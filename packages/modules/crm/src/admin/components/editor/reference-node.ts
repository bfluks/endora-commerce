import { mergeAttributes, Node } from '@tiptap/react';
import {
  formatOpportunityReferenceToken,
  splitOpportunityReferenceText,
  type OpportunityReferenceType,
} from '@endora-commerce/contracts';
import { REFERENCE_NODE } from '../../lib/rich-text-doc.js';

/** The attribute a chip carries its token in — what a copy inside the editor pastes back from. */
export const CHIP_TOKEN_ATTRIBUTE = 'data-crm-token';

const CHIP_CLASS =
  'mx-0.5 inline-block rounded border px-1.5 align-baseline text-xs leading-5 whitespace-nowrap';
const CHIP_KIND_CLASS: Record<OpportunityReferenceType, string> = {
  admin_user: 'border-primary/30 bg-primary/10 font-medium text-foreground',
  order: 'border-border bg-muted/50 font-medium text-foreground',
  product: 'border-border bg-muted/50 font-medium text-foreground',
};
const CHIP_UNAVAILABLE_CLASS = 'border-dashed border-border text-muted-foreground';

export interface ReferenceNodeOptions {
  /** What a chip whose target this reader may not see says, per kind. */
  unavailableLabel: (type: OpportunityReferenceType) => string;
}

/**
 * A reference — a person, an Order, a Product — as one character of the
 * formatted field (`specs/158-crm-opportunity-inline-editing/`, research R-3;
 * the chip of `specs/143-crm-sales-opportunities/` research N-M11, kept).
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
    return [
      {
        tag: `span[${CHIP_TOKEN_ATTRIBUTE}]`,
        getAttrs: (element) => {
          const token = (element as HTMLElement).getAttribute(CHIP_TOKEN_ATTRIBUTE) ?? '';
          const [part] = splitOpportunityReferenceText(token);
          if (!part || part.kind !== 'reference') return false;
          const available = (element as HTMLElement).dataset['available'] === 'true';
          return {
            refType: part.type,
            refId: part.id,
            available,
            label: available ? (element as HTMLElement).dataset['label'] ?? null : null,
          };
        },
      },
    ];
  },

  renderHTML({ node, HTMLAttributes: attributes }) {
    const type = node.attrs['refType'] as OpportunityReferenceType;
    const label = node.attrs['label'] as string | null;
    const available = node.attrs['available'] === true && label !== null;
    const text = available ? (type === 'admin_user' ? `@${label}` : label) : this.options.unavailableLabel(type);
    return [
      'span',
      mergeAttributes(attributes, {
        [CHIP_TOKEN_ATTRIBUTE]: formatOpportunityReferenceToken(type, node.attrs['refId'] as string),
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
    return formatOpportunityReferenceToken(node.attrs['refType'] as OpportunityReferenceType, node.attrs['refId'] as string);
  },
});
