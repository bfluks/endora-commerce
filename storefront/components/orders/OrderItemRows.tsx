import type { ReactNode } from 'react';
import Link from 'next/link';
import { GroupedLineRows, orderSectionTotals } from '../line-groups/GroupedLineRows';
import type { OrderSummary } from '../../lib/api/orders';
import { formatMoney } from '../../lib/i18n/money';

/**
 * The rows of the order detail's *Items* table, inside its `<tbody>` — feature
 * 159 (FR-031, FR-033, FR-063): grouped read-only when the order has groups,
 * each group with its summary, then *Other items*; exactly the rows the page
 * always rendered when it has none. A server component.
 */
export function OrderItemRows(props: {
  order: Pick<OrderSummary, 'items' | 'itemGroups' | 'currency'>;
  locale: string;
}): ReactNode {
  const { order, locale } = props;
  return (
    <GroupedLineRows
      groups={order.itemGroups ?? []}
      lines={order.items}
      columnCount={4}
      locale={locale}
      currency={order.currency}
      moneyLocale={locale}
      // Unused: the order's own rule below totals every section.
      taxRate={0}
      totals={orderSectionTotals}
      renderRow={(it) => (
        <tr key={it.id}>
          <td>
            <Link href={`/p/${it.productId}`}>{it.productSnapshot.name}</Link>
            <br />
            <small className="text-subtle">SKU: {it.variantSnapshot?.sku ?? it.productSnapshot.sku}</small>
          </td>
          <td>{it.quantity}</td>
          <td>{formatMoney(it.unitPrice, order.currency, locale, { unitPrice: true })}</td>
          <td className="text-right">{formatMoney(it.lineTotal, order.currency, locale)}</td>
        </tr>
      )}
    />
  );
}
