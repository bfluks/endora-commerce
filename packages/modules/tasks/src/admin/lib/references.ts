import { useMemo } from 'react';
import type { ReferenceLookups, ReferenceTriggerKind } from '@endora-commerce/admin-kit/components';
import { useAuth } from '@endora-commerce/admin-kit/lib';
import { useAppLanguage } from '@endora-commerce/admin-kit/i18n';
import { tasksApi } from '../api.js';

/** People are chosen through Tasks' own lookup, offered to whoever reads Tasks (`admin-api.md` §3). */
const READ_PERMISSION = 'tasks:read';
/** Documents are chosen through Tasks' own lookup, offered to whoever may write. */
const WRITE_PERMISSION = 'tasks:write';
/** A Product is searched in `catalog`'s own list, offered to a role holding its code. */
const PRODUCT_LIST_PERMISSION = 'catalog:read';

/** A Product's name in the language on screen, then any name it has, then its SKU. */
function productLabel(name: Record<string, string>, sku: string, language: string): string {
  const base = language.split('-')[0] ?? language;
  const sameLanguage = Object.keys(name).find((locale) => locale === base || locale.startsWith(`${base}-`));
  return name[language] || (sameLanguage ? name[sameLanguage] : undefined) || Object.values(name).find(Boolean) || sku;
}

/**
 * What a Task's text may refer to, and where the kit's reference editor finds
 * it (`specs/165-task-management/` FR-005, research R-5; Projects'
 * `lib/references.ts`, the model) — the standard trigger table, `@` a person,
 * `@@` a document, `@@@` a Product: people and the grouped document list
 * through Tasks' own lookups, Products through `catalog`'s list. The `@@` list
 * always has the Tasks group for a writer, so it is offered with `@`.
 *
 * `taskId` is `null` on the create form, before there is a Task.
 */
export function useTaskReferences(taskId: string | null): {
  kinds: readonly ReferenceTriggerKind[];
  lookups: ReferenceLookups;
} {
  const { hasPermission } = useAuth();
  const { language } = useAppLanguage();
  const canRead = hasPermission(READ_PERMISSION);
  const canWrite = hasPermission(WRITE_PERMISSION);
  const canProducts = hasPermission(PRODUCT_LIST_PERMISSION);

  const kinds = useMemo(
    (): readonly ReferenceTriggerKind[] => [
      ...(canRead || canWrite ? (['admin_user'] as const) : []),
      ...(canWrite ? (['document'] as const) : []),
      ...(canProducts ? (['product'] as const) : []),
    ],
    [canRead, canWrite, canProducts],
  );

  const lookups = useMemo(
    (): ReferenceLookups => ({
      searchPeople: async (query) =>
        (await tasksApi.lookupMentionable(taskId, query)).map((person) => ({
          id: person.id,
          label: person.name,
          description: person.email,
        })),
      searchDocuments: (query) => tasksApi.lookupDocuments(query),
      searchProducts: async (query) =>
        (await tasksApi.searchProducts(query)).map((product) => ({
          id: product.id,
          label: productLabel(product.name, product.sku, language),
          description: product.sku,
        })),
    }),
    [taskId, language],
  );

  return { kinds, lookups };
}
