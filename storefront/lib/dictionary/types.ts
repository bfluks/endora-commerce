import type {
  DictionaryByCodeResponse,
  DictionaryRegistryResponse,
} from '@endora-commerce/contracts';

export type DictionaryRegistry = DictionaryRegistryResponse['data'];
export type DictionaryByCode = DictionaryByCodeResponse['data'];
