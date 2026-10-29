import Link from 'next/link';
import type { ReactNode } from 'react';
import { JsonLd } from '../lib/seo/JsonLd';
import { absoluteUrl } from '../lib/seo/site-url';

export interface BreadcrumbCrumb {
  /**
   * The crumb's path, or `null` for a crumb with nowhere to go — a CMS page's
   * ancestor that the visiting channel does not serve (feature 163, FR-030a).
   * Such a crumb renders as text and carries no JSON-LD `item`.
   */
  href: string | null;
  label: string;
}

/**
 * The colour scheme the trail sits on (feature 163, FR-031). `light`, the
 * default, keeps the trail's own colours; on `muted` and `dark` the trail reads
 * the scheme's variables, which the surrounding `data-cmsb-scheme` binds.
 */
export type BreadcrumbsScheme = 'light' | 'muted' | 'dark';

const TRAIL_CLASS = 'm-0 mb-[16px] flex list-none flex-wrap gap-[6px] p-0 text-[12px]';
const CRUMB_CLASS = "before:mr-[6px] before:text-line-strong before:content-['›'] first:before:hidden";
const SCHEME_CRUMB_CLASS =
  "before:mr-[6px] before:text-[color:var(--cmsb-border,#d9e0e7)] before:content-['›'] first:before:hidden";

/**
 * Renders the navigation trail with `BreadcrumbList` JSON-LD so crawlers
 * pick the structured data up directly (Principle VII / FR-103).
 *
 * The JSON-LD `item` is absolute (`siteUrl()`), as schema.org's `ListItem`
 * expects; the visible links stay paths, like every other link here.
 */
export function Breadcrumbs(props: { crumbs: BreadcrumbCrumb[]; scheme?: BreadcrumbsScheme }): ReactNode {
  if (props.crumbs.length === 0) return null;
  const painted = props.scheme !== undefined && props.scheme !== 'light';
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: props.crumbs.map((c, idx) => ({
      '@type': 'ListItem',
      position: idx + 1,
      name: c.label,
      ...(c.href !== null ? { item: absoluteUrl(c.href) } : {}),
    })),
  };
  return (
    <nav aria-label="Breadcrumb">
      {/*
        Migrated to utilities (was .b2b-breadcrumbs). Spacing/size use arbitrary px to
        preserve exact parity — the storefront root font-size is 14px, so Tailwind's
        rem-based scales would not equal the original absolute px. Colours use semantic
        tokens. The '›' separator is a before: pseudo-element on every li except the first.
      */}
      <ol
        className={
          painted
            ? `${TRAIL_CLASS} text-[color:var(--cmsb-fg-muted,#64748b)] [&_a]:text-[color:var(--cmsb-link,#1261a6)]`
            : `${TRAIL_CLASS} text-muted`
        }
      >
        {props.crumbs.map((c, idx) => (
          <li
            key={`${idx}:${c.href ?? ''}`}
            className={painted ? SCHEME_CRUMB_CLASS : CRUMB_CLASS}
          >
            {idx === props.crumbs.length - 1 ? (
              <span aria-current="page">{c.label}</span>
            ) : c.href !== null ? (
              <Link href={c.href}>{c.label}</Link>
            ) : (
              <span>{c.label}</span>
            )}
          </li>
        ))}
      </ol>
      <JsonLd data={jsonLd} />
    </nav>
  );
}
