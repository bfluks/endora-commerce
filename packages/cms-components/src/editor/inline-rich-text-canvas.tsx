'use client';

import { lazy, Suspense, useCallback, useEffect, useRef, type MouseEvent, type ReactElement } from 'react';
import { registerOverlayPortal, setDeep, useGetPuck } from '@puckeditor/core';
import type { InlineRichText } from '@endora-commerce/page-builder-core';
import { InlineRich } from '../components/InlineRich.js';
import type { InlineRichTextFieldValue } from '../fields/inline-rich-text-field.js';

/**
 * In-place editing of inline rich text on the page-builder canvas
 * (`specs/163-page-builder-marketing-pages/` plan § *Extend, don't narrow*,
 * rule 1): before feature 163 a heading's text was typed on the canvas, and it
 * still is. A field created with `createInlineRichTextField({ canvas: true })`
 * is rendered, while the canvas is being edited, as the inline rich-text editor
 * in place of its value; an edit writes the same `InlineRichText` document the
 * side-bar field writes, through Puck's `replace` action.
 *
 * This is Puck's own facility — a `fieldTransforms` entry, the mechanism behind
 * its `contentEditable` text fields — handed to `<Puck fieldTransforms>`. Puck
 * keys transforms by field type, so this `custom` entry replaces Puck's default
 * one, which only acts on a `contentEditable` custom field holding a string; no
 * custom field here is one, and every other custom field's value is returned
 * unchanged.
 */

const LazyInlineRichTextEditor = lazy(async () => {
  const mod = await import('../components/InlineRichTextEditor.js');
  return { default: mod.InlineRichTextEditor };
});

interface InlineRichTextCanvasProps {
  value: InlineRichTextFieldValue;
  componentId: string;
  propPath: string;
  label: string;
}

function InlineRichTextCanvas({ value, componentId, propPath, label }: InlineRichTextCanvasProps): ReactElement {
  const getPuck = useGetPuck();
  const ref = useRef<HTMLDivElement>(null);

  // Lets pointer events through Puck's selection overlay to the text, and keeps
  // a drag from starting while the text has focus.
  useEffect(() => registerOverlayPortal(ref.current, { disableDragOnFocus: true }), []);

  const write = useCallback(
    (next: InlineRichText): void => {
      const puck = getPuck();
      const item = puck.getItemById(componentId);
      const selector = puck.getSelectorForId(componentId);
      if (!item || !selector) return;
      puck.dispatch({
        type: 'replace',
        destinationIndex: selector.index,
        destinationZone: selector.zone,
        data: { ...item, props: setDeep(item.props, propPath, next) },
      });
    },
    [getPuck, componentId, propPath],
  );

  const select = (event: MouseEvent): void => {
    event.stopPropagation();
    const puck = getPuck();
    if (puck.selectedItem?.props.id === componentId) return;
    const selector = puck.getSelectorForId(componentId);
    if (selector) puck.dispatch({ type: 'setUi', ui: { itemSelector: selector } });
  };

  return (
    <div
      ref={ref}
      className="cmsc-inline-canvas-host"
      onClickCapture={select}
      onClick={(event): void => event.stopPropagation()}
      // Puck's keyboard shortcuts (delete the block, undo) are not for the text.
      onKeyDown={(event): void => event.stopPropagation()}
    >
      <Suspense fallback={<InlineRich value={value} />}>
        <LazyInlineRichTextEditor value={value} onChange={write} label={label} variant="canvas" />
      </Suspense>
    </div>
  );
}

/** What Puck hands a field transform; typed loosely so it fits `<Puck fieldTransforms>` for any config. */
interface FieldTransformParams {
  value: unknown;
  componentId: string;
  field: { type: string; label?: string };
  propPath: string;
  isReadOnly: boolean;
}

/** `<Puck fieldTransforms>` for the canvas editing of inline rich-text fields. */
export const INLINE_RICH_TEXT_FIELD_TRANSFORMS: { custom: (params: FieldTransformParams) => unknown } = {
  custom: ({ value, componentId, field, propPath, isReadOnly }) => {
    if ((field as { inlineCanvas?: unknown }).inlineCanvas !== true || isReadOnly) return value;
    return (
      <InlineRichTextCanvas
        key={`${componentId}:${propPath}`}
        value={value as InlineRichTextFieldValue}
        componentId={componentId}
        propPath={propPath}
        label={field.label ?? 'Text'}
      />
    );
  },
};
