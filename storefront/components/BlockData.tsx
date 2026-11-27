import type { ReactNode } from 'react';
import { CatalogPreviewProvider } from '@endora-commerce/cms-components/components/catalog-preview-context';
import type { RequestContext } from '../lib/api/client';
import type { ModulePresenceSet } from '../lib/api/module-presence';
import { resolveBlockDataFor } from '../lib/page-builder/block-data';

/**
 * Resolves the fetched data — products, categories, blog posts — of the Page
 * Builder documents rendered below it and hands it to their blocks — a Server
 * Component, so the read happens while the page renders and the content is in
 * the HTML.
 *
 * `documents` is every tree `children` will render, embeds included: a block
 * reads its answer from the nearest provider, and one whose document was not
 * listed finds none and renders its empty state. `ctx` is the request's own
 * context and is required, because it is what makes the answer this viewer's:
 * see `lib/page-builder/block-data.ts`. `modules`, the request's module presence,
 * skips the reads of a module that is off.
 */
export async function BlockData({
  documents,
  ctx,
  modules,
  children,
}: {
  documents: readonly unknown[];
  ctx: RequestContext;
  modules?: ModulePresenceSet;
  children: ReactNode;
}): Promise<ReactNode> {
  const data = await resolveBlockDataFor(documents, ctx, modules);
  return <CatalogPreviewProvider data={data}>{children}</CatalogPreviewProvider>;
}
