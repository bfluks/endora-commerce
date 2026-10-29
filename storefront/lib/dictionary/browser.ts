import {
  dictionaryByCodeResponseSchema,
  dictionaryRegistryResponseSchema,
  type DictionaryEntryType,
} from '@endora-commerce/contracts';
import { channelHeaders } from '../channel/channel-header';
import { publicApiBaseUrl } from '../env.mjs';
import type { DictionaryByCode, DictionaryRegistry } from './types';

/**
 * The dictionary read from the browser, by `DictionaryProvider`.
 *
 * Kept apart from `./client.ts`, which reads through the server transport
 * (`lib/api/client.ts`, which reads the request's headers): a client
 * component must not pull that into the browser bundle. The active sales
 * channel is passed in explicitly — the provider has it from the layout — and
 * sent as `X-Sales-Channel` (`specs/154-sales-channel-access/`).
 */

const browserBaseUrl = process.env['NEXT_PUBLIC_BACKEND_BASE_URL'] ?? publicApiBaseUrl();

export async function fetchDictionaryFromBrowser(args: {
  locale?: string;
  channel?: string;
}): Promise<DictionaryRegistry> {
  const params = new URLSearchParams();
  if (args.locale) params.set('locale', args.locale);
  if (args.channel) params.set('channel', args.channel);
  const qs = params.toString();
  const response = await fetch(`${browserBaseUrl}/api/v1/dictionary${qs ? `?${qs}` : ''}`, {
    headers: { Accept: 'application/json', ...channelHeaders(args.channel) },
    credentials: 'include',
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json?.error?.message ?? `HTTP ${response.status}`);
  return dictionaryRegistryResponseSchema.parse(json).data;
}

export async function fetchByCodeFromBrowser(args: {
  type: DictionaryEntryType;
  code: string;
  locale?: string;
  /** The storefront's active sales channel, sent as `X-Sales-Channel`. */
  channel?: string;
}): Promise<DictionaryByCode> {
  const params = new URLSearchParams();
  params.set('type', args.type);
  params.set('code', args.code);
  if (args.locale) params.set('locale', args.locale);
  const response = await fetch(`${browserBaseUrl}/api/v1/dictionary/by-code?${params.toString()}`, {
    headers: { Accept: 'application/json', ...channelHeaders(args.channel) },
    credentials: 'include',
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json?.error?.message ?? `HTTP ${response.status}`);
  return dictionaryByCodeResponseSchema.parse(json).data;
}

