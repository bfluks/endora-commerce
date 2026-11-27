import { describe, expect, it } from 'vitest';
import type { CatalogAttributeView } from '@endora-commerce/contracts';
import { WebsiteRuleService, type WebsiteRuleServiceDeps } from './website-rule.service.js';

/**
 * T103 — `GET /attributes` carries each choice option's labels next to its key, so the rule
 * editor shows a label in the admin's language (else the default) and still sends the key.
 */
describe('WebsiteRuleService.listAttributes', () => {
  const option = (value: string, labelDefault: string, label: Record<string, string>) =>
    ({ id: value, value, labelDefault, label, isDefault: false, sortOrder: 0, createdAt: new Date(0) });
  const segment = {
    key: 'segment',
    labelDefault: 'Segment',
    label: { 'pl-PL': 'Segment PL' },
    valueType: 'enum',
    scopeLevels: ['G'],
    options: [option('retail', 'Retail', { 'en-US': 'Retail EN', 'pl-PL': 'Detal' }), option('export', 'Export', {})],
  } as unknown as CatalogAttributeView;
  const scoped = { ...segment, key: 'per_channel', scopeLevels: ['G', 'C'] } as unknown as CatalogAttributeView;
  const deps = { attributes: () => ({ listAll: async () => [segment, scoped] }) } as unknown as WebsiteRuleServiceDeps;

  it('answers each option as { key, labelDefault, label }, in the catalogue order', async () => {
    const { items } = await new WebsiteRuleService(deps).listAttributes();
    expect(items).toEqual([
      {
        key: 'segment',
        labelDefault: 'Segment',
        label: { 'pl-PL': 'Segment PL' },
        kind: 'choice',
        options: [
          { key: 'retail', labelDefault: 'Retail', label: { 'en-US': 'Retail EN', 'pl-PL': 'Detal' } },
          { key: 'export', labelDefault: 'Export', label: {} },
        ],
      },
    ]);
  });
});
