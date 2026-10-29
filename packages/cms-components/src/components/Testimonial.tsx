'use client';

import type { ReactNode } from 'react';
import type { ComponentConfig, Fields, PuckComponent } from '@puckeditor/core';
import { withHideOn, type BreakpointTier, type ResponsiveImage } from '@endora-commerce/page-builder-core';
import { usePreviewBreakpointTier } from '@endora-commerce/page-builder-core/client';
import type { TestimonialProps } from '../schema/component-types.js';
import { BoxStyled } from './box-styles.js';
import {
  BACKGROUND_FIELD,
  BOX_BORDER_FIELD,
  BOX_MARGIN_FIELD,
  BOX_PADDING_FIELD,
  CORNER_RADIUS_FIELD,
  DEFAULT_BOX_PROPS,
  SHADOW_FIELD,
} from '../fields/shared-fields.js';
import { createRichTextDocField } from '../fields/rich-text-doc-field.js';
import { imageObjectField } from '../fields/section-block-fields.js';
import { Picture } from './Picture.js';
import { useCmsRenderAssets, useCmsRenderMediaBaseUrl } from './render-context.js';
import { resolveImageUrl } from '../utils/resolve-image-url.js';
import { hasImage, plainTextToDoc, richHtml } from './section-parts.js';

/**
 * `cms.Testimonial` — `specs/163-page-builder-marketing-pages/`
 * contracts/blocks.md.
 *
 * A rich quote with its author, role and avatar, as today's card (`layout:
 * 'card'`, the default) — with an optional image above the quote — or as an
 * image card with the quote, author and role laid over the image under a shade
 * (`'image-overlay'`). The avatar is one `ResponsiveImage`.
 *
 * Plan § *Extend, don't narrow*: every field of today's block has its
 * counterpart (the option-parity test), and a testimonial stored before
 * renders as it did ({@link testimonialFromLegacy}): its avatar fields become
 * the avatar with today's alternative text, its plain quote a one-paragraph
 * document.
 */

// ── Stored before the reshape ────────────────────────────────────────

const LEGACY_AVATAR_KEYS = ['avatarSource', 'avatarUrl', 'avatarAssetId'] as const;

/**
 * A testimonial stored on `origin/master` in the reshaped shape, value for
 * value (the option-parity test holds it): `avatarSource` with `avatarUrl` or
 * `avatarAssetId` becomes the `avatar` image, with today's alternative text
 * ("<author> avatar"); a plain quote becomes a document; the layout is today's
 * card. Idempotent.
 */
export function testimonialFromLegacy(props: Record<string, unknown>): TestimonialProps {
  const next: Record<string, unknown> = { ...props };
  const hasLegacyAvatar = LEGACY_AVATAR_KEYS.some((key) => key in props);
  if (hasLegacyAvatar) {
    for (const key of LEGACY_AVATAR_KEYS) delete next[key];
    if (props['avatar'] === undefined) {
      const author = typeof props['author'] === 'string' ? props['author'] : '';
      const alt = author ? `${author} avatar` : '';
      const library = props['avatarSource'] === 'library';
      const assetId = typeof props['avatarAssetId'] === 'string' ? props['avatarAssetId'] : '';
      const src = typeof props['avatarUrl'] === 'string' ? props['avatarUrl'] : '';
      // As today's render read it: the source picks the URL or the library asset.
      if (library && assetId) next['avatar'] = { imageSource: 'library', assetId, alt } satisfies Partial<ResponsiveImage>;
      else if (!library && src) next['avatar'] = { imageSource: 'url', src, alt } satisfies Partial<ResponsiveImage>;
    }
  }
  if (typeof props['quote'] === 'string') next['quote'] = plainTextToDoc(props['quote']);
  if (next['layout'] === undefined) next['layout'] = 'card';
  return next as unknown as TestimonialProps;
}

// ── Render ───────────────────────────────────────────────────────────

function Quote({ quote }: { quote: TestimonialProps['quote'] }): ReactNode {
  // A plain quote stored before renders as its text, exactly as today.
  if (typeof quote === 'string') return <blockquote className="cmsc-pb-testimonial__quote">{quote}</blockquote>;
  const html = richHtml(quote);
  return <blockquote className="cmsc-pb-testimonial__quote cmsc-pb-rich" dangerouslySetInnerHTML={{ __html: html }} />;
}

/** The avatar as today's round `<img>`: its desktop image, else its mobile one; 44 px, so it reserves its space. */
function Avatar({ avatar }: { avatar: Partial<ResponsiveImage> | undefined }): ReactNode {
  const assets = useCmsRenderAssets();
  const mediaBaseUrl = useCmsRenderMediaBaseUrl();
  if (!hasImage(avatar)) return null;
  const source = avatar.imageSource ?? 'url';
  const resolve = (src: string | undefined, assetId: string | undefined): string =>
    resolveImageUrl({ imageSource: source, ...(src ? { src } : {}), ...(assetId ? { assetId } : {}) }, null, assets, mediaBaseUrl);
  const url = resolve(avatar.src, avatar.assetId) || resolve(avatar.mobileSrc, avatar.mobileAssetId);
  if (!url) return null;
  return (
    <img
      src={url}
      alt={avatar.alt ?? ''}
      className="cmsc-pb-testimonial__avatar"
      width={44}
      height={44}
      loading="lazy"
      decoding="async"
    />
  );
}

function Attribution({ props }: { props: TestimonialProps }): ReactNode {
  const { author = '', role = '', avatar } = props;
  return (
    <footer className="cmsc-pb-testimonial__footer">
      <Avatar avatar={avatar} />
      <div>
        {author ? <div className="cmsc-pb-testimonial__author">{author}</div> : null}
        {role ? <div className="cmsc-pb-testimonial__role">{role}</div> : null}
      </div>
    </footer>
  );
}

function TestimonialBody({ props: stored, tier }: { props: TestimonialProps; tier: BreakpointTier | null }): ReactNode {
  // The avatar is carried for the render; a stored plain quote is kept as its text.
  const props = { ...testimonialFromLegacy(stored as unknown as Record<string, unknown>), quote: stored.quote };
  const { margin, padding, border, background, cornerRadius, shadow, image } = props;
  const overlay = props.layout === 'image-overlay' && hasImage(image);

  return (
    <BoxStyled
      {...(margin !== undefined ? { margin } : {})}
      {...(padding !== undefined ? { padding } : {})}
      {...(border !== undefined ? { border } : {})}
      {...(background !== undefined ? { background } : {})}
      {...(cornerRadius !== undefined ? { cornerRadius } : {})}
      {...(shadow !== undefined ? { shadow } : {})}
      {...(tier !== null ? { previewTier: tier } : {})}
      className={['cmsc-pb-testimonial', overlay ? 'cmsc-pb-testimonial--image-overlay' : ''].filter(Boolean).join(' ')}
    >
      {overlay ? (
        <div className="cmsc-pb-testimonial__stage">
          <div className="cmsc-pb-testimonial__image">
            <Picture image={{ fit: 'cover', ...image, ratio: image!.ratio ?? '4:5' }} />
          </div>
          <div className="cmsc-pb-testimonial__overlay">
            <Quote quote={props.quote} />
            <Attribution props={props} />
          </div>
        </div>
      ) : (
        <>
          {hasImage(image) ? (
            <div className="cmsc-pb-testimonial__image">
              <Picture image={{ fit: 'cover', ...image, ratio: image.ratio ?? '16:9' }} />
            </div>
          ) : null}
          <Quote quote={props.quote} />
          <Attribution props={props} />
        </>
      )}
    </BoxStyled>
  );
}

const TestimonialEditingRender: PuckComponent<TestimonialProps> = (props) => (
  <TestimonialBody props={props as unknown as TestimonialProps} tier={usePreviewBreakpointTier()} />
);

const TestimonialPublishedRender: PuckComponent<TestimonialProps> = (props) => (
  <TestimonialBody props={props as unknown as TestimonialProps} tier={null} />
);

// ── Fields ───────────────────────────────────────────────────────────

const TESTIMONIAL_FIELDS = {
  layout: {
    type: 'select' as const,
    label: 'Layout',
    options: [
      { label: 'Card', value: 'card' },
      { label: 'Quote over the image', value: 'image-overlay' },
    ],
  },
  quote: createRichTextDocField({ label: 'Quote' }),
  author: { type: 'text' as const, label: 'Author' },
  role: { type: 'text' as const, label: 'Role / company' },
  image: imageObjectField('Image'),
  avatar: imageObjectField('Avatar'),
  background: BACKGROUND_FIELD,
  cornerRadius: CORNER_RADIUS_FIELD,
  shadow: SHADOW_FIELD,
  margin: BOX_MARGIN_FIELD,
  padding: BOX_PADDING_FIELD,
  border: BOX_BORDER_FIELD,
};

const testimonialConfig: ComponentConfig<{ props: TestimonialProps }> = {
  label: 'Testimonial',
  fields: TESTIMONIAL_FIELDS as unknown as Fields<TestimonialProps>,
  // Today's card (T048): a light fill, 24 px padding, medium corners.
  defaultProps: {
    layout: 'card',
    quote: plainTextToDoc('“This platform made our ordering dramatically simpler.”'),
    author: 'Alex Kowalski',
    role: 'Procurement lead',
    ...DEFAULT_BOX_PROPS,
    background: { kind: 'solid', color: '#f8fafc' },
    padding: { mode: 'uniform', value: 24 },
    cornerRadius: 'medium',
  } as TestimonialProps,
  // Filters the host's field set, so the admin's pickers survive.
  resolveFields: (_data, params) =>
    ((params?.fields as Record<string, unknown> | undefined) ?? TESTIMONIAL_FIELDS) as unknown as Fields<TestimonialProps>,
  // A testimonial stored before the reshape is carried into it once, with no change to its render.
  resolveData: async (data) => ({
    props: testimonialFromLegacy(data.props as unknown as Record<string, unknown>) as never,
  }),
  render: (props) =>
    props.puck?.isEditing ? <TestimonialEditingRender {...props} /> : <TestimonialPublishedRender {...props} />,
};

export const Testimonial = withHideOn(testimonialConfig);
