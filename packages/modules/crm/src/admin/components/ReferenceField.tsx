import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import {
  AtSign,
  Bold,
  Italic,
  Link2,
  List,
  ListOrdered,
  Package,
  ShoppingCart,
  Strikethrough,
} from 'lucide-react';
import {
  extractOpportunityReferenceTokens,
  foldDiacritics,
  isSafeOpportunityRichHref,
  type OpportunityReference,
  type OpportunityReferenceType,
} from '@endora-commerce/contracts';
import { useAuth } from '@endora-commerce/admin-kit/lib';
import { Button, Combobox, Input, type ComboboxOption } from '@endora-commerce/admin-kit/ui';
import { useAppLanguage, useTranslation } from '@endora-commerce/admin-kit/i18n';
import { crmApi } from '../api.js';
import { findMentionTrigger, type MentionTrigger } from '../lib/mention-trigger.js';
import { editorDocOf, REFERENCE_NODE, textOfEditorDoc, type EditorDoc } from '../lib/rich-text-doc.js';
import { ReferenceNode } from './editor/reference-node.js';

const SEARCH_DEBOUNCE_MS = 250;
/**
 * How long a bare `@` waits before it is a question: long enough for the
 * second and third `@` of an Order or a Product to follow it, so that typing
 * `@@@` neither shows two lists it did not ask for nor asks who may be
 * mentioned.
 */
const FIRST_SEARCH_DELAY_MS = 200;
/** The gap between the line being typed and the list that opens at it. */
const LIST_GAP_PX = 4;
const VIEWPORT_MARGIN_PX = 8;
/** What an inline atom — a chip — counts as in the text the `@` shortcuts read. */
const ATOM_CHARACTER = '￼';

/**
 * The codes of the lists a reference is chosen from. Two are their owners' —
 * `catalog`'s product list and `orders`' order list — and a role without one is
 * simply not offered that button or that shortcut (research N-H3). The people
 * who may be mentioned are CRM's own lookup, offered to whoever may write.
 */
const PRODUCT_LIST_PERMISSION = 'catalog:read';
const ORDER_LIST_PERMISSION = 'orders:read';
const PEOPLE_LIST_PERMISSION = 'crm:write';

/** What the three kinds are called in this module's bundle keys. */
const KIND_KEY = { admin_user: 'person', order: 'order', product: 'product' } as const;

interface Suggestion {
  id: string;
  label: string;
  description?: string;
}

/** A Product's name in the language on screen, then any name it has, then its SKU. */
function productLabel(name: Record<string, string>, sku: string, language: string): string {
  const base = language.split('-')[0] ?? language;
  const sameLanguage = Object.keys(name).find((locale) => locale === base || locale.startsWith(`${base}-`));
  return name[language] || (sameLanguage ? name[sameLanguage] : undefined) || Object.values(name).find(Boolean) || sku;
}

const keyOf = (type: OpportunityReferenceType, id: string): string => `${type}:${id}`;

/**
 * The editor while its view is mounted, else `null`. React may run this
 * field's effects with an editor the hook has already destroyed — effects
 * reconnected after a lazy tab is revealed, or a Suspense boundary resolves,
 * later than the hook's one-tick grace — and a destroyed editor's `view`
 * throws (seen on CI). An effect that finds none waits for the editor that
 * replaces it: the editor is in its dependencies.
 */
function mounted(editor: Editor | null): Editor | null {
  return editor && !editor.isDestroyed ? editor : null;
}

/**
 * The caret's textblock up to the caret, as the `@` shortcuts read it: its
 * characters, and one placeholder per chip — so that a position in this string
 * is a position in the document, counted from the block's start.
 */
function textBeforeCaret(editor: Editor): { text: string; blockStart: number } | null {
  const { selection } = editor.state;
  if (!selection.empty) return null;
  const { $from } = selection;
  if (!$from.parent.isTextblock) return null;
  let text = '';
  $from.parent.forEach((child, offset) => {
    if (offset >= $from.parentOffset) return;
    if (child.isText) text += (child.text ?? '').slice(0, $from.parentOffset - offset);
    else text += ATOM_CHARACTER.repeat(Math.min(child.nodeSize, $from.parentOffset - offset));
  });
  return { text, blockStart: $from.start() };
}

export interface ReferenceFieldProps {
  /** The id a `<Label htmlFor>` names: the label is tied to the field and focuses it. */
  id: string;
  /** The stored text — formatting, tokens and all. */
  value: string;
  onValueChange: (next: string) => void;
  /**
   * The Organization whose Orders may be referred to — the Opportunity's.
   * `null` while none is chosen (the create form): Orders are not offered yet.
   */
  organizationId: string | null;
  /**
   * What the tokens already in `value` name, as the server resolved them for
   * this reader — the `references` returned beside the text being edited.
   */
  references?: readonly OpportunityReference[];
  /**
   * Whether people, Orders and Products may be referred to. An Event's
   * description is formatted text without references.
   */
  mentions?: boolean;
  maxLength?: number;
  disabled?: boolean;
  required?: boolean;
  placeholder?: string;
  /** The height the field starts at, in lines; it grows with its text. */
  rows?: number;
  autoFocus?: boolean;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
  /** Ctrl/Cmd + Enter — the surrounding form's *Save*. */
  onSubmitShortcut?: () => void;
}

/**
 * The field a description, a note, a message or an Event's description is
 * written in — **formatted text, in which a reference is read as what it
 * names** (`specs/158-crm-opportunity-inline-editing/`, FR-010 – FR-011;
 * `specs/143-crm-sales-opportunities/` User Stories 12 and 18).
 *
 * **What is stored is still text.** The editor is TipTap — already in the tree
 * for the CMS — holding paragraphs, bulleted and numbered lists, bold, italic,
 * strikethrough and links, and the reference chip; every change is written
 * back to the text grammar of `@endora-commerce/contracts` before it leaves
 * the field (`lib/rich-text-doc.ts`). The server never stores HTML, and a
 * screen draws the text with elements of its own.
 *
 * The toolbar above the field formats what is selected, and its buttons say
 * which formatting the caret is in; the usual keys do the same (Ctrl/Cmd + B,
 * I, Shift + S, Shift + 7, Shift + 8), and a line beginning `- ` or `1. ` is a
 * list.
 *
 * **While typing**: `@` opens a list of people, `@@` of the Organization's
 * Orders, `@@@` of Products, **at the place it was typed** — under that line,
 * above it when there is no room below, never outside the window — narrowed by
 * whatever is typed next (`lib/mention-trigger.ts` says exactly when). Arrow
 * keys move through it, Enter or Tab puts the chip where the `@`s and the
 * letters were, Escape closes it and leaves them as typed. While the list is
 * open the field is a combobox to assistive technology; closed, it is a
 * multi-line text box under its label.
 *
 * **By button**: *Mention a person*, *Insert order* and *Insert product* each
 * open a search under the field; choosing a result puts its chip **where the
 * caret was**.
 *
 * Only what the reader may search is offered, by either way: the product search
 * needs `catalog:read`, the order search `orders:read` and an Organization, the
 * people `crm:write`.
 */
export function ReferenceField(props: ReferenceFieldProps): ReactNode {
  const {
    id,
    value,
    onValueChange,
    organizationId,
    references,
    mentions = true,
    maxLength,
    disabled = false,
    required,
    placeholder,
    rows = 4,
    autoFocus,
    'aria-invalid': invalid,
    'aria-describedby': describedBy,
    onSubmitShortcut,
  } = props;
  const t = useTranslation('crm');
  const tCore = useTranslation('core');
  const { language } = useAppLanguage();
  const { hasPermission } = useAuth();
  const baseId = useId();
  const wrapper = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  /** What the field can name: the server's references, and everything chosen here. */
  const known = useRef(new Map<string, { label: string | null; available: boolean }>());
  /** The text last handed up — a `value` equal to it is the field's own echo. */
  const emitted = useRef<string>(value);
  /** Set while a value from outside is drawn. */
  const silent = useRef(false);
  /** The editor's last state within the length limit — what an edit past it goes back to. */
  const goodState = useRef<Editor['state'] | null>(null);
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  const [labelId, setLabelId] = useState<string | undefined>(undefined);
  const [picker, setPicker] = useState<OpportunityReferenceType | null>(null);
  const [options, setOptions] = useState<ComboboxOption<string>[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [linkDraft, setLinkDraft] = useState<string | null>(null);
  const [linkInvalid, setLinkInvalid] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sequence = useRef(0);

  // --- Typing: the `@` shortcuts ------------------------------------------------
  /** The run of `@`s the caret is typing after, as a stretch of the document. */
  const [typing, setTyping] = useState<(MentionTrigger & { from: number; to: number }) | null>(null);
  /** The run Escape closed: it stays closed until its `@` is gone. */
  const [dismissed, setDismissed] = useState<number | null>(null);
  const [answer, setAnswer] = useState<{
    kind: OpportunityReferenceType;
    query: string;
    found: Suggestion[];
    failed: boolean;
  } | null>(null);
  const [active, setActive] = useState(0);
  /** The kind whose list is on screen: set when a run's first search starts, not when its `@` is typed. */
  const [shownKind, setShownKind] = useState<OpportunityReferenceType | null>(null);
  const [place, setPlace] = useState<CSSProperties | null>(null);
  const suggestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suggestSequence = useRef(0);

  const canProducts = mentions && hasPermission(PRODUCT_LIST_PERMISSION);
  const canOrders = mentions && hasPermission(ORDER_LIST_PERMISSION) && organizationId !== null;
  const canPeople = mentions && hasPermission(PEOPLE_LIST_PERMISSION);
  const offered = useCallback(
    (kind: OpportunityReferenceType): boolean =>
      kind === 'admin_user' ? canPeople : kind === 'order' ? canOrders : canProducts,
    [canPeople, canOrders, canProducts],
  );

  const describe = useCallback((type: OpportunityReferenceType, refId: string) => {
    return known.current.get(keyOf(type, refId)) ?? null;
  }, []);

  /** Things the editor's handlers reach that change between renders. */
  const latest = useRef({
    maxLength,
    onValueChange,
    onKey: (_event: KeyboardEvent): boolean => false,
    follow: (_editor: Editor): void => undefined,
    onSubmitShortcut,
    mentions,
  });

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          heading: false,
          blockquote: false,
          code: false,
          codeBlock: false,
          horizontalRule: false,
          underline: false,
          // The text has no way to say "and an empty line after the list".
          trailingNode: false,
          link: {
            openOnClick: false,
            autolink: true,
            defaultProtocol: 'https',
            protocols: ['http', 'https', 'mailto'],
            isAllowedUri: (url) => isSafeOpportunityRichHref(url),
          },
        }),
        ReferenceNode.configure({
          unavailableLabel: (type) => t(`references.unavailable.${type}`),
        }),
      ],
      content: editorDocOf(value, describe),
      editable: !disabled,
      immediatelyRender: true,
      shouldRerenderOnTransaction: false,
      editorProps: {
        handleKeyDown: (_view, event) => latest.current.onKey(event),
        // A pasted token is a reference, as a chosen one is.
        handlePaste: (_view, event) => {
          const html = event.clipboardData?.getData('text/html') ?? '';
          const text = event.clipboardData?.getData('text/plain') ?? '';
          if (
            !latest.current.mentions ||
            html.includes('data-crm-token') ||
            extractOpportunityReferenceTokens(text).length === 0
          ) {
            return false;
          }
          const doc = editorDocOf(text.replace(/\r\n?/g, '\n'), describe);
          editorRef.current?.chain().insertContent(doc.content ?? []).run();
          return true;
        },
      },
      onTransaction: ({ editor: current, transaction }) => {
        if (transaction.docChanged) {
          const next = textOfEditorDoc(current.getJSON() as EditorDoc);
          const limit = latest.current.maxLength;
          if (typeof limit === 'number' && next.length > limit && goodState.current) {
            // Past the limit: the field goes back to what it held, keystroke or chip.
            current.view.updateState(goodState.current);
            setProblem(t('references.error.tooLong'));
            rerender();
            return;
          }
          setProblem(null);
          // A value drawn from outside is not an edit: nothing is handed up.
          if (!silent.current && next !== emitted.current) {
            emitted.current = next;
            latest.current.onValueChange(next);
          }
        }
        goodState.current = current.state;
        latest.current.follow(current);
        rerender();
      },
      onCreate: ({ editor: current }) => {
        goodState.current = current.state;
      },
      onBlur: () => setTyping(null),
    },
    [],
  );
  const editorRef = useRef<Editor | null>(editor);
  editorRef.current = editor;

  // What the server resolved is what the field can name from the start.
  useLayoutEffect(() => {
    let learned = false;
    for (const reference of references ?? []) {
      const key = keyOf(reference.type, reference.id);
      const entry = { label: reference.label, available: reference.available };
      const previous = known.current.get(key);
      if (!previous || previous.label !== entry.label || previous.available !== entry.available) {
        // A name chosen here is not taken back by an answer that has none.
        if (previous?.available && !entry.available) continue;
        known.current.set(key, entry);
        learned = true;
      }
    }
    const live = mounted(editor);
    if (!live) return;
    if (value !== emitted.current) {
      // A value from outside: a form reset, a reload, a draft sent and cleared.
      emitted.current = value;
      silent.current = true;
      try {
        live.commands.setContent(editorDocOf(value, describe), { emitUpdate: false });
      } finally {
        silent.current = false;
      }
      return;
    }
    if (!learned) return;
    // Names that arrived: every chip that can say more now does.
    const { tr } = live.state;
    let changed = false;
    live.state.doc.descendants((node, position) => {
      if (node.type.name !== REFERENCE_NODE) return;
      const entry = known.current.get(keyOf(node.attrs['refType'] as OpportunityReferenceType, node.attrs['refId'] as string));
      if (!entry) return;
      const available = entry.available && entry.label !== null;
      if (node.attrs['label'] === entry.label && node.attrs['available'] === available) return;
      tr.setNodeMarkup(position, undefined, { ...node.attrs, label: available ? entry.label : null, available });
      changed = true;
    });
    if (changed) live.view.dispatch(tr.setMeta('addToHistory', false));
  }, [value, references, editor, describe]);

  useEffect(() => {
    mounted(editor)?.setEditable(!disabled);
  }, [editor, disabled]);

  // The label of the form: tied to the field by id, and a click on it focuses the field.
  useEffect(() => {
    const live = mounted(editor);
    if (!live) return undefined;
    const element = live.view.dom;
    const label = Array.from(element.ownerDocument.querySelectorAll('label')).find(
      (candidate) => candidate.htmlFor === id,
    );
    if (!label) {
      setLabelId(undefined);
      return undefined;
    }
    if (!label.id) label.id = `${id}-label`;
    setLabelId(label.id);
    const focus = (): void => {
      if (!live.isDestroyed && live.isEditable) live.commands.focus();
    };
    label.addEventListener('click', focus);
    return (): void => label.removeEventListener('click', focus);
  }, [id, editor]);

  useEffect(() => {
    if (autoFocus) mounted(editor)?.commands.focus('end');
    // Once, when the field appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  // --- By button: a search under the field -------------------------------------
  const search = useCallback(
    async (type: OpportunityReferenceType, query: string): Promise<void> => {
      const current = ++sequence.current;
      setSearching(true);
      setSearchFailed(false);
      try {
        const found: ComboboxOption<string>[] =
          type === 'order'
            ? organizationId === null
              ? []
              : (await crmApi.searchOrders(organizationId, query)).map((order) => ({
                  value: order.id,
                  label: order.businessId,
                }))
            : type === 'product'
              ? (await crmApi.searchProducts(query)).map((product) => ({
                  value: product.id,
                  label: productLabel(product.name, product.sku, language),
                  description: product.sku,
                }))
              : (await crmApi.lookupMentionable(organizationId, query)).map((person) => ({
                  value: person.id,
                  label: person.name,
                }));
        if (current === sequence.current) setOptions(found);
      } catch {
        if (current === sequence.current) {
          setOptions([]);
          setSearchFailed(true);
        }
      } finally {
        if (current === sequence.current) setSearching(false);
      }
    },
    [organizationId, language],
  );

  useEffect(() => {
    if (picker !== null) {
      setOptions([]);
      void search(picker, '');
    }
    return (): void => {
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, [picker, search]);

  const toggle = (type: OpportunityReferenceType): void => {
    setProblem(null);
    setNotice('');
    setPicker((current) => (current === type ? null : type));
  };

  /**
   * A chip over `range` or at the selection. One chosen while typing is
   * followed by a space unless one already follows, so the sentence is simply
   * carried on; one inserted by button goes in as it is.
   */
  const putChip = (
    type: OpportunityReferenceType,
    chosen: string,
    label: string,
    range?: { from: number; to: number },
  ): boolean => {
    if (!editor) return false;
    known.current.set(keyOf(type, chosen), { label, available: true });
    const at = range ?? { from: editor.state.selection.from, to: editor.state.selection.to };
    const following = editor.state.doc.textBetween(at.to, Math.min(at.to + 1, editor.state.doc.content.size), '\n', '\n');
    const before = emitted.current;
    editor
      .chain()
      .focus()
      .insertContentAt(at, [
        { type: REFERENCE_NODE, attrs: { refType: type, refId: chosen, label, available: true } },
        ...(range === undefined || /^\s/.test(following) ? [] : [{ type: 'text', text: ' ' }]),
      ])
      .run();
    return emitted.current !== before;
  };

  const insert = (type: OpportunityReferenceType, chosen: string, label: string): void => {
    if (!putChip(type, chosen, label)) return;
    setPicker(null);
    setNotice(t(`references.inserted.${type}`));
  };

  // --- While typing: the list at the caret ---------------------------------------
  latest.current.follow = (current: Editor): void => {
    if (!current.isFocused || !current.isEditable) {
      setTyping(null);
      return;
    }
    const before = textBeforeCaret(current);
    const found = before ? findMentionTrigger(before.text, before.text.length) : null;
    if (!before || !found || !offered(found.kind)) {
      setTyping(null);
      return;
    }
    const next = { ...found, from: before.blockStart + found.start, to: before.blockStart + found.end };
    setTyping((previous) =>
      previous &&
      previous.from === next.from &&
      previous.to === next.to &&
      previous.kind === next.kind &&
      previous.query === next.query
        ? previous
        : next,
    );
  };

  const triggerKind = disabled ? null : (typing?.kind ?? null);
  const triggerStart = disabled ? null : (typing?.from ?? null);
  const triggerQuery = disabled ? null : (typing?.query ?? null);
  const live = typing !== null && !disabled && triggerStart !== dismissed;

  // A run that is gone takes its dismissal with it: the next `@` opens again.
  useEffect(() => {
    if (triggerStart === null) setDismissed(null);
  }, [triggerStart]);

  useEffect(() => {
    if (!live || triggerKind === null || triggerQuery === null) {
      suggestSequence.current += 1;
      setAnswer(null);
      setShownKind(null);
      return undefined;
    }
    const current = ++suggestSequence.current;
    const run = async (): Promise<void> => {
      setShownKind(triggerKind);
      try {
        const found: Suggestion[] =
          triggerKind === 'admin_user'
            ? (await crmApi.lookupMentionable(organizationId, triggerQuery)).map((person) => ({
                id: person.id,
                label: person.name,
              }))
            : triggerKind === 'order'
              ? organizationId === null
                ? []
                : (await crmApi.searchOrders(organizationId, triggerQuery)).map((order) => ({
                    id: order.id,
                    label: order.businessId,
                  }))
              : (await crmApi.searchProducts(triggerQuery)).map((product) => ({
                  id: product.id,
                  label: productLabel(product.name, product.sku, language),
                  description: product.sku,
                }));
        if (current !== suggestSequence.current) return;
        setAnswer({ kind: triggerKind, query: triggerQuery, found, failed: false });
      } catch {
        if (current !== suggestSequence.current) return;
        setAnswer({ kind: triggerKind, query: triggerQuery, found: [], failed: true });
      }
    };
    // Both wait for a pause: a search for the typing to stop, a bare `@` for
    // the `@`s that may follow it.
    suggestTimer.current = setTimeout(
      () => void run(),
      triggerQuery === '' ? FIRST_SEARCH_DELAY_MS : SEARCH_DEBOUNCE_MS,
    );
    return (): void => {
      if (suggestTimer.current !== null) clearTimeout(suggestTimer.current);
    };
  }, [live, triggerKind, triggerQuery, organizationId, language]);

  // Every new search starts at its first result.
  useEffect(() => {
    setActive(0);
  }, [triggerKind, triggerQuery]);

  // Between a keystroke and its answer the list is the previous answer, narrowed
  // by what is in the field now: Enter never chooses somebody the typed letters
  // have already ruled out, and the list does not blink on every key.
  const answered = answer !== null && answer.kind === triggerKind && answer.query === triggerQuery;
  const suggestions = useMemo<Suggestion[]>(() => {
    if (answer === null || answer.kind !== triggerKind || triggerQuery === null) return [];
    if (answer.query === triggerQuery) return answer.found;
    const needle = foldDiacritics(triggerQuery).toLowerCase();
    return answer.found.filter((suggestion) =>
      [suggestion.label, suggestion.description ?? ''].some((text) =>
        foldDiacritics(text).toLowerCase().includes(needle),
      ),
    );
  }, [answer, triggerKind, triggerQuery]);
  const failed = answered && answer?.failed === true;
  // Typed on past the last match — "@home tomorrow" — is a sentence, not a search.
  const exhausted =
    answered && !failed && suggestions.length === 0 && triggerQuery !== null && /\s/.test(triggerQuery);
  const open = live && !exhausted && shownKind === triggerKind;
  const listed = open && suggestions.length > 0;
  const activeIndex = Math.min(active, Math.max(suggestions.length - 1, 0));
  const listId = `${baseId}-suggestions`;
  const hintId = `${baseId}-shortcuts`;
  const optionId = (index: number): string => `${listId}-${index}`;
  const activeOptionId = listed ? optionId(activeIndex) : null;

  // The focus stays in the field, so nothing scrolls by itself: the option the
  // arrow keys reach is brought into view within a list longer than its window.
  useEffect(() => {
    if (activeOptionId === null) return;
    wrapper.current?.ownerDocument.getElementById(activeOptionId)?.scrollIntoView?.({ block: 'nearest' });
  }, [activeOptionId]);

  /**
   * Where the list goes: under the line the `@` is on, at the `@`; above that
   * line when the window has no room below; and never past the window's edge.
   * Measured against the field's own box, so it moves with the field.
   */
  const settle = useCallback((): void => {
    const box = wrapper.current;
    const popup = list.current;
    const live = mounted(editor);
    if (!live || !box || !popup || triggerStart === null) return;
    const frame = box.getBoundingClientRect();
    let anchor: { top: number; bottom: number; left: number } = live.view.dom.getBoundingClientRect();
    try {
      const coords = live.view.coordsAtPos(triggerStart);
      if (coords.top !== 0 || coords.left !== 0 || coords.bottom !== 0) anchor = coords;
    } catch {
      // No layout (a test's DOM): the field's own box.
    }
    const view = box.ownerDocument.defaultView;
    const viewWidth = view?.innerWidth ?? frame.right;
    const viewHeight = view?.innerHeight ?? anchor.bottom + popup.offsetHeight + LIST_GAP_PX;
    const width = popup.offsetWidth;
    const height = popup.offsetHeight;
    const below = anchor.bottom + LIST_GAP_PX + height <= viewHeight - VIEWPORT_MARGIN_PX;
    const above = anchor.top - LIST_GAP_PX - height >= VIEWPORT_MARGIN_PX;
    const top = below || !above ? anchor.bottom + LIST_GAP_PX : anchor.top - LIST_GAP_PX - height;
    // Never past the window's edge, nor past the field's own: what surrounds
    // the field may clip what sticks out of it.
    const left = Math.max(
      Math.max(VIEWPORT_MARGIN_PX, Math.min(frame.left, viewWidth - VIEWPORT_MARGIN_PX - width)),
      Math.min(anchor.left, viewWidth - VIEWPORT_MARGIN_PX - width, frame.right - width),
    );
    setPlace((previous) => {
      const next = { top: Math.round(top - frame.top), left: Math.round(left - frame.left) };
      return previous && previous.top === next.top && previous.left === next.left ? previous : next;
    });
  }, [editor, triggerStart]);

  useLayoutEffect(() => {
    if (!open) {
      setPlace(null);
      return undefined;
    }
    settle();
    const view = wrapper.current?.ownerDocument.defaultView;
    if (!view) return undefined;
    view.addEventListener('resize', settle);
    // Any scroll moves the line: the page's, a panel's, the field's own.
    view.addEventListener('scroll', settle, true);
    return (): void => {
      view.removeEventListener('resize', settle);
      view.removeEventListener('scroll', settle, true);
    };
  }, [open, settle, suggestions.length, triggerQuery, failed, answered]);

  const choose = (suggestion: Suggestion): void => {
    if (!typing) return;
    if (!putChip(typing.kind, suggestion.id, suggestion.label, { from: typing.from, to: typing.to })) return;
    setAnswer(null);
    setNotice(t(`references.inserted.${typing.kind}`));
  };

  latest.current.maxLength = maxLength;
  latest.current.onValueChange = onValueChange;
  latest.current.onSubmitShortcut = onSubmitShortcut;
  latest.current.mentions = mentions;
  latest.current.onKey = (event: KeyboardEvent): boolean => {
    if (event.isComposing) return false;
    if (open) {
      if (event.key === 'Escape') {
        // Closes the list and nothing else: a dialog around the field stays open.
        event.preventDefault();
        event.stopPropagation();
        setDismissed(triggerStart);
        return true;
      }
      if (listed && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        setActive((activeIndex + step + suggestions.length) % suggestions.length);
        return true;
      }
      if (listed && (event.key === 'Enter' || event.key === 'Tab')) {
        const chosen = suggestions[activeIndex];
        if (chosen) {
          event.preventDefault();
          choose(chosen);
          return true;
        }
      }
    }
    if ((event.key === 'Backspace' || event.key === 'Delete') && editor && editor.state.selection.empty) {
      // A chip is one character: Backspace after it and Delete before it take
      // it whole, the same in every browser.
      const { $from } = editor.state.selection;
      const node = event.key === 'Backspace' ? $from.nodeBefore : $from.nodeAfter;
      if (node?.type.name === REFERENCE_NODE) {
        event.preventDefault();
        const from = event.key === 'Backspace' ? $from.pos - node.nodeSize : $from.pos;
        editor.chain().deleteRange({ from, to: from + node.nodeSize }).run();
        return true;
      }
    }
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && latest.current.onSubmitShortcut) {
      event.preventDefault();
      latest.current.onSubmitShortcut();
      return true;
    }
    return false;
  };

  // --- The field's attributes, which ProseMirror owns on its element ------------
  const shortcuts = [
    canPeople ? t('references.shortcut.person') : null,
    canOrders ? t('references.shortcut.order') : null,
    canProducts ? t('references.shortcut.product') : null,
  ].filter((item): item is string => item !== null);
  const anything = shortcuts.length > 0;
  const description = [describedBy, anything ? hintId : null].filter(Boolean).join(' ');
  const empty = editor ? editor.isEmpty : value === '';
  const attributes: Record<string, string> = {
    id,
    role: listed ? 'combobox' : 'textbox',
    spellcheck: 'true',
    style: `min-height: ${rows * 1.25 + 1}rem`,
    class: [
      'relative max-h-96 w-full overflow-y-auto break-words rounded-md border border-input bg-transparent px-3 py-2 text-sm leading-5 shadow-sm',
      'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
      'aria-disabled:cursor-not-allowed aria-disabled:opacity-50',
      'aria-invalid:border-destructive',
      '[&_p]:min-h-5 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_a]:text-primary [&_a]:underline',
      'data-[empty=true]:before:pointer-events-none data-[empty=true]:before:absolute data-[empty=true]:before:text-muted-foreground data-[empty=true]:before:content-[attr(data-placeholder)]',
    ].join(' '),
    'data-empty': empty ? 'true' : 'false',
    // A combobox has no `aria-multiline` and no `aria-placeholder`; the text
    // box it is the rest of the time has both.
    ...(listed ? {} : { 'aria-multiline': 'true' }),
    ...(labelId ? { 'aria-labelledby': labelId } : {}),
    ...(placeholder ? { 'data-placeholder': placeholder } : {}),
    ...(placeholder && !listed ? { 'aria-placeholder': placeholder } : {}),
    ...(description ? { 'aria-describedby': description } : {}),
    ...(invalid ? { 'aria-invalid': 'true' } : {}),
    ...(required ? { 'aria-required': 'true' } : {}),
    ...(disabled ? { 'aria-disabled': 'true' } : {}),
    ...(listed
      ? {
          'aria-expanded': 'true',
          'aria-haspopup': 'listbox',
          'aria-autocomplete': 'list',
          'aria-controls': listId,
          'aria-activedescendant': optionId(activeIndex),
        }
      : {}),
  };
  const attributeKey = JSON.stringify(attributes);
  useLayoutEffect(() => {
    const live = mounted(editor);
    if (!live) return;
    live.setOptions({ editorProps: { ...live.options.editorProps, attributes: JSON.parse(attributeKey) } });
  }, [editor, attributeKey]);

  // --- Formatting ----------------------------------------------------------------
  const kindKey = triggerKind ? KIND_KEY[triggerKind] : 'person';
  const format = (run: (chain: ReturnType<Editor['chain']>) => ReturnType<Editor['chain']>): void => {
    if (!editor) return;
    run(editor.chain().focus()).run();
  };
  const formats: Array<{ key: string; icon: typeof Bold; active: boolean; apply: () => void }> = editor
    ? [
        { key: 'bold', icon: Bold, active: editor.isActive('bold'), apply: () => format((c) => c.toggleBold()) },
        { key: 'italic', icon: Italic, active: editor.isActive('italic'), apply: () => format((c) => c.toggleItalic()) },
        { key: 'strike', icon: Strikethrough, active: editor.isActive('strike'), apply: () => format((c) => c.toggleStrike()) },
        { key: 'bulletList', icon: List, active: editor.isActive('bulletList'), apply: () => format((c) => c.toggleBulletList()) },
        { key: 'orderedList', icon: ListOrdered, active: editor.isActive('orderedList'), apply: () => format((c) => c.toggleOrderedList()) },
      ]
    : [];
  const linkActive = editor?.isActive('link') ?? false;

  const openLink = (): void => {
    if (!editor) return;
    setLinkInvalid(false);
    setLinkDraft((editor.getAttributes('link')['href'] as string | undefined) ?? '');
  };
  const applyLink = (event?: FormEvent): void => {
    event?.preventDefault();
    if (!editor || linkDraft === null) return;
    const href = linkDraft.trim();
    if (href === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      setLinkDraft(null);
      return;
    }
    const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(href) ? href : `https://${href}`;
    if (!isSafeOpportunityRichHref(withScheme)) {
      setLinkInvalid(true);
      return;
    }
    const chain = editor.chain().focus().extendMarkRange('link');
    if (editor.state.selection.empty && !linkActive) {
      chain.insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href: withScheme } }] }).run();
    } else {
      chain.setLink({ href: withScheme }).run();
    }
    setLinkDraft(null);
  };

  return (
    <div className="space-y-2">
      <div
        role="toolbar"
        aria-label={t('editor.toolbar')}
        aria-controls={id}
        className="flex flex-wrap items-center gap-1"
      >
        {formats.map((item) => (
          <Button
            key={item.key}
            type="button"
            variant={item.active ? 'secondary' : 'ghost'}
            size="sm"
            className="min-h-11 min-w-11 px-2 sm:min-h-8 sm:min-w-8"
            disabled={disabled}
            aria-pressed={item.active}
            aria-label={t(`editor.format.${item.key}`)}
            title={t(`editor.format.${item.key}`)}
            // The field keeps its selection: the button formats it.
            onMouseDown={(event): void => event.preventDefault()}
            onClick={item.apply}
          >
            <item.icon aria-hidden="true" className="size-4" />
          </Button>
        ))}
        <Button
          type="button"
          variant={linkActive ? 'secondary' : 'ghost'}
          size="sm"
          className="min-h-11 min-w-11 px-2 sm:min-h-8 sm:min-w-8"
          disabled={disabled}
          aria-pressed={linkActive}
          aria-expanded={linkDraft !== null}
          aria-label={t('editor.format.link')}
          title={t('editor.format.link')}
          onMouseDown={(event): void => event.preventDefault()}
          onClick={(): void => (linkDraft === null ? openLink() : setLinkDraft(null))}
        >
          <Link2 aria-hidden="true" className="size-4" />
        </Button>
      </div>

      {linkDraft !== null ? (
        <div className="flex flex-wrap items-start gap-2">
          <div className="min-w-48 flex-1 space-y-1">
            <Input
              aria-label={t('editor.link.url')}
              placeholder={t('editor.link.placeholder')}
              value={linkDraft}
              autoFocus
              aria-invalid={linkInvalid}
              onChange={(event): void => {
                setLinkDraft(event.target.value);
                setLinkInvalid(false);
              }}
              onKeyDown={(event): void => {
                if (event.key === 'Enter') applyLink(event);
                if (event.key === 'Escape') {
                  event.preventDefault();
                  event.stopPropagation();
                  setLinkDraft(null);
                  editor?.commands.focus();
                }
              }}
            />
            {linkInvalid ? (
              <p role="alert" className="text-xs text-destructive">
                {t('editor.link.invalid')}
              </p>
            ) : null}
          </div>
          <Button type="button" size="sm" className="min-h-11 sm:min-h-9" onClick={(): void => applyLink()}>
            {t('editor.link.apply')}
          </Button>
          {linkActive ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-11 sm:min-h-9"
              onClick={(): void => {
                editor?.chain().focus().extendMarkRange('link').unsetLink().run();
                setLinkDraft(null);
              }}
            >
              {t('editor.link.remove')}
            </Button>
          ) : null}
        </div>
      ) : null}

      <div ref={wrapper} className="relative">
        <EditorContent editor={editor} />

        {open ? (
          <div
            ref={list}
            style={place ?? { top: 0, left: 0, visibility: 'hidden' }}
            className="absolute z-50 w-72 max-w-[calc(100vw-1rem)] rounded-md border border-input bg-background p-1 text-sm shadow-md"
          >
            <p className="px-2 py-1 text-xs text-muted-foreground">{t(`references.suggest.title.${kindKey}`)}</p>
            {listed ? (
              <ul
                id={listId}
                role="listbox"
                aria-label={t(`references.suggest.title.${kindKey}`)}
                className="max-h-60 overflow-y-auto"
              >
                {suggestions.map((suggestion, index) => (
                  <li
                    key={suggestion.id}
                    id={optionId(index)}
                    role="option"
                    aria-selected={index === activeIndex}
                    // The field keeps the focus: the list is its popup, not a stop of its own.
                    onMouseDown={(event): void => event.preventDefault()}
                    onMouseEnter={(): void => setActive(index)}
                    onClick={(): void => choose(suggestion)}
                    className={`flex min-h-11 cursor-pointer items-center justify-between gap-2 rounded-sm px-2 py-1.5 sm:min-h-9 ${
                      index === activeIndex ? 'bg-accent text-accent-foreground' : ''
                    }`}
                  >
                    <span className="truncate">{suggestion.label}</span>
                    {suggestion.description ? (
                      <span className="shrink-0 text-xs text-muted-foreground">{suggestion.description}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-2 py-1.5 text-muted-foreground">
                {failed
                  ? t('references.suggest.error')
                  : answered
                    ? t(`references.suggest.empty.${kindKey}`)
                    : tCore('common.state.loading')}
              </p>
            )}
          </div>
        ) : null}
      </div>

      {anything ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {canPeople ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-h-11 sm:min-h-9"
                disabled={disabled}
                aria-expanded={picker === 'admin_user'}
                aria-controls={`${baseId}-picker`}
                onClick={(): void => toggle('admin_user')}
              >
                <AtSign aria-hidden="true" className="size-4" />
                {t('references.insert.person')}
              </Button>
            ) : null}
            {canOrders ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-h-11 sm:min-h-9"
                disabled={disabled}
                aria-expanded={picker === 'order'}
                aria-controls={`${baseId}-picker`}
                onClick={(): void => toggle('order')}
              >
                <ShoppingCart aria-hidden="true" className="size-4" />
                {t('references.insert.order')}
              </Button>
            ) : null}
            {canProducts ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-h-11 sm:min-h-9"
                disabled={disabled}
                aria-expanded={picker === 'product'}
                aria-controls={`${baseId}-picker`}
                onClick={(): void => toggle('product')}
              >
                <Package aria-hidden="true" className="size-4" />
                {t('references.insert.product')}
              </Button>
            ) : null}
          </div>
          <p id={hintId} className="text-xs text-muted-foreground">
            <span>{t('references.shortcuts', { list: shortcuts.join(', ') })}</span>{' '}
            <span>{t('references.hint')}</span>
          </p>

          <div id={`${baseId}-picker`}>
            {picker !== null ? (
              <Combobox<string>
                key={picker}
                ariaLabel={t(`references.search.${KIND_KEY[picker]}`)}
                options={options}
                value={null}
                onChange={(chosen): void => {
                  const option = options.find((candidate) => candidate.value === chosen);
                  if (chosen && option) insert(picker, chosen, option.label);
                }}
                onSearchChange={(query): void => {
                  if (timer.current !== null) clearTimeout(timer.current);
                  timer.current = setTimeout(() => void search(picker, query), SEARCH_DEBOUNCE_MS);
                }}
                manualFilter
                loading={searching}
                placeholder={t(`references.search.${KIND_KEY[picker]}Placeholder`)}
                emptyMessage={
                  searchFailed
                    ? t('references.error.search')
                    : t(`references.search.${KIND_KEY[picker]}Empty`)
                }
              />
            ) : null}
          </div>

          {/*
            A polite live region, mounted before it has text. Not `role="status"`:
            the thread around this field owns the one status of its tab.
          */}
          <p aria-live="polite" className="sr-only">
            {notice}
          </p>
        </div>
      ) : null}
      {problem ? (
        <p role="alert" className="text-xs text-destructive">
          {problem}
        </p>
      ) : null}
    </div>
  );
}
