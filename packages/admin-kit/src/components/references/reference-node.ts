import { mergeAttributes, Node } from '@tiptap/react';
import {
  formatRecordReferenceToken,
  splitRecordReferenceText,
  type RecordReferenceType,
} from '@endora-commerce/contracts';
import { REFERENCE_NODE } from './rich-text-doc.js';

/**
 * The attribute a chip carries its token in — what a copy inside the editor
 * pastes back from. A neutral name, since the editor is every module's
 * (`specs/163-projects-and-tasks/` research R-17).
 */
export const CHIP_TOKEN_ATTRIBUTE = 'data-reference-token';

/**
 * The name CRM's editor gave that attribute before the editor was promoted.
 * A chip copied from a screen still running an earlier build carries it, and
 * still pastes back as a chip.
 */
export const LEGACY_CHIP_TOKEN_ATTRIBUTE = 'data-crm-token';

/** The chip attributes a paste is read for, the current one first. */
export const CHIP_TOKEN_ATTRIBUTES = [CHIP_TOKEN_ATTRIBUTE, LEGACY_CHIP_TOKEN_ATTRIBUTE] as const;

const CHIP_CLASS =
  'mx-0.5 inline-block rounded border px-1.5 align-baseline text-xs leading-5 whitespace-nowrap';
const CHIP_KIND_CLASS: Record<RecordReferenceType, string> = {
  admin_user: 'border-primary/30 bg-primary/10 font-medium text-foreground',
  order: 'border-border bg-muted/50 font-medium text-foreground',
  product: 'border-border bg-muted/50 font-medium text-foreground',
  quote_request: 'border-border bg-muted/50 font-medium text-foreground',
  task: 'border-border bg-muted/50 font-medium text-foreground',
};
const CHIP_UNAVAILABLE_CLASS = 'border-dashed border-border text-muted-foreground';

export interface ReferenceNodeOptions {
  /** What a chip whose target this reader may not see says, per kind. */
  unavailableLabel: (type: RecordReferenceType) => string;
}

/**
 * A reference — a person, an Order, a Quote Request, a Task, a Product — as one
 * character of the formatted field (`specs/158-crm-opportunity-inline-editing/`,
 * research R-3; the chip of `specs/143-crm-sales-opportunities/` research
 * N-M11, kept).
 *
 * An inline atom: the caret steps over it, Backspace and Delete take it whole.
 * It carries its target (`refType`, `refId`) and what the field knows of it
 * (`label`, `available`); only the target is stored — the token of
 * `@endora-commerce/contracts` — and the name is the server's, resolved for
 * every reader.
 */
export const ReferenceNode = Node.create<ReferenceNodeOptions>({
  name: REFERENCE_NODE,
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addOptions() {
    return { unavailableLabel: (type) => type };
  },

  addAttributes() {
    return {
      refType: { default: 'product', rendered: false },
      refId: { default: '', rendered: false },
      label: { default: null, rendered: false },
      available: { default: false, rendered: false },
    };
  },

  parseHTML() {
    return CHIP_TOKEN_ATTRIBUTES.map((attribute) => ({
      tag: `span[${attribute}]`,
      getAttrs: (node) => {
        const element = node as HTMLElement;
        const token = element.getAttribute(attribute) ?? '';
        const [part] = splitRecordReferenceText(token);
        if (!part || part.kind !== 'reference') return false;
        const available = element.dataset['available'] === 'true';
        return {
          refType: part.type,
          refId: part.id,
          available,
          label: available ? element.dataset['label'] ?? null : null,
        };
      },
    }));
  },

  renderHTML({ node, HTMLAttributes: attributes }) {
    const type = node.attrs['refType'] as RecordReferenceType;
    const label = node.attrs['label'] as string | null;
    const available = node.attrs['available'] === true && label !== null;
    const text = available ? (type === 'admin_user' ? `@${label}` : label) : this.options.unavailableLabel(type);
    return [
      'span',
      mergeAttributes(attributes, {
        [CHIP_TOKEN_ATTRIBUTE]: formatRecordReferenceToken(type, node.attrs['refId'] as string),
        'data-available': available ? 'true' : 'false',
        ...(available ? { 'data-label': label } : {}),
        contenteditable: 'false',
        class: `${CHIP_CLASS} ${available ? CHIP_KIND_CLASS[type] : CHIP_UNAVAILABLE_CLASS}`,
      }),
      text,
    ];
  },

  /** What leaves the field as plain text is the token, so a chip copied here is a chip where it is pasted. */
  renderText({ node }) {
    return formatRecordReferenceToken(node.attrs['refType'] as RecordReferenceType, node.attrs['refId'] as string);
  },
});
