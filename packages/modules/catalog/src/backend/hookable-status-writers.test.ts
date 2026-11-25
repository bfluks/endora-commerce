import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CATALOG_HOOKABLE_ACTIONS, toHookableActionDeclaration } from '@endora-commerce/contracts';
import { manifest } from '../manifest.js';

/**
 * Spec 193 T049 (research R-11, H1) — every catalog Command that can move a product's status (its
 * global status, its archive flag, or a channel-scoped status cell) is declared hookable, so the
 * website rule's admission can act in the same transaction; and each of them supplies its hook
 * data through `withProductStatusHookData`.
 *
 * The population is every action string a catalog Command writes as a literal (`action: '…'`, a
 * ternary of two literals included). Each one is classified here, both ways: a new action that is
 * not classified fails, and so does a classification whose action is gone. Actions built from a
 * parameter (the link, gallery, grouped, bundle, packaging-unit and attachment helpers) are not
 * seen by this scan; none of them writes a product's status.
 */
const SRC = fileURLToPath(new URL('..', import.meta.url));

const HOOKED = new Set(Object.values(CATALOG_HOOKABLE_ACTIONS).map((ref) => ref.action));

/** Actions that write no global status, archive flag or channel-scoped status cell — and why. */
const NOT_STATUS_WRITERS: Record<string, string> = {
  'product.create': 'a new product; the kernel governor keeps it off governed channels (R-10), nothing to reactivate',
  'product.archive': 'archives: a product leaves, never becomes active',
  'product.delete': 'deletes: a product leaves, never becomes active',
  'product.bulk_update': 'an audit summary only; each product runs product.update / product.restore / product.scopes.update',
  'product.scoped_values.copy_to_channels': 'copies text fields only (copyable), never a status — research R-11',
  'product.media.update': 'gallery and media',
  'product.content.update': 'content blocks',
  'product.url_keys.update': 'URL keys',
  'product.url_redirect.delete': 'URL redirects',
  'product_link.create': 'product links',
  'product_link.delete': 'product links',
  'product_link.reorder': 'product links',
  'grouped_item.create': 'grouped items',
  'grouped_item.update': 'grouped items',
  'grouped_item.delete': 'grouped items',
  'bundle_slot.create': 'bundle slots',
  'bundle_slot.update': 'bundle slots',
  'bundle_slot.delete': 'bundle slots',
  'bundle_slot_option.create': 'bundle slot options',
  'bundle_slot_option.delete': 'bundle slot options',
  'packaging_unit.reorder': 'packaging units',
  'packaging_unit.delete': 'packaging units',
  'gallery.create': 'galleries',
  'attachment_type.create': 'attachment types',
  'attachment_type.update': 'attachment types',
  'attachment_type.delete': 'attachment types',
  'catalog.attribute.create': 'attribute definitions',
  'catalog.attribute.update': 'attribute definitions',
  'catalog.attribute.delete': 'attribute definitions',
  'catalog.attribute_option.create': 'attribute options',
  'catalog.attribute_option.update': 'attribute options',
  'catalog.attribute_option.delete': 'attribute options',
  'catalog.categories.import': 'categories',
};

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'admin' ? [] : sources(path);
    return path.endsWith('.ts') && !path.endsWith('.test.ts') ? [path] : [];
  });
}

/** Every literal action, and the files it is written in. */
function literalActions(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const re = /action:\s*(?:[A-Za-z_.]+\s*\?\s*)?'([a-z_.]+)'(?:\s*:\s*'([a-z_.]+)')?/g;
  for (const file of sources(SRC)) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(re)) {
      for (const action of [match[1], match[2]]) {
        if (!action) continue;
        out.set(action, [...(out.get(action) ?? []), relative(SRC, file)]);
      }
    }
  }
  return out;
}

describe('catalog status writers are hookable (spec 193, T049)', () => {
  it('the manifest declares every ref of CATALOG_HOOKABLE_ACTIONS', () => {
    const declared = (manifest.hookableActions ?? []).map((d) => JSON.stringify(d));
    for (const ref of Object.values(CATALOG_HOOKABLE_ACTIONS)) {
      expect(declared, ref.action).toContain(JSON.stringify(toHookableActionDeclaration(ref)));
    }
  });

  it('every literal action is classified, and every classification is still written', () => {
    const actions = literalActions();
    expect(actions.size).toBeGreaterThan(20);
    const unclassified = [...actions.keys()].filter((a) => !HOOKED.has(a) && !(a in NOT_STATUS_WRITERS)).sort();
    expect(unclassified, 'classify each: hookable (CATALOG_HOOKABLE_ACTIONS) or NOT_STATUS_WRITERS with a reason').toEqual([]);
    const stale = [...HOOKED, ...Object.keys(NOT_STATUS_WRITERS)].filter((a) => !actions.has(a)).sort();
    expect(stale, 'a classification whose action is no longer written').toEqual([]);
  });

  it('every hooked action supplies its hook data through withProductStatusHookData', () => {
    const actions = literalActions();
    for (const action of HOOKED) {
      // The manifest names actions for its recent-activity labels; only Command sources count.
      for (const file of (actions.get(action) ?? []).filter((f) => f !== 'manifest.ts')) {
        const text = readFileSync(join(SRC, file), 'utf8');
        expect(text.includes('withProductStatusHookData('), `${action} in ${file}`).toBe(true);
      }
    }
  });
});
