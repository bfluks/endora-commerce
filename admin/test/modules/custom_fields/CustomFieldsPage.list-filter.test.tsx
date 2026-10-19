import { StrictMode } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { AuthProvider } from '@endora-commerce/admin-kit/lib';
import type { CustomFieldDefinitionDto, CustomFieldEntityTypeInfo } from '@endora-commerce/contracts';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession } from '../../helpers/render-with-session';
import en from '../../../../packages/modules/custom_fields/i18n/en.json';
import pl from '../../../../packages/modules/custom_fields/i18n/pl.json';
import coreEn from '../../../../packages/modules/_i18n/i18n/en.json';

/**
 * Feature 157 (T056, US3) — `/custom-fields` shows which definitions are list
 * filters, lets the create form set the option where the entity type offers
 * it, and offers no write control to an operator who may only read
 * (`specs/157-custom-fields-list-filters/contracts/admin-surfaces.md` §3).
 */

const ENTITY_TYPES: CustomFieldEntityTypeInfo[] = [
  { entityType: 'order', labelKey: 'customFields.entity.order', listFilter: true },
  { entityType: 'organization', labelKey: 'customFields.entity.organization', listFilter: false },
];

function definition(overrides: Partial<CustomFieldDefinitionDto>): CustomFieldDefinitionDto {
  return {
    id: '00000000-0000-4000-8000-00000000cf01',
    entityType: 'order',
    key: 'region',
    label: {},
    labelDefault: 'Region',
    valueType: 'text',
    required: false,
    audience: 'internal',
    sortOrder: 0,
    config: {},
    listFilter: true,
    options: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const ORDER_ROWS = [
  definition({}),
  definition({ id: '00000000-0000-4000-8000-00000000cf02', key: 'po_ref', labelDefault: 'PO', listFilter: false }),
];

const create = vi.fn(async (_body: unknown) => ({}));

vi.mock('../../../../packages/modules/custom_fields/src/admin/api/custom-fields-client', () => ({
  customFieldsClient: {
    listEntityTypes: async () => ENTITY_TYPES,
    list: async (entityType?: string) => (entityType === 'order' ? ORDER_ROWS : []),
    get: async () => ORDER_ROWS[0],
    create: (body: unknown) => create(body),
    update: async () => ({}),
    remove: async () => ({}),
    createOption: async () => ({}),
    updateOption: async () => ({}),
    removeOption: async () => ({}),
  },
}));

const { CustomFieldsPage } = await import(
  '../../../../packages/modules/custom_fields/src/admin/pages/CustomFieldsPage'
);

function renderPage(permissions: string[], bundle: Record<string, string> = en): void {
  renderWithI18n(
    <StrictMode>
      <AuthProvider initial={adminSession({ permissions })}>
        <CustomFieldsPage />
      </AuthProvider>
    </StrictMode>,
    { custom_fields: bundle, core: coreEn as Record<string, string> },
  );
}

async function chooseEntity(value: string, entityLabel = 'Entity'): Promise<void> {
  const select = await screen.findByLabelText(entityLabel);
  await waitFor(() => expect(within(select).getAllByRole('option')).toHaveLength(ENTITY_TYPES.length));
  fireEvent.change(select, { target: { value } });
}

function cellOf(key: string, column: string): HTMLElement {
  const table = screen.getByRole('table');
  const headers = within(table).getAllByRole('columnheader').map((h) => h.textContent);
  const row = within(table).getByText(key).closest('tr')!;
  return within(row).getAllByRole('cell')[headers.indexOf(column)]!;
}

beforeEach(() => {
  create.mockClear();
});

describe('CustomFieldsPage — the list-filter option', () => {
  it('shows a List filter column, Yes or —, in English (US3-3, FR-006)', async () => {
    renderPage(['custom_fields:read', 'custom_fields:write']);
    await chooseEntity('order');
    await screen.findByText('po_ref');
    expect(cellOf('region', 'List filter')).toHaveTextContent('Yes');
    expect(cellOf('po_ref', 'List filter')).toHaveTextContent('—');
  });

  it('shows the column in Polish from the Polish bundle', async () => {
    renderPage(['custom_fields:read', 'custom_fields:write'], pl as Record<string, string>);
    await chooseEntity('order', pl['customFields.form.entity']);
    await screen.findByText('po_ref');
    expect(cellOf('region', pl['customFields.table.listFilter'])).toHaveTextContent(pl['customFields.listFilter.yes']);
  });

  it('offers the option in the create form only where the entity type has it, and sends it (FR-003)', async () => {
    renderPage(['custom_fields:read', 'custom_fields:write']);
    await screen.findByLabelText('Key');
    expect(screen.queryByLabelText('Use as list filter')).toBeNull();
    await chooseEntity('order');
    fireEvent.click(await screen.findByLabelText('Use as list filter'));
    fireEvent.change(screen.getByLabelText('Key'), { target: { value: 'channel_ref' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add field' }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0]![0]).toMatchObject({ entityType: 'order', key: 'channel_ref', listFilter: true });
  });

  it('offers no Edit, Delete, audience select or create form to a reader (US3-9)', async () => {
    renderPage(['custom_fields:read']);
    await chooseEntity('order');
    await screen.findByText('po_ref');
    expect(screen.queryByRole('button', { name: /^Edit / })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Delete / })).toBeNull();
    expect(screen.queryByLabelText('Who can see the value of region')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add field' })).toBeNull();
    expect(screen.queryByLabelText('Key')).toBeNull();
    expect(cellOf('region', 'Visible to')).toHaveTextContent('Internal — administrators only');
  });

  it('every key the page and its components read exists in both bundles, the Polish value different (FR-018)', () => {
    const dir = resolve(__dirname, '../../../../packages/modules/custom_fields/src/admin');
    const files = [
      'pages/CustomFieldsPage.tsx',
      'components/DefinitionEditorDialog.tsx',
      'components/DefinitionOptionsEditor.tsx',
      'components/DefinitionBehaviourFields.tsx',
    ];
    const keys = new Set<string>();
    for (const file of files) {
      const source = readFileSync(resolve(dir, file), 'utf8');
      for (const match of source.matchAll(/\bt\(\s*'([\w.]+)'/g)) keys.add(match[1]!);
    }
    for (const type of ['text', 'number', 'boolean', 'date', 'select', 'multiselect']) keys.add(`customFields.valueType.${type}`);
    for (const audience of ['internal', 'customer']) keys.add(`customFields.audience.${audience}`);
    expect(keys.size).toBeGreaterThan(40);
    const enBundle = en as Record<string, string>;
    const plBundle = pl as Record<string, string>;
    for (const key of keys) {
      expect(enBundle[key], key).toBeTruthy();
      expect(plBundle[key], key).toBeTruthy();
      expect(plBundle[key], key).not.toBe(enBundle[key]);
    }
  });
});
