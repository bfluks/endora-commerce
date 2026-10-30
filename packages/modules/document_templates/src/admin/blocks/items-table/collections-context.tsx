import { createContext, useContext, type ReactNode } from 'react';
import type {
  DocumentCollectionDetail,
  DocumentFieldDefinition,
  DocumentItem,
  DocumentItemSection,
  DocumentValue,
} from '@endora-commerce/contracts';

/** A served collection, read through the declared shapes rather than the wire schema's inferred ones. */
export interface CollectionView {
  readonly key: string;
  readonly fields: readonly DocumentFieldDefinition[];
  readonly summaryFields: readonly DocumentFieldDefinition[];
  readonly sampleItems: readonly DocumentItem[];
  readonly sampleSummary: Readonly<Record<string, DocumentValue>>;
  /** Feature 159 — the sample's sections; `[]` when the type declares none (an older server: absent). */
  readonly sampleSections?: readonly DocumentItemSection[];
}

/**
 * The line collections of the edited document type, in the edited language
 * (`specs/153-quote-request-pdf-template/contracts/admin-ui.md` §2) — what the
 * Line items table's canvas draws over and its fields choose from. The editor
 * page provides the type detail's `collections`; nothing else does, so outside
 * the editor the table has no lines and says so.
 *
 * The field editors read the first collection: Puck hands a custom field its
 * own value and not its siblings', and every document type in the platform
 * declares one collection. The canvas follows the block's `collection` prop.
 */
interface CollectionsValue {
  readonly collections: readonly DocumentCollectionDetail[];
  /** The edited language — what the canvas formats values in, as the PDF will. */
  readonly language: string;
}
const DocumentCollectionsContext = createContext<CollectionsValue>({ collections: [], language: 'en-US' });

export function DocumentCollectionsProvider({
  value,
  language,
  children,
}: {
  value: readonly DocumentCollectionDetail[];
  language: string;
  children: ReactNode;
}): ReactNode {
  return <DocumentCollectionsContext.Provider value={{ collections: value, language }}>{children}</DocumentCollectionsContext.Provider>;
}

export function useDocumentCollections(): readonly CollectionView[] {
  return useContext(DocumentCollectionsContext).collections as unknown as readonly CollectionView[];
}

export function useDocumentLanguage(): string {
  return useContext(DocumentCollectionsContext).language;
}

/** A stable empty catalogue, so a hook's dependencies do not change on every render. */
export const NO_FIELDS: readonly DocumentFieldDefinition[] = [];

/** A collection by key, else the first one. */
export function useCollection(key?: unknown): CollectionView | undefined {
  const collections = useDocumentCollections();
  return (typeof key === 'string' && key !== '' ? collections.find((c) => c.key === key) : undefined) ?? collections[0];
}

/** The picker's group of a field: the three the platform names, anything else under *Other*. */
export function groupOf(field: DocumentFieldDefinition): 'line' | 'pricing' | 'product' | 'other' {
  return field.group === 'line' || field.group === 'pricing' || field.group === 'product' ? field.group : 'other';
}

/** A short, stable id for a new column — unique within the block. */
export function newColumnId(taken: readonly string[]): string {
  for (let n = taken.length + 1; ; n += 1) {
    const id = `c${n}`;
    if (!taken.includes(id)) return id;
  }
}
