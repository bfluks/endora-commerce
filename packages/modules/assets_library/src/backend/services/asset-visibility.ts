import {
  ADMIN_PERMISSION_WILDCARD,
  ERROR_CODES,
  isAssetIdShaped,
  type AssetReference,
  type AssetReferenceDescriptor,
  type AssetReferenceHit,
  type PermissionReadPort,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import type { AssetReferenceRegistry } from './reference-registry.js';

/**
 * Which assets a library reader may see (`specs/166-asset-reference-visibility/`
 * data-model §2, research R-3 – R-7) — **the one evaluator**: the by-id guard,
 * the list, move-many, the detail's references and `assetReadPort.visibleToCaller`
 * all ask it, so the rule has one implementation.
 *
 * **The rule (FR-001).** An asset is visible unless every reference to it is
 * reader-restricted and the caller may see none of the referencing records.
 * An asset no record uses, or one an unrestricted kind (a product, a page)
 * uses, is visible to every reader.
 *
 * **Who asks (R-3)**, decided from the ambient tenant context once per request:
 * the system actor and a holder of the platform wildcard `*` are unrestricted
 * and cost nothing; any other administrator asks each present owner; anybody
 * else — no context, a customer, an API key — sees no restricted record
 * (fail closed). The wildcard is read through `permissionService.listPermissions`,
 * which answers an administrator without a role with nothing rather than a
 * refusal.
 *
 * **An owner switched off (R-4, FR-009)** is decided here, per evaluation, and
 * never asked anything about visibility: its references are hidden from every
 * restricted caller, and its contribution to a list's candidates is
 * `allReferencedAssetIds()` — plain SQL over its tables. Switching it back on
 * restores the answer without a write. A `ModuleDisabledError` is never caught.
 *
 * **Enumeration is not this.** The registry's `findReferences` still asks every
 * descriptor whoever asks — the deletion guard counts every reference (FR-008).
 */

/** Who the ambient caller is, for visibility (data-model §2.1). */
export type AssetCaller =
  | { readonly kind: 'unrestricted'; readonly why: 'system' | 'wildcard' }
  | { readonly kind: 'admin'; readonly adminUserId: string }
  | { readonly kind: 'nobody' };

/** The part of the tenant context the classification reads. */
export interface AssetVisibilityContext {
  readonly actor: { readonly kind: string; readonly id?: string };
}

export interface AssetVisibilityDeps {
  registry: Pick<AssetReferenceRegistry, 'partition' | 'referencesOf' | 'inRegistrationOrder'>;
  /** `effectiveState.isPresent`, read per evaluation. */
  isPresent: (moduleId: string) => boolean;
  /** `admin_roles`' `permissionService`, resolved per call. */
  permissions: () => Pick<PermissionReadPort, 'listPermissions'>;
  /** The ambient tenant context. */
  tenantContext: () => AssetVisibilityContext | undefined;
}

/**
 * The answer for an asset the caller cannot have — missing or hidden alike,
 * byte for byte (FR-012). Every not-found of the library throws through it.
 */
export function assetNotFound(assetId: string): HttpError {
  return new HttpError(404, ERROR_CODES.ASSET_NOT_FOUND, `Asset ${assetId} not found.`);
}

/** The wire shape of a reference: the descriptor's `assetId` never leaves the library. */
function toReference(hit: AssetReferenceHit): AssetReference {
  return { kind: hit.kind, entityId: hit.entityId, label: hit.label };
}

export class AssetVisibility {
  /** One classification per tenant context — that is, per request (R-3). */
  readonly #callers = new WeakMap<AssetVisibilityContext, Promise<AssetCaller>>();

  constructor(private readonly deps: AssetVisibilityDeps) {}

  /** The ambient caller's class, memoised for the request's tenant context. */
  caller(): Promise<AssetCaller> {
    const context = this.deps.tenantContext();
    if (context === undefined) return Promise.resolve({ kind: 'nobody' });
    const known = this.#callers.get(context);
    if (known) return known;
    const classified = this.#classify(context);
    this.#callers.set(context, classified);
    return classified;
  }

  async #classify(context: AssetVisibilityContext): Promise<AssetCaller> {
    const { actor } = context;
    if (actor.kind === 'system') return { kind: 'unrestricted', why: 'system' };
    if (actor.kind !== 'admin' || !actor.id) return { kind: 'nobody' };
    const held = await this.deps.permissions().listPermissions(actor.id);
    return held.includes(ADMIN_PERMISSION_WILDCARD)
      ? { kind: 'unrestricted', why: 'wildcard' }
      : { kind: 'admin', adminUserId: actor.id };
  }

  /** Whether a restricted owner may be asked about visibility for this caller now. */
  #asksOwner(caller: AssetCaller, descriptor: AssetReferenceDescriptor): boolean {
    return caller.kind === 'admin' && this.deps.isPresent(descriptor.ownerModuleId);
  }

  /**
   * Of these asset ids, the ones the caller may **not** see (data-model §2.3).
   * Ids are not checked for existence: a missing id with no reference is
   * simply not hidden. Constant in the number of statements, whatever the size
   * of `ids` (FR-014):
   *
   * 1. each restricted descriptor's references to `ids`, once;
   * 2. each present owner's visible records among its hits, once (admins only);
   * 3. `pending` = the ids with a restricted reference and no visible one;
   * 4. the unrestricted descriptors' references to `pending` only — any hit
   *    rescues the asset (FR-001 b).
   */
  async hiddenAmong(ids: readonly string[]): Promise<Set<string>> {
    const caller = await this.caller();
    if (caller.kind === 'unrestricted') return new Set();
    return this.#hiddenAmong(caller, [...new Set(ids)], 'pending');
  }

  /**
   * `hiddenAmong`'s steps. `rescue` says which ids step 4 asks about:
   * - `'pending'` — only the ids steps 1–3 left pending, after they answered;
   * - `'all'` — every asked id, **while** steps 1–2 run. For a list's
   *   candidates, which all have a hidden restricted reference by construction,
   *   the two sets differ only by the few with a visible one too, and not
   *   waiting for the owners is what keeps the restricted reader's list within
   *   SC-004 (T049). The statements are the same, one per descriptor.
   */
  async #hiddenAmong(caller: AssetCaller, asked: readonly string[], rescue: 'pending' | 'all'): Promise<Set<string>> {
    if (asked.length === 0) return new Set();
    const { restricted, unrestricted } = this.deps.registry.partition();
    const rescueAmong = async (assetIds: readonly string[]): Promise<Set<string>> => {
      const rescued = new Set<string>();
      if (assetIds.length === 0) return rescued;
      await Promise.all(
        unrestricted.map(async (descriptor) => {
          const byAsset = await this.deps.registry.referencesOf(descriptor, [...assetIds]);
          for (const [assetId, list] of byAsset) if (list.length > 0) rescued.add(assetId);
        }),
      );
      return rescued;
    };
    const eagerRescue = rescue === 'all' ? rescueAmong(asked) : undefined;

    const withRestricted = new Set<string>();
    const visible = new Set<string>();
    await Promise.all(
      restricted.map(async (descriptor) => {
        const byAsset = await this.deps.registry.referencesOf(descriptor, [...asked]);
        const hits = [...byAsset.entries()].filter(([, list]) => list.length > 0);
        if (hits.length === 0) return;
        for (const [assetId] of hits) withRestricted.add(assetId);
        if (!this.#asksOwner(caller, descriptor)) return;
        const entityIds = [...new Set(hits.flatMap(([, list]) => list.map((hit) => hit.entityId)))];
        const seen = await descriptor.readerRestriction!.visibleEntityIds(entityIds);
        for (const [assetId, list] of hits) {
          if (list.some((hit) => seen.has(hit.entityId))) visible.add(assetId);
        }
      }),
    );

    const pending = [...withRestricted].filter((id) => !visible.has(id));
    const rescued = await (eagerRescue ?? rescueAmong(pending));
    return new Set(pending.filter((id) => !rescued.has(id)));
  }

  /**
   * The ids a list must leave out, for the caller (data-model §2.4, R-5).
   * `scope` narrows the candidates to the rows the list itself could return —
   * its own folder and filters — in one library statement, so only those are
   * evaluated. Each restricted descriptor is asked once, in parallel; nothing
   * is scoped or evaluated when no descriptor names a candidate. The
   * unrestricted descriptors are asked about every scoped candidate alongside
   * the owners rather than after them (T049).
   */
  async exclusionFor(scope: (candidates: readonly string[]) => Promise<readonly string[]>): Promise<string[]> {
    const caller = await this.caller();
    if (caller.kind === 'unrestricted') return [];
    const { restricted } = this.deps.registry.partition();
    const perDescriptor = await Promise.all(
      restricted.map((descriptor) =>
        this.#asksOwner(caller, descriptor)
          ? descriptor.readerRestriction!.assetIdsWithHiddenReferences()
          : descriptor.readerRestriction!.allReferencedAssetIds(),
      ),
    );
    const candidates = [...new Set(perDescriptor.flat())];
    if (candidates.length === 0) return [];
    const scoped = await scope(candidates);
    if (scoped.length === 0) return [];
    return [...(await this.#hiddenAmong(caller, [...new Set(scoped)], 'all'))];
  }

  /**
   * The references of one asset the caller may be told about (FR-007, R-8):
   * every unrestricted reference, plus the restricted references whose record
   * a present owner says the caller may see — all of them for an unrestricted
   * caller. `assetId` is stripped: the wire shape is `AssetReference`. The
   * registry's order is kept, so a caller who may see every reference gets
   * today's list unchanged.
   *
   * Invariant I-1 follows from FR-001: a visible asset with references has at
   * least one visible reference.
   */
  async visibleReferences(assetId: string): Promise<AssetReference[]> {
    const caller = await this.caller();
    const perDescriptor = await Promise.all(
      this.deps.registry.inRegistrationOrder().map(async (descriptor) => {
        const hits = await descriptor.findReferences([assetId]);
        if (!descriptor.readerRestriction || caller.kind === 'unrestricted' || hits.length === 0) return hits;
        if (!this.#asksOwner(caller, descriptor)) return [];
        const seen = await descriptor.readerRestriction.visibleEntityIds([...new Set(hits.map((hit) => hit.entityId))]);
        return hits.filter((hit) => seen.has(hit.entityId));
      }),
    );
    return perDescriptor.flat().map(toReference);
  }

  /**
   * The by-id guard's question (R-7): pass, or throw the error a missing row
   * gets. The restricted descriptors are asked whether or not the row exists,
   * so a hidden id and a missing one issue the same first reads.
   *
   * **Only the canonical spelling passes** (review T055, F-1). Postgres also
   * reads a uuid without hyphens, in braces or grouped otherwise, so an id
   * that is not canonical may still name a row — and the owners, whose hits
   * are keyed by the canonical id, would not match it. Any such spelling
   * answers as a missing asset, for every caller and asking nobody; the
   * canonical form in upper case is checked — and refused — as its lower-case
   * self, which is the id the service names when the row is missing. Answers
   * the id the handler must use from here on, always lower case.
   */
  async assertVisible(assetId: string): Promise<string> {
    if (!isAssetIdShaped(assetId)) throw assetNotFound(assetId);
    const canonical = assetId.toLowerCase();
    if ((await this.hiddenAmong([canonical])).has(canonical)) throw assetNotFound(canonical);
    return canonical;
  }
}
