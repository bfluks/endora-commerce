import type { ReactNode } from 'react';
import type { BlogResolvedTagRef } from '@endora-commerce/contracts';
import { LocalizedLink } from '../../../lib/i18n/localized-link';

const BLOG_PREFIX = '/blog';

export function TagChipStrip({ tags }: { tags: BlogResolvedTagRef[] }): ReactNode {
  if (tags.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {tags.map((tag) => (
        <LocalizedLink
          key={tag.id}
          href={`${BLOG_PREFIX}/tag/${tag.code}`}
          className="inline-flex items-center rounded-full border border-[--line] bg-[--surface-alt] px-3 py-1 text-xs font-medium text-[--ink-700] transition hover:bg-[--surface]"
        >
          #{tag.name}
        </LocalizedLink>
      ))}
    </div>
  );
}
