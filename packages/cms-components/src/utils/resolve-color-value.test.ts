import { describe, expect, it } from 'vitest';
import { colorValueToCss, resolveColorValue } from './color-value.js';

/**
 * `specs/163-page-builder-marketing-pages/` T040, research R-6 — a block colour
 * is a brand-token reference (`token:<role>`) or a literal. The token becomes
 * the brand variable with today's literal as its fallback (standing rule 9);
 * a literal is applied as it is, so every colour stored before tokens existed
 * renders unchanged.
 */
describe('resolveColorValue (T040)', () => {
  it('resolves each brand colour role to its variable with the default literal', () => {
    expect(resolveColorValue('token:primary')).toBe('var(--cmsb-color-primary, #1261a6)');
    expect(resolveColorValue('token:primary-hover')).toBe('var(--cmsb-color-primary-hover, #0f5189)');
    expect(resolveColorValue('token:secondary')).toBe('var(--cmsb-color-secondary, #0f766e)');
    expect(resolveColorValue('token:secondary-hover')).toBe('var(--cmsb-color-secondary-hover, #115e59)');
    expect(resolveColorValue('token:on-primary')).toBe('var(--cmsb-color-on-primary, #ffffff)');
    expect(resolveColorValue('token:on-secondary')).toBe('var(--cmsb-color-on-secondary, #ffffff)');
    // The camel-case spelling of the token schema names the same variable.
    expect(resolveColorValue('token:onPrimary')).toBe('var(--cmsb-color-on-primary, #ffffff)');
  });

  it('leaves a hex value unchanged', () => {
    expect(resolveColorValue('#1d4ed8')).toBe('#1d4ed8');
  });

  it('keeps a literal stored before tokens, and drops an unknown role', () => {
    expect(resolveColorValue('rgb(10, 20, 30)')).toBe('rgb(10, 20, 30)');
    expect(resolveColorValue('transparent')).toBe('transparent');
    expect(resolveColorValue('token:nonexistent')).toBeUndefined();
    expect(resolveColorValue('')).toBeUndefined();
    expect(resolveColorValue(undefined)).toBeUndefined();
  });

  it('colorValueToCss stays strict: a token or #rrggbb, nothing else', () => {
    expect(colorValueToCss('token:primary')).toBe('var(--cmsb-color-primary, #1261a6)');
    expect(colorValueToCss('#1d4ed8')).toBe('#1d4ed8');
    expect(colorValueToCss('transparent')).toBeUndefined();
    expect(colorValueToCss('rgb(10, 20, 30)')).toBeUndefined();
  });
});
