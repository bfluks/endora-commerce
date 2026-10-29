'use client';

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { ComponentConfig, Fields, PuckComponent } from '@puckeditor/core';
import { plainTextToInlineRichText, withHideOn, type InlineRichText, createToggleField } from '@endora-commerce/page-builder-core';
import type {
  NewsletterSignupFormProps,
  NewsletterSignupMessages,
  NewsletterSignupTopic,
} from '../schema/component-types.js';
import { createInlineRichTextField } from '../fields/inline-rich-text-field.js';
import { createRichTextDocField } from '../fields/rich-text-doc-field.js';
import { levelField } from '../fields/section-block-fields.js';
import { useSectionAnchor } from './Section.js';
import { InlineRich } from './InlineRich.js';
import { useBlockDomId } from './block-dom-id.js';
import { useCmsRenderLocation, type CmsRenderLocation } from './render-context.js';
import { BlockHeading, plainTextToDoc, RichBody } from './section-parts.js';

/**
 * `newsletter.Signup` — `specs/163-page-builder-marketing-pages/` US7, FR-029,
 * research R-17, contracts/blocks.md. Declared by the `newsletter` module,
 * rendered from here, and gone from every page while that module is off.
 *
 * A plain `<form method="post" action="/newsletter/subscribe">`: the
 * storefront's handler subscribes through the newsletter module, with the
 * chosen topics as tags and the consent recorded, and answers `303` back to
 * this page with the outcome on the URL (`?newsletter=…&reason=…#anchor`, the
 * anchor of the enclosing `cms.Section` when it has one). The
 * outcome is read from the rendered page's location, so it is in the server
 * HTML and a visitor without JavaScript sees it. With JavaScript the form
 * checks the e-mail and the consent itself, posts with `fetch` and shows the
 * outcome inline; the typed address is never lost.
 */

/** The storefront handler the form posts to (contracts/storefront-and-admin-api.md §4). */
export const NEWSLETTER_SUBSCRIBE_PATH = '/newsletter/subscribe';

/** Most topics one sign-up offers (contracts/blocks.md). */
export const NEWSLETTER_SIGNUP_MAX_TOPICS = 12;

/** A topic is a newsletter tag code; the handler drops anything else. */
const TOPIC_CODE_RE = /^[a-z0-9_-]{1,64}$/;

/** A deliberately loose check: the handler applies the backend's own rule. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type SignupError = 'consent' | 'email' | 'topics' | 'unavailable';
type Outcome = { status: 'pending' | 'active' } | { error: SignupError } | null;

const ERRORS: readonly SignupError[] = ['consent', 'email', 'topics', 'unavailable'];

/** The outcome the handler put on the URL, if any. */
function outcomeFromQuery(query: CmsRenderLocation['query'] | undefined): Outcome {
  const status = query?.['newsletter'];
  if (status === 'pending' || status === 'active') return { status };
  if (status !== 'error') return null;
  const reason = query?.['reason'] as SignupError | undefined;
  return { error: reason && ERRORS.includes(reason) ? reason : 'unavailable' };
}

/** The page to come back to, without an earlier outcome on it. */
function returnPathOf(path: string, query: Readonly<Record<string, string>>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (key !== 'newsletter' && key !== 'reason') params.append(key, value);
  }
  const search = params.toString();
  return `${path}${search ? `?${search}` : ''}`;
}

function validTopics(topics: NewsletterSignupTopic[] | undefined): Array<{ label: string; tagCode: string }> {
  return (topics ?? [])
    .filter((topic): topic is { label: string; tagCode: string } =>
      !!topic && typeof topic.tagCode === 'string' && TOPIC_CODE_RE.test(topic.tagCode) && typeof topic.label === 'string' && topic.label.trim() !== '',
    )
    .slice(0, NEWSLETTER_SIGNUP_MAX_TOPICS);
}

const DEFAULT_MESSAGES: Required<NewsletterSignupMessages> = {
  pending: 'Almost done: check your inbox and confirm your subscription.',
  active: 'Thank you, you are subscribed.',
  consent: 'Please accept the consent to subscribe.',
  email: 'Enter a valid e-mail address.',
  topics: 'Choose at least one topic.',
  unavailable: 'The sign-up is not available right now. Please try again later.',
};

function message(messages: NewsletterSignupMessages | undefined, key: keyof NewsletterSignupMessages): string {
  const value = messages?.[key];
  return typeof value === 'string' && value.trim() !== '' ? value : DEFAULT_MESSAGES[key];
}

/** The consent label a block shows when the editor wrote none. */
const DEFAULT_CONSENT_LABEL: InlineRichText = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'I agree to receive the newsletter and accept the ' },
        { type: 'text', text: 'privacy policy', marks: [{ type: 'link', attrs: { href: '/privacy-policy' } }] },
        { type: 'text', text: '.' },
      ],
    },
  ],
} as InlineRichText;

function SignupBody({ props, editing }: { props: NewsletterSignupFormProps; editing: boolean }): ReactNode {
  const location = useCmsRenderLocation();
  const [returnTo, setReturnTo] = useState(() => (location ? returnPathOf(location.path, location.query) : '/'));
  const [outcome, setOutcome] = useState<Outcome>(() => outcomeFromQuery(location?.query));
  const [enhanced, setEnhanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const consentRef = useRef<HTMLInputElement>(null);
  // The block's id, not `useId()` alone: the same on the server and on hydration (T149).
  const baseId = useBlockDomId('pb-signup', (props as { id?: unknown }).id);
  const ids = {
    email: `${baseId}-email`,
    emailError: `${baseId}-email-error`,
    consent: `${baseId}-consent`,
    consentError: `${baseId}-consent-error`,
    topicsError: `${baseId}-topics-error`,
  };

  useEffect(() => {
    // From here on the form checks itself and shows its own messages.
    setEnhanced(true);
    if (!location && typeof window !== 'undefined') {
      setReturnTo(returnPathOf(window.location.pathname, Object.fromEntries(new URLSearchParams(window.location.search))));
    }
  }, [location]);

  const topics = validTopics(props.topics);
  // Back to the enclosing `cms.Section`, when it has an anchor.
  const anchor = useSectionAnchor();
  const error = outcome && 'error' in outcome ? outcome.error : null;
  const done = outcome && 'status' in outcome ? outcome.status : null;
  const layout = props.layout === 'inline' ? 'inline' : 'boxed';

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (editing || busy) return;
    const form = event.currentTarget;
    const email = emailRef.current?.value.trim() ?? '';
    if (!EMAIL_RE.test(email)) {
      setOutcome({ error: 'email' });
      emailRef.current?.focus();
      return;
    }
    if (!consentRef.current?.checked) {
      setOutcome({ error: 'consent' });
      consentRef.current?.focus();
      return;
    }
    const body = new FormData(form);
    if (props.topicsRequired === true && topics.length > 0 && body.getAll('topics').length === 0) {
      setOutcome({ error: 'topics' });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(NEWSLETTER_SUBSCRIBE_PATH, {
        method: 'POST',
        headers: { Accept: 'application/json' },
        body,
      });
      const answer = (await res.json().catch(() => null)) as { status?: string; error?: string } | null;
      if (answer?.status === 'pending' || answer?.status === 'active') setOutcome({ status: answer.status });
      else setOutcome({ error: ERRORS.includes(answer?.error as SignupError) ? (answer!.error as SignupError) : 'unavailable' });
    } catch {
      setOutcome({ error: 'unavailable' });
    } finally {
      setBusy(false);
    }
  }

  const errorText = (key: SignupError) => message(props.messages, key);

  return (
    <div className={`cmsc-pb-signup cmsc-pb-signup--${layout}`}>
      <BlockHeading
        value={props.heading}
        level={props.headingLevel}
        size={undefined}
        sizePx={undefined}
        className="cmsc-pb-signup__heading"
        tier={null}
      />
      <RichBody value={props.text} className="cmsc-pb-signup__text cmsc-pb-rich" />
      <form
        className="cmsc-pb-signup__form"
        method="post"
        action={NEWSLETTER_SUBSCRIBE_PATH}
        noValidate={enhanced}
        onSubmit={(event) => void onSubmit(event)}
      >
        <input type="hidden" name="returnTo" value={returnTo} />
        {anchor ? <input type="hidden" name="anchor" value={anchor} /> : null}
        {props.topicsRequired === true && topics.length > 0 ? <input type="hidden" name="topicsRequired" value="on" /> : null}
        <div className="cmsc-pb-signup__row">
          <div className="cmsc-pb-signup__field">
            <label className="cmsc-pb-signup__label" htmlFor={ids.email}>
              {props.emailLabel?.trim() || 'E-mail address'}
            </label>
            <input
              ref={emailRef}
              id={ids.email}
              className="cmsc-pb-signup__input"
              type="email"
              name="email"
              autoComplete="email"
              required
              placeholder={props.placeholder ?? ''}
              {...(error === 'email' ? { 'aria-invalid': true, 'aria-describedby': ids.emailError } : {})}
            />
            {error === 'email' ? (
              <p id={ids.emailError} className="cmsc-pb-signup__error">
                {errorText('email')}
              </p>
            ) : null}
          </div>
          <button type="submit" className="cmsc-pb-signup__button" disabled={busy} aria-busy={busy || undefined}>
            {props.buttonLabel?.trim() || 'Subscribe'}
          </button>
        </div>
        {topics.length > 0 ? (
          <fieldset
            className="cmsc-pb-signup__topics"
            {...(error === 'topics' ? { 'aria-describedby': ids.topicsError } : {})}
          >
            <legend className="cmsc-pb-signup__legend">{props.topicsLegend?.trim() || 'Topics'}</legend>
            {topics.map((topic, index) => (
              <div key={`${topic.tagCode}-${index}`} className="cmsc-pb-signup__check">
                <input id={`${baseId}-topic-${index}`} type="checkbox" name="topics" value={topic.tagCode} />
                <label htmlFor={`${baseId}-topic-${index}`}>{topic.label}</label>
              </div>
            ))}
            {error === 'topics' ? (
              <p id={ids.topicsError} className="cmsc-pb-signup__error">
                {errorText('topics')}
              </p>
            ) : null}
          </fieldset>
        ) : null}
        <div className="cmsc-pb-signup__consent cmsc-pb-signup__check">
          <input
            ref={consentRef}
            id={ids.consent}
            type="checkbox"
            name="consent"
            value="on"
            required
            {...(error === 'consent' ? { 'aria-invalid': true, 'aria-describedby': ids.consentError } : {})}
          />
          <label htmlFor={ids.consent}>
            <InlineRich value={props.consentLabel ?? DEFAULT_CONSENT_LABEL} />
          </label>
          {error === 'consent' ? (
            <p id={ids.consentError} className="cmsc-pb-signup__error">
              {errorText('consent')}
            </p>
          ) : null}
        </div>
        <p
          className={['cmsc-pb-signup__message', error === 'unavailable' ? 'cmsc-pb-signup__message--error' : ''].filter(Boolean).join(' ')}
          role="status"
          aria-live="polite"
        >
          {done ? message(props.messages, done) : error === 'unavailable' ? errorText('unavailable') : null}
        </p>
      </form>
    </div>
  );
}

const SignupEditingRender: PuckComponent<NewsletterSignupFormProps> = (props) => (
  <SignupBody props={props as unknown as NewsletterSignupFormProps} editing />
);

const SignupPublishedRender: PuckComponent<NewsletterSignupFormProps> = (props) => (
  <SignupBody props={props as unknown as NewsletterSignupFormProps} editing={false} />
);

const SIGNUP_FIELDS = {
  heading: createInlineRichTextField({ label: 'Heading' }),
  headingLevel: levelField('Heading level'),
  text: createRichTextDocField({ label: 'Text' }),
  emailLabel: { type: 'text' as const, label: 'Email field label' },
  placeholder: { type: 'text' as const, label: 'Email placeholder' },
  buttonLabel: { type: 'text' as const, label: 'Button label' },
  topicsLegend: { type: 'text' as const, label: 'Topics heading' },
  topics: {
    type: 'array' as const,
    label: 'Topics',
    max: NEWSLETTER_SIGNUP_MAX_TOPICS,
    arrayFields: {
      label: { type: 'text' as const, label: 'Label' },
      tagCode: { type: 'text' as const, label: 'Newsletter tag code' },
    },
    defaultItemProps: { label: 'Topic', tagCode: '' },
    getItemSummary: (item: NewsletterSignupTopic) => item?.label || 'Topic',
  },
  topicsRequired: createToggleField({ label: 'A topic must be chosen', defaultValue: false }),
  consentLabel: createInlineRichTextField({ label: 'Consent label' }),
  layout: {
    type: 'radio' as const,
    label: 'Layout',
    options: [
      { label: 'Boxed', value: 'boxed' },
      { label: 'Inline', value: 'inline' },
    ],
  },
  messages: {
    type: 'object' as const,
    label: 'Messages',
    objectFields: {
      pending: { type: 'textarea' as const, label: 'Confirmation email sent' },
      active: { type: 'textarea' as const, label: 'Subscribed' },
      consent: { type: 'text' as const, label: 'Consent missing' },
      email: { type: 'text' as const, label: 'Invalid email address' },
      topics: { type: 'text' as const, label: 'No topic chosen' },
      unavailable: { type: 'textarea' as const, label: 'Sign-up unavailable' },
    },
  },
};

const signupConfig: ComponentConfig<{ props: NewsletterSignupFormProps }> = {
  label: 'Newsletter sign-up',
  fields: SIGNUP_FIELDS as unknown as Fields<NewsletterSignupFormProps>,
  defaultProps: {
    heading: plainTextToInlineRichText('Stay in the loop'),
    headingLevel: 'h2',
    text: plainTextToDoc('News, offers and events, a few times a month.'),
    emailLabel: 'E-mail address',
    placeholder: 'you@example.com',
    buttonLabel: 'Subscribe',
    topicsLegend: 'Topics',
    topics: [],
    topicsRequired: false,
    consentLabel: DEFAULT_CONSENT_LABEL,
    layout: 'boxed',
    messages: { ...DEFAULT_MESSAGES },
  } as NewsletterSignupFormProps,
  render: (props) =>
    props.puck?.isEditing ? <SignupEditingRender {...props} /> : <SignupPublishedRender {...props} />,
};

/**
 * The block, exported under its name's local segment (`newsletter.Signup`), as
 * every block of this package is: the SSR floor reconciles the components map
 * with the exported block configs by that segment.
 */
export const Signup = withHideOn(signupConfig);
