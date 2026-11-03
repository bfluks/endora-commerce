import { describe, expect, it } from 'vitest';
import { settlementRequestSchema } from '../src/index.js';

/**
 * Review of PR #423 (issue #417) — a settlement naming one case line twice was
 * accepted: the refund summed both entries while the correction kept one, and
 * the correction then refused after the gateway had already refunded. The
 * request is refused before anything moves.
 */
describe('settlementRequestSchema', () => {
  const id = '00000000-0000-4000-8000-000000000101';

  it('refuses a case line named twice', () => {
    const result = settlementRequestSchema.safeParse({
      resolutionType: 'refund',
      lines: [
        { returnCaseItemId: id, approvedRefundAmount: 10 },
        { returnCaseItemId: id, approvedRefundAmount: 5 },
      ],
    });
    expect(result.success).toBe(false);
    expect(result.error!.issues.map((i) => [i.path.join('.'), i.message])).toEqual([
      ['lines.1.returnCaseItemId', 'duplicate_line'],
    ]);
  });

  it('accepts distinct lines', () => {
    const other = '00000000-0000-4000-8000-000000000102';
    expect(
      settlementRequestSchema.safeParse({
        resolutionType: 'refund',
        lines: [
          { returnCaseItemId: id, approvedRefundAmount: 10 },
          { returnCaseItemId: other, approvedRefundAmount: 5 },
        ],
      }).success,
    ).toBe(true);
  });
});
