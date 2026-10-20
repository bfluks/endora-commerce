import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { AuthProvider } from '@endora-commerce/admin-kit/lib';
import type { CustomFieldDefinitionDto } from '@endora-commerce/contracts';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession } from '../../helpers/render-with-session';
import { expectNoAxeViolations } from '../../helpers/axe';
import en from '../../../../packages/modules/custom_fields/i18n/en.json';
import coreEn from '../../../../packages/modules/_i18n/i18n/en.json';
import { CARRY_ENTITY_TYPES, carryDefinition, sentence } from './carry-fixtures';

/**
 * Feature 158 (T043, US4-6, US4-8, SC-007, FR-019) — a change that would stop
 * an enabled carry from working asks first, in the page, naming every field on
 * the other side; *Cancel* sends nothing and *Proceed* sends exactly what the
 * action sent before (`specs/158-custom-fields-value-carry/contracts/admin-surfaces.md` §1.4).
 */

const EN = en as Record<string, string>;
const WARNING = sentence(EN, 'customFields.carry.warning.title');
const PROCEED = sentence(EN, 'customFields.carry.warning.proceed');
const CANCEL = sentence(EN, 'customFields.carry.warning.cancel');

/** Internal, offers north + south, carries to the Order field of the same key. */
const QR_REGION = carryDefinition('00000000-0000-4000-8000-0000000d0001', { carryTo: ['order'] });
/** The carry's target: compatible today. */
const ORDER_REGION = carryDefinition('00000000-0000-4000-8000-0000000d0002', { entityType: 'order' });
/** Takes part in no carry. */
const ORDER_NOTE = carryDefinition('00000000-0000-4000-8000-0000000d0003', {
  entityType: 'order',
  key: 'note',
  valueType: 'text',
  optionValues: [],
});

const db = vi.hoisted(() => ({ definitions: [] as CustomFieldDefinitionDto[] }));
const client = vi.hoisted(() => ({
  list: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  createOption: vi.fn(),
  removeOption: vi.fn(),
}));

vi.mock('../../../../packages/modules/custom_fields/src/admin/api/custom-fields-client', () => ({
  customFieldsClient: {
    listEntityTypes: async () => CARRY_ENTITY_TYPES,
    list: async (entityType?: string) => {
      client.list(entityType);
      return db.definitions.filter((d) => entityType === undefined || d.entityType === entityType);
    },
    get: async (id: string) => db.definitions.find((d) => d.id === id),
    create: async () => ({}),
    update: (...args: unknown[]) => client.update(...args),
    remove: (...args: unknown[]) => client.remove(...args),
    createOption: (...args: unknown[]) => client.createOption(...args),
    updateOption: async () => ({}),
    removeOption: (...args: unknown[]) => client.removeOption(...args),
  },
}));

const { CustomFieldsPage } = await import(
  '../../../../packages/modules/custom_fields/src/admin/pages/CustomFieldsPage'
);

let nativeDialogs: Array<ReturnType<typeof vi.spyOn>>;

beforeEach(() => {
  db.definitions = [QR_REGION, ORDER_REGION, ORDER_NOTE];
  for (const fn of Object.values(client)) fn.mockReset();
  client.update.mockResolvedValue({});
  client.remove.mockResolvedValue({});
  client.createOption.mockResolvedValue({ id: 'new', value: 'east' });
  client.removeOption.mockResolvedValue(undefined);
  nativeDialogs = [
    vi.spyOn(window, 'confirm').mockImplementation(() => false),
    vi.spyOn(window, 'prompt').mockImplementation(() => null),
    vi.spyOn(window, 'alert').mockImplementation(() => undefined),
  ];
});

afterEach(() => {
  for (const spy of nativeDialogs) expect(spy).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

async function renderPage(entityType: 'quote_request' | 'order'): Promise<void> {
  renderWithI18n(
    <StrictMode>
      <AuthProvider initial={adminSession({ permissions: ['custom_fields:read', 'custom_fields:write'] })}>
        <CustomFieldsPage />
      </AuthProvider>
    </StrictMode>,
    { custom_fields: EN, core: coreEn as Record<string, string> },
  );
  const recordType = sentence(EN, 'customFields.form.entity');
  await waitFor(() =>
    expect(within(screen.getByLabelText(recordType)).getAllByRole('option').map((o) => o.textContent)).toContain('Order'),
  );
  fireEvent.change(screen.getByLabelText(recordType), { target: { value: entityType } });
  await waitFor(() => expect(client.list).toHaveBeenCalledWith(entityType));
  await waitFor(() => expect(client.list).toHaveBeenCalledWith(undefined));
  await screen.findByRole('row', { name: /region/ });
}

async function openEditor(key = 'region'): Promise<HTMLElement> {
  const title = sentence(EN, 'customFields.editor.title', { key });
  fireEvent.click(await screen.findByRole('button', { name: title }));
  return screen.findByRole('dialog', { name: title });
}

/** The warning lists exactly these "<type> · <key>" lines. */
function expectCounterparts(warning: HTMLElement, lines: string[]): void {
  expect(within(warning).getAllByRole('listitem').map((item) => item.textContent)).toEqual(lines);
}

const REQUESTS = (): number =>
  client.update.mock.calls.length +
  client.remove.mock.calls.length +
  client.createOption.mock.calls.length +
  client.removeOption.mock.calls.length;

describe('CustomFieldsPage — drift warnings', () => {
  describe('removing an option a carrying source holds', () => {
    async function askToRemoveSouth(): Promise<HTMLElement> {
      await renderPage('order');
      const dialog = await openEditor();
      const south = within(dialog).getByRole('group', { name: 'South' });
      fireEvent.click(within(south).getByRole('button', { name: 'Remove' }));
      return screen.findByRole('dialog', { name: WARNING });
    }

    it('asks first, naming the source, and sends nothing on Cancel', async () => {
      const warning = await askToRemoveSouth();
      expectCounterparts(warning, ['Quote request · region']);
      expect(within(warning).getByRole('button', { name: CANCEL })).toHaveFocus();
      expect(REQUESTS()).toBe(0);
      fireEvent.click(within(warning).getByRole('button', { name: CANCEL }));
      // The editor comes back as it was, the removal not asked again in the row.
      const editor = await screen.findByRole('dialog', { name: sentence(EN, 'customFields.editor.title', { key: 'region' }) });
      expect(within(editor).getByRole('group', { name: 'South' })).toBeInTheDocument();
      expect(REQUESTS()).toBe(0);
    });

    it('removes the option exactly as before on Proceed', async () => {
      const warning = await askToRemoveSouth();
      fireEvent.click(within(warning).getByRole('button', { name: PROCEED }));
      await waitFor(() => expect(client.removeOption).toHaveBeenCalledTimes(1));
      expect(client.removeOption).toHaveBeenCalledWith(ORDER_REGION.id, ORDER_REGION.options[1]!.id);
      expect(REQUESTS()).toBe(1);
    });
  });

  describe('adding an option the target lacks', () => {
    async function askToAddEast(): Promise<HTMLElement> {
      await renderPage('quote_request');
      const dialog = await openEditor();
      const add = within(dialog).getByRole('group', { name: 'Add option' });
      fireEvent.change(within(add).getByLabelText('Stored value'), { target: { value: 'east' } });
      fireEvent.change(within(add).getByLabelText('Default label'), { target: { value: 'East' } });
      fireEvent.click(within(add).getByRole('button', { name: 'Add option' }));
      return screen.findByRole('dialog', { name: WARNING });
    }

    it('asks first, naming the target, and keeps the typed option on Cancel', async () => {
      const warning = await askToAddEast();
      expectCounterparts(warning, ['Order · region']);
      fireEvent.click(within(warning).getByRole('button', { name: CANCEL }));
      const editor = await screen.findByRole('dialog', { name: sentence(EN, 'customFields.editor.title', { key: 'region' }) });
      expect(within(within(editor).getByRole('group', { name: 'Add option' })).getByLabelText('Stored value')).toHaveValue('east');
      expect(REQUESTS()).toBe(0);
    });

    it('adds the option exactly as before on Proceed', async () => {
      const warning = await askToAddEast();
      fireEvent.click(within(warning).getByRole('button', { name: PROCEED }));
      await waitFor(() => expect(client.createOption).toHaveBeenCalledTimes(1));
      expect(client.createOption).toHaveBeenCalledWith(QR_REGION.id, {
        value: 'east',
        labelDefault: 'East',
        label: {},
        isDefault: false,
        sortOrder: 2,
      });
    });
  });

  describe('making the target visible to customers under an internal source', () => {
    const audienceOf = (): HTMLSelectElement =>
      screen.getByLabelText(sentence(EN, 'customFields.audience.rowLabel', { key: 'region' })) as HTMLSelectElement;

    it('asks first and leaves the audience as it was on Cancel', async () => {
      await renderPage('order');
      fireEvent.change(audienceOf(), { target: { value: 'customer' } });
      const warning = await screen.findByRole('dialog', { name: WARNING });
      expectCounterparts(warning, ['Quote request · region']);
      fireEvent.click(within(warning).getByRole('button', { name: CANCEL }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(audienceOf().value).toBe('internal');
      expect(REQUESTS()).toBe(0);
    });

    it('sends the audience exactly as before on Proceed', async () => {
      await renderPage('order');
      fireEvent.change(audienceOf(), { target: { value: 'customer' } });
      const warning = await screen.findByRole('dialog', { name: WARNING });
      fireEvent.click(within(warning).getByRole('button', { name: PROCEED }));
      await waitFor(() => expect(client.update).toHaveBeenCalledTimes(1));
      expect(client.update).toHaveBeenCalledWith(ORDER_REGION.id, { audience: 'customer' });
    });
  });

  describe('deleting a definition that is part of an enabled carry', () => {
    it('asks once, in the warning, and sends nothing on Cancel', async () => {
      await renderPage('order');
      fireEvent.click(screen.getByRole('button', { name: sentence(EN, 'customFields.table.delete', { key: 'region' }) }));
      const warning = await screen.findByRole('dialog', { name: WARNING });
      expect(within(warning).getByText(sentence(EN, 'customFields.table.deleteConfirm', { key: 'region' }))).toBeInTheDocument();
      expectCounterparts(warning, ['Quote request · region']);
      fireEvent.click(within(warning).getByRole('button', { name: CANCEL }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(REQUESTS()).toBe(0);
    });

    it('deletes exactly as before on Proceed', async () => {
      await renderPage('quote_request');
      fireEvent.click(screen.getByRole('button', { name: sentence(EN, 'customFields.table.delete', { key: 'region' }) }));
      const warning = await screen.findByRole('dialog', { name: WARNING });
      expectCounterparts(warning, ['Order · region']);
      fireEvent.click(within(warning).getByRole('button', { name: PROCEED }));
      await waitFor(() => expect(client.remove).toHaveBeenCalledTimes(1));
      expect(client.remove).toHaveBeenCalledWith(QR_REGION.id);
    });
  });

  describe('accessibility', () => {
    it('has no axe violations with the warning open in the editor and over the table', async () => {
      await renderPage('order');
      const dialog = await openEditor();
      fireEvent.click(within(within(dialog).getByRole('group', { name: 'South' })).getByRole('button', { name: 'Remove' }));
      await expectNoAxeViolations(await screen.findByRole('dialog', { name: WARNING }));
      fireEvent.keyDown(document, { key: 'Escape' });
      // Escape answers the warning, not the editor under it.
      expect(await screen.findByRole('dialog', { name: sentence(EN, 'customFields.editor.title', { key: 'region' }) })).toBeInTheDocument();
      fireEvent.keyDown(document, { key: 'Escape' });
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

      fireEvent.click(screen.getByRole('button', { name: sentence(EN, 'customFields.table.delete', { key: 'region' }) }));
      await expectNoAxeViolations(await screen.findByRole('dialog', { name: WARNING }));
      expect(REQUESTS()).toBe(0);
    });
  });

  describe('a change that breaks nothing', () => {
    it('asks nothing when the audience change is one the rule allows', async () => {
      await renderPage('quote_request');
      fireEvent.change(screen.getByLabelText(sentence(EN, 'customFields.audience.rowLabel', { key: 'region' })), {
        target: { value: 'customer' },
      });
      await waitFor(() => expect(client.update).toHaveBeenCalledWith(QR_REGION.id, { audience: 'customer' }));
      expect(screen.queryByRole('dialog', { name: WARNING })).toBeNull();
    });

    it('keeps the in-row confirmation for a deletion no carry depends on', async () => {
      await renderPage('order');
      fireEvent.click(screen.getByRole('button', { name: sentence(EN, 'customFields.table.delete', { key: 'note' }) }));
      expect(screen.queryByRole('dialog', { name: WARNING })).toBeNull();
      expect(screen.getByText(sentence(EN, 'customFields.table.deleteConfirm', { key: 'note' }))).toBeInTheDocument();
    });

    it('keeps the in-row confirmation for an option no source holds', async () => {
      db.definitions = [QR_REGION, carryDefinition(ORDER_REGION.id, { entityType: 'order', optionValues: ['north', 'south', 'west'] })];
      await renderPage('order');
      const dialog = await openEditor();
      fireEvent.click(within(within(dialog).getByRole('group', { name: 'West' })).getByRole('button', { name: 'Remove' }));
      expect(screen.queryByRole('dialog', { name: WARNING })).toBeNull();
      expect(within(dialog).getByRole('button', { name: 'Keep' })).toBeInTheDocument();
    });
  });
});
