import {
  dictionaryByCodeResponseSchema,
  dictionaryRegistryResponseSchema,
  type DictionaryByCodeResponse,
  type DictionaryEntryType,
  type DictionaryRegistryResponse,
} from '@endora-commerce/contracts';
import { apiGet, type RequestContext } from '../api/client';
import type { DictionaryByCode, DictionaryRegistry } from './types';

export type { DictionaryByCode, DictionaryRegistry } from './types';

export interface FetchDictionaryArgs {
  locale?: string;
  channel?: string;
  ctx?: RequestContext;
}

export interface FetchByCodeArgs {
  type: DictionaryEntryType;
  code: string;
  locale?: string;
  ctx?: RequestContext;
}

export async function fetchDictionary(args: FetchDictionaryArgs = {}): Promise<DictionaryRegistry> {
  const params = new URLSearchParams();
  const locale = args.locale ?? args.ctx?.locale;
  const channel = args.channel ?? args.ctx?.salesChannelCode;
  if (locale) params.set('locale', locale);
  if (channel) params.set('channel', channel);
  const qs = params.toString();
  const response = await apiGet<DictionaryRegistryResponse>(
    `/api/v1/dictionary${qs ? `?${qs}` : ''}`,
    args.ctx,
    { revalidate: 60, tags: ['dictionary:registry'] },
  );
  return dictionaryRegistryResponseSchema.parse(response).data;
}

export async function fetchByCode(args: FetchByCodeArgs): Promise<DictionaryByCode> {
  const params = new URLSearchParams();
  params.set('type', args.type);
  params.set('code', args.code);
  const locale = args.locale ?? args.ctx?.locale;
  if (locale) params.set('locale', locale);
  const response = await apiGet<DictionaryByCodeResponse>(
    `/api/v1/dictionary/by-code?${params.toString()}`,
    args.ctx,
    { revalidate: 60, tags: [`dictionary:${args.type}:${args.code}`] },
  );
  return dictionaryByCodeResponseSchema.parse(response).data;
}
