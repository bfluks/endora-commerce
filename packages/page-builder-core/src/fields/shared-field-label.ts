/**
 * The fields every block shares, translated **once**
 * (`specs/163-page-builder-marketing-pages/` R17, T200).
 *
 * A block's field label is translated from the declaring module's bundle
 * (research R-24: `<stem>.fields.<field>.label`). The fields below are not a
 * block's: they are this package's or `cms-components`' shared definitions —
 * the editor's name, "Hide on", the box spacing and border, the background,
 * corners, shadow and the text typography — and copying their translation into
 * every block of every module is how a block ends up untranslated. A shared
 * field carries a marker naming its key in the `core` bundle
 * (`pageBuilder.sharedFields.<key>.label`, `….options.<value>`), which the admin
 * reads **after** the block's own key and **before** the English.
 *
 * The marker records the English label it was made with, and is honoured only
 * while the field still carries that label: a block that relabels a shared
 * field for one placement (`{ ...CORNER_RADIUS_FIELD, label: 'Card – rounded corners' }`)
 * means something narrower and needs its own key, not the shared one.
 */

export const PAGE_BUILDER_SHARED_FIELD_KEYS = [
  'editorName',
  'hideOn',
  'stackOrder',
  'margin',
  'padding',
  'border',
  'background',
  'cornerRadius',
  'shadow',
  'color',
  'fontFamily',
  'fontStyle',
  'fontSize',
  'fontWeight',
  'textAlign',
  'lineHeight',
  'minHeight',
] as const;

export type PageBuilderSharedFieldKey = (typeof PAGE_BUILDER_SHARED_FIELD_KEYS)[number];

export interface SharedFieldLabel {
  key: PageBuilderSharedFieldKey;
  /** The English label the marker was made with. */
  en: string;
}

type WithMetadata = { label?: string; metadata?: Record<string, unknown> };

/** `field` marked as the shared field `key`; its metadata is kept (e.g. the responsive flag). */
export function withSharedFieldLabel<F extends object>(key: PageBuilderSharedFieldKey, field: F): F {
  const own = field as F & WithMetadata;
  const metadata = (own.metadata ?? {}) as { pageBuilder?: Record<string, unknown> };
  return {
    ...field,
    metadata: {
      ...metadata,
      pageBuilder: { ...(metadata.pageBuilder ?? {}), sharedLabel: { key, en: own.label ?? '' } },
    },
  };
}

/** The shared key of `field`, while it still carries the label it was marked with. */
export function sharedFieldLabel(field: unknown): SharedFieldLabel | undefined {
  if (!field || typeof field !== 'object') return undefined;
  const { label, metadata } = field as WithMetadata;
  const marker = (metadata as { pageBuilder?: { sharedLabel?: unknown } } | undefined)?.pageBuilder?.sharedLabel;
  if (!marker || typeof marker !== 'object') return undefined;
  const { key, en } = marker as Partial<SharedFieldLabel>;
  if (typeof key !== 'string' || !(PAGE_BUILDER_SHARED_FIELD_KEYS as readonly string[]).includes(key)) return undefined;
  if (typeof en !== 'string' || label !== en) return undefined;
  return { key: key as PageBuilderSharedFieldKey, en };
}
