import type { RecordDocumentLookupResponse } from '@endora-commerce/contracts';

/**
 * What a run of `@`s may ask for in the reference editor
 * (`specs/163-projects-and-tasks/` research R-14, R-17, FR-044).
 *
 * One standard in every module, three kinds, one per run length: `@` a person
 * (`admin_user`), `@@` a **document** — one list grouped Orders · Quote
 * Requests · Tasks — and `@@@` a Product. A screen passes the kinds its reader
 * may use; there is no other trigger table.
 */
export type ReferenceTriggerKind = 'admin_user' | 'document' | 'product';

/** The standard trigger table: `@` a person, `@@` a document, `@@@` a Product. */
export const REFERENCE_TRIGGER_KINDS: readonly ReferenceTriggerKind[] = ['admin_user', 'document', 'product'];

/** How many `@`s ask for each kind. */
export const REFERENCE_TRIGGER_LENGTH: Readonly<Record<ReferenceTriggerKind, 1 | 2 | 3>> = {
  admin_user: 1,
  document: 2,
  product: 3,
};

/** One thing a reference may be made to, as a list offers it. */
export interface ReferenceSuggestion {
  id: string;
  /** What the chip will say: a name, a number. */
  label: string;
  /** A second, quieter line — a SKU, a Task's title. */
  description?: string;
}

/**
 * Where the editor's suggestions come from — the screen's own lookups, behind
 * its own permissions. A kind offered without its search offers nothing.
 *
 * Each search is asked with what was typed after the `@`s (`''` for none) and
 * answers already-labelled suggestions: a person's name, a Product's name in
 * the language on screen, a document's number.
 */
export interface ReferenceLookups {
  searchPeople?: (query: string) => Promise<readonly ReferenceSuggestion[]>;
  /** The `@@` document list — one schema for every module (FR-044). */
  searchDocuments?: (query: string) => Promise<RecordDocumentLookupResponse>;
  searchProducts?: (query: string) => Promise<readonly ReferenceSuggestion[]>;
}
