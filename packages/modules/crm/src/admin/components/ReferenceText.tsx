import { Fragment, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AtSign, ExternalLink, Package, ShoppingCart } from 'lucide-react';
import {
  parseOpportunityRichText,
  splitOpportunityReferenceText,
  type OpportunityReference,
  type OpportunityReferenceType,
  type OpportunityRichInline,
} from '@endora-commerce/contracts';
import { useAppLanguage, useTranslation } from '@endora-commerce/admin-kit/i18n';
import type { OrderStatusOption } from '../api.js';
import { moneyLabel, orderStatusLabel } from '../lib/labels.js';
import { useReturnHere } from '../lib/return-here.js';

export interface ReferenceTextProps {
  /** The stored text — formatting, tokens and all. */
  text: string;
  /** The references the server resolved for this text, for this reader. */
  references: readonly OpportunityReference[];
  /**
   * `orders`' statuses, for naming a referenced Order's status. Without them
   * (no `orders:read`) the status is shown by its code.
   */
  orderStatuses?: readonly OrderStatusOption[];
  /**
   * Draw the text as one run, without its formatting — a place that shows only
   * a clipped beginning of it, like the Change history.
   */
  inline?: boolean;
}

const CHIP =
  'mx-0.5 inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 align-baseline text-xs';

/**
 * A description, a note, a message or an Event's description as it is read
 * (`specs/158-crm-opportunity-inline-editing/` FR-010 – FR-012;
 * `specs/143-crm-sales-opportunities/` User Stories 12 and 18): its paragraphs,
 * lists, bold, italic, strikethrough and links as elements, and each
 * `[[product:…]]` / `[[order:…]]` / `[[admin_user:…]]` token as a chip.
 *
 * **The text is never interpreted as markup.** It is read by the grammar of
 * `@endora-commerce/contracts` into blocks, and every stretch of it is a text
 * node, so markup somebody typed is shown as the characters they typed. A link
 * is drawn only for an address a reader may follow (`http`, `https`,
 * `mailto`), opens in a new tab and tells the page it came from nothing.
 *
 * A reference the server resolved links to the Product or the Order under its
 * current name or number. **An Order says more than its number** — its status,
 * total, when it was placed and for whom — and has its own button that opens
 * it in a new tab, so the deal being read stays where it is. The chip itself
 * opens the Order here, with the way back to this Opportunity.
 *
 * One it could not resolve — the target is gone, or this reader may not see
 * it — is a chip that says so, without a link and without the name: an Order
 * of another Organization is not leaked by its number here.
 *
 * A person is `@` and their current name, set apart from the sentence and not
 * a link. Somebody removed or deactivated since is a chip that says so.
 */
export function ReferenceText(props: ReferenceTextProps): ReactNode {
  const t = useTranslation('crm');
  const { language } = useAppLanguage();
  const returnHere = useReturnHere();
  const resolved = new Map(props.references.map((item) => [`${item.type}:${item.id}`, item]));

  const chip = (type: OpportunityReferenceType, id: string, key: string | number): ReactNode => {
    const reference = resolved.get(`${type}:${id}`);
    if (type === 'admin_user' && reference?.available && reference.label) {
      return (
        <span key={key} className={`${CHIP} border-primary/30 bg-primary/10 font-medium text-foreground`}>
          <span className="sr-only">{t('references.kind.admin_user')}</span>
          <span aria-hidden="true">@</span>
          {reference.label}
        </span>
      );
    }
    const Icon = type === 'product' ? Package : type === 'order' ? ShoppingCart : AtSign;
    if (reference?.available && reference.url && reference.label) {
      const order = type === 'order' ? reference.order : undefined;
      const facts = order
        ? [
            orderStatusLabel(order.status, props.orderStatuses ?? [], language),
            moneyLabel(order.total, order.currency),
            new Date(order.placedAt).toLocaleDateString(language),
            order.customerName,
          ].filter((fact): fact is string => Boolean(fact))
        : [];
      const link = (
        <Link
          to={type === 'order' ? returnHere(reference.url) : reference.url}
          className="inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline"
        >
          <Icon aria-hidden="true" className="size-3" />
          <span className="sr-only">{t(`references.kind.${type}`)}</span>
          {reference.label}
        </Link>
      );
      if (!order) {
        return (
          <span key={key} className={`${CHIP} bg-muted/50`}>
            {link}
          </span>
        );
      }
      return (
        <span
          key={key}
          className={`${CHIP} max-w-full flex-wrap gap-x-1.5 bg-muted/50`}
          data-crm-order-reference={id}
        >
          {link}
          {facts.map((fact, index) => (
            <span key={index} className="text-muted-foreground">
              <span aria-hidden="true">· </span>
              {fact}
            </span>
          ))}
          <Link
            to={reference.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t('references.order.openInNewTab', { number: reference.label })}
            title={t('references.order.openInNewTab', { number: reference.label })}
            // A finger-sized target on a touch screen, a quiet icon on a desk.
            className="-my-2 inline-flex min-h-11 min-w-11 items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring sm:my-0 sm:min-h-5 sm:min-w-5"
          >
            <ExternalLink aria-hidden="true" className="size-3" />
          </Link>
        </span>
      );
    }
    return (
      <span key={key} className={`${CHIP} border-dashed text-muted-foreground`} title={t('references.unavailableHint')}>
        <Icon aria-hidden="true" className="size-3" />
        {t(`references.unavailable.${type}`)}
      </span>
    );
  };

  if (props.inline) {
    return (
      <>
        {splitOpportunityReferenceText(props.text).map((part, index) =>
          part.kind === 'text' ? <span key={index}>{part.text}</span> : chip(part.type, part.id, index),
        )}
      </>
    );
  }

  const inline = (nodes: readonly OpportunityRichInline[]): ReactNode =>
    nodes.map((node, index) => {
      let drawn: ReactNode = node.kind === 'reference' ? chip(node.type, node.id, index) : node.text;
      if (node.marks.includes('strike')) drawn = <s>{drawn}</s>;
      if (node.marks.includes('italic')) drawn = <em>{drawn}</em>;
      if (node.marks.includes('bold')) drawn = <strong className="font-semibold">{drawn}</strong>;
      if (node.kind === 'text' && node.href) {
        drawn = (
          <a
            href={node.href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="text-primary underline underline-offset-4"
          >
            {drawn}
          </a>
        );
      }
      return <Fragment key={index}>{drawn}</Fragment>;
    });

  return (
    <div className="space-y-1 break-words [overflow-wrap:anywhere]">
      {parseOpportunityRichText(props.text).map((block, index) => {
        if (block.kind === 'paragraph') {
          // An empty line is a line: it keeps the space it was given.
          return (
            <p key={index} className="min-h-5 whitespace-pre-wrap">
              {inline(block.content)}
            </p>
          );
        }
        const items = block.items.map((item, itemIndex) => (
          <li key={itemIndex} className="whitespace-pre-wrap">
            {inline(item)}
          </li>
        ));
        return block.kind === 'bullet_list' ? (
          <ul key={index} className="list-disc space-y-0.5 pl-5">
            {items}
          </ul>
        ) : (
          <ol key={index} start={block.start} className="list-decimal space-y-0.5 pl-5">
            {items}
          </ol>
        );
      })}
    </div>
  );
}
