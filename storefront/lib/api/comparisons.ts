'use client';

import type {
  ComparisonOwnerView,
  ComparisonSharedView,
  ComparisonDisplayMode,
} from '@endora-commerce/contracts';
import { publicApiBaseUrl } from '../env.mjs';
import { channelHeaders } from '../channel/channel-header';

/**
 * Client-side fetch helpers for the comparisons backend module
 * (feature 007 / T029). All functions run in the browser; cookies
 * (notably `compare_token`) are threaded automatically via
 * `credentials: 'include'`.
 *
 * The dev setup either shares a domain (reverse proxy) or accepts
 * cross-origin credentials — same setup the cart and account flows
 * already rely on.
 *
 * Every function takes the storefront's active sales-channel code and sends
 * it as `X-Sales-Channel` (`specs/154-sales-channel-access/`): a call from
 * the browser has no request the middleware stamped, so the component passes
 * the code the layout gave it.
 */

const apiBase = publicApiBaseUrl();

export class ComparisonApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ComparisonApiError';
  }
}

interface ErrorEnvelope {
  error: { code: string; message: string };
}

async function call<T>(
  channelCode: string | undefined,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T | null> {
  const res = await rawFetch(channelCode, method, path, body);
  if (res.status === 204) return null;
  await throwOnError(res);
  const json = (await res.json()) as { data: T };
  return json.data;
}

async function rawFetch(
  channelCode: string | undefined,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  extraHeaders: Readonly<Record<string, string>> = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...channelHeaders(channelCode),
    ...extraHeaders,
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return fetch(`${apiBase}${path}`, {
    method,
    credentials: 'include',
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

async function throwOnError(res: Response): Promise<void> {
  if (res.ok) return;
  let envelope: ErrorEnvelope | undefined;
  try {
    envelope = (await res.json()) as ErrorEnvelope;
  } catch {
    // Non-JSON error — fall through.
  }
  throw new ComparisonApiError(
    res.status,
    envelope?.error.code ?? 'UNKNOWN',
    envelope?.error.message ?? `HTTP ${res.status}`,
  );
}

export async function getMyComparison(
  channelCode: string | undefined,
): Promise<ComparisonOwnerView | null> {
  return call<ComparisonOwnerView>(channelCode, 'GET', '/api/v1/comparisons/me');
}

export async function addProductToCompare(
  productId: string,
  channelCode: string | undefined,
): Promise<ComparisonOwnerView> {
  const view = await call<ComparisonOwnerView>(
    channelCode,
    'POST',
    '/api/v1/comparisons/me/products',
    { productId },
  );
  if (!view) throw new Error('expected ComparisonOwnerView');
  return view;
}

export async function removeProductFromCompare(
  productId: string,
  channelCode: string | undefined,
): Promise<ComparisonOwnerView> {
  const view = await call<ComparisonOwnerView>(
    channelCode,
    'DELETE',
    `/api/v1/comparisons/me/products/${encodeURIComponent(productId)}`,
  );
  if (!view) throw new Error('expected ComparisonOwnerView');
  return view;
}

export async function setComparisonDisplayMode(
  mode: ComparisonDisplayMode,
  channelCode: string | undefined,
): Promise<ComparisonOwnerView> {
  const view = await call<ComparisonOwnerView>(channelCode, 'PATCH', '/api/v1/comparisons/me', {
    displayMode: mode,
  });
  if (!view) throw new Error('expected ComparisonOwnerView');
  return view;
}

export async function deleteMyComparison(channelCode: string | undefined): Promise<void> {
  await call(channelCode, 'DELETE', '/api/v1/comparisons/me');
}

/**
 * US4 — Owner-only PDF export. Triggers the browser's download flow by
 * synthesising an `<a download>` click on a same-origin Blob URL. The
 * resulting filename is whatever the backend's Content-Disposition
 * header declared (`comparison-{shortToken}.pdf`).
 */
export async function exportComparisonPdf(options: {
  /** The language the storefront is shown in — the PDF is printed in it (`specs/152-compare-pdf-template/` FR-032). */
  readonly locale: string;
  /** The *Hide empty rows* switch, so the PDF shows the rows the screen shows (FR-020). */
  readonly hideEmptyRows: boolean;
  /** The storefront's active sales channel. */
  readonly channelCode: string | undefined;
}): Promise<void> {
  const res = await rawFetch(
    options.channelCode,
    'GET',
    `/api/v1/comparisons/me/pdf?hideEmptyRows=${options.hideEmptyRows ? 'true' : 'false'}`,
    undefined,
    { 'Accept-Language': options.locale },
  );
  if (!res.ok) {
    await throwOnError(res);
    return;
  }
  const blob = await res.blob();
  const filename = parseDispositionFilename(res.headers.get('content-disposition')) ??
    'comparison.pdf';
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

function parseDispositionFilename(value: string | null): string | null {
  if (!value) return null;
  const match = /filename="([^"]+)"/.exec(value);
  return match ? match[1] ?? null : null;
}

/**
 * US2 — recipient view by share token. Returns the comparison plus a
 * `viewerIsOwner` flag the storefront uses to decide whether to render
 * owner-only affordances. Returns `null` on 404 (deleted comparison or
 * never existed) so the page can render the "no longer exists" state.
 */
export async function getSharedComparison(
  token: string,
  channelCode: string | undefined,
): Promise<{ data: ComparisonSharedView; viewerIsOwner: boolean } | null> {
  const res = await rawFetch(
    channelCode,
    'GET',
    `/api/v1/comparisons/share/${encodeURIComponent(token)}`,
  );
  if (res.status === 404) return null;
  await throwOnError(res);
  const json = (await res.json()) as {
    data: ComparisonSharedView;
    meta: { viewerIsOwner: boolean };
  };
  return { data: json.data, viewerIsOwner: json.meta.viewerIsOwner };
}
