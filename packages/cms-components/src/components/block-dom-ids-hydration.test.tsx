// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { Render, type Config, type Data } from '@puckeditor/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultPageBuilderConfig } from '../index.js';
import { CmsRenderProvider } from './render-context.js';

/**
 * `specs/163-page-builder-marketing-pages/` T149 (R7): the element ids that
 * `cms.Tabs`, `cms.Accordion`, `cms.NewsletterSignup` and `newsletter.Signup`
 * write into their markup (tab and panel ids, `aria-controls`,
 * `aria-labelledby`, a label's `for`) hydrate without a mismatch whatever is
 * rendered above the page — the carousel defect N4 (T141) for these blocks.
 *
 * `useId()` encodes the whole component path from the application root, so a
 * server tree that differs above the page, even without any DOM, gives other
 * ids than the hydrating client. The ids are therefore made from the block's
 * own id; `useId()` is the fallback for a block rendered without one.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.hoisted(() => {
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
});

beforeEach(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
});

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  vi.unstubAllGlobals();
});

const config = defaultPageBuilderConfig as Config;
const defaultsOf = (type: string) => (config.components[type]?.defaultProps ?? {}) as Record<string, unknown>;

type BlockType = 'cms.Tabs' | 'cms.Accordion' | 'cms.NewsletterSignup' | 'newsletter.Signup';

const BLOCK_ID: Record<BlockType, string> = {
  'cms.Tabs': 'cms.Tabs-1',
  'cms.Accordion': 'cms.Accordion-1',
  'cms.NewsletterSignup': 'cms.NewsletterSignup-1',
  'newsletter.Signup': 'newsletter.Signup-1',
};

function props(type: BlockType, id: string | undefined): Record<string, unknown> {
  const extra: Record<string, unknown> =
    type === 'cms.NewsletterSignup' ? { showConsent: true, actionUrl: 'https://example.com/subscribe' } : {};
  return { ...defaultsOf(type), ...extra, ...(id ? { id } : {}) };
}

function tree(content: Data['content'], serverShape: boolean): ReactNode {
  const rendered = (
    <CmsRenderProvider embeds={{ blocks: {}, templates: {} }} mediaBaseUrl="https://api.example.com">
      <Render config={config} data={{ root: { props: {} }, content }} />
    </CmsRenderProvider>
  );
  // The same DOM, one list level deeper on the server: what an ancestor rendered differently does.
  return serverShape ? [null, <div key="page">{rendered}</div>] : <div>{rendered}</div>;
}

async function hydrate(content: Data['content']): Promise<{ errors: string[]; html: string }> {
  const html = renderToString(tree(content, true));
  host = document.createElement('div');
  host.innerHTML = html;
  document.body.appendChild(host);
  const errors: string[] = [];
  const consoleError = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(' '));
  });
  try {
    await act(async () => {
      root = hydrateRoot(host!, tree(content, false), {
        onRecoverableError: (error) => {
          errors.push(String(error));
        },
      });
    });
  } finally {
    consoleError.mockRestore();
  }
  return { errors, html };
}

/** Every id the block's markup refers to: `aria-controls`, `aria-labelledby`, `aria-describedby`, `for`. */
function references(element: HTMLElement): string[] {
  const out: string[] = [];
  for (const node of Array.from(element.querySelectorAll('[aria-controls], [aria-labelledby], label[for]'))) {
    for (const name of ['aria-controls', 'aria-labelledby', 'for']) {
      const value = node.getAttribute(name);
      if (value) out.push(...value.split(/\s+/));
    }
  }
  return out;
}

const TYPES: readonly BlockType[] = ['cms.Tabs', 'cms.Accordion', 'cms.NewsletterSignup', 'newsletter.Signup'];

describe('block element ids hydrate whatever is rendered above the page (T149)', () => {
  it.each(TYPES)('%s: no hydration mismatch', async (type) => {
    const { errors, html } = await hydrate([{ type, props: props(type, BLOCK_ID[type]) }] as Data['content']);
    expect(html).toMatch(/id="/);
    expect(errors.filter((message) => /hydrat|didn't match/i.test(message))).toEqual([]);
  });

  it.each(TYPES)('%s: the ids come from the block id, and every reference resolves', async (type) => {
    await hydrate([{ type, props: props(type, BLOCK_ID[type]) }] as Data['content']);
    const refs = references(host!);
    expect(refs.length).toBeGreaterThan(0);
    const safe = BLOCK_ID[type].replace(/[^A-Za-z0-9_-]/g, '');
    for (const ref of refs) {
      expect(ref).toContain(safe);
      expect(host!.querySelector(`[id="${ref}"]`), ref).not.toBeNull();
    }
  });

  it.each(TYPES)('%s: two blocks on one page keep distinct ids', async (type) => {
    await hydrate([
      { type, props: props(type, `${BLOCK_ID[type]}a`) },
      { type, props: props(type, `${BLOCK_ID[type]}b`) },
    ] as Data['content']);
    const ids = Array.from(host!.querySelectorAll('[id]')).map((node) => node.id);
    expect(ids.length).toBeGreaterThan(1);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(TYPES)('%s: without a block id, useId() still gives resolvable ids', (type) => {
    host = document.createElement('div');
    host.innerHTML = renderToString(tree([{ type, props: props(type, undefined) }] as Data['content'], false));
    const refs = references(host);
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) expect(host.querySelector(`[id="${ref}"]`), ref).not.toBeNull();
  });
});
