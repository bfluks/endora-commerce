import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * `specs/152-compare-pdf-template/` T041, T047 — the storefront's `PDF` button
 * asks for the PDF in the language the storefront is shown in
 * (`Accept-Language`, FR-032) and with the *Hide empty rows* switch the buyer
 * set on screen (`?hideEmptyRows=`, FR-020).
 */

const { exportComparisonPdf } = await import('../../lib/api/comparisons');

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubDownload(): { fetch: ReturnType<typeof vi.fn> } {
  const fetch = vi.fn(async () =>
    new Response(new Blob(['%PDF-']), {
      status: 200,
      headers: { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="comparison-abc.pdf"' },
    }),
  );
  vi.stubGlobal('fetch', fetch);
  const anchor = { click: vi.fn(), remove: vi.fn(), href: '', download: '' };
  vi.stubGlobal('document', { createElement: () => anchor, body: { appendChild: vi.fn() } });
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => undefined }));
  return { fetch };
}

describe('exportComparisonPdf', () => {
  it('sends the storefront language and the hide-empty-rows switch', async () => {
    const { fetch } = stubDownload();
    await exportComparisonPdf({ locale: 'pl-PL', hideEmptyRows: true, channelCode: 'retail' });
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/v1\/comparisons\/me\/pdf\?hideEmptyRows=true$/);
    expect((init.headers as Record<string, string>)['Accept-Language']).toBe('pl-PL');
    // `specs/154-sales-channel-access/` — a browser call names the store it is made on.
    expect((init.headers as Record<string, string>)['X-Sales-Channel']).toBe('retail');
  });

  it('sends hideEmptyRows=false when the switch is off', async () => {
    const { fetch } = stubDownload();
    await exportComparisonPdf({ locale: 'en-US', hideEmptyRows: false, channelCode: undefined });
    expect((fetch.mock.calls[0] as [string])[0]).toMatch(/\?hideEmptyRows=false$/);
  });
});
