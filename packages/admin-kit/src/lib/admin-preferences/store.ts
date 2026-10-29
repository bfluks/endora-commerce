import {
  ADMIN_PREFERENCES_DEFAULTS,
  type AdminListPageSize,
  type AdminPreferenceKey,
  type AdminPreferences,
} from '@endora-commerce/contracts';

/**
 * Feature 164 — the signed-in admin's preferences store, without React
 * (`specs/164-admin-user-preferences/contracts/admin-preferences-client.md` §1).
 *
 * - **Optimistic.** `set` updates the value synchronously; the UI re-renders
 *   before any request (FR-017).
 * - **One write in flight per key**, only the newest value waiting behind it, so
 *   the server never ends holding an older value than the UI shows and no
 *   request is sent out of order. No debounce: coalescing gives the same economy
 *   without delaying a save the tab might not live to send.
 * - **A failure keeps the value**, marks the key unsaved and raises the notice
 *   once per failure episode; the next success ends the episode. Unsaved keys
 *   are retried on reconnect, on foreground and on their next change.
 * - **Refetch on foreground** adopts the server's value for every key with no
 *   local work in flight, pending or unsaved (FR-019); a write's response
 *   updates only the key it wrote.
 * - **Unavailable mode** (FR-018): the session carried no preferences. Defaults
 *   are shown, nothing is sent, and the admin's changes are recorded as deltas;
 *   once loading succeeds they are applied onto the loaded values and only the
 *   touched keys are written — defaults are never saved over stored values.
 */

export const PREFERENCES_URL = '/api/v1/admin/me/preferences';

export type Availability = 'available' | 'unavailable';

/** The slice of the kit's API client the store talks through. */
export interface PreferencesTransport {
  get<T>(path: string): Promise<T>;
  patch<T>(path: string, body: unknown): Promise<T>;
}

interface KeyState {
  inFlight: boolean;
  /** A newer value was set while a write was in flight; send it next. */
  pending: boolean;
  unsaved: boolean;
}

export interface PreferencesSnapshot {
  readonly values: AdminPreferences;
  readonly availability: Availability;
  readonly unsavedNotice: boolean;
}

interface Deltas {
  pinsAdded: string[];
  pinsRemoved: Set<string>;
  folded: Set<string>;
  unfolded: Set<string>;
  rail?: boolean;
  lists: Map<string, AdminListPageSize | null>;
}

const KEYS: readonly AdminPreferenceKey[] = [
  'sidebarPins',
  'sidebarCollapsedGroups',
  'sidebarRailMode',
  'listPageSizes',
];

function emptyDeltas(): Deltas {
  return {
    pinsAdded: [],
    pinsRemoved: new Set(),
    folded: new Set(),
    unfolded: new Set(),
    lists: new Map(),
  };
}

/** The value of one key from a server document, or `undefined` when it has the wrong type. */
function remoteValue<K extends AdminPreferenceKey>(
  doc: unknown,
  key: K,
): AdminPreferences[K] | undefined {
  if (typeof doc !== 'object' || doc === null) return undefined;
  const value = (doc as Record<string, unknown>)[key];
  switch (key) {
    case 'sidebarPins':
    case 'sidebarCollapsedGroups':
      return Array.isArray(value) && value.every((v) => typeof v === 'string')
        ? (value as AdminPreferences[K])
        : undefined;
    case 'sidebarRailMode':
      return typeof value === 'boolean' ? (value as AdminPreferences[K]) : undefined;
    case 'listPageSizes':
      return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? ({ ...(value as Record<string, number>) } as AdminPreferences[K])
        : undefined;
    default:
      return undefined;
  }
}

export class AdminPreferencesStore {
  private values: AdminPreferences;
  private availability: Availability;
  private unsavedNotice = false;
  /** A failure episode is open: no further notice until a success closes it. */
  private episodeOpen = false;
  private readonly state: Record<AdminPreferenceKey, KeyState>;
  /** Lists changed since they were last sent successfully. */
  private readonly dirtyLists = new Set<string>();
  /** Lists carried by the `listPageSizes` write in flight. */
  private inFlightLists = new Set<string>();
  private deltas: Deltas = emptyDeltas();
  private touched = new Set<AdminPreferenceKey>();
  private refetching = false;
  private loading = false;
  private snapshot: PreferencesSnapshot;
  private readonly listeners = new Set<() => void>();
  private readonly availableListeners = new Set<() => void>();

  constructor(
    initial: AdminPreferences | null,
    private readonly transport: PreferencesTransport,
  ) {
    this.availability = initial === null ? 'unavailable' : 'available';
    this.values = structuredClone(initial ?? ADMIN_PREFERENCES_DEFAULTS);
    this.state = Object.fromEntries(
      KEYS.map((key) => [key, { inFlight: false, pending: false, unsaved: false }]),
    ) as Record<AdminPreferenceKey, KeyState>;
    this.snapshot = this.buildSnapshot();
  }

  // ---- reading ------------------------------------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): PreferencesSnapshot => this.snapshot;

  get<K extends AdminPreferenceKey>(key: K): AdminPreferences[K] {
    return this.values[key];
  }

  isAvailable(): boolean {
    return this.availability === 'available';
  }

  /** Called once each time the store becomes available (and now, if it is). */
  onAvailable(listener: () => void): () => void {
    this.availableListeners.add(listener);
    return () => this.availableListeners.delete(listener);
  }

  // ---- writing ------------------------------------------------------------

  set<K extends Exclude<AdminPreferenceKey, 'listPageSizes'>>(
    key: K,
    next: AdminPreferences[K],
  ): void {
    const previous = this.values[key];
    this.values = { ...this.values, [key]: next };
    this.emit();
    if (this.availability === 'unavailable') {
      this.recordDelta(key, previous, next);
      void this.tryLoad();
      return;
    }
    this.write(key);
  }

  /** One list's page size; `null` forgets it. Only that list goes on the wire. */
  setListPageSize(list: string, size: AdminListPageSize | null): void {
    const sizes = { ...this.values.listPageSizes };
    if (size === null) delete sizes[list];
    else sizes[list] = size;
    this.values = { ...this.values, listPageSizes: sizes };
    this.emit();
    if (this.availability === 'unavailable') {
      this.deltas.lists.set(list, size);
      this.touched.add('listPageSizes');
      void this.tryLoad();
      return;
    }
    this.dirtyLists.add(list);
    this.write('listPageSizes');
  }

  /**
   * Adopt page sizes the carry-over got back from the server, except for lists
   * with local work in flight, pending or unsaved.
   */
  adoptListPageSizes(remote: Readonly<Record<string, number>>): void {
    const local = this.values.listPageSizes;
    const merged: Record<string, number> = { ...remote };
    for (const list of [...this.dirtyLists, ...this.inFlightLists]) {
      if (list in local) merged[list] = local[list]!;
      else delete merged[list];
    }
    this.values = { ...this.values, listPageSizes: merged };
    this.emit();
  }

  dismissNotice = (): void => {
    if (!this.unsavedNotice) return;
    this.unsavedNotice = false;
    this.emit();
  };

  // ---- triggers -----------------------------------------------------------

  /** `online`: retry what is unsaved, or load what never loaded. */
  handleOnline(): void {
    if (this.availability === 'unavailable') {
      void this.tryLoad();
      return;
    }
    this.retryUnsaved();
  }

  /** `visibilitychange` → visible: retry, then refetch (FR-019). */
  handleForeground(): void {
    if (this.availability === 'unavailable') {
      void this.tryLoad();
      return;
    }
    this.retryUnsaved();
    void this.refetch();
  }

  /** A newer `/admin/me` for the same admin: treated as a refetch result. */
  adoptRemote(doc: AdminPreferences): void {
    if (this.availability === 'unavailable') return;
    this.adoptIdle(doc);
  }

  // ---- internals ----------------------------------------------------------

  private write(key: AdminPreferenceKey): void {
    const state = this.state[key];
    if (state.inFlight) {
      state.pending = true;
      return;
    }
    void this.send(key);
  }

  private retryUnsaved(): void {
    for (const key of KEYS) {
      const state = this.state[key];
      if (state.unsaved && !state.inFlight) void this.send(key);
    }
  }

  private async send(key: AdminPreferenceKey): Promise<void> {
    const state = this.state[key];
    state.inFlight = true;
    state.pending = false;
    let body: Partial<Record<AdminPreferenceKey, unknown>>;
    if (key === 'listPageSizes') {
      this.inFlightLists = new Set(this.dirtyLists);
      this.dirtyLists.clear();
      const sizes = this.values.listPageSizes;
      body = {
        listPageSizes: Object.fromEntries(
          [...this.inFlightLists].map((list) => [list, sizes[list] ?? null]),
        ),
      };
    } else {
      body = { [key]: this.values[key] };
    }
    try {
      const response = await this.transport.patch<{ data: AdminPreferences }>(
        PREFERENCES_URL,
        body,
      );
      state.inFlight = false;
      state.unsaved = false;
      if (key === 'listPageSizes') this.inFlightLists = new Set();
      if (!state.pending && (key !== 'listPageSizes' || this.dirtyLists.size === 0)) {
        const adopted = remoteValue(response.data, key);
        if (adopted !== undefined) this.values = { ...this.values, [key]: adopted };
      }
      if (!KEYS.some((k) => this.state[k].unsaved)) {
        this.episodeOpen = false;
        this.unsavedNotice = false;
      }
      this.emit();
      if (state.pending) void this.send(key);
    } catch {
      state.inFlight = false;
      state.unsaved = true;
      // The newest value is already in `values`; it goes out on the next trigger.
      state.pending = false;
      if (key === 'listPageSizes') {
        for (const list of this.inFlightLists) this.dirtyLists.add(list);
        this.inFlightLists = new Set();
      }
      if (!this.episodeOpen) {
        this.episodeOpen = true;
        this.unsavedNotice = true;
      }
      this.emit();
    }
  }

  private async refetch(): Promise<void> {
    if (this.refetching) return;
    this.refetching = true;
    try {
      const response = await this.transport.get<{ data: AdminPreferences }>(PREFERENCES_URL);
      this.adoptIdle(response.data);
    } catch {
      // Nothing to do: the values on screen stand, and the next foreground tries again.
    } finally {
      this.refetching = false;
    }
  }

  private adoptIdle(doc: unknown): void {
    let changed = false;
    const next: AdminPreferences = { ...this.values };
    for (const key of KEYS) {
      const state = this.state[key];
      if (state.inFlight || state.pending || state.unsaved) continue;
      if (key === 'listPageSizes' && this.dirtyLists.size > 0) continue;
      const value = remoteValue(doc, key);
      if (value === undefined) continue;
      (next as Record<AdminPreferenceKey, unknown>)[key] = value;
      changed = true;
    }
    if (!changed) return;
    this.values = next;
    this.emit();
  }

  private recordDelta<K extends Exclude<AdminPreferenceKey, 'listPageSizes'>>(
    key: K,
    previous: AdminPreferences[K],
    next: AdminPreferences[K],
  ): void {
    this.touched.add(key);
    const d = this.deltas;
    if (key === 'sidebarRailMode') {
      d.rail = next as boolean;
      return;
    }
    const before = new Set(previous as readonly string[]);
    const after = new Set(next as readonly string[]);
    const added = [...after].filter((x) => !before.has(x));
    const removed = [...before].filter((x) => !after.has(x));
    if (key === 'sidebarPins') {
      for (const a of added) {
        if (d.pinsRemoved.has(a)) d.pinsRemoved.delete(a);
        else if (!d.pinsAdded.includes(a)) d.pinsAdded.push(a);
      }
      for (const r of removed) {
        const index = d.pinsAdded.indexOf(r);
        if (index >= 0) d.pinsAdded.splice(index, 1);
        else d.pinsRemoved.add(r);
      }
      return;
    }
    for (const g of added) {
      d.unfolded.delete(g);
      d.folded.add(g);
    }
    for (const g of removed) {
      d.folded.delete(g);
      d.unfolded.add(g);
    }
  }

  /** Unavailable mode: try to load; on success replay the deltas and write the touched keys. */
  private async tryLoad(): Promise<void> {
    if (this.loading || this.availability === 'available') return;
    this.loading = true;
    try {
      const response = await this.transport.get<{ data: AdminPreferences }>(PREFERENCES_URL);
      if (this.isAvailable()) return;
      const loaded: AdminPreferences = structuredClone(ADMIN_PREFERENCES_DEFAULTS);
      for (const key of KEYS) {
        const value = remoteValue(response.data, key);
        if (value !== undefined) (loaded as Record<AdminPreferenceKey, unknown>)[key] = value;
      }
      const d = this.deltas;
      const touched = this.touched;
      if (touched.has('sidebarPins')) {
        const kept = loaded.sidebarPins.filter((p) => !d.pinsRemoved.has(p));
        loaded.sidebarPins = [...kept, ...d.pinsAdded.filter((p) => !kept.includes(p))];
      }
      if (touched.has('sidebarCollapsedGroups')) {
        const groups = new Set([...loaded.sidebarCollapsedGroups, ...d.folded]);
        for (const g of d.unfolded) groups.delete(g);
        loaded.sidebarCollapsedGroups = [...groups];
      }
      if (touched.has('sidebarRailMode') && d.rail !== undefined) {
        loaded.sidebarRailMode = d.rail;
      }
      if (touched.has('listPageSizes')) {
        for (const [list, size] of d.lists) {
          if (size === null) delete loaded.listPageSizes[list];
          else loaded.listPageSizes[list] = size;
          this.dirtyLists.add(list);
        }
      }
      this.values = loaded;
      this.availability = 'available';
      this.deltas = emptyDeltas();
      this.touched = new Set();
      this.emit();
      for (const key of touched) void this.send(key);
      for (const listener of [...this.availableListeners]) listener();
    } catch {
      // Still unavailable; the next `online`, foreground or change tries again.
    } finally {
      this.loading = false;
    }
  }

  private buildSnapshot(): PreferencesSnapshot {
    return {
      values: this.values,
      availability: this.availability,
      unsavedNotice: this.unsavedNotice,
    };
  }

  private emit(): void {
    this.snapshot = this.buildSnapshot();
    for (const listener of [...this.listeners]) listener();
  }
}
