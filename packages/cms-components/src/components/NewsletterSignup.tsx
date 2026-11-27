'use client';

import { type ComponentConfig, type Fields, type PuckComponent } from '@puckeditor/core';
import { plainTextToInlineRichText, withHideOn, createToggleField } from '@endora-commerce/page-builder-core';
import { usePreviewBreakpointTier } from '@endora-commerce/page-builder-core/client';
import type { NewsletterSignupProps } from '../schema/component-types.js';
import { createInlineRichTextField } from '../fields/inline-rich-text-field.js';
import { BoxStyled } from './box-styles.js';
import { InlineRich } from './InlineRich.js';
import { useBlockDomId } from './block-dom-id.js';
import {
  BACKGROUND_FIELD,
  BOX_BORDER_FIELD,
  BOX_MARGIN_FIELD,
  BOX_PADDING_FIELD,
  CORNER_RADIUS_FIELD,
  DEFAULT_BOX_PROPS,
  SHADOW_FIELD,
} from '../fields/shared-fields.js';

/**
 * `cms.NewsletterSignup` — a sign-up form that posts to any endpoint the
 * editor names (`actionUrl`), for a newsletter run outside the platform. The
 * platform's own newsletter is `newsletter.Signup` (feature 163, US7); the
 * owner kept this block beside it (T076, decision (a)), with an optional
 * consent checkbox, off by default so a form stored before looks the same.
 */

function NewsletterBody({
  props,
  editing,
  tier,
}: {
  props: NewsletterSignupProps;
  editing: boolean;
  tier: 'mobile' | 'tablet' | 'desktop' | null;
}): React.ReactElement {
  const {
    heading = '',
    description = '',
    placeholder = 'you@company.com',
    buttonLabel = 'Subscribe',
    actionUrl = '',
    showConsent = false,
    consentLabel,
    background,
    cornerRadius,
    shadow,
    ...box
  } = props;

  // The block's id, not `useId()` alone: the same on the server and on hydration (T149).
  const consentId = `${useBlockDomId('pb-newsletter', (props as { id?: unknown }).id)}-consent`;
  return (
    <BoxStyled
      {...box}
      {...(background !== undefined ? { background } : {})}
      {...(cornerRadius !== undefined ? { cornerRadius } : {})}
      {...(shadow !== undefined ? { shadow } : {})}
      {...(editing && tier ? { previewTier: tier } : {})}
      className="cmsc-pb-newsletter"
    >
      {heading ? <h3 className="cmsc-pb-newsletter__heading">{heading}</h3> : null}
      {description ? <p className="cmsc-pb-newsletter__desc">{description}</p> : null}
      <form
        className="cmsc-pb-newsletter__form"
        action={actionUrl || undefined}
        method={actionUrl ? 'post' : undefined}
        onSubmit={actionUrl ? undefined : (e): void => e.preventDefault()}
      >
        <input
          type="email"
          name="email"
          required
          placeholder={placeholder}
          className="cmsc-pb-newsletter__input"
          aria-label="Email"
        />
        <button type="submit" className="cmsc-pb-newsletter__button">
          {buttonLabel}
        </button>
        {showConsent ? (
          <div className="cmsc-pb-newsletter__consent">
            <input id={consentId} type="checkbox" name="consent" value="on" required />
            <label htmlFor={consentId}>
              <InlineRich value={consentLabel ?? DEFAULT_CONSENT_LABEL} />
            </label>
          </div>
        ) : null}
      </form>
      {editing && !actionUrl ? (
        <p className="cmsc:text-xs cmsc:text-[#94a3b8] cmsc:mt-2">
          Set Action URL to wire this form to your newsletter endpoint.
        </p>
      ) : null}
    </BoxStyled>
  );
}

const NewsletterEditingRender: PuckComponent<NewsletterSignupProps> = (props) => (
  <NewsletterBody props={props as unknown as NewsletterSignupProps} editing tier={usePreviewBreakpointTier()} />
);

const NewsletterPublishedRender: PuckComponent<NewsletterSignupProps> = (props) => (
  <NewsletterBody props={props as unknown as NewsletterSignupProps} editing={false} tier={null} />
);

/** The consent label a form shows when the editor switched the consent on and wrote none. */
const DEFAULT_CONSENT_LABEL = 'I agree to receive the newsletter.';

const NEWSLETTER_FIELDS = {
  heading: { type: 'text', label: 'Heading' },
  description: { type: 'textarea', label: 'Description' },
  placeholder: { type: 'text', label: 'Email placeholder' },
  buttonLabel: { type: 'text', label: 'Button label' },
  actionUrl: { type: 'text', label: 'Form action URL' },
  showConsent: createToggleField({ label: 'Consent checkbox' }),
  consentLabel: createInlineRichTextField({ label: 'Consent label' }),
  background: BACKGROUND_FIELD,
  cornerRadius: CORNER_RADIUS_FIELD,
  shadow: SHADOW_FIELD,
  margin: BOX_MARGIN_FIELD,
  padding: BOX_PADDING_FIELD,
  border: BOX_BORDER_FIELD,
} as unknown as Fields<NewsletterSignupProps>;

const newsletterConfig: ComponentConfig<NewsletterSignupProps> = {
  label: 'Newsletter signup',
  fields: NEWSLETTER_FIELDS,
  // The consent label is offered once the consent is switched on.
  resolveFields: (data, params) => {
    const fields: Record<string, unknown> = {};
    const source = (params?.fields as Record<string, unknown> | undefined) ?? NEWSLETTER_FIELDS;
    for (const [key, field] of Object.entries(source)) {
      if (key === 'consentLabel' && data.props.showConsent !== true) continue;
      fields[key] = field;
    }
    return fields as Fields<NewsletterSignupProps>;
  },
  defaultProps: {
    heading: 'Stay in the loop',
    description: 'Product updates and wholesale offers — no spam.',
    placeholder: 'you@company.com',
    buttonLabel: 'Subscribe',
    actionUrl: '',
    showConsent: false,
    consentLabel: plainTextToInlineRichText(DEFAULT_CONSENT_LABEL),
    ...DEFAULT_BOX_PROPS,
    background: { kind: 'solid', color: '#f0fdfa' },
    padding: { mode: 'uniform', value: 24 },
    cornerRadius: 'medium',
  },
  render: (props) =>
    props.puck?.isEditing ? (
      <NewsletterEditingRender {...props} />
    ) : (
      <NewsletterPublishedRender {...props} />
    ),
};

export const NewsletterSignup = withHideOn(newsletterConfig);
