import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * `specs/163-page-builder-marketing-pages/` R20E (T290): a value per
 * breakpoint is written as `--x` / `--x-md` / `--x-lg` custom properties and
 * read by a base rule plus one rule per `@media (min-width: …)` tier. Those
 * tier rules win only while **no later rule of the same selector** sets the
 * same property for every width: at equal specificity the later rule wins, so
 * a base rule written after its tier rules silently drops the tablet and
 * desktop values (the download tile's title size did, from 768 px).
 *
 * jsdom cannot evaluate media queries, so this reads the stylesheet's order:
 * for every rule in a min-width tier that reads a `-md` or `-lg` custom
 * property, no later rule with the same selector — unconditional, or in a
 * lower min-width tier — may declare that property (or a shorthand of it).
 */

interface FlatRule {
  index: number;
  selectors: string[];
  properties: Map<string, string>;
  /** The enclosing at-rule preludes, outermost first. */
  context: string[];
}

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function parse(css: string): FlatRule[] {
  const rules: FlatRule[] = [];
  let position = 0;
  const source = stripComments(css);

  function block(context: string[]): void {
    while (position < source.length) {
      const open = source.indexOf('{', position);
      const close = source.indexOf('}', position);
      if (close !== -1 && (open === -1 || close < open)) {
        position = close + 1;
        return;
      }
      if (open === -1) {
        position = source.length;
        return;
      }
      const prelude = source.slice(position, open).trim().replace(/\s+/g, ' ');
      position = open + 1;
      if (prelude.startsWith('@')) {
        block([...context, prelude]);
        continue;
      }
      // A plain rule: its body has no nested blocks in this stylesheet.
      const end = source.indexOf('}', position);
      const body = source.slice(position, end);
      position = end + 1;
      const properties = new Map<string, string>();
      for (const declaration of body.split(';')) {
        const colon = declaration.indexOf(':');
        if (colon === -1) continue;
        properties.set(declaration.slice(0, colon).trim().toLowerCase(), declaration.slice(colon + 1).trim());
      }
      rules.push({
        index: rules.length,
        selectors: prelude.split(',').map((selector) => selector.trim().replace(/\s+/g, ' ')),
        properties,
        context,
      });
    }
  }
  block([]);
  return rules;
}

/** The min-width a context requires (0 without one); `null` when it holds a condition this test does not reason about. */
function minWidth(context: string[]): number | null {
  let width = 0;
  for (const prelude of context) {
    if (!prelude.startsWith('@media')) return null;
    const match = /^@media \(min-width: (\d+)px\)$/.exec(prelude);
    if (!match) return null;
    width = Math.max(width, Number(match[1]));
  }
  return width;
}

const SHORTHANDS = ['margin', 'padding', 'inset', 'font', 'gap', 'background', 'grid-template'];

function overrides(later: string, property: string): boolean {
  if (later === property) return true;
  return SHORTHANDS.includes(later) && property.startsWith(`${later}-`);
}

const TIERED = /var\(--[\w-]+-(md|lg)\b/;

function sheet(): string {
  return readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../styles/cms-components.css'), 'utf8');
}

function tierOverrides(css: string): string[] {
  const rules = parse(css);
  const findings: string[] = [];
  for (const rule of rules) {
    const tier = minWidth(rule.context);
    if (tier === null || tier === 0) continue;
    for (const [property, value] of rule.properties) {
      if (!TIERED.test(value)) continue;
      for (const later of rules.slice(rule.index + 1)) {
        const laterTier = minWidth(later.context);
        if (laterTier === null || laterTier >= tier) continue;
        const shared = later.selectors.filter((selector) => rule.selectors.includes(selector));
        if (shared.length === 0) continue;
        for (const laterProperty of later.properties.keys()) {
          if (!overrides(laterProperty, property)) continue;
          findings.push(`${shared.join(', ')} { ${property} } @${tier}px overridden by a later ${laterProperty} at ${laterTier}px`);
        }
      }
    }
  }
  return findings;
}

describe('per-breakpoint custom property rules keep their place in the cascade (T290)', () => {
  it('the parser sees the tier rules (the test cannot pass empty)', () => {
    const rules = parse(sheet());
    const tiered = rules.filter((rule) => (minWidth(rule.context) ?? 0) > 0 && [...rule.properties.values()].some((value) => TIERED.test(value)));
    expect(tiered.length).toBeGreaterThan(50);
  });

  it('finds a base rule written after its tier rule', () => {
    const broken = `
      @media (min-width: 768px) { .a { font-size: var(--x-md, var(--x, 1rem)); } }
      .a { font-size: var(--x, 1rem); }
      .b { margin: 0; }
      @media (min-width: 1024px) { .b { margin-left: var(--y-lg, 0); } }
    `;
    expect(tierOverrides(broken)).toEqual(['.a { font-size } @768px overridden by a later font-size at 0px']);
  });

  it('no tier rule in the stylesheet is overridden by a later rule of the same selector', () => {
    expect(tierOverrides(sheet())).toEqual([]);
  });
});
