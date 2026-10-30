import type { ReactNode } from 'react';
import type { AdminZoneProps } from '@endora-commerce/contracts';
import { ProjectPanel } from './ProjectPanel.js';

/** `projects`' contribution to `order.detail.after`: the Project the record is in (User Story 6). */
export function OrderProjectPanel({ orderId }: AdminZoneProps<'order.detail.after'>): ReactNode {
  return <ProjectPanel kind="order" recordId={orderId} />;
}

/** The default export the zone declaration's dynamic-import factory resolves. */
export default OrderProjectPanel;
