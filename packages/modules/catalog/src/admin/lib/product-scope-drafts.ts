import {
  effectiveStatus,
  type PatchProductScopesRequest,
  type ProductScopes,
  type ProductScopeStatus,
  type ProductVisibility,
} from '@endora-commerce/contracts';

/**
 * Feature 163 (US1–US3, FR-012, FR-023, FR-030, FR-040) — the pure half of the product
 * editor's scope controls: local time ↔ ISO for `datetime-local`, the editable draft of
 * one channel's scope row, and the diff that becomes `PATCH …/scopes`. Kept out of the
 * component so every rule here is assertable without rendering.
 */

export type ChannelScope = ProductScopes['channels'][number];
export type GlobalScope = ProductScopes['global'];
export type ChannelScopePatch = PatchProductScopesRequest['channels'][number];

// --- Local time ↔ ISO (FR-023, A-10) ------------------------------------------------

const pad = (n: number): string => String(n).padStart(2, '0');

/**
 * An ISO instant as the `datetime-local` value the operator sees — their own zone, to the
 * minute (the input's resolution). `''` for no value.
 */
export function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

export type LocalInputParse = { ok: true; value: string | null } | { ok: false };

/**
 * A `datetime-local` value as an ISO instant. Empty (or whitespace) = an open side
 * (`null`). A date-time string without an offset is local time by ECMAScript's own rule,
 * which is exactly the operator's zone.
 */
export function localInputToIso(raw: string): LocalInputParse {
  const value = raw.trim();
  if (value === '') return { ok: true, value: null };
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?$/.test(value)) return { ok: false };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { ok: false };
  return { ok: true, value: date.toISOString() };
}

export type WindowCheck =
  | { ok: true; from: string | null; until: string | null }
  | { ok: false; field: 'from' | 'until'; reason: 'invalidDate' | 'order' };

/** Both sides parsed, and a bounded window must start before it ends (FR-023). */
export function checkWindowInputs(fromInput: string, untilInput: string): WindowCheck {
  const from = localInputToIso(fromInput);
  if (!from.ok) return { ok: false, field: 'from', reason: 'invalidDate' };
  const until = localInputToIso(untilInput);
  if (!until.ok) return { ok: false, field: 'until', reason: 'invalidDate' };
  if (from.value !== null && until.value !== null && Date.parse(from.value) >= Date.parse(until.value)) {
    return { ok: false, field: 'until', reason: 'order' };
  }
  return { ok: true, from: from.value, until: until.value };
}

// --- Status and its source (FR-040) -------------------------------------------------

export type StatusSource = 'channel_language' | 'channel' | 'global';

/** The value an inheriting scope would take, and where it comes from. */
export function inheritedStatus(
  globalStatus: ProductScopeStatus,
  channelStatus: ProductScopeStatus | null,
): { value: ProductScopeStatus; source: 'channel' | 'global' } {
  return channelStatus === null
    ? { value: globalStatus, source: 'global' }
    : { value: effectiveStatus({ status: globalStatus }, { status: channelStatus }, undefined), source: 'channel' };
}

// --- One channel's draft ------------------------------------------------------------

export interface ChannelScopeDraft {
  status: ProductScopeStatus | null;
  /** Every language of the channel plus every orphaned language row; `null` = inherit. */
  languageStatuses: Record<string, ProductScopeStatus | null>;
  windowOverride: boolean;
  windowFrom: string;
  windowUntil: string;
  audienceOverride: boolean;
  visibility: ProductVisibility;
  allowedOrganizationIds: string[];
}

/**
 * The draft a channel starts from. An inheriting window or audience starts from the
 * global values, so ticking "set for this channel" begins with what applies today rather
 * than from nothing (Tesler).
 */
export function draftFromChannelScope(
  global: GlobalScope,
  row: ChannelScope | undefined,
  channelLanguages: readonly string[],
): ChannelScopeDraft {
  const languageStatuses: Record<string, ProductScopeStatus | null> = {};
  for (const code of channelLanguages) languageStatuses[code] = null;
  for (const entry of row?.languageStatuses ?? []) languageStatuses[entry.languageCode] = entry.status;
  const window = row?.window ?? null;
  const audience = row?.audience ?? null;
  return {
    status: row?.status ?? null,
    languageStatuses,
    windowOverride: window !== null,
    windowFrom: isoToLocalInput(window ? window.from : global.publishFrom),
    windowUntil: isoToLocalInput(window ? window.until : global.publishUntil),
    audienceOverride: audience !== null,
    visibility: audience?.visibility ?? global.visibility,
    allowedOrganizationIds: [...(audience?.allowedOrganizationIds ?? global.allowedOrganizationIds)],
  };
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((v) => set.has(v));
}

export type ChannelPatchResult =
  | { ok: true; patch: ChannelScopePatch | null }
  | { ok: false; field: 'from' | 'until'; reason: 'invalidDate' | 'order' };

/**
 * The `PATCH …/scopes` entry for one channel: only the keys whose value changed — an
 * absent key is untouched and `null` is "use inherited" (FR-012). `null` patch = nothing
 * changed. Windows are compared in their local rendering, so a stored instant with seconds
 * the input cannot show is not re-sent on every save.
 */
export function buildChannelPatch(
  channelId: string,
  saved: ChannelScopeDraft,
  draft: ChannelScopeDraft,
): ChannelPatchResult {
  const patch: ChannelScopePatch = { channelId };
  let changed = false;

  if (draft.status !== saved.status) {
    patch.status = draft.status;
    changed = true;
  }

  const languageStatuses = Object.keys(draft.languageStatuses)
    .sort()
    .filter((code) => (draft.languageStatuses[code] ?? null) !== (saved.languageStatuses[code] ?? null))
    .map((code) => ({ languageCode: code, status: draft.languageStatuses[code] ?? null }));
  if (languageStatuses.length > 0) {
    patch.languageStatuses = languageStatuses;
    changed = true;
  }

  const windowChanged =
    draft.windowOverride !== saved.windowOverride ||
    (draft.windowOverride && (draft.windowFrom !== saved.windowFrom || draft.windowUntil !== saved.windowUntil));
  if (windowChanged) {
    if (draft.windowOverride) {
      const check = checkWindowInputs(draft.windowFrom, draft.windowUntil);
      if (!check.ok) return check;
      patch.window = { from: check.from, until: check.until };
    } else {
      patch.window = null;
    }
    changed = true;
  }

  const audienceChanged =
    draft.audienceOverride !== saved.audienceOverride ||
    (draft.audienceOverride &&
      (draft.visibility !== saved.visibility ||
        (draft.visibility === 'organization_restricted' &&
          !sameSet(draft.allowedOrganizationIds, saved.allowedOrganizationIds))));
  if (audienceChanged) {
    patch.audience = draft.audienceOverride
      ? {
          visibility: draft.visibility,
          allowedOrganizationIds:
            draft.visibility === 'organization_restricted' ? [...draft.allowedOrganizationIds] : [],
        }
      : null;
    changed = true;
  }

  return { ok: true, patch: changed ? patch : null };
}
