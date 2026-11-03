import { useState, type ReactElement } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { RecordDocumentLookupResponse, RecordReference } from '@endora-commerce/contracts';
import {
  ReferenceField,
  ReferenceText,
  textOfEditorDoc,
  type EditorDoc,
  type ReferenceLookups,
  type ReferenceSuggestion,
  type ReferenceTriggerKind,
} from '@endora-commerce/admin-kit/components';
import { Label } from '@endora-commerce/admin-kit/ui';
import { AppLanguageContext } from '@endora-commerce/admin-kit/i18n';
import { renderWithI18n } from '../helpers/render-with-i18n';
import { adminSession, withSession } from '../helpers/render-with-session';

/**
 * The reference editor and its reader, promoted from CRM into the kit
 * (`specs/163-projects-and-tasks/` research R-14, R-17; T099).
 *
 * The kit knows no module: **what may be referred to is a prop** (`kinds` — the
 * trigger table, `@` a person, `@@` a document, `@@@` a Product) and **where the
 * suggestions come from is an adapter** (`ReferenceLookups`). CRM's own screen
 * tests (`admin/test/modules/crm/`) hold the CRM wiring; these hold the
 * component.
 */

const CORE: Record<string, string> = JSON.parse(
  readFileSync(resolve(process.cwd(), '../packages/modules/_i18n/i18n/en.json'), 'utf8'),
) as Record<string, string>;

function core(key: string, params: Record<string, string | number> = {}): string {
  const template = CORE[key];
  if (template === undefined) throw new Error(`the shipped core bundle has no key "${key}"`);
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole));
}

const PERSON_ID = '00000000-0000-4000-8000-00000000ad11';
const OTHER_PERSON_ID = '00000000-0000-4000-8000-00000000ad12';
const ORDER_ID = '00000000-0000-4000-8000-0000000000c1';
const QUOTE_ID = '00000000-0000-4000-8000-0000000000f1';
const TASK_ID = '00000000-0000-4000-8000-0000000000e1';
const PRODUCT_ID = '00000000-0000-4000-8000-00000000aa01';
const OPPORTUNITY_ID = '00000000-0000-4000-8000-0000000000b1';
const PROJECT_ID = '00000000-0000-4000-8000-0000000000b2';

const PEOPLE: ReferenceSuggestion[] = [
  { id: PERSON_ID, label: 'Anna Nowak' },
  { id: OTHER_PERSON_ID, label: 'Piotr Zielony' },
];
const DOCUMENTS: RecordDocumentLookupResponse = {
  groups: [
    { kind: 'order', items: [{ id: ORDER_ID, label: 'ORD-1001' }] },
    { kind: 'quote_request', items: [{ id: QUOTE_ID, label: 'QR-0007' }] },
    { kind: 'task', items: [{ id: TASK_ID, label: 'TSK-000042', sublabel: 'Call the client' }] },
  ],
};

const searchPeople = vi.fn<(query: string) => Promise<readonly ReferenceSuggestion[]>>();
const searchDocuments = vi.fn<(query: string) => Promise<RecordDocumentLookupResponse>>();
const searchProducts = vi.fn<(query: string) => Promise<readonly ReferenceSuggestion[]>>();
const LOOKUPS: ReferenceLookups = { searchPeople, searchDocuments, searchProducts };
const STANDARD: readonly ReferenceTriggerKind[] = ['admin_user', 'document', 'product'];

beforeEach(() => {
  searchPeople.mockReset();
  searchDocuments.mockReset();
  searchProducts.mockReset();
  searchPeople.mockImplementation((query) =>
    Promise.resolve(PEOPLE.filter((person) => person.label.toLowerCase().includes(query.toLowerCase()))),
  );
  searchDocuments.mockResolvedValue(DOCUMENTS);
  searchProducts.mockResolvedValue([{ id: PRODUCT_ID, label: 'Cargo van L2', description: 'VAN-L2' }]);
});

function mount(ui: ReactElement): void {
  renderWithI18n(
    withSession(
      <AppLanguageContext.Provider value={{ language: 'en', setLanguage: (): void => {} }}>
        <MemoryRouter initialEntries={['/projects/p1']}>{ui}</MemoryRouter>
      </AppLanguageContext.Provider>,
      {
      session: adminSession({ permissions: ['*'] }),
    }),
    { core: CORE },
  );
}

function Harness(props: {
  kinds?: readonly ReferenceTriggerKind[];
  initial?: string;
  references?: readonly RecordReference[];
}): ReactElement {
  const [value, setValue] = useState(props.initial ?? '');
  return (
    <div>
      <Label htmlFor="kit-field">Description</Label>
      <ReferenceField
        id="kit-field"
        value={value}
        kinds={props.kinds ?? STANDARD}
        lookups={LOOKUPS}
        {...(props.references ? { references: props.references } : {})}
        onValueChange={setValue}
      />
      <output data-testid="stored">{value}</output>
    </div>
  );
}

function field(): HTMLElement {
  return screen.getByLabelText('Description');
}

function storedText(element: HTMLElement): string {
  const editor = (element as unknown as { editor?: { getJSON(): unknown } }).editor;
  if (!editor) throw new Error('not a formatted field');
  return textOfEditorDoc(editor.getJSON() as EditorDoc);
}

describe('ReferenceField — the trigger table is the `kinds` prop', () => {
  it('@ opens the people the adapter answers, narrows as letters are typed, and Enter puts the mention in', async () => {
    mount(<Harness />);
    await userEvent.type(field(), '@');
    const list = await screen.findByRole('listbox', { name: core('references.suggest.title.person') });
    expect(within(list).getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Anna Nowak',
      'Piotr Zielony',
    ]);
    expect(searchPeople).toHaveBeenCalledWith('');

    await userEvent.type(field(), 'pio');
    await waitFor(() =>
      expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['Piotr Zielony']),
    );
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(storedText(field())).toBe(`[[admin_user:${OTHER_PERSON_ID}]] `));
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('@@ opens one document list, grouped Orders · Quote requests · Tasks, and a Task is inserted as its token', async () => {
    mount(<Harness />);
    await userEvent.type(field(), 'see @@');
    const list = await screen.findByRole('listbox', { name: core('references.suggest.title.document') });
    const groups = within(list).getAllByRole('group');
    expect(groups.map((group) => group.getAttribute('aria-label'))).toEqual([
      core('references.group.order'),
      core('references.group.quote_request'),
      core('references.group.task'),
    ]);
    expect(within(groups[2]!).getByRole('option')).toHaveTextContent('TSK-000042');
    expect(within(groups[2]!).getByRole('option')).toHaveTextContent('Call the client');
    expect(searchDocuments).toHaveBeenCalledWith('');

    await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    await waitFor(() => expect(storedText(field())).toBe(`see [[task:${TASK_ID}]] `));
  });

  it('never shrinks a suggestion’s number for its title: the title is what truncates (165 T095)', async () => {
    // jsdom lays nothing out, so the flex contract is what is held: the label
    // (the record's number, what the chip shows) keeps its width; the sublabel (the title) may shrink to nothing and truncates.
    const long = 'A very long Task title that goes on and on well past the width of any popup list';
    searchDocuments.mockResolvedValue({ groups: [{ kind: 'task', items: [{ id: TASK_ID, label: 'TSK-000042', sublabel: long }] }] });
    mount(<Harness />);
    await userEvent.type(field(), '@@');
    const option = within(await screen.findByRole('listbox', { name: core('references.suggest.title.document') })).getByRole(
      'option',
    );
    const number = within(option).getByText('TSK-000042');
    expect(number).toHaveClass('shrink-0');
    expect(number).not.toHaveClass('min-w-0');
    const title = within(option).getByText(long);
    expect(title).toHaveClass('min-w-0', 'truncate');
    expect(title).not.toHaveClass('shrink-0');
  });

  it('shows only the groups the adapter answers — a group it leaves out is not offered', async () => {
    searchDocuments.mockResolvedValue({ groups: [{ kind: 'task', items: [{ id: TASK_ID, label: 'TSK-000042' }] }] });
    mount(<Harness />);
    await userEvent.type(field(), '@@');
    const list = await screen.findByRole('listbox', { name: core('references.suggest.title.document') });
    expect(within(list).getAllByRole('group').map((group) => group.getAttribute('aria-label'))).toEqual([
      core('references.group.task'),
    ]);
  });

  // `specs/165-task-management/` T035, research R-5: Opportunities and Projects
  // are kinds of the shared grammar, two more groups of the one list.
  it('@@ groups Opportunities and Projects after Tasks, and inserts each as its token', async () => {
    searchDocuments.mockResolvedValue({
      groups: [
        ...DOCUMENTS.groups,
        { kind: 'opportunity', items: [{ id: OPPORTUNITY_ID, label: 'OPP-000012', sublabel: 'Fleet renewal' }] },
        { kind: 'project', items: [{ id: PROJECT_ID, label: 'PRJ-000003', sublabel: 'Warehouse fit-out' }] },
      ],
    });
    mount(<Harness />);
    await userEvent.type(field(), '@@');
    const list = await screen.findByRole('listbox', { name: core('references.suggest.title.document') });
    const groups = within(list).getAllByRole('group');
    expect(groups.map((group) => group.getAttribute('aria-label'))).toEqual([
      core('references.group.order'),
      core('references.group.quote_request'),
      core('references.group.task'),
      core('references.group.opportunity'),
      core('references.group.project'),
    ]);
    expect(within(groups[3]!).getByRole('option')).toHaveTextContent('OPP-000012');
    expect(within(groups[4]!).getByRole('option')).toHaveTextContent('Warehouse fit-out');
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{Enter}');
    await waitFor(() => expect(storedText(field())).toBe(`[[project:${PROJECT_ID}]] `));
  });

  it('@@@ opens the Products the adapter answers', async () => {
    mount(<Harness />);
    await userEvent.type(field(), '@@@');
    const list = await screen.findByRole('listbox', { name: core('references.suggest.title.product') });
    expect(within(list).getByRole('option')).toHaveTextContent('Cargo van L2');
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(storedText(field())).toBe(`[[product:${PRODUCT_ID}]] `));
  });

  it('opens nothing for a kind it was not given, and offers no button or shortcut for it', async () => {
    mount(<Harness kinds={['admin_user']} />);
    expect(screen.getByRole('button', { name: core('references.insert.person') })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: core('references.insert.document') })).toBeNull();
    expect(screen.queryByRole('button', { name: core('references.insert.product') })).toBeNull();
    expect(
      screen.getByText(core('references.shortcuts', { list: core('references.shortcut.person') })),
    ).toBeInTheDocument();

    await userEvent.type(field(), '@@');
    await new Promise((settle) => setTimeout(settle, 400));
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(searchDocuments).not.toHaveBeenCalled();
  });

  it('the @ of an e-mail address opens nothing and asks nobody', async () => {
    mount(<Harness />);
    await userEvent.type(field(), 'write to jan@example.com');
    await new Promise((settle) => setTimeout(settle, 400));
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(searchPeople).not.toHaveBeenCalled();
    expect(storedText(field())).toBe('write to jan@example.com');
  });

  it('draws the list at the caret, inside the field’s own box, and the field is its combobox', async () => {
    mount(<Harness />);
    await userEvent.type(field(), 'Hello @');
    const list = await screen.findByRole('listbox', { name: core('references.suggest.title.person') });
    const popup = list.parentElement as HTMLElement;
    // Positioned against the box that holds the field, so it moves with the field.
    expect(popup.parentElement).toContainElement(field());
    expect(popup.className).toContain('absolute');
    expect(field()).toHaveAttribute('role', 'combobox');
    expect(field()).toHaveAttribute('aria-controls', list.id);
  });

  it('shows the tokens of a text by name, an unreadable one as unavailable, and changes nothing by showing them', () => {
    const text = `Ask [[admin_user:${PERSON_ID}]] about [[quote_request:${QUOTE_ID}]] and [[task:${TASK_ID}]].`;
    mount(
      <Harness
        initial={text}
        references={[
          { type: 'admin_user', id: PERSON_ID, available: true, label: 'Anna Nowak', url: null },
          { type: 'quote_request', id: QUOTE_ID, available: true, label: 'QR-0007', url: `/quote-requests/${QUOTE_ID}` },
          { type: 'task', id: TASK_ID, available: false, label: null, url: null },
        ]}
      />,
    );
    expect(field()).toHaveTextContent(`Ask @Anna Nowak about QR-0007 and ${core('references.unavailable.task')}.`);
    expect(field().textContent).not.toContain('[[');
    expect(storedText(field())).toBe(text);
    expect(screen.getByTestId('stored')).toHaveTextContent(text);
  });
});

describe('ReferenceField — a chip copied and pasted', () => {
  const pasteHtml = (html: string): void => {
    field().focus();
    fireEvent.paste(field(), {
      clipboardData: {
        getData: (type: string): string => (type === 'text/html' ? html : ''),
        types: ['text/html'],
      },
    });
  };

  it('carries its token under a neutral attribute, and pastes back as the chip', async () => {
    mount(
      <Harness
        initial={`[[task:${TASK_ID}]]`}
        references={[{ type: 'task', id: TASK_ID, available: true, label: 'TSK-000042', url: `/tasks/${TASK_ID}` }]}
      />,
    );
    const chip = field().querySelector('[data-reference-token]');
    expect(chip?.getAttribute('data-reference-token')).toBe(`[[task:${TASK_ID}]]`);
    expect(field().querySelector('[data-crm-token]')).toBeNull();
  });

  it('pastes a chip copied from a screen of an earlier build — the attribute CRM named — as the chip', async () => {
    mount(<Harness />);
    pasteHtml(`<p>see <span data-crm-token="[[order:${ORDER_ID}]]" data-available="true" data-label="ORD-1001">ORD-1001</span></p>`);
    await waitFor(() => expect(storedText(field())).toBe(`see [[order:${ORDER_ID}]]`));
    pasteHtml(`<span data-reference-token="[[task:${TASK_ID}]]" data-available="false">x</span>`);
    await waitFor(() => expect(storedText(field())).toContain(`[[task:${TASK_ID}]]`));
  });
});

describe('ReferenceText — five chip kinds, and the unavailable chip', () => {
  const REFERENCES: RecordReference[] = [
    { type: 'admin_user', id: PERSON_ID, available: true, label: 'Anna Nowak', url: null },
    {
      type: 'order',
      id: ORDER_ID,
      available: true,
      label: 'ORD-1001',
      url: `/orders/${ORDER_ID}`,
      order: { status: 'paid', total: '990.00', currency: 'PLN', placedAt: '2026-10-01T10:00:00.000Z', customerName: 'Acme' },
    },
    { type: 'product', id: PRODUCT_ID, available: true, label: 'Cargo van L2', url: `/catalog/products/${PRODUCT_ID}` },
    { type: 'quote_request', id: QUOTE_ID, available: true, label: 'QR-0007', url: `/quote-requests/${QUOTE_ID}` },
    { type: 'task', id: TASK_ID, available: true, label: 'TSK-000042', url: `/tasks/${TASK_ID}` },
  ];
  const text =
    `[[admin_user:${PERSON_ID}]] [[order:${ORDER_ID}]] [[product:${PRODUCT_ID}]] ` +
    `[[quote_request:${QUOTE_ID}]] [[task:${TASK_ID}]]`;

  it('names a person, and links an Order, a Product, a Quote Request and a Task to their screens', () => {
    mount(<ReferenceText text={text} references={REFERENCES} orderStatusLabel={(code) => `status ${code}`} />);
    expect(screen.getByText('Anna Nowak').closest('span')).toHaveTextContent('@Anna Nowak');
    expect(screen.queryByRole('link', { name: /Anna Nowak/ })).toBeNull();

    const order = screen.getByRole('link', { name: `${core('references.kind.order')}ORD-1001` });
    expect(order.getAttribute('href')).toMatch(/^\/orders\/[^?]+\?returnTo=%2Fprojects%2Fp1$/);
    // An Order says more than its number, through the status label it was given.
    expect(order.parentElement).toHaveTextContent('status paid');
    expect(order.parentElement).toHaveTextContent('Acme');
    expect(
      screen.getByRole('link', { name: core('references.order.openInNewTab', { number: 'ORD-1001' }) }),
    ).toHaveAttribute('target', '_blank');

    expect(screen.getByRole('link', { name: `${core('references.kind.product')}Cargo van L2` })).toHaveAttribute(
      'href',
      `/catalog/products/${PRODUCT_ID}`,
    );
    expect(
      screen.getByRole('link', { name: `${core('references.kind.quote_request')}QR-0007` }).getAttribute('href'),
    ).toMatch(/^\/quote-requests\/[^?]+\?returnTo=%2Fprojects%2Fp1$/);
    expect(screen.getByRole('link', { name: `${core('references.kind.task')}TSK-000042` })).toHaveAttribute(
      'href',
      `/tasks/${TASK_ID}`,
    );
  });

  it('links an Opportunity and a Project to their screens (165)', () => {
    mount(
      <ReferenceText
        text={`[[opportunity:${OPPORTUNITY_ID}]] [[project:${PROJECT_ID}]]`}
        references={[
          {
            type: 'opportunity',
            id: OPPORTUNITY_ID,
            available: true,
            label: 'OPP-000012',
            url: `/crm/opportunities/${OPPORTUNITY_ID}`,
          },
          { type: 'project', id: PROJECT_ID, available: true, label: 'PRJ-000003', url: `/projects/${PROJECT_ID}` },
        ]}
      />,
    );
    expect(screen.getByRole('link', { name: `${core('references.kind.opportunity')}OPP-000012` })).toHaveAttribute(
      'href',
      `/crm/opportunities/${OPPORTUNITY_ID}`,
    );
    expect(screen.getByRole('link', { name: `${core('references.kind.project')}PRJ-000003` })).toHaveAttribute(
      'href',
      `/projects/${PROJECT_ID}`,
    );
  });

  it('shows an Opportunity or a Project the reader may not see as unavailable (165)', () => {
    mount(
      <ReferenceText
        text={`[[opportunity:${OPPORTUNITY_ID}]] [[project:${PROJECT_ID}]]`}
        references={[
          { type: 'opportunity', id: OPPORTUNITY_ID, available: false, label: null, url: null },
          { type: 'project', id: PROJECT_ID, available: false, label: null, url: null },
        ]}
      />,
    );
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    for (const type of ['opportunity', 'project'] as const) {
      expect(screen.getByText(core(`references.unavailable.${type}`))).toHaveAttribute('title', core('references.unavailableHint'));
    }
  });

  it('shows a target the reader may not see as a chip that says so, with no link and no name', () => {
    mount(
      <ReferenceText
        text={`[[quote_request:${QUOTE_ID}]] [[task:${TASK_ID}]]`}
        references={[
          { type: 'quote_request', id: QUOTE_ID, available: false, label: null, url: null },
          { type: 'task', id: TASK_ID, available: false, label: null, url: null },
        ]}
      />,
    );
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    for (const type of ['quote_request', 'task'] as const) {
      const chip = screen.getByText(core(`references.unavailable.${type}`));
      expect(chip).toHaveAttribute('title', core('references.unavailableHint'));
    }
  });
});
