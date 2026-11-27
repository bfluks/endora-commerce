import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PRODUCT_VISIBILITY_SETTING_CODES } from '@endora-commerce/contracts';
import { REGISTERED_MANIFESTS } from '../../../src/lifecycle/registered-manifests.js';

/**
 * `specs/193-product-visibility-rules/` T077 — what the activation control on
 * `/platform/modules` says about this module, in both shipped languages. The screen shows the
 * module's description (translated from its bundle, issue #1809) beside the switch, so that is
 * where an operator reads the consequence of the flip before making it:
 *
 * - **FR-076 (M10)** — turning it on applies FR-023 at once: an unmapped role that handles quote
 *   requests sees no products until it is mapped;
 * - **TM-13** — turning it off lifts every restriction: every restricted role becomes
 *   unrestricted while it is off (the configuration is kept).
 *
 * The sentences are pinned here so a later edit of the description cannot drop either
 * consequence silently. The settings screen's description of the same control says both too.
 */

const ON = {
  en: 'Switching it on applies at once: a role that handles quote requests and is not mapped sees no products until it is mapped.',
  pl: 'Włączenie działa od razu: rola obsługująca zapytania ofertowe, która nie ma przypisania, nie widzi żadnych produktów, dopóki nie zostanie przypisana.',
} as const;

const OFF = {
  en: 'Switching it off lifts every product restriction: every restricted role sees all products while it is off.',
  pl: 'Wyłączenie znosi wszystkie ograniczenia produktów: każda ograniczona rola widzi wszystkie produkty, dopóki moduł jest wyłączony.',
} as const;

const entry = REGISTERED_MANIFESTS.find((candidate) => candidate.manifest.id === 'product_visibility_rules');

function bundle(language: 'en' | 'pl'): Record<string, string> {
  if (!entry) throw new Error('product_visibility_rules is not registered');
  return JSON.parse(readFileSync(join(dirname(entry.filePath), entry.manifest.i18n!.bundlesDir, `${language}.json`), 'utf8')) as Record<string, string>;
}

describe('product_visibility_rules — activation texts (T077; FR-076, TM-13)', () => {
  it('is registered and ships off', () => {
    expect(entry).toBeDefined();
    expect(entry!.manifest.activation).toMatchObject({ settingCode: PRODUCT_VISIBILITY_SETTING_CODES.MODULE_ENABLED, default: false });
  });

  for (const language of ['en', 'pl'] as const) {
    it(`says in ${language} what switching it on and off does, beside the switch`, () => {
      const description = bundle(language)['module.description'];
      expect(description).toContain(ON[language]);
      expect(description).toContain(OFF[language]);
    });
  }

  it('keeps the manifest\'s English equal to the bundle\'s (issue #1809)', () => {
    expect(entry!.manifest.description).toBe(bundle('en')['module.description']);
  });

  it('says both on the settings screen\'s description of the same control', () => {
    const key = `settingLabels.${PRODUCT_VISIBILITY_SETTING_CODES.MODULE_ENABLED}.description`;
    for (const language of ['en', 'pl'] as const) {
      const text = bundle(language)[key] ?? '';
      expect(text.length).toBeGreaterThan(0);
    }
    expect(bundle('en')[key]).toMatch(/see none until mapped/);
    expect(bundle('en')[key]).toMatch(/Off: every restriction is lifted/);
    // The Polish description states both consequences too, not just a non-empty string (QA).
    expect(bundle('pl')[key]).toMatch(/nic do czasu przypisania/);
    expect(bundle('pl')[key]).toMatch(/Wyłączony: bez ograniczeń/);
  });
});
