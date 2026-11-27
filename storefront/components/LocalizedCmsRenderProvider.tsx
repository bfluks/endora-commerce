'use client';

import type { ComponentProps } from 'react';
import { CmsRenderProvider } from '@endora-commerce/cms-components/components/render-context';
import { useLocalizedPath } from '../lib/i18n/localized-link';

/**
 * `CmsRenderProvider` with the page language's path localizer (feature 167,
 * `specs/167-storefront-locale-path/`, FR-020): every internal link an operator
 * authored in a Page Builder block — a page, a product, a category, a root-relative
 * URL — renders under the current prefix. A client component because a function
 * cannot be handed from the server render to the (client) render context.
 */
export function LocalizedCmsRenderProvider(props: Omit<ComponentProps<typeof CmsRenderProvider>, 'localizePath'>) {
  const localize = useLocalizedPath();
  return <CmsRenderProvider {...props} localizePath={(path: string) => localize(path)} />;
}
