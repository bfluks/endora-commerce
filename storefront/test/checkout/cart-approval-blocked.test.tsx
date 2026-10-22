import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { CartPrimaryCta, type CartPrimaryCtaProps } from '../../components/CartPrimaryCta';
import { CartApprovalBanner } from '../../components/CartApprovalBanner';
import { tForLocale } from '../../lib/i18n/messages';

/**
 * Feature 155, owner ruling 2026-10-18 — "Submit for approval" is blocked the way checkout is
 * while a cart line is below a minimum or its product is gone (`cartBlocksCheckout`): a disabled
 * control with no form behind it, and the reason as visible text linked by `aria-describedby`.
 * SSR-only: the markup is the assertion.
 */

const noop = async (): Promise<void> => undefined;

const CTA_STRINGS = {
  checkout: 'Proceed to checkout',
  submitForApproval: 'Submit for approval',
  awaitingApproval: 'Awaiting approval',
  blockedByOrganization: 'Ordering is blocked',
};

function cta(overrides: Partial<CartPrimaryCtaProps> = {}): string {
  return renderToString(
    <CartPrimaryCta
      cta="submit_for_approval"
      authenticated
      submitForApprovalNeeded={false}
      canTransact
      moderationMessage={null}
      submitAction={noop}
      linesBlockCheckout={false}
      linesBlockedNote="Fix the lines to continue to checkout."
      approvalBlockedNote="Fix the lines to submit for approval."
      strings={CTA_STRINGS}
      {...overrides}
    />,
  );
}

/** The `aria-describedby` target id, asserting the button points at a rendered element. */
function describedNote(html: string): string {
  const ref = /aria-describedby="([^"]+)"/.exec(html)?.[1];
  expect(ref).toBeDefined();
  const note = new RegExp(`<p[^>]*id="${ref}"[^>]*>([^<]*)</p>`).exec(html);
  expect(note).not.toBeNull();
  return note![1]!;
}

describe('CartPrimaryCta — submit for approval', () => {
  it('offers a submitting form when no line blocks', () => {
    const html = cta();
    expect(html).toContain('<form');
    expect(html).toContain('type="submit"');
    expect(html).toContain('Submit for approval');
    expect(html).not.toContain('disabled');
    expect(html).not.toContain('aria-describedby');
  });

  it('is disabled, with no form, and linked to the visible note while a line blocks', () => {
    const html = cta({ linesBlockCheckout: true });
    expect(html).toContain('Submit for approval');
    expect(html).not.toContain('<form');
    expect(html).not.toContain('type="submit"');
    expect(html).toMatch(/<button[^>]*type="button"[^>]*disabled/);
    expect(html).toContain('aria-disabled="true"');
    expect(describedNote(html)).toBe('Fix the lines to submit for approval.');
  });

  it('blocks the legacy submitForApprovalNeeded path the same way', () => {
    const html = cta({ cta: 'checkout', submitForApprovalNeeded: true, linesBlockCheckout: true });
    expect(html).not.toContain('<form');
    expect(describedNote(html)).toBe('Fix the lines to submit for approval.');
  });

  it('keeps the checkout block with its own note and id', () => {
    const html = cta({ cta: 'checkout', linesBlockCheckout: true });
    expect(html).toContain('Proceed to checkout');
    expect(describedNote(html)).toBe('Fix the lines to continue to checkout.');
    expect(html).not.toContain('Submit for approval');
  });

  it('offers checkout as a link when nothing blocks', () => {
    const html = cta({ cta: 'checkout' });
    expect(html).toContain('href="/checkout"');
    expect(html).not.toContain('disabled');
  });
});

describe('CartApprovalBanner — submit while a line blocks', () => {
  const STRINGS = {
    pending: 'Awaiting approval.',
    approved: 'Approved.',
    rejected: () => 'Rejected.',
    policyOn: 'Your organization requires cart approval.',
    submitButton: 'Submit for approval',
  };

  it('renders the banner button disabled, with no form, linked to the visible note', () => {
    const html = renderToString(
      <CartApprovalBanner
        approvalStatus="not_required"
        policyOn
        rejectedReason={null}
        submitForApprovalAction={noop}
        linesBlockedNote="Fix the lines to submit for approval."
        strings={STRINGS}
      />,
    );
    expect(html).toContain('Your organization requires cart approval.');
    expect(html).not.toContain('<form');
    expect(html).toMatch(/<button[^>]*type="button"[^>]*disabled/);
    expect(describedNote(html)).toBe('Fix the lines to submit for approval.');
  });
});

describe('cart.approvalBlocked copy', () => {
  it('ships in EN and PL and is not the checkout sentence', () => {
    const en = tForLocale('en-US')('cart.approvalBlocked');
    const pl = tForLocale('pl-PL')('cart.approvalBlocked');
    expect(en).toBe('Change or remove the flagged lines to submit the cart for approval.');
    expect(pl).toBe('Zmień lub usuń oznaczone pozycje, aby wysłać koszyk do akceptacji.');
    expect(en).not.toBe(tForLocale('en-US')('cart.checkoutBlocked'));
  });
});
