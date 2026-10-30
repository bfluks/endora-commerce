import { afterEach, describe, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import { render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEFAULT_BRAND_TOKENS, type CmsBrandTokens } from '@endora-commerce/contracts';
import { apiClient } from '@endora-commerce/admin-kit/lib';
import {
  PreviewBrandTokens,
  PreviewBrandTokensProvider,
} from '../../../../packages/modules/cms/src/admin/components/PreviewBrandTokens';
import { cmsClient } from '../../../../packages/modules/cms/src/admin/api/cms-client';

/**
 * Feature 163, T027 — the page-builder preview is styled with the same brand
 * tokens as the storefront (`specs/163-page-builder-marketing-pages/` research
 * R-4, FR-038).
 *
 * Puck renders the canvas into an iframe, which jsdom does not paint, so the
 * injection is asserted on the component `overrides.iframe` mounts, against a
 * separate document standing in for the iframe's; the wiring that reaches it
 * (the override, the page's first channel) is asserted on the source, in the
 * idiom of `block-degradation.test.tsx`.
 */

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  };
});

afterEach(() => {
  vi.mocked(apiClient.get).mockReset();
});

function tokensWithPrimary(primary: string): CmsBrandTokens {
  return { ...DEFAULT_BRAND_TOKENS, colors: { ...DEFAULT_BRAND_TOKENS.colors, primary } };
}

function frameDocument(): Document {
  return document.implementation.createHTMLDocument('preview');
}

function brandStyleOf(doc: Document): string | null {
  return doc.head.querySelector('style#cmsb')?.textContent ?? null;
}

describe('PreviewBrandTokens', () => {
  it('injects <style id="cmsb"> with the descriptor\'s primary colour into the iframe document', () => {
    const frame = frameDocument();
    const view = render(
      <StrictMode>
        <PreviewBrandTokens document={frame} tokens={tokensWithPrimary('#1d4ed8')}>
          <p>canvas</p>
        </PreviewBrandTokens>
      </StrictMode>,
    );
    expect(view.getByText('canvas')).toBeTruthy();
    expect(frame.head.querySelectorAll('style#cmsb')).toHaveLength(1);
    expect(brandStyleOf(frame)).toContain('--cmsb-color-primary:#1d4ed8;');
    // Never into the admin's own document.
    expect(document.head.querySelector('style#cmsb')).toBeNull();
  });

  it('updates the tag when the descriptor changes, and removes it when there are no tokens', () => {
    const frame = frameDocument();
    const view = render(
      <PreviewBrandTokens document={frame} tokens={tokensWithPrimary('#1d4ed8')}>
        <p>canvas</p>
      </PreviewBrandTokens>,
    );
    view.rerender(
      <PreviewBrandTokens document={frame} tokens={tokensWithPrimary('#b91c1c')}>
        <p>canvas</p>
      </PreviewBrandTokens>,
    );
    expect(frame.head.querySelectorAll('style#cmsb')).toHaveLength(1);
    expect(brandStyleOf(frame)).toContain('--cmsb-color-primary:#b91c1c;');

    view.rerender(
      <PreviewBrandTokens document={frame} tokens={null}>
        <p>canvas</p>
      </PreviewBrandTokens>,
    );
    expect(brandStyleOf(frame)).toBeNull();
  });

  it('reads the tokens from the provider around <Puck> when none are passed', () => {
    const frame = frameDocument();
    render(
      <PreviewBrandTokensProvider tokens={tokensWithPrimary('#1d4ed8')}>
        <PreviewBrandTokens document={frame}>
          <p>canvas</p>
        </PreviewBrandTokens>
      </PreviewBrandTokensProvider>,
    );
    expect(brandStyleOf(frame)).toContain('--cmsb-color-primary:#1d4ed8;');
  });

  it('adds the font links to the iframe head and replaces them on change', () => {
    const frame = frameDocument();
    const withSheet: CmsBrandTokens = {
      ...DEFAULT_BRAND_TOKENS,
      fonts: {
        heading: { kind: 'stylesheet', family: 'Acme Serif', generic: 'serif', url: 'https://fonts.example.com/a.css' },
        body: DEFAULT_BRAND_TOKENS.fonts.body,
      },
    };
    const view = render(
      <PreviewBrandTokens document={frame} tokens={withSheet}>
        <p>canvas</p>
      </PreviewBrandTokens>,
    );
    const links = (): string[] =>
      Array.from(frame.head.querySelectorAll('link[data-cmsb-font]')).map((link) => link.getAttribute('href') ?? '');
    expect(links()).toEqual(['https://fonts.example.com/a.css']);

    view.rerender(
      <PreviewBrandTokens document={frame} tokens={DEFAULT_BRAND_TOKENS}>
        <p>canvas</p>
      </PreviewBrandTokens>,
    );
    expect(links()).toEqual([]);
  });
});

describe('the descriptor is requested for the page\'s first sales channel', () => {
  it('cmsClient.getPageBuilderConfig passes ?salesChannelId= when given one', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: { components: [] } });
    await cmsClient.getPageBuilderConfig('3f2a8b9c-1d4e-4f5a-8b6c-7d8e9f0a1b2c');
    await cmsClient.getPageBuilderConfig(null);
    expect(vi.mocked(apiClient.get).mock.calls.map((call) => call[0])).toEqual([
      '/api/v1/admin/cms/page-builder/config?salesChannelId=3f2a8b9c-1d4e-4f5a-8b6c-7d8e9f0a1b2c',
      '/api/v1/admin/cms/page-builder/config',
    ]);
  });

  it('PageBuilderEditor wires the iframe override and the channel; PageEditor passes its first channel', () => {
    const root = resolve(process.cwd(), '../packages/modules/cms/src/admin');
    const editor = readFileSync(resolve(root, 'components/PageBuilderEditor.tsx'), 'utf8');
    expect(editor).toMatch(/iframe:\s*\(\{[^}]*document[^}]*\}[^)]*\)[^=]*=>\s*\(?\s*<PreviewBrandTokens/);
    expect(editor).toMatch(/getPageBuilderConfig\(salesChannelId\)/);
    expect(editor).toMatch(/<PreviewBrandTokensProvider tokens=\{descriptor\?\.brandTokens \?\? null\}>/);
    const pageEditor = readFileSync(resolve(root, 'editors/PageEditor.tsx'), 'utf8');
    expect(pageEditor).toMatch(/salesChannelId=\{scope\.salesChannelIds\[0\] \?\? null\}/);
  });
});
