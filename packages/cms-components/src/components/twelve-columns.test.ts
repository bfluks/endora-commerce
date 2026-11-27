import { describe, expect, it } from 'vitest';
import { chosenSpans, LAYOUT_PRESETS, layoutPresetField, presetSpans, twelveColumns, usesAdvancedLayout } from './twelve-columns.js';

/**
 * `specs/163-page-builder-marketing-pages/` R23 (T438): a 12-column layout is
 * one preset (`layout`) — the raw spans, offset and anchor stay, shown and
 * applied only with the Advanced switch on (`layoutAdvanced`).
 */

describe('layout presets (R23 T438)', () => {
  it('each preset is media columns, columns between, text columns, on 12 at most', () => {
    expect(presetSpans('6-6')).toEqual({ mediaSpan: 6, textOffset: 0, textSpan: 6 });
    expect(presetSpans('7-5')).toEqual({ mediaSpan: 7, textOffset: 0, textSpan: 5 });
    expect(presetSpans('5-1-6')).toEqual({ mediaSpan: 5, textOffset: 1, textSpan: 6 });
    for (const [value, [media, offset, text]] of Object.entries(LAYOUT_PRESETS)) {
      expect(media + offset + text, value).toBeLessThanOrEqual(12);
    }
    expect(presetSpans('default')).toBeNull();
    expect(presetSpans(undefined)).toBeNull();
    expect(presetSpans('9-9')).toBeNull();
  });

  it('a preset mirrors with the media side', () => {
    expect(twelveColumns(chosenSpans({ layout: '7-5' }), 'start')).toEqual({ media: '1 / span 7', text: '8 / span 5' });
    expect(twelveColumns(chosenSpans({ layout: '7-5' }), 'end')).toEqual({ media: '6 / span 7', text: '1 / span 5' });
    expect(twelveColumns(chosenSpans({ layout: '5-1-6' }), 'start')).toEqual({ media: '1 / span 5', text: '7 / span 6' });
  });

  it('the field offers Default first, then the presets', () => {
    const field = layoutPresetField('Layout');
    expect(field.type).toBe('select');
    expect(field.options[0]).toEqual({ label: 'Default', value: 'default' });
    expect(field.options.map((option) => option.value).slice(1)).toEqual(Object.keys(LAYOUT_PRESETS));
  });
});

describe('the Advanced switch (R23 T438)', () => {
  const raw = { mediaSpan: 4, textSpan: 6, textOffset: 2, columnsAnchor: 'start' };

  it('off: the preset applies and stored raw numbers are not read', () => {
    expect(chosenSpans({ layout: '6-6', layoutAdvanced: false, ...raw })).toEqual({ mediaSpan: 6, textOffset: 0, textSpan: 6 });
    expect(chosenSpans({ layoutAdvanced: false, ...raw })).toEqual({});
  });

  it('on: the raw numbers win over the preset', () => {
    expect(chosenSpans({ layout: '6-6', layoutAdvanced: true, ...raw })).toEqual(raw);
  });

  it('raw numbers stored before the switch existed (R21G, R22I) read as Advanced while no preset is stored', () => {
    expect(usesAdvancedLayout({ ...raw })).toBe(true);
    expect(chosenSpans({ ...raw })).toEqual(raw);
    expect(usesAdvancedLayout({ layout: '7-5', ...raw })).toBe(false);
    expect(usesAdvancedLayout({})).toBe(false);
  });

  it('nothing chosen: no columns of 12 (the block keeps its own layout)', () => {
    expect(twelveColumns(chosenSpans({}), 'start')).toBeNull();
    expect(twelveColumns(chosenSpans({ layout: 'default' }), 'start')).toBeNull();
  });
});
