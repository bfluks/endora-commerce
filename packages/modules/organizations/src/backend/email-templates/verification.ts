import type { EmailMailerSendInput } from '@endora-commerce/contracts';

export interface BuildVerificationEmailInput {
  customerAccountId: string;
  rawToken: string;
  recipientEmail: string;
  organizationName: string;
  /** Storefront base URL — verification UI submits token to API. */
  storefrontBaseUrl: string;
  /**
   * Puts the storefront language prefix on the page path (feature 167, FR-034) — the
   * caller passes `storefrontPagePathFor` bound to the channel and the e-mail's
   * language. Absent: the logical path.
   */
  pagePath?: (path: string) => string;
}

/**
 * Verification email for first-time organization registration (FR-001).
 */
export function buildVerificationEmail(input: BuildVerificationEmailInput): EmailMailerSendInput {
  const base = trimSlash(input.storefrontBaseUrl);
  /** Must match storefront `app/(auth)/verify/page.tsx` (path `/verify`). */
  const path = `/verify?token=${encodeURIComponent(input.rawToken)}`;
  const verifyUrl = `${base}${input.pagePath ? input.pagePath(path) : path}`;
  const text = [
    `Welcome to the B2B platform.`,
    ``,
    `Organization "${input.organizationName}" was registered.`,
    ``,
    `Verify your email address by opening this link:`,
    verifyUrl,
    ``,
    `If you did not register, you can ignore this message.`,
  ].join('\n');

  return {
    messageId: `email_verification:${input.customerAccountId}`,
    to: input.recipientEmail,
    subject: `Verify your email — ${input.organizationName}`,
    text,
    meta: {
      kind: 'email_verification',
      customerAccountId: input.customerAccountId,
      organizationName: input.organizationName,
      verifyUrl,
    },
  };
}

function trimSlash(s: string): string {
  return s.endsWith('/') ? s.slice(0, -1) : s;
}
