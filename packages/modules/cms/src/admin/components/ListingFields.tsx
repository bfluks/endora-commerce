'use client';

import type { ComponentConfig } from '@puckeditor/core';
import { createBlogCategorySlugField, createButtonSpecField } from '@endora-commerce/page-builder-admin';

/**
 * Feature 163, T069–T072 — the admin's fields of the dynamic listings
 * (`specs/163-page-builder-marketing-pages/` contracts/blocks.md, research
 * R-9, R-15, R-16): the header button of `catalog.ProductGrid`,
 * `catalog.ProductSlider` and `blog.LatestPosts`, the product listings' footer
 * button and each `cms.LinkList` row button get the button fields with their
 * link pickers (page, product, category, file, anchor, URL).
 *
 * Every other field — and the order of the fields — is the block's own. The
 * product pickers of the two listings are applied by `PageBuilderEditor`.
 */

// Stable: a field recreated on every merge loses its input focus.
const HEADER_BUTTON_FIELD = createButtonSpecField({ label: 'Button', responsive: true });
const FOOTER_BUTTON_FIELD = createButtonSpecField({ label: 'Button below the products', responsive: true });
const ROW_BUTTON_FIELD = createButtonSpecField({ label: 'Button', responsive: true });
// R17 (T220): the post listing's category from the blog's categories, by slug as before.
const BLOG_CATEGORY_FIELD = createBlogCategorySlugField('Category (optional)');

type FieldMap = Record<string, unknown>;
type Composite = { type?: string; objectFields?: FieldMap; arrayFields?: FieldMap };

/** `fields` with each named field replaced, where the block has it. */
function swap(fields: FieldMap, replacements: FieldMap): FieldMap {
  const next = { ...fields };
  for (const [key, field] of Object.entries(replacements)) if (key in next) next[key] = field;
  return next;
}

function withHeaderButton(fields: FieldMap): FieldMap {
  const header = fields['header'] as Composite | undefined;
  if (header?.type !== 'object' || !header.objectFields) return fields;
  return swap(fields, { header: { ...header, objectFields: swap(header.objectFields, { button: HEADER_BUTTON_FIELD }) } });
}

const SWAPS: Record<string, (fields: FieldMap) => FieldMap> = {
  'catalog.ProductGrid': (fields) => swap(withHeaderButton(fields), { footerButton: FOOTER_BUTTON_FIELD }),
  'catalog.ProductSlider': (fields) => swap(withHeaderButton(fields), { footerButton: FOOTER_BUTTON_FIELD }),
  'blog.LatestPosts': (fields) => swap(withHeaderButton(fields), { categorySlug: BLOG_CATEGORY_FIELD }),
  'cms.LinkList': (fields) => {
    const items = fields['items'] as Composite | undefined;
    if (items?.type !== 'array' || !items.arrayFields) return fields;
    return swap(fields, { items: { ...items, arrayFields: swap(items.arrayFields, { button: ROW_BUTTON_FIELD }) } });
  },
};

/** The listing blocks this module gives link pickers to. */
export const LISTING_BLOCKS_WITH_ADMIN_FIELDS: readonly string[] = Object.keys(SWAPS);

/** `config` with the admin's pickers, when `name` is one of {@link LISTING_BLOCKS_WITH_ADMIN_FIELDS}; any other block as it is. */
export function withAdminListingFields(name: string, config: ComponentConfig): ComponentConfig {
  const apply = SWAPS[name];
  if (!apply) return config;
  return { ...config, fields: apply({ ...(config.fields ?? {}) }) } as ComponentConfig;
}
