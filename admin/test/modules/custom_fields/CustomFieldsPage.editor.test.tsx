import { StrictMode, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { ApiError, AuthProvider } from '@endora-commerce/admin-kit/lib';
import type { CustomFieldDefinitionDto, CustomFieldEntityTypeInfo } from '@endora-commerce/contracts';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession } from '../../helpers/render-with-session';
import { expectNoAxeViolations } from '../../helpers/axe';
import en from '../../../../packages/modules/custom_fields/i18n/en.json';
import coreEn from '../../../../packages/modules/_i18n/i18n/en.json';

/**
 * Feature 157 (T055, US3) — an existing definition is edited on
 * `/custom-fields` in a dialog (`specs/157-custom-fields-list-filters/contracts/admin-surfaces.md` §3).
 * The save sends only what the operator changed (threat model F-6); option
 * actions go through the option sub-routes one at a time.
 */

const ENTITY_TYPES: CustomFieldEntityTypeInfo[] = [
  { entityType: 'order', labelKey: 'customFields.entity.order', listFilter: true },
  { entityType: 'customer', labelKey: 'customFields.entity.customer', listFilter: false },
];

function definition(overrides: Partial<CustomFieldDefinitionDto>): CustomFieldDefinitionDto {
  return {
    id: '00000000-0000-4000-8000-00000000cf01',
    entityType: 'order',
    key: 'region',
    label: { en: 'Region' },
    labelDefault: 'Region',
    valueType: 'select',
    required: false,
    audience: 'internal',
    sortOrder: 0,
    config: { hostFlag: true },
    listFilter: false,
    options: [
      { id: '00000000-0000-4000-8000-0000000000a1', value: 'north', label: { en: 'North' }, labelDefault: 'North', isDefault: false, sortOrder: 0 },
      { id: '00000000-0000-4000-8000-0000000000a2', value: 'south', label: { en: 'South' }, labelDefault: 'South', isDefault: false, sortOrder: 1 },
    ],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const REGION = definition({});
const TIER = definition({
  id: '00000000-0000-4000-8000-00000000cf02',
  entityType: 'customer',
  key: 'tier',
  label: {},
  labelDefault: 'Tier',
  valueType: 'text',
  options: [],
});
const NORTH_ID = REGION.options[0]!.id!;
const SOUTH_ID = REGION.options[1]!.id!;

const client = vi.hoisted(() => ({
  update: vi.fn(),
  get: vi.fn(),
  createOption: vi.fn(),
  updateOption: vi.fn(),
  removeOption: vi.fn(),
}));

vi.mock('../../../../packages/modules/custom_fields/src/admin/api/custom-fields-client', () => ({
  customFieldsClient: {
    listEntityTypes: async () => ENTITY_TYPES,
    list: async (entityType?: string) => (entityType === 'customer' ? [TIER] : entityType === 'order' ? [REGION] : []),
    get: (...args: unknown[]) => client.get(...args),
    create: async () => ({}),
    update: (...args: unknown[]) => client.update(...args),
    remove: async () => ({}),
    createOption: (...args: unknown[]) => client.createOption(...args),
    updateOption: (...args: unknown[]) => client.updateOption(...args),
    removeOption: (...args: unknown[]) => client.removeOption(...args),
  },
}));

/** Every prop set the behaviour block was rendered with — the seam value-carry extends. */
const behaviourProps = vi.hoisted(() => [] as Array<Record<string, unknown>>);
vi.mock('../../../../packages/modules/custom_fields/src/admin/components/DefinitionBehaviourFields', async () => {
  const actual = await vi.importActual<
    typeof import('../../../../packages/modules/custom_fields/src/admin/components/DefinitionBehaviourFields')
  >('../../../../packages/modules/custom_fields/src/admin/components/DefinitionBehaviourFields');
  return {
    ...actual,
    DefinitionBehaviourFields: (props: Parameters<typeof actual.DefinitionBehaviourFields>[0]): ReactNode => {
      behaviourProps.push(props as unknown as Record<string, unknown>);
      return <actual.DefinitionBehaviourFields {...props} />;
    },
  };
});

const { CustomFieldsPage } = await import(
  '../../../../packages/modules/custom_fields/src/admin/pages/CustomFieldsPage'
);

const BUNDLE = { custom_fields: en, core: coreEn as Record<string, string> };

let nativeDialogs: Array<ReturnType<typeof vi.spyOn>>;

beforeEach(() => {
  for (const fn of Object.values(client)) fn.mockReset();
  client.update.mockResolvedValue(REGION);
  client.get.mockResolvedValue(REGION);
  client.createOption.mockResolvedValue({ id: 'new', value: 'east' });
  client.updateOption.mockResolvedValue({ id: NORTH_ID, value: 'north' });
  client.removeOption.mockResolvedValue(undefined);
  behaviourProps.length = 0;
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

async function openEditor(entityType: 'order' | 'customer' = 'order', key = 'region'): Promise<HTMLElement> {
  renderWithI18n(
    <StrictMode>
      <AuthProvider initial={adminSession({ permissions: ['custom_fields:read', 'custom_fields:write'] })}>
        <CustomFieldsPage />
      </AuthProvider>
    </StrictMode>,
    BUNDLE,
  );
  await waitFor(() =>
    expect(within(screen.getByLabelText('Entity')).getAllByRole('option').map((o) => o.textContent)).toContain('Order'),
  );
  fireEvent.change(screen.getByLabelText('Entity'), { target: { value: entityType } });
  fireEvent.click(await screen.findByRole('button', { name: `Edit ${key}` }));
  return screen.findByRole('dialog', { name: `Edit ${key}` });
}

function save(dialog: HTMLElement): void {
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
}

/** The definition's own label inputs: option rows carry inputs of the same names. */
function labels(dialog: HTMLElement): HTMLElement {
  return within(dialog).getByRole('group', { name: 'Labels' });
}

function optionRow(dialog: HTMLElement, label: string): HTMLElement {
  return within(dialog).getByRole('group', { name: label });
}

describe('CustomFieldsPage — the definition editor', () => {
  it('shows key, entity type and value type as read-only text and offers no value-type control (US3-8)', async () => {
    const dialog = await openEditor();
    expect(within(dialog).getByText('region')).toBeInTheDocument();
    expect(within(dialog).getByText('Order')).toBeInTheDocument();
    expect(within(dialog).getByText('Single choice')).toBeInTheDocument();
    expect(within(dialog).queryByRole('combobox')).toBeNull();
    expect(within(dialog).queryByDisplayValue('region')).toBeNull();
  });

  it('sends one PATCH holding only the changed label (F-6, US3-4)', async () => {
    const dialog = await openEditor();
    fireEvent.change(within(labels(dialog)).getByLabelText('Polish label'), { target: { value: 'Region PL' } });
    save(dialog);
    await waitFor(() => expect(client.update).toHaveBeenCalledTimes(1));
    const [id, body] = client.update.mock.calls[0]!;
    expect(id).toBe(REGION.id);
    expect(body).toEqual({ label: { en: 'Region', pl: 'Region PL' } });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('sends nothing when nothing changed', async () => {
    const dialog = await openEditor();
    save(dialog);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(client.update).not.toHaveBeenCalled();
  });

  it('turns the list-filter option on (US3-1)', async () => {
    const dialog = await openEditor();
    fireEvent.click(within(dialog).getByLabelText('Use as list filter'));
    save(dialog);
    await waitFor(() => expect(client.update).toHaveBeenCalledWith(REGION.id, { listFilter: true }));
  });

  it('shows the required notice before saving and sends { required: true } (US3-7, FR-003b)', async () => {
    const dialog = await openEditor();
    expect(within(dialog).queryByText(/Records that already exist keep their values/)).toBeNull();
    fireEvent.click(within(dialog).getByLabelText('Required'));
    expect(within(dialog).getByText(/Records that already exist keep their values/)).toBeInTheDocument();
    expect(client.update).not.toHaveBeenCalled();
    save(dialog);
    await waitFor(() => expect(client.update).toHaveBeenCalledWith(REGION.id, { required: true }));
  });

  it('offers no list-filter toggle for an entity type without the option (US3-2)', async () => {
    const dialog = await openEditor('customer', 'tier');
    expect(within(dialog).queryByLabelText('Use as list filter')).toBeNull();
  });

  it('hands the behaviour block the edited definition and its entity type entry', async () => {
    await openEditor();
    const props = behaviourProps.at(-1)!;
    expect(props.definition).toMatchObject({
      id: REGION.id,
      key: 'region',
      valueType: 'select',
      audience: 'internal',
      options: REGION.options,
    });
    expect(props.entityTypeInfo).toEqual(ENTITY_TYPES[0]);
    expect(props.value).toEqual({ listFilter: false });
  });

  it('adds an option with its value and labels', async () => {
    const dialog = await openEditor();
    const add = within(dialog).getByRole('group', { name: 'Add option' });
    fireEvent.change(within(add).getByLabelText('Stored value'), { target: { value: 'east' } });
    fireEvent.change(within(add).getByLabelText('Default label'), { target: { value: 'East' } });
    fireEvent.change(within(add).getByLabelText('Polish label'), { target: { value: 'Wschód' } });
    fireEvent.click(within(add).getByRole('button', { name: 'Add option' }));
    await waitFor(() => expect(client.createOption).toHaveBeenCalledTimes(1));
    expect(client.createOption).toHaveBeenCalledWith(REGION.id, {
      value: 'east',
      labelDefault: 'East',
      label: { pl: 'Wschód' },
      isDefault: false,
      sortOrder: 2,
    });
    await waitFor(() => expect(client.get).toHaveBeenCalledWith(REGION.id));
  });

  it('relabels an option without sending its value, which is read-only text', async () => {
    const dialog = await openEditor();
    const row = optionRow(dialog, 'North');
    expect(within(row).getByText('north')).toBeInTheDocument();
    expect(within(row).queryByDisplayValue('north')).toBeNull();
    const polish = within(row).getByLabelText('Polish label');
    fireEvent.change(polish, { target: { value: 'Północ' } });
    fireEvent.blur(polish);
    await waitFor(() => expect(client.updateOption).toHaveBeenCalledTimes(1));
    expect(client.updateOption).toHaveBeenCalledWith(REGION.id, NORTH_ID, { label: { en: 'North', pl: 'Północ' } });
  });

  it('moves an option up by patching the sortOrder of the two that swapped, and announces it', async () => {
    const dialog = await openEditor();
    fireEvent.click(within(optionRow(dialog, 'South')).getByRole('button', { name: 'Move up' }));
    await waitFor(() => expect(client.updateOption).toHaveBeenCalledTimes(2));
    expect(client.updateOption).toHaveBeenCalledWith(REGION.id, SOUTH_ID, { sortOrder: 0 });
    expect(client.updateOption).toHaveBeenCalledWith(REGION.id, NORTH_ID, { sortOrder: 1 });
    await waitFor(() =>
      expect(within(dialog).getByRole('status')).toHaveTextContent('“South” moved up to position 1 of 2.'),
    );
  });

  it('removes an unused option after an in-dialog confirmation', async () => {
    const dialog = await openEditor();
    fireEvent.click(within(optionRow(dialog, 'South')).getByRole('button', { name: 'Remove' }));
    expect(client.removeOption).not.toHaveBeenCalled();
    const row = optionRow(dialog, 'South');
    expect(within(row).getByText('Remove the option “South”?')).toBeInTheDocument();
    fireEvent.click(within(row).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(client.removeOption).toHaveBeenCalledWith(REGION.id, SOUTH_ID));
  });

  it('shows the server sentence at an option in use (US3-6)', async () => {
    client.removeOption.mockRejectedValue(
      new ApiError(409, { error: { code: 'CUSTOM_FIELD_DEFINITION_INVALID', message: 'This option is still used by 3 records.' } }),
    );
    const dialog = await openEditor();
    fireEvent.click(within(optionRow(dialog, 'North')).getByRole('button', { name: 'Remove' }));
    fireEvent.click(within(optionRow(dialog, 'North')).getByRole('button', { name: 'Remove' }));
    expect(await within(optionRow(dialog, 'North')).findByText('This option is still used by 3 records.')).toBeInTheDocument();
    expect(within(dialog).queryByText(/CUSTOM_FIELD_DEFINITION_INVALID/)).toBeNull();
  });

  it('keeps the dialog open with the server sentence when the save is refused', async () => {
    client.update.mockRejectedValue(
      new ApiError(422, { error: { code: 'CUSTOM_FIELD_DEFINITION_INVALID', message: 'The label is too long.' } }),
    );
    const dialog = await openEditor();
    fireEvent.change(within(labels(dialog)).getByLabelText('Default label'), { target: { value: 'Area' } });
    save(dialog);
    expect(await within(dialog).findByText('The label is too long.')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBe(dialog);
  });

  it('asks for a default label in the dialog, never through the browser', async () => {
    const dialog = await openEditor();
    const input = within(labels(dialog)).getByLabelText('Default label');
    expect(input).not.toBeRequired();
    fireEvent.change(input, { target: { value: '  ' } });
    save(dialog);
    expect(await within(dialog).findByText('Enter a default label.')).toBeInTheDocument();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(client.update).not.toHaveBeenCalled();
  });

  it('ignores Escape while saving', async () => {
    let finish!: (value: unknown) => void;
    client.update.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    const dialog = await openEditor();
    fireEvent.click(within(dialog).getByLabelText('Use as list filter'));
    save(dialog);
    await waitFor(() => expect(client.update).toHaveBeenCalledTimes(1));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    finish(REGION);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('has no axe violations with the dialog open', async () => {
    const dialog = await openEditor();
    await expectNoAxeViolations(dialog);
  });
});
