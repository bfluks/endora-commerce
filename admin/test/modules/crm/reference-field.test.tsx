import { useState, type ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { OpportunityReference } from '@endora-commerce/contracts';
import { ADMIN_ID, ORDER_ID, ORGANIZATION_ID, caretAt, core, crmLookupResponse, editorOf, renderCrm, storedText } from './crm-fixtures';

/**
 * The field a description, a note, a message or an Event's description is
 * written in (`specs/158-crm-opportunity-inline-editing/`, FR-010 – FR-011;
 * `specs/143-crm-sales-opportunities/` User Story 18): formatted text that
 * shows names, never tokens, and stores the text grammar of the contracts
 * package — formatting as its markers, a chip as its token.
 *
 * What is proven here is what a DOM without layout can express: what the field
 * draws for a text, and what each edit does to the stored text. That the caret
 * *looks* right around a chip, and where the list is drawn, are the browser
 * walk's.
 */

const getSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: { get: (...args: unknown[]) => getSpy(...args), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  };
});

const { ReferenceField } = await import('../../../../packages/modules/crm/src/admin/components/ReferenceField');
const { Label } = await import('@endora-commerce/admin-kit/ui');

const PRODUCT_ID = '00000000-0000-4000-8000-00000000aa01';
const HIDDEN_ORDER_ID = '00000000-0000-4000-8000-0000000000c7';
const UNKNOWN_ID = '00000000-0000-4000-8000-00000000ffff';
const person = `[[admin_user:${ADMIN_ID}]]`;
const order = `[[order:${ORDER_ID}]]`;
const product = `[[product:${PRODUCT_ID}]]`;
const hidden = `[[order:${HIDDEN_ORDER_ID}]]`;
const unknown = `[[admin_user:${UNKNOWN_ID}]]`;

const REFERENCES: OpportunityReference[] = [
  { type: 'admin_user', id: ADMIN_ID, available: true, label: 'Anna Nowak', url: null },
  { type: 'order', id: ORDER_ID, available: true, label: 'ORD-1001', url: `/orders/${ORDER_ID}` },
  { type: 'product', id: PRODUCT_ID, available: true, label: 'Cargo van L2', url: `/catalog/products/${PRODUCT_ID}` },
  { type: 'order', id: HIDDEN_ORDER_ID, available: false, label: null, url: null },
];

const changes = vi.fn();

function Harness(props: {
  initial?: string;
  maxLength?: number;
  disabled?: boolean;
  references?: OpportunityReference[];
}): ReactElement {
  const [value, setValue] = useState(props.initial ?? '');
  return (
    <div>
      <Label htmlFor="walk-field">Description</Label>
      <ReferenceField
        id="walk-field"
        value={value}
        organizationId={ORGANIZATION_ID}
        references={props.references ?? REFERENCES}
        placeholder="Write here"
        {...(props.maxLength ? { maxLength: props.maxLength } : {})}
        {...(props.disabled ? { disabled: true } : {})}
        onValueChange={(next): void => {
          changes(next);
          setValue(next);
        }}
      />
      <button type="button" onClick={(): void => setValue('')}>
        reset
      </button>
      <output data-testid="stored">{value}</output>
    </div>
  );
}

function mount(props: Parameters<typeof Harness>[0] = {}): HTMLElement {
  renderCrm(<Harness {...props} />);
  return screen.getByLabelText('Description');
}

const chips = (field: HTMLElement): string[] =>
  Array.from(field.querySelectorAll('[data-reference-token]')).map((chip) => chip.textContent ?? '');
const sent = (): string => screen.getByTestId('stored').textContent ?? '';

beforeEach(() => {
  getSpy.mockReset();
  changes.mockReset();
  getSpy.mockImplementation((path: string) => crmLookupResponse(path) ?? Promise.resolve({ data: [] }));
});

describe('a text opened for editing', () => {
  it('shows every reference by name — a person, an Order, a Product — and no token', () => {
    const text = `Ask ${person} about ${order} and ${product}.`;
    const field = mount({ initial: text });
    expect(field).toHaveTextContent('Ask @Anna Nowak about ORD-1001 and Cargo van L2.');
    expect(field.textContent).not.toContain('[[');
    expect(chips(field)).toEqual(['@Anna Nowak', 'ORD-1001', 'Cargo van L2']);
    // Nothing was changed by showing it.
    expect(storedText(field)).toBe(text);
    expect(changes).not.toHaveBeenCalled();
  });

  it('shows formatting as formatting — bold, italic, strikethrough, lists, links — and no markers', () => {
    const text = '**Deal** _soon_ ~~maybe~~\n- one\n2. two\n[site](https://example.com)';
    const field = mount({ initial: text });
    expect(field.querySelector('strong')).toHaveTextContent('Deal');
    expect(field.querySelector('em')).toHaveTextContent('soon');
    expect(field.querySelector('s')).toHaveTextContent('maybe');
    expect(field.querySelector('ul > li')).toHaveTextContent('one');
    expect(field.querySelector('ol')).toHaveAttribute('start', '2');
    expect(field.querySelector('a')).toHaveAttribute('href', 'https://example.com');
    expect(field.textContent).not.toMatch(/\*\*|~~|\]\(/);
    expect(storedText(field)).toBe(text);
    expect(changes).not.toHaveBeenCalled();
  });

  it('says unavailable for a target the reader may not see, and keeps its token through an edit', async () => {
    const text = `See ${hidden} first.`;
    const field = mount({ initial: text });
    expect(chips(field)).toEqual([core('references.unavailable.order')]);
    caretAt(field, text.length);
    await userEvent.type(field, ' Then call.', { skipClick: true });
    expect(sent()).toBe(`${text} Then call.`);
  });

  it('keeps a token it has no name for — as an unavailable chip — and sends it unchanged', async () => {
    const text = `Ask ${unknown}`;
    const field = mount({ initial: text });
    expect(chips(field)).toEqual([core('references.unavailable.admin_user')]);
    caretAt(field, text.length);
    await userEvent.type(field, '!', { skipClick: true });
    expect(sent()).toBe(`${text}!`);
  });

  it('is a multi-line text box under its label, and the label focuses it', async () => {
    const field = mount({ initial: 'Hello' });
    expect(field).toHaveAttribute('role', 'textbox');
    expect(field).toHaveAttribute('aria-multiline', 'true');
    expect(field).toHaveAttribute('contenteditable', 'true');
    expect(screen.getByRole('textbox', { name: 'Description' })).toBe(field);
    expect(field).toHaveAttribute('aria-placeholder', 'Write here');
    await userEvent.click(screen.getByText('Description'));
    await waitFor(() => expect(field).toHaveFocus());
  });

  it('marks an empty field so its placeholder shows, and a filled one so it does not', async () => {
    const field = mount();
    expect(field).toHaveAttribute('data-empty', 'true');
    await userEvent.type(field, 'x');
    await waitFor(() => expect(field).toHaveAttribute('data-empty', 'false'));
  });

  it('cannot be typed into while disabled, and says so', () => {
    const field = mount({ initial: `Ask ${person}`, disabled: true });
    expect(field).toHaveAttribute('contenteditable', 'false');
    expect(field).toHaveAttribute('aria-disabled', 'true');
    expect(chips(field)).toEqual(['@Anna Nowak']);
    for (const button of within(screen.getByRole('toolbar')).getAllByRole('button')) expect(button).toBeDisabled();
  });

  it('follows a value set from outside — the form cleared after a message was sent', async () => {
    const field = mount({ initial: `Ask ${person}` });
    await userEvent.click(screen.getByRole('button', { name: 'reset' }));
    expect(field.textContent).toBe('');
    await waitFor(() => expect(field).toHaveAttribute('data-empty', 'true'));
    expect(changes).not.toHaveBeenCalled();
  });
});

describe('formatting', () => {
  it('formats what is selected from the toolbar, and stores it as the text grammar', async () => {
    const field = mount({ initial: 'Call Anna today' });
    // "Anna" selected.
    editorOf(field).commands.setTextSelection({ from: 6, to: 10 });
    await userEvent.click(screen.getByRole('button', { name: core('editor.format.bold') }));
    expect(sent()).toBe('Call **Anna** today');
    expect(screen.getByRole('button', { name: core('editor.format.bold') })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: core('editor.format.italic') }));
    expect(sent()).toBe('Call **_Anna_** today');
    await userEvent.click(screen.getByRole('button', { name: core('editor.format.strike') }));
    expect(sent()).toBe('Call **_~~Anna~~_** today');
  });

  it('turns lines into a bulleted and a numbered list from the toolbar', async () => {
    const field = mount({ initial: 'one\ntwo' });
    editorOf(field).commands.selectAll();
    await userEvent.click(screen.getByRole('button', { name: core('editor.format.bulletList') }));
    expect(sent()).toBe('- one\n- two');
    await userEvent.click(screen.getByRole('button', { name: core('editor.format.orderedList') }));
    expect(sent()).toBe('1. one\n2. two');
  });

  it('starts a list when a line begins as one is written', async () => {
    const field = mount();
    await userEvent.type(field, '- first{Enter}second');
    expect(sent()).toBe('- first\n- second');
  });

  it('links what is selected to an address, and refuses one a reader may not follow', async () => {
    const field = mount({ initial: 'see the offer' });
    editorOf(field).commands.setTextSelection({ from: 9, to: 14 });
    await userEvent.click(screen.getByRole('button', { name: core('editor.format.link') }));
    const address = screen.getByRole('textbox', { name: core('editor.link.url') });
    await userEvent.type(address, 'javascript:alert(1){Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent(core('editor.link.invalid'));
    expect(sent()).toBe('see the offer');
    await userEvent.clear(address);
    await userEvent.type(address, 'example.com/offer{Enter}');
    expect(sent()).toBe('see the [offer](https://example.com/offer)');
    expect(field.querySelector('a')).toHaveAttribute('href', 'https://example.com/offer');
  });

  it('keeps the characters of formatting typed by hand as the characters they are', async () => {
    const field = mount();
    await userEvent.type(field, '2 * 3 and a_b_c');
    expect(sent()).toBe('2 \\* 3 and a\\_b\\_c');
  });
});

describe('editing around a chip', () => {
  it('Backspace after a chip takes the whole of it, and nothing else', async () => {
    const text = `Ask ${person} now`;
    const field = mount({ initial: text });
    caretAt(field, `Ask ${person}`.length);
    await userEvent.keyboard('{Backspace}');
    expect(sent()).toBe('Ask  now');
    expect(chips(field)).toEqual([]);
    // The next Backspace is an ordinary one.
    await userEvent.keyboard('{Backspace}');
    expect(sent()).toBe('Ask now');
  });

  it('typing next to a chip leaves the chip alone', async () => {
    const field = mount({ initial: `${person}` });
    caretAt(field, person.length);
    await userEvent.type(field, ' - take this over', { skipClick: true });
    expect(sent()).toBe(`${person} - take this over`);
    expect(field).toHaveTextContent('@Anna Nowak - take this over');
    expect(chips(field)).toEqual(['@Anna Nowak']);
  });

  it('Enter starts a new line of the text', async () => {
    const field = mount();
    await userEvent.type(field, 'one{Enter}two{Enter}three');
    expect(sent()).toBe('one\ntwo\nthree');
  });
});

describe('pasting', () => {
  it('keeps the formatting the text can hold, and none of the rest of the markup', async () => {
    const field = mount({ initial: 'Start: ' });
    caretAt(field, 7);
    const clipboardData = {
      getData: (type: string): string =>
        type === 'text/html'
          ? '<p>first <b>bold</b> <u>under</u></p><h1>heading</h1><script>x</script><img src=x onerror="alert(1)">'
          : 'first bold under\nheading',
      types: ['text/html', 'text/plain'],
    };
    fireEvent.paste(field, { clipboardData });
    await waitFor(() => expect(sent()).toBe('Start: first **bold** under\nheading'));
    expect(field.querySelector('script, img, h1, u')).toBeNull();
  });

  it('draws a pasted token as a chip', async () => {
    const field = mount();
    field.focus();
    fireEvent.paste(field, {
      clipboardData: { getData: (type: string): string => (type === 'text/plain' ? `Ask ${person} today` : '') },
    });
    expect(sent()).toBe(`Ask ${person} today`);
    expect(chips(field)).toEqual(['@Anna Nowak']);
  });
});

describe('the length limit', () => {
  it('counts the stored text, refuses what does not fit and says so', async () => {
    const field = mount({ initial: person, maxLength: person.length + 3 });
    caretAt(field, person.length);
    await userEvent.type(field, 'abcd', { skipClick: true });
    expect(sent()).toBe(`${person}abc`);
    expect(screen.getByRole('alert')).toHaveTextContent(core('references.error.tooLong'));
    expect(chips(field)).toEqual(['@Anna Nowak']);
  });

  it('counts formatting markers as the characters they are stored as', async () => {
    const field = mount({ initial: 'abcd', maxLength: 6 });
    editorOf(field).commands.selectAll();
    await userEvent.click(screen.getByRole('button', { name: core('editor.format.bold') }));
    expect(storedText(field)).toBe('abcd');
    expect(changes).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(core('references.error.tooLong'));
  });
});

describe('undo and redo', () => {
  it('a mention chosen from the list is undone as one step', async () => {
    const field = mount();
    await userEvent.type(field, 'Hi @an');
    await userEvent.click(await screen.findByRole('option', { name: 'Anna Nowak' }));
    await waitFor(() => expect(sent()).toBe(`Hi ${person} `));
    expect(field).toHaveTextContent('Hi @Anna Nowak');
    await userEvent.keyboard('{Control>}z{/Control}');
    expect(sent()).not.toContain('[[');
    expect(chips(field)).toEqual([]);
    await userEvent.keyboard('{Control>}{Shift>}z{/Shift}{/Control}');
    expect(sent()).toBe(`Hi ${person} `);
  });
});

describe('a field hidden and shown again', () => {
  it('survives its effects being reconnected before the editor is mounted again — a lazy tab revealed anew', async () => {
    // React reconnects a hidden subtree's effects when it is shown again
    // (`<Activity>`, a Suspense boundary revealing a lazy tab). The editor's
    // view is unmounted while hidden; touching it then threw on CI.
    const { Activity } = await import('react');
    const errors: unknown[] = [];
    const onError = (event: ErrorEvent): void => {
      errors.push(event.error);
      event.preventDefault();
    };
    window.addEventListener('error', onError);
    try {
      function Toggle(): ReactElement {
        const [shown, setShown] = useState(true);
        return (
          <div>
            <button type="button" onClick={(): void => setShown((value) => !value)}>
              toggle
            </button>
            <Activity mode={shown ? 'visible' : 'hidden'}>
              <Harness initial={`Ask ${person}`} />
            </Activity>
          </div>
        );
      }
      renderCrm(<Toggle />);
      const toggle = screen.getByRole('button', { name: 'toggle' });
      await userEvent.click(toggle);
      // Hidden for longer than the editor hook's one-tick grace: the editor
      // it held is destroyed while the field is away.
      await new Promise((resolve) => setTimeout(resolve, 50));
      await userEvent.click(toggle);
      const field = await screen.findByLabelText('Description');
      expect(chips(field)).toEqual(['@Anna Nowak']);
      await userEvent.click(screen.getByText('Description'));
      await waitFor(() => expect(field).toHaveFocus());
      expect(errors).toEqual([]);
    } finally {
      window.removeEventListener('error', onError);
    }
  });
});
