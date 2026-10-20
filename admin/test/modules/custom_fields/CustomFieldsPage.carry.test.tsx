import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { ApiError, AuthProvider } from '@endora-commerce/admin-kit/lib';
import type { CustomFieldDefinitionDto } from '@endora-commerce/contracts';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession } from '../../helpers/render-with-session';
import en from '../../../../packages/modules/custom_fields/i18n/en.json';
import pl from '../../../../packages/modules/custom_fields/i18n/pl.json';
import coreEn from '../../../../packages/modules/_i18n/i18n/en.json';
import { CARRY_ENTITY_TYPES, carryDefinition, sentence } from './carry-fixtures';

/**
 * Feature 158 (T042, US4) — `/custom-fields` offers the carry options, sends
 * them, explains a refusal in words, and shows which targets a definition
 * carries to, marked where the target no longer fits
 * (`specs/158-custom-fields-value-carry/contracts/admin-surfaces.md` §1.1 – §1.3).
 */

const EN = en as Record<string, string>;
const PL = pl as Record<string, string>;

const QR_REGION = carryDefinition('00000000-0000-4000-8000-0000000c0001', { carryTo: ['order'] });
/** Lacks "south", which the Quote Request field offers — the carry to it is incompatible. */
const ORDER_REGION = carryDefinition('00000000-0000-4000-8000-0000000c0002', {
  entityType: 'order',
  optionValues: ['north'],
});
const OPPORTUNITY_REGION = carryDefinition('00000000-0000-4000-8000-0000000c0003', { entityType: 'opportunity' });

const db = vi.hoisted(() => ({ definitions: [] as CustomFieldDefinitionDto[], failAll: false }));
const client = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  list: vi.fn(),
}));

vi.mock('../../../../packages/modules/custom_fields/src/admin/api/custom-fields-client', () => ({
  customFieldsClient: {
    listEntityTypes: async () => CARRY_ENTITY_TYPES,
    list: async (entityType?: string) => {
      client.list(entityType);
      if (entityType === undefined && db.failAll) throw new Error('offline');
      return db.definitions.filter((d) => entityType === undefined || d.entityType === entityType);
    },
    get: async (id: string) => db.definitions.find((d) => d.id === id),
    create: (...args: unknown[]) => client.create(...args),
    update: (...args: unknown[]) => client.update(...args),
    remove: async () => ({}),
    createOption: async () => ({}),
    updateOption: async () => ({}),
    removeOption: async () => ({}),
  },
}));

const { CustomFieldsPage } = await import(
  '../../../../packages/modules/custom_fields/src/admin/pages/CustomFieldsPage'
);

let nativeDialogs: Array<ReturnType<typeof vi.spyOn>>;

beforeEach(() => {
  db.definitions = [QR_REGION, ORDER_REGION, OPPORTUNITY_REGION];
  db.failAll = false;
  client.create.mockReset().mockResolvedValue({});
  client.update.mockReset().mockResolvedValue({});
  client.list.mockReset();
  nativeDialogs = [
    vi.spyOn(window, 'confirm').mockImplementation(() => false),
    vi.spyOn(window, 'alert').mockImplementation(() => undefined),
  ];
});

afterEach(() => {
  for (const spy of nativeDialogs) expect(spy).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

async function renderPage(
  entityType: 'quote_request' | 'order' | 'opportunity' | 'category',
  bundle: Record<string, string> = EN,
): Promise<void> {
  renderWithI18n(
    <StrictMode>
      <AuthProvider initial={adminSession({ permissions: ['custom_fields:read', 'custom_fields:write'] })}>
        <CustomFieldsPage />
      </AuthProvider>
    </StrictMode>,
    { custom_fields: bundle, core: coreEn as Record<string, string> },
  );
  const recordType = sentence(bundle, 'customFields.form.entity');
  const label = sentence(bundle, CARRY_ENTITY_TYPES.find((info) => info.entityType === entityType)!.labelKey);
  await waitFor(() =>
    expect(within(screen.getByLabelText(recordType)).getAllByRole('option').map((o) => o.textContent)).toContain(label),
  );
  fireEvent.change(screen.getByLabelText(recordType), { target: { value: entityType } });
  // The selected type's rows and the every-type read the marks need have both arrived.
  await waitFor(() => expect(client.list).toHaveBeenCalledWith(entityType));
  await waitFor(() => expect(client.list).toHaveBeenCalledWith(undefined));
}

const toggle = (entityType: string, bundle: Record<string, string> = EN): string =>
  sentence(bundle, 'customFields.carry.toggle', { entityType });

async function openEditor(key = 'region'): Promise<HTMLElement> {
  const title = sentence(EN, 'customFields.editor.title', { key });
  fireEvent.click(await screen.findByRole('button', { name: title }));
  return screen.findByRole('dialog', { name: title });
}

describe('CustomFieldsPage — carry options (US4)', () => {
  it('offers one carry checkbox per carry target in the create form and sends the ticked ones', async () => {
    await renderPage('quote_request');
    const toOrder = screen.getByRole('checkbox', { name: toggle('Order') });
    expect(screen.getByRole('checkbox', { name: toggle('Opportunity') })).not.toBeChecked();
    expect(toOrder).toHaveAccessibleDescription(sentence(EN, 'customFields.carry.help', { entityType: 'Order' }));
    fireEvent.change(screen.getByPlaceholderText('po_number'), { target: { value: 'region_copy' } });
    fireEvent.click(toOrder);
    fireEvent.click(screen.getByRole('button', { name: 'Add field' }));
    await waitFor(() => expect(client.create).toHaveBeenCalledTimes(1));
    expect(client.create.mock.calls[0]![0]).toMatchObject({ key: 'region_copy', carryTo: ['order'] });
  });

  it('creates a field that carries nothing when no box is ticked', async () => {
    await renderPage('quote_request');
    fireEvent.change(screen.getByPlaceholderText('po_number'), { target: { value: 'plain' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add field' }));
    await waitFor(() => expect(client.create).toHaveBeenCalledTimes(1));
    expect(client.create.mock.calls[0]![0]).toMatchObject({ key: 'plain', carryTo: [] });
  });

  it('offers no carry option for a type without carry targets (US4-4)', async () => {
    await renderPage('category');
    expect(screen.queryByRole('checkbox', { name: /Carry value to/ })).toBeNull();
  });

  it('never offers an Order field a Quote Request target', async () => {
    await renderPage('order');
    expect(screen.getByRole('checkbox', { name: toggle('Opportunity') })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: toggle('Quote request') })).toBeNull();
  });

  it('shows the stored carry in the editor and sends nothing when it is left alone', async () => {
    await renderPage('quote_request');
    const dialog = await openEditor();
    expect(within(dialog).getByRole('checkbox', { name: toggle('Order') })).toBeChecked();
    expect(within(dialog).getByRole('checkbox', { name: toggle('Opportunity') })).not.toBeChecked();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(client.update).not.toHaveBeenCalled();
  });

  it('sends the whole new carry list, and only it, when the carry changed', async () => {
    await renderPage('quote_request');
    const dialog = await openEditor();
    fireEvent.click(within(dialog).getByRole('checkbox', { name: toggle('Opportunity') }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(client.update).toHaveBeenCalledTimes(1));
    expect(client.update).toHaveBeenCalledWith(QR_REGION.id, { carryTo: ['order', 'opportunity'] });
  });

  it('keeps the editor open and names the missing options when the server refuses (US4-3)', async () => {
    client.update.mockRejectedValueOnce(
      new ApiError(422, {
        error: {
          code: 'CUSTOM_FIELD_CARRY_INCOMPATIBLE' as never,
          message: 'CUSTOM_FIELD_CARRY_INCOMPATIBLE raw',
          details: {
            code: 'options_missing',
            targetEntityType: 'opportunity',
            key: 'region',
            missingOptionValues: 'south, west',
            missingOptionValueList: ['south', 'west'],
          },
        },
      }),
    );
    await renderPage('quote_request');
    const dialog = await openEditor();
    fireEvent.click(within(dialog).getByRole('checkbox', { name: toggle('Opportunity') }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(
      await within(dialog).findByText(
        sentence(EN, 'errors.CUSTOM_FIELD_CARRY_INCOMPATIBLE.options_missing', {
          key: 'region',
          targetEntityType: 'Opportunity',
          missingOptionValues: 'south, west',
        }),
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBe(dialog);
    expect(within(dialog).queryByText(/CUSTOM_FIELD_CARRY_INCOMPATIBLE/)).toBeNull();
  });

  it('names the missing field and its type when the create form is refused (US4-2)', async () => {
    client.create.mockRejectedValueOnce(
      new ApiError(422, {
        error: {
          code: 'CUSTOM_FIELD_CARRY_INCOMPATIBLE' as never,
          message: 'raw',
          details: { code: 'target_missing', targetEntityType: 'order', key: 'fresh_key' },
        },
      }),
    );
    await renderPage('quote_request');
    fireEvent.change(screen.getByPlaceholderText('po_number'), { target: { value: 'fresh_key' } });
    fireEvent.click(screen.getByRole('checkbox', { name: toggle('Order') }));
    fireEvent.click(screen.getByRole('button', { name: 'Add field' }));
    expect(
      await screen.findByText(
        sentence(EN, 'errors.CUSTOM_FIELD_CARRY_INCOMPATIBLE.target_missing', { key: 'fresh_key', targetEntityType: 'Order' }),
      ),
    ).toBeInTheDocument();
    // The form keeps what was typed, so the operator can fix it and try again.
    expect(screen.getByPlaceholderText('po_number')).toHaveValue('fresh_key');
    expect(screen.getByRole('checkbox', { name: toggle('Order') })).toBeChecked();
  });

  it('falls back to the server sentence for an unknown refusal token', async () => {
    client.update.mockRejectedValueOnce(
      new ApiError(422, {
        error: { code: 'CUSTOM_FIELD_CARRY_INCOMPATIBLE' as never, message: 'Server sentence.', details: { code: 'brand_new' } },
      }),
    );
    await renderPage('quote_request');
    const dialog = await openEditor();
    fireEvent.click(within(dialog).getByRole('checkbox', { name: toggle('Opportunity') }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText('Server sentence.')).toBeInTheDocument();
  });
});

describe('CustomFieldsPage — the Carries to column (US4-5, US4-7)', () => {
  it.each([
    ['en', EN],
    ['pl', PL],
  ] as const)('shows the targets as translated chips (%s)', async (_language, bundle) => {
    await renderPage('quote_request', bundle);
    expect(screen.getByRole('columnheader', { name: sentence(bundle, 'customFields.table.carriesTo') })).toBeInTheDocument();
    const row = screen.getByRole('row', { name: /region/ });
    expect(within(row).getByText(sentence(bundle, 'customFields.entity.order'))).toBeInTheDocument();
  });

  it('shows a dash for a field that carries nothing', async () => {
    await renderPage('opportunity');
    const row = screen.getByRole('row', { name: /region/ });
    expect(within(row).getAllByRole('cell').some((cell) => cell.textContent === '—')).toBe(true);
  });

  it('marks a carry whose target lacks a source option, with its reason, until the list re-reads compatible', async () => {
    await renderPage('quote_request');
    const reason = sentence(EN, 'customFields.carry.reason.options_missing', {
      entityType: 'Order',
      missingOptionValues: 'south',
    });
    const row = screen.getByRole('row', { name: /region/ });
    const mark = await within(row).findByText(sentence(EN, 'customFields.carry.incompatible'));
    expect(mark).toHaveAttribute('title', reason);
    expect(within(row).getByText(reason)).toBeInTheDocument();

    // The Order field gains "south"; the next read finds the carry compatible.
    db.definitions = [QR_REGION, carryDefinition(ORDER_REGION.id, { entityType: 'order' }), OPPORTUNITY_REGION];
    const dialog = await openEditor();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(within(screen.getByRole('row', { name: /region/ })).queryByText(sentence(EN, 'customFields.carry.incompatible'))).toBeNull(),
    );
  });

  it('marks a carry whose target field does not exist', async () => {
    db.definitions = [QR_REGION, OPPORTUNITY_REGION];
    await renderPage('quote_request');
    const row = screen.getByRole('row', { name: /region/ });
    expect(
      await within(row).findByText(
        sentence(EN, 'customFields.carry.reason.target_missing', { entityType: 'Order', key: 'region' }),
      ),
    ).toBeInTheDocument();
  });

  it('shows the chips but no mark when the every-type read failed', async () => {
    db.failAll = true;
    await renderPage('quote_request');
    const row = screen.getByRole('row', { name: /region/ });
    expect(within(row).getByText('Order')).toBeInTheDocument();
    // Without the Order definitions there is nothing to judge by: no guess is shown.
    expect(within(row).queryByText(sentence(EN, 'customFields.carry.incompatible'))).toBeNull();
  });
});
