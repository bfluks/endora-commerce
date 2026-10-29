/**
 * `POST /newsletter/subscribe` — the storefront handler behind the
 * `newsletter.Signup` Page Builder block (feature 163, FR-029; research R-17;
 * `specs/163-page-builder-marketing-pages/contracts/storefront-and-admin-api.md` §4).
 *
 * The block is a plain `<form method="post">`, so a sign-up works without
 * JavaScript: the handler answers `303` back to the page it came from, with the
 * outcome in `?newsletter=pending|active|error&reason=…` and the section's
 * anchor as the fragment. With JavaScript the block submits with
 * `Accept: application/json` and gets `{status}` or `{error}` instead.
 *
 * The subscription itself is the newsletter module's existing public endpoint,
 * reached through `subscribeNewsletter`; the consent is recorded there
 * (`consentAt` and the audit entry), and `source: 'cms-block'` tells this
 * sign-up apart from the others. While the newsletter module is absent the
 * handler answers `404`, as the block is already gone from every page.
 */

import { SECTION_ANCHOR_RE, newsletterSubscribeRequestSchema } from '@endora-commerce/contracts';
import { getModulePresence } from '../../../lib/api/module-presence';
import { subscribeNewsletter } from '../../../lib/api/newsletter';
import { SALES_CHANNEL_REQUEST_HEADER } from '../../../lib/channel/channel-header';

export const dynamic = 'force-dynamic';

/** A topic is a newsletter tag code. Anything else is dropped, not refused. */
const TOPIC_CODE_RE = /^[a-z0-9_-]{1,64}$/;
/** The most topics one sign-up carries; the block offers at most 12. */
const MAX_TOPICS = 12;

type SignupError = 'consent' | 'email' | 'topics' | 'unavailable';
type SignupOutcome = { status: 'pending' | 'active' } | { error: SignupError };

/** The `email` rule the backend applies, so a refusal here is the one the backend would give. */
const emailRule = newsletterSubscribeRequestSchema.shape.email;

/**
 * A same-origin path, or `/`. Anything that could leave the storefront — an
 * absolute URL, `//host`, `/\host`, a scheme — falls back to the home page.
 */
function safeReturnTo(raw: string): URL {
  const base = 'http://storefront.invalid';
  const fallback = new URL('/', base);
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return fallback;
  if (/[\u0000-\u001f\\]/.test(raw)) return fallback;
  try {
    const url = new URL(raw, base);
    return url.origin === base ? url : fallback;
  } catch {
    return fallback;
  }
}

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

function redirectTo(returnTo: URL, anchor: string | null, outcome: SignupOutcome): Response {
  const target = new URL(returnTo.href);
  target.searchParams.delete('newsletter');
  target.searchParams.delete('reason');
  if ('error' in outcome) {
    target.searchParams.set('newsletter', 'error');
    target.searchParams.set('reason', outcome.error);
  } else {
    target.searchParams.set('newsletter', outcome.status);
  }
  // A relative `Location`: the storefront may sit behind a proxy whose public
  // origin this request does not know, and the browser resolves it against the
  // page it posted from.
  const location = `${target.pathname}${target.search}${anchor ? `#${anchor}` : ''}`;
  return new Response(null, { status: 303, headers: { Location: location, 'Cache-Control': 'no-store' } });
}

function json(outcome: SignupOutcome): Response {
  return Response.json(outcome, {
    status: 'error' in outcome ? 400 : 200,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export async function POST(request: Request): Promise<Response> {
  const modules = await getModulePresence();
  if (!modules.isPresent('newsletter')) {
    return new Response('Not Found', { status: 404 });
  }

  const wantsJson = (request.headers.get('accept') ?? '').includes('application/json');
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    form = new FormData();
  }

  const returnTo = safeReturnTo(field(form, 'returnTo'));
  const rawAnchor = field(form, 'anchor');
  const anchor = SECTION_ANCHOR_RE.test(rawAnchor) ? rawAnchor : null;
  const answer = (outcome: SignupOutcome): Response =>
    wantsJson ? json(outcome) : redirectTo(returnTo, anchor, outcome);

  const email = emailRule.safeParse(field(form, 'email'));
  if (!email.success) return answer({ error: 'email' });
  if (field(form, 'consent') !== 'on') return answer({ error: 'consent' });

  const topics = [
    ...new Set(
      form
        .getAll('topics')
        .filter((value): value is string => typeof value === 'string' && TOPIC_CODE_RE.test(value)),
    ),
  ].slice(0, MAX_TOPICS);
  if (field(form, 'topicsRequired') === 'on' && topics.length === 0) return answer({ error: 'topics' });

  const channelCode = request.headers.get(SALES_CHANNEL_REQUEST_HEADER) || 'default';
  try {
    const result = await subscribeNewsletter({
      email: email.data,
      channelCode,
      ...(topics.length > 0 ? { tags: topics } : {}),
      source: 'cms-block',
    });
    return answer({ status: result.status });
  } catch {
    return answer({ error: 'unavailable' });
  }
}
