import { describe, expect, it } from 'vitest';
import { customOnlyLeading, singleWeight, textStyleAttrs } from './text-style.js';

/**
 * `specs/163-page-builder-marketing-pages/` R23 (T435): the typography rule.
 *
 * - A size token carries its own line height, weight and letter spacing (the
 *   brand's `--cmsb-t-<token>-lh|-w|-ls`, the built-in values as fallbacks) —
 *   wherever a block text takes a token size, as T350's `tokenTierStyle` does
 *   for a token that changes per breakpoint.
 * - A line height applies only to a breakpoint sized in Custom px.
 * - A weight is one value for every breakpoint; a stored per-breakpoint weight
 *   reads as its desktop value, else its base.
 */

const TODAY = { size: '16px', lineHeight: '1.6' };

describe('textStyleAttrs: a size token brings its own line height, weight and tracking (R23 T435)', () => {
  it('one token at every breakpoint: all four inline', () => {
    expect(textStyleAttrs({ size: 'body' }, null, TODAY)).toEqual({
      classes: [],
      style: {
        fontSize: 'var(--cmsb-t-body-size, 16px)',
        fontWeight: 'var(--cmsb-t-body-w, 400)',
        lineHeight: 'var(--cmsb-t-body-lh, 1.65)',
        letterSpacing: 'var(--cmsb-t-body-ls, 0em)',
      },
    });
  });

  it('a token per breakpoint: each tier its own token’s values, through the tier classes', () => {
    const { classes, style } = textStyleAttrs({ size: { base: 'small', desktop: 'h4' } }, null, TODAY);
    expect(classes).toEqual(['cmsc-pb-ts-size', 'cmsc-pb-ts-weight', 'cmsc-pb-ts-leading', 'cmsc-pb-ts-tracking']);
    expect(style['--pb-ts-leading']).toBe('var(--cmsb-t-small-lh, 1.5)');
    expect(style['--pb-ts-leading-md']).toBe('var(--cmsb-t-small-lh, 1.5)');
    expect(style['--pb-ts-leading-lg']).toBe('var(--cmsb-t-h4-lh, 1.12)');
    expect(style['--pb-ts-weight-lg']).toBe('var(--cmsb-t-h4-w, 700)');
    expect(style['--pb-ts-tracking']).toBe('var(--cmsb-t-small-ls, 0em)');
  });

  it('the editor’s previewed tier: that tier’s token inline', () => {
    expect(textStyleAttrs({ size: { base: 'small', desktop: 'h4' } }, 'desktop', TODAY).style).toMatchObject({
      fontSize: 'var(--cmsb-t-h4-size, 26px)',
      lineHeight: 'var(--cmsb-t-h4-lh, 1.12)',
      fontWeight: 'var(--cmsb-t-h4-w, 700)',
      letterSpacing: 'var(--cmsb-t-h4-ls, 0em)',
    });
  });

  it('a weight of its own wins over the token’s', () => {
    expect(textStyleAttrs({ size: 'body', weight: 600 }, null, TODAY).style['fontWeight']).toBe('600');
  });

  it('a line height applies only to a Custom px size, never over a token or the block’s own size', () => {
    expect(textStyleAttrs({ size: 'body', lineHeight: 1.2 }, null, TODAY).style['lineHeight']).toBe('var(--cmsb-t-body-lh, 1.65)');
    expect(textStyleAttrs({ lineHeight: 1.2 }, null, TODAY)).toEqual({ classes: [], style: {} });
    expect(textStyleAttrs({ size: 'default', lineHeight: 1.2 }, null, TODAY)).toEqual({ classes: [], style: {} });
    expect(textStyleAttrs({ size: 'custom', sizePx: 18, lineHeight: 1.2 }, null, TODAY).style).toEqual({
      fontSize: '18px',
      lineHeight: '1.2',
    });
  });

  it('Custom px on one tier, a token on another: the line height on the Custom tier only', () => {
    const { style } = textStyleAttrs({ size: { base: 'custom', desktop: 'h4' }, sizePx: 18, lineHeight: 1.3 }, null, TODAY);
    expect(style['--pb-ts-leading']).toBe('1.3');
    expect(style['--pb-ts-leading-md']).toBe('1.3');
    expect(style['--pb-ts-leading-lg']).toBe('var(--cmsb-t-h4-lh, 1.12)');
  });

  it('a Custom px size alone brings no weight or tracking (the block’s own stay)', () => {
    expect(textStyleAttrs({ size: 'custom', sizePx: 18 }, null, TODAY)).toEqual({ classes: [], style: { fontSize: '18px' } });
  });
});

describe('singleWeight: one weight for every breakpoint (R23 T435)', () => {
  it('reads one value as it is, a per-breakpoint value as its desktop, else its base', () => {
    expect(singleWeight(600)).toBe(600);
    expect(singleWeight('default')).toBe('default');
    expect(singleWeight(undefined)).toBeUndefined();
    expect(singleWeight({ base: 400, desktop: 500 })).toBe(500);
    expect(singleWeight({ base: 400, tablet: 300 })).toBe(400);
    expect(singleWeight({ tablet: 300 })).toBeUndefined();
  });

  it('textStyleAttrs reads a stored per-breakpoint weight as one value', () => {
    expect(textStyleAttrs({ weight: { base: 400, desktop: 500 } }, null, TODAY)).toEqual({ classes: [], style: { fontWeight: '500' } });
  });
});

describe('customOnlyLeading: a line height kept for the breakpoints sized in Custom px (R23 T435)', () => {
  it('nothing unless the size is Custom somewhere', () => {
    expect(customOnlyLeading('h3', 1.2)).toBeUndefined();
    expect(customOnlyLeading(undefined, 1.2)).toBeUndefined();
    expect(customOnlyLeading('custom', undefined)).toBeUndefined();
  });

  it('a Custom size everywhere keeps the stored value as it is', () => {
    expect(customOnlyLeading('custom', 1.2)).toBe(1.2);
    expect(customOnlyLeading('custom', { base: 1.2, desktop: 1.1 })).toEqual({ base: 1.2, desktop: 1.1 });
  });

  it('Custom on some tiers only: the line height from the first Custom tier up, while it stays Custom', () => {
    expect(customOnlyLeading({ base: 'h4', desktop: 'custom' }, 1.2)).toEqual({ desktop: 1.2 });
  });
});
