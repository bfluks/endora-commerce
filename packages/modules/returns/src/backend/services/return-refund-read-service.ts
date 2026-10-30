import type { EntityManager } from '@mikro-orm/postgresql';
import type { OrderReturnRefund, ReturnRefundReadPort } from '@endora-commerce/contracts';
import { ReturnCase } from '../entities/return-case.entity.js';
import { Refund } from '../entities/refund.entity.js';

/**
 * `returnRefundReadPort` — what the order's settled return cases refunded
 * (issue #428). Every money-moving settlement writes one `Refund` row, so this
 * is a read of those rows over the order's cases, in the caller's tenant scope
 * (`ReturnCase` is organisation-scoped). The reader decides which of them
 * `payments` already reports.
 */
export class ReturnRefundReadService implements ReturnRefundReadPort {
  constructor(private readonly emFactory: () => EntityManager) {}

  async listForOrder(orderId: string): Promise<OrderReturnRefund[]> {
    const em = this.emFactory();
    const cases = await em.find(ReturnCase, { orderId });
    if (cases.length === 0) return [];
    const refunds = await em.find(
      Refund,
      { returnCaseId: { $in: cases.map((c) => c.id) } },
      { orderBy: { createdAt: 'asc', id: 'asc' } },
    );
    return refunds.map((refund) => ({
      resolutionType: refund.resolutionType,
      amount: refund.amount,
      settlementState: refund.settlementState,
    }));
  }
}
