import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { CmsRenderProvider } from '@endora-commerce/cms-components/components/render-context';
import { BlockRenderScope } from '../../components/BlockRenderScope';
import { PageBuilderRender } from '../../components/PageBuilderRender';
import { cmsRenderLocation } from '../../lib/page-builder/render-location';

/**
 * `newsletter.Signup` on a storefront page (`specs/163-page-builder-marketing-pages/`
 * US7, FR-029, research R-17): the form, its topics and its consent are in the
 * server HTML and post to the storefront's `/newsletter/subscribe`; the outcome
 * the handler put on the URL is shown without JavaScript; and while the
 * newsletter module is absent, customers see nothing in its place (US7
 * acceptance 2, Principle XVII).
 *
 * Harness: `renderToString`, as `blog-latest-posts.test.tsx`.
 */

// The sign-up inside a top-level `cms.Section`, whose anchor is the way back
// (plan § Owner ruling 2026-10-23: anchors live on the Section).
const DOCUMENT = {
  root: { props: {} },
  content: [
    {
      type: 'cms.Section',
      props: {
        id: 'section-newsletter',
        anchor: 'newsletter',
        content: [
          {
            type: 'newsletter.Signup',
            props: {
              id: 'signup',
              heading: 'Stay in the loop',
              buttonLabel: 'Sign up',
              topics: [{ label: 'Offers', tagCode: 'offers' }],
              consentLabel: 'I accept the newsletter terms.',
              messages: { pending: 'Check your inbox to confirm.' },
            },
          },
        ],
      },
    },
  ],
  zones: {},
};

function ssr(options: { absent?: readonly string[]; query?: Record<string, string> } = {}): string {
  return renderToString(
    <BlockRenderScope presence={{ absent: [...(options.absent ?? [])] }} language="en-US">
      <CmsRenderProvider
        embeds={{ blocks: {}, templates: {} }}
        location={cmsRenderLocation('/landing', options.query ?? {})}
      >
        <PageBuilderRender data={DOCUMENT} />
      </CmsRenderProvider>
    </BlockRenderScope>,
  );
}

describe('newsletter.Signup on a storefront page', () => {
  it('server-renders the form posting to /newsletter/subscribe, with its topics, consent and way back', () => {
    const html = ssr();
    expect(html).toContain('action="/newsletter/subscribe"');
    expect(html).toContain('method="post"');
    expect(html).toContain('name="returnTo" value="/landing"');
    expect(html).toContain('name="anchor" value="newsletter"');
    expect(html).toContain('name="topics" value="offers"');
    expect(html).toContain('I accept the newsletter terms.');
    expect(html).toContain('id="newsletter"');
  });

  it('shows the outcome on the URL without JavaScript, and drops it from the way back', () => {
    const html = ssr({ query: { newsletter: 'pending', ref: 'mail' } });
    expect(html).toContain('Check your inbox to confirm.');
    expect(html).toContain('name="returnTo" value="/landing?ref=mail"');
  });

  it('renders nothing of the sign-up while the newsletter module is absent', () => {
    const html = ssr({ absent: ['newsletter'] });
    expect(html).not.toContain('/newsletter/subscribe');
    expect(html).not.toContain('Stay in the loop');
  });
});
