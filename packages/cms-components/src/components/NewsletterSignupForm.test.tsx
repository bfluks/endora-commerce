// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { Render, type Config, type Data } from '@puckeditor/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultPageBuilderConfig } from '../index.js';
import { CmsRenderProvider, type CmsRenderLocation } from './render-context.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Puck's drag-and-drop layer observes element sizes when it is imported; jsdom has no ResizeObserver.
vi.hoisted(() => {
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
});

/**
 * `specs/163-page-builder-marketing-pages/` T075, US7, FR-029, research R-17,
 * contracts/blocks.md `newsletter.Signup` — the sign-up that subscribes
 * through the newsletter module.
 *
 * - A plain `<form method="post" action="/newsletter/subscribe">` with the
 *   hidden `returnTo` and `anchor`, so it works without JavaScript.
 * - Topics are a checkbox group of tag codes; the consent is `required` and its
 *   label may hold a link (to the privacy policy).
 * - With JavaScript, a submit without consent shows the error next to the
 *   consent and keeps the typed address (US7 acceptance 1); a valid one posts
 *   with `fetch` and shows the outcome inline.
 * - Without JavaScript, the outcome comes back on the URL
 *   (`?newsletter=pending`) and is in the server HTML.
 */

const config = defaultPageBuilderConfig as Config;
const defaults = (config.components['newsletter.Signup']?.defaultProps ?? {}) as Record<string, unknown>;

const consentLabel = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'I accept the ' },
        { type: 'text', text: 'privacy policy', marks: [{ type: 'link', attrs: { href: '/privacy-policy' } }] },
      ],
    },
  ],
};

const PROPS = {
  heading: 'Stay in the loop',
  placeholder: 'you@example.com',
  buttonLabel: 'Sign up',
  topics: [
    { label: 'Offers', tagCode: 'offers' },
    { label: 'Events', tagCode: 'events' },
  ],
  consentLabel,
};

/**
 * The sign-up inside a top-level `cms.Section`, whose anchor the form posts
 * back to (plan § Owner ruling 2026-10-23: anchors live on the Section).
 * `sectionAnchor: null` gives a section with no anchor.
 */
function page(props: Record<string, unknown>, location?: CmsRenderLocation, sectionAnchor: string | null = 'signup') {
  const signup = { type: 'newsletter.Signup', props: { ...defaults, id: 'signup-1', ...props } };
  const sectionDefaults = (config.components['cms.Section']?.defaultProps ?? {}) as Record<string, unknown>;
  const content = [
    {
      type: 'cms.Section',
      props: { ...sectionDefaults, id: 'section-1', ...(sectionAnchor ? { anchor: sectionAnchor } : {}), content: [signup] },
    },
  ] as Data['content'];
  return (
    <CmsRenderProvider embeds={{ blocks: {}, templates: {} }} {...(location ? { location } : {})}>
      <Render config={config} data={{ root: { props: {} }, content }} />
    </CmsRenderProvider>
  );
}

function serverDom(props: Record<string, unknown> = PROPS, location?: CmsRenderLocation, sectionAnchor: string | null = 'signup'): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = renderToString(page(props, location, sectionAnchor));
  return host;
}

let root: Root | null = null;
const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

function clientDom(props: Record<string, unknown> = PROPS, location?: CmsRenderLocation): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(page(props, location)));
  return host;
}

function form(host: HTMLElement): HTMLFormElement {
  const found = host.querySelector('form');
  if (!found) throw new Error('no form rendered');
  return found;
}

function emailInput(host: HTMLElement): HTMLInputElement {
  return host.querySelector<HTMLInputElement>('input[type="email"][name="email"]')!;
}

function consentInput(host: HTMLElement): HTMLInputElement {
  return host.querySelector<HTMLInputElement>('input[type="checkbox"][name="consent"]')!;
}

async function submit(host: HTMLElement): Promise<void> {
  await act(async () => {
    form(host).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}

function type(input: HTMLInputElement, value: string): void {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('newsletter.Signup (T075)', () => {
  it('is registered with neutral defaults: no topics, a consent label and the boxed layout', () => {
    expect(config.components['newsletter.Signup']).toBeDefined();
    expect(defaults).toMatchObject({ topics: [], topicsRequired: false, layout: 'boxed' });
    expect(defaults['consentLabel']).toBeTruthy();
    expect(typeof defaults['buttonLabel']).toBe('string');
  });

  it('posts to /newsletter/subscribe with the hidden returnTo and the enclosing section’s anchor', () => {
    const host = serverDom(PROPS, { path: '/landing', query: { ref: 'mail' } });
    const f = form(host);
    expect(f.getAttribute('method')).toBe('post');
    expect(f.getAttribute('action')).toBe('/newsletter/subscribe');
    expect(f.querySelector<HTMLInputElement>('input[type="hidden"][name="returnTo"]')?.value).toBe('/landing?ref=mail');
    expect(f.querySelector<HTMLInputElement>('input[type="hidden"][name="anchor"]')?.value).toBe('signup');
    const email = emailInput(host);
    expect(email.required).toBe(true);
    expect(email.getAttribute('placeholder')).toBe('you@example.com');
    // The e-mail field has a label, not only a placeholder.
    expect(host.querySelector(`label[for="${email.id}"]`)).not.toBeNull();
    expect(f.querySelector('button[type="submit"]')?.textContent).toBe('Sign up');
  });

  it('sends returnTo / when the page location is not known, and no anchor when its section has none', () => {
    const host = serverDom(PROPS, undefined, null);
    expect(host.querySelector<HTMLInputElement>('input[name="returnTo"]')?.value).toBe('/');
    expect(host.querySelector('input[name="anchor"]')).toBeNull();
  });

  it('renders the topics as a labelled checkbox group of tag codes', () => {
    const host = serverDom();
    const group = host.querySelector('fieldset');
    expect(group).not.toBeNull();
    expect(group!.querySelector('legend')?.textContent?.trim()).toBeTruthy();
    const boxes = [...group!.querySelectorAll<HTMLInputElement>('input[type="checkbox"][name="topics"]')];
    expect(boxes.map((box) => box.value)).toEqual(['offers', 'events']);
    expect(boxes.map((box) => host.querySelector(`label[for="${box.id}"]`)?.textContent)).toEqual(['Offers', 'Events']);
    // A topic with no valid tag code is not offered.
    const bad = serverDom({ ...PROPS, topics: [{ label: 'Broken', tagCode: 'Not A Code' }] });
    expect(bad.querySelector('input[name="topics"]')).toBeNull();
    expect(bad.querySelector('fieldset')).toBeNull();
  });

  it('marks the topic choice required with a hidden flag when the block asks for one', () => {
    const host = serverDom({ ...PROPS, topicsRequired: true });
    expect(host.querySelector<HTMLInputElement>('input[type="hidden"][name="topicsRequired"]')?.value).toBe('on');
    expect(serverDom().querySelector('input[name="topicsRequired"]')).toBeNull();
  });

  it('renders a required consent checkbox whose label holds the link', () => {
    const host = serverDom();
    const consent = consentInput(host);
    expect(consent.required).toBe(true);
    expect(consent.value).toBe('on');
    const label = host.querySelector(`label[for="${consent.id}"]`);
    expect(label?.textContent).toBe('I accept the privacy policy');
    expect(label?.querySelector('a')?.getAttribute('href')).toBe('/privacy-policy');
  });

  it('with JavaScript, a submit without consent shows the error next to the consent and keeps the e-mail', async () => {
    const host = clientDom();
    type(emailInput(host), 'buyer@example.com');
    await submit(host);
    expect(fetchMock).not.toHaveBeenCalled();
    const consent = consentInput(host);
    expect(consent.getAttribute('aria-invalid')).toBe('true');
    const errorId = consent.getAttribute('aria-describedby');
    expect(errorId).toBeTruthy();
    const error = host.querySelector(`[id="${errorId}"]`);
    expect(error?.textContent?.trim()).toBeTruthy();
    // Next to the consent: in the same consent row as the checkbox.
    expect(error?.closest('.cmsc-pb-signup__consent')).toBe(consent.closest('.cmsc-pb-signup__consent'));
    expect(emailInput(host).value).toBe('buyer@example.com');
  });

  it('with JavaScript, posts the form with fetch and shows the outcome inline, keeping the page', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ status: 'pending' }), { status: 200 }));
    const host = clientDom(PROPS, { path: '/landing', query: {} });
    type(emailInput(host), 'buyer@example.com');
    act(() => consentInput(host).click());
    act(() => host.querySelector<HTMLInputElement>('input[name="topics"][value="events"]')!.click());
    await submit(host);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/newsletter/subscribe');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Accept']).toBe('application/json');
    const body = init.body as FormData;
    expect(body.get('email')).toBe('buyer@example.com');
    expect(body.get('consent')).toBe('on');
    expect(body.getAll('topics')).toEqual(['events']);
    const status = host.querySelector('[role="status"]');
    expect(status?.textContent?.trim()).toBe(String((defaults['messages'] as Record<string, string>)['pending']));
  });

  it('with JavaScript, shows the backend refusal next to the field it is about and keeps the e-mail', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'email' }), { status: 400 }));
    const host = clientDom();
    type(emailInput(host), 'buyer@example.com');
    act(() => consentInput(host).click());
    await submit(host);
    const email = emailInput(host);
    expect(email.getAttribute('aria-invalid')).toBe('true');
    expect(host.querySelector(`[id="${email.getAttribute('aria-describedby')}"]`)?.textContent?.trim()).toBeTruthy();
    expect(email.value).toBe('buyer@example.com');
  });

  it('shows the pending message from ?newsletter=pending without JavaScript', () => {
    const host = serverDom(PROPS, { path: '/landing', query: { newsletter: 'pending' } });
    const status = host.querySelector('[role="status"]');
    expect(status?.textContent?.trim()).toBe(String((defaults['messages'] as Record<string, string>)['pending']));
  });

  it('shows a consent refusal from the URL next to the consent without JavaScript', () => {
    const host = serverDom(PROPS, { path: '/landing', query: { newsletter: 'error', reason: 'consent' } });
    const consent = consentInput(host);
    expect(consent.getAttribute('aria-invalid')).toBe('true');
    expect(host.querySelector(`[id="${consent.getAttribute('aria-describedby')}"]`)?.textContent?.trim()).toBe(
      String((defaults['messages'] as Record<string, string>)['consent']),
    );
  });

  it('renders the inline layout as a modifier, the boxed one by default', () => {
    expect(serverDom().querySelector('.cmsc-pb-signup--boxed')).not.toBeNull();
    expect(serverDom({ ...PROPS, layout: 'inline' }).querySelector('.cmsc-pb-signup--inline')).not.toBeNull();
  });
});
