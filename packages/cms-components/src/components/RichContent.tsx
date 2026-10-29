'use client';

import { lazy, Suspense, type ReactElement } from 'react';
import { type ComponentConfig } from '@puckeditor/core';
import type { JSONContent } from '@tiptap/core';
import type { RichContentProps } from '../schema/component-types.js';
import { BOX_BORDER_FIELD, BOX_MARGIN_FIELD, BOX_PADDING_FIELD, DEFAULT_BOX_PROPS } from '../fields/shared-fields.js';
import { RichContentEditingPreviewRender, RichContentPublishedRender } from './RichContentPublished.js';
import { coerceRichContentProps, defaultRichContent, htmlFromTiptap } from './rich-content-shared.js';
import { textMaxWidthFields, usesCustomTextMaxWidth } from './text-max-width.js';

const LazyRichContentEditorField = lazy(async () => {
  const mod = await import('./RichContentEditorField.js');
  return { default: mod.RichContentEditorField };
});

function RichContentFieldRender({
  value,
  onChange,
  readOnly,
}: {
  value: JSONContent | null | undefined;
  onChange: (value: JSONContent | null) => void;
  readOnly?: boolean;
}): ReactElement {
  return (
    <Suspense fallback={<p className="text-sm opacity-70">Loading editor…</p>}>
      <LazyRichContentEditorField
        value={value ?? null}
        onChange={onChange}
        {...(readOnly === true ? { readOnly: true } : {})}
      />
    </Suspense>
  );
}

type RichContentFields = NonNullable<ComponentConfig<RichContentProps>['fields']>;

const MEASURE_FIELDS = textMaxWidthFields() as unknown as Pick<RichContentFields, 'textMaxWidth' | 'textMaxWidthPx'>;

const RICH_CONTENT_FIELDS = {
  content: {
    type: 'custom',
    label: 'Content',
    render: ({ value, onChange, readOnly }) => (
      <RichContentFieldRender
        value={value}
        onChange={onChange}
        {...(readOnly === true ? { readOnly: true } : {})}
      />
    ),
  },
  // `html` is kept on props (synced from TipTap in resolveData) for published
  // render + legacy trees, but is not an author-facing field.
  // T134: a maximum width for the text, per breakpoint; unset keeps today's full width.
  ...MEASURE_FIELDS,
  margin: BOX_MARGIN_FIELD,
  padding: BOX_PADDING_FIELD,
  border: BOX_BORDER_FIELD,
} as RichContentFields;

export const RichContent: ComponentConfig<RichContentProps> = {
  label: 'Rich Content',
  fields: RICH_CONTENT_FIELDS,
  // The Custom px is offered once a tier of the measure is on Custom.
  resolveFields: (data, params) => {
    const fields: Record<string, unknown> = {};
    for (const [key, field] of Object.entries(params?.fields ?? RICH_CONTENT_FIELDS)) {
      if (key === 'textMaxWidthPx' && !usesCustomTextMaxWidth(data.props.textMaxWidth)) continue;
      fields[key] = field;
    }
    return fields as RichContentFields;
  },
  defaultProps: {
    content: defaultRichContent,
    html: '',
    ...DEFAULT_BOX_PROPS,
  },
  resolveData: async ({ props }, { changed }) => {
    const normalized = coerceRichContentProps(props);
    if (changed.content) {
      return {
        props: {
          ...normalized,
          html: htmlFromTiptap(normalized.content) || normalized.html,
        },
      };
    }
    return { props: normalized };
  },
  render: (props) =>
    props.puck?.isEditing ? (
      <RichContentEditingPreviewRender {...props} />
    ) : (
      <RichContentPublishedRender {...props} />
    ),
};
