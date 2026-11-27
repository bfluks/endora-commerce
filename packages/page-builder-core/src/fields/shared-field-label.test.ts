import { describe, expect, it } from 'vitest';
import type { ComponentConfig } from '@puckeditor/core';
import { definePageBuilderComponent } from '../define-component.js';
import { isResponsiveField, PB_RESPONSIVE_METADATA } from '../types/responsive.js';
import { withHideOn } from '../visibility/with-hide-on.js';
import { sharedFieldLabel, withSharedFieldLabel } from './shared-field-label.js';

/**
 * `specs/163-page-builder-marketing-pages/` R17 (T200) — a field every block
 * shares is translated once, from the `core` bundle, through a marker that
 * names its key and is honoured only while the field keeps its label.
 */
describe('shared field labels (T200)', () => {
  it('marks a field and keeps its metadata', () => {
    const field = withSharedFieldLabel('fontSize', { type: 'number', label: 'Font size (px)', metadata: PB_RESPONSIVE_METADATA });
    expect(sharedFieldLabel(field)).toEqual({ key: 'fontSize', en: 'Font size (px)' });
    expect(isResponsiveField(field as never)).toBe(true);
  });

  it('is not honoured once a block relabels the field', () => {
    const field = withSharedFieldLabel('cornerRadius', { type: 'select', label: 'Rounded corners', options: [] });
    expect(sharedFieldLabel({ ...field, label: 'Card – rounded corners' })).toBeUndefined();
    expect(sharedFieldLabel({ type: 'text', label: 'Rounded corners' })).toBeUndefined();
    expect(sharedFieldLabel(null)).toBeUndefined();
  });

  it('marks the editor name and "Hide on" every block gets', () => {
    const block = definePageBuilderComponent(
      withHideOn({ fields: { title: { type: 'text', label: 'Title' } }, render: () => null } as unknown as ComponentConfig) as ComponentConfig,
    );
    expect(sharedFieldLabel(block.fields?.['editorName'])?.key).toBe('editorName');
    expect(sharedFieldLabel(block.fields?.['hideOn'])?.key).toBe('hideOn');
    expect(sharedFieldLabel(block.fields?.['title'])).toBeUndefined();
  });
});
