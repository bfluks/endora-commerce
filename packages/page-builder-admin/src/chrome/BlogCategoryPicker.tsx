'use client';

import { useEffect, useState, type ReactElement } from 'react';
import { FieldLabel, type CustomField } from '@puckeditor/core';
import { PB_DATA_METADATA, PB_FIELD_INPUT_CLASS } from '@endora-commerce/page-builder-core';
import { apiClient } from '@endora-commerce/admin-kit/lib';
import { useTranslation, useTranslationContext } from '@endora-commerce/admin-kit/i18n';

/**
 * `specs/163-page-builder-marketing-pages/` R17 (T220) — the blog category of
 * `blog.LatestPosts`, picked from the blog's categories rather than typed as a
 * slug. It stores the slug it always stored (empty: every category).
 *
 * The list is the blog's own admin tree (`GET /api/v1/admin/blog/categories`),
 * as the catalog pickers read the catalog's; while it loads, when the request
 * fails (the blog switched off, no permission) or for a stored slug the tree
 * does not hold, the control keeps the slug: a free text box, or the stored
 * slug kept among the options, so nothing is lost by opening the block.
 */

interface BlogCategoryNode {
  slug: string;
  name: Record<string, string> | string;
  children?: BlogCategoryNode[];
}

const inputClassName = PB_FIELD_INPUT_CLASS;

function nameIn(name: Record<string, string> | string, language: string, fallback: string): string {
  if (typeof name === 'string') return name || fallback;
  const short = language.slice(0, 2);
  const match = Object.keys(name).find((key) => key === language || key.slice(0, 2) === short);
  return (match ? name[match] : undefined) ?? name['en-US'] ?? Object.values(name)[0] ?? fallback;
}

/** The tree as options, children indented under their parent. */
export function flattenBlogCategories(tree: readonly BlogCategoryNode[], language: string): { slug: string; label: string }[] {
  const walk = (nodes: readonly BlogCategoryNode[], level: number): { slug: string; label: string }[] =>
    nodes.flatMap((node) => [
      { slug: node.slug, label: `${level > 0 ? `${'—'.repeat(level)} ` : ''}${nameIn(node.name, language, node.slug)}` },
      ...walk(node.children ?? [], level + 1),
    ]);
  return walk(tree, 0);
}

type Loaded = { state: 'loading' } | { state: 'ready'; options: { slug: string; label: string }[] } | { state: 'failed' };

function useBlogCategories(language: string): Loaded {
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });
  useEffect(() => {
    let cancelled = false;
    void apiClient
      .get<{ tree?: BlogCategoryNode[] }>('/api/v1/admin/blog/categories')
      .then((response) => {
        if (!cancelled) setLoaded({ state: 'ready', options: flattenBlogCategories(response?.tree ?? [], language) });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ state: 'failed' });
      });
    return (): void => {
      cancelled = true;
    };
  }, [language]);
  return loaded;
}

export function BlogCategoryFieldControl({
  value,
  onChange,
  readOnly,
  label,
}: {
  value: string | undefined;
  onChange: (slug: string) => void;
  readOnly?: boolean | undefined;
  label: string;
}): ReactElement {
  const t = useTranslation('core');
  const { language } = useTranslationContext();
  const loaded = useBlogCategories(language);
  const slug = value ?? '';

  if (loaded.state !== 'ready') {
    return (
      <FieldLabel label={label} {...(readOnly === true ? { readOnly: true } : {})}>
        <input
          type="text"
          className={inputClassName}
          readOnly={readOnly === true}
          value={slug}
          placeholder={t('pageBuilder.blogCategory.slugPlaceholder')}
          onChange={(event): void => onChange(event.target.value)}
        />
      </FieldLabel>
    );
  }

  const known = loaded.options.some((option) => option.slug === slug);
  return (
    <FieldLabel label={label} {...(readOnly === true ? { readOnly: true } : {})}>
      <select
        className={inputClassName}
        disabled={readOnly === true}
        value={slug}
        onChange={(event): void => onChange(event.target.value)}
      >
        <option value="">{t('pageBuilder.blogCategory.all')}</option>
        {slug !== '' && !known ? <option value={slug}>{slug}</option> : null}
        {loaded.options.map((option) => (
          <option key={option.slug} value={option.slug}>
            {option.label}
          </option>
        ))}
      </select>
    </FieldLabel>
  );
}

/** The blog category of a post listing, by slug (R17, T220); on the Data tab. */
export function createBlogCategorySlugField(label = 'Category (optional)'): CustomField<string | undefined> {
  return {
    type: 'custom',
    label,
    metadata: PB_DATA_METADATA,
    render: ({ value, onChange, readOnly, field }): ReactElement => (
      <BlogCategoryFieldControl
        value={value}
        onChange={onChange}
        readOnly={readOnly}
        label={field.label ?? label}
      />
    ),
  };
}
