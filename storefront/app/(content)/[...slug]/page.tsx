import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { notFound, permanentRedirect } from 'next/navigation';
import type { CmsResolvedPage } from '@endora-commerce/contracts';
import { Breadcrumbs, type BreadcrumbCrumb } from '../../../components/Breadcrumbs';
import { CmsPageRenderer } from '../../../components/CmsPageRenderer';
import { OrganizationJsonLd } from '../../../components/seo/OrganizationJsonLd';
import { getCmsPageBySlug, normalizeCmsUrlPath } from '../../../lib/api/cms';
import { getHomepageConfig } from '../../../lib/api/homepage';
import { tForLocale } from '../../../lib/i18n/messages';
import { getServerContext } from '../../../lib/server-context';
import { cmsSocialMetadata } from '../../../lib/seo/cms-share-metadata';
import { canonicalPath } from '../../../lib/seo/route-seo';
import { cmsRenderLocation, type PageSearchParams } from '../../../lib/page-builder/render-location';
import { seo } from './seo';

interface PageProps {
  params: Promise<{ slug: string[] }>;
  searchParams?: Promise<PageSearchParams>;
}

/**
 * A CMS page, at the one address it has
 * (`specs/105-cms-root-page-urls/contracts/cms-page-url.md` §1).
 *
 * The row is resolved through `GET /api/v1/cms/pages/by-slug`, carrying the
 * request's language, so the backend narrows the served language against the
 * page's own and the channel's default and returns exactly one (§3.1 — case 1
 * of `specs/094-translation-boundary/`, where the reader's language is
 * resolvable at the moment the response is composed).
 *
 * There is no second CMS route type and no second renderer: `/cms/{path}` is a
 * permanent redirect configured in `next.config.js`, and the page-builder tree
 * is rendered by `CmsPageRenderer` here exactly as it is on the home page.
 */

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const path = normalizeCmsUrlPath(slug.join('/'));
  const { ctx } = await getServerContext();
  const page = await getCmsPageBySlug(path, ctx);
  if (!page) return { title: 'Not found', robots: { index: false, follow: false } };
  const canonical = canonicalPath(seo.route, { slug });
  // Feature 163 (FR-033, FR-034): the sharing card — image, locale and its
  // alternates. No `alternates.languages`: there are no per-language URLs.
  const social = cmsSocialMetadata(page, canonical);
  return {
    title: social.title,
    description: page.meta.description ?? undefined,
    keywords: page.meta.keywords ?? undefined,
    // Indexable (FR-010/FR-012).
    alternates: { canonical },
    openGraph: social.openGraph,
    twitter: social.twitter,
  };
}

export default async function CmsContentPage({ params, searchParams }: PageProps): Promise<ReactNode> {
  const { slug } = await params;
  const query = (await searchParams) ?? {};
  const path = normalizeCmsUrlPath(slug.join('/'));
  const { ctx, locale, modules } = await getServerContext();
  const t = tForLocale(locale);
  const [page, { cmsPageSlug }] = await Promise.all([
    getCmsPageBySlug(path, ctx),
    getHomepageConfig(ctx),
  ]);
  if (!page) notFound();

  // The page an operator selected as the home page is served at `/` and
  // nowhere else (contract §1.3): the row does not gain a second address, it
  // changes which one it has. Answered in the page component rather than in
  // `generateMetadata` (§2.2) — a redirect here discards the metadata result,
  // so there is one place and nothing to keep in sync. It is asked *after* the
  // row resolves, so a home-page setting naming a page this channel does not
  // publish still answers 404 rather than redirecting to a different document.
  //
  // **It reaches every consumer, and that took the deletion of a file three
  // directories up.** Until `specs/108-storefront-response-status/` the
  // response was `200` carrying `NEXT_REDIRECT;replace;/;308;` in the RSC
  // payload — no `Location`, no `Refresh`, no canonical — because
  // `app/loading.tsx` put every page inside a Suspense boundary and the shell
  // was flushed before this component resolved. There was nothing this line
  // could have been written differently to fix; the boundary is gone, and it
  // may not come back above a page that decides a status
  // (`check:storefront-indexability`'s `status-decision-under-a-boundary`).
  if (cmsPageSlug !== null && normalizeCmsUrlPath(cmsPageSlug) === path) permanentRedirect('/');

  // Feature 163 (FR-030, FR-031): Home › the ancestors the backend resolved for
  // this channel › the page. An ancestor this channel does not serve arrives
  // with `slug: null` and renders as text. `?? DEFAULT_BREADCRUMBS` covers an
  // answer cached before the field existed — today's trail, shown and light.
  const breadcrumbs = page.breadcrumbs ?? DEFAULT_BREADCRUMBS;
  const crumbs: BreadcrumbCrumb[] = [
    { href: '/', label: t('nav.home') },
    ...breadcrumbs.trail.map((crumb) => ({
      href: crumb.slug !== null ? `/${normalizeCmsUrlPath(crumb.slug)}` : null,
      label: crumb.name,
    })),
    { href: `/${path}`, label: page.name },
  ];

  return (
    <>
      {/* Feature 163 (FR-035): the organisation's data on every CMS page, not only on `/`. */}
      <OrganizationJsonLd ctx={ctx} />
      {breadcrumbs.visible ? (
        // The scheme binds the brand's `--cmsb-*` colours for the trail. Light,
        // the default, paints nothing, so a page that never chose a scheme looks
        // exactly as it did; muted and dark paint a full-width band.
        <div
          data-cmsb-scheme={breadcrumbs.scheme}
          className={breadcrumbs.scheme === 'light' ? undefined : 'bg-[var(--cmsb-bg,#ffffff)]'}
        >
          <div className="mx-auto max-w-[1360px] px-[24px] pt-[24px] max-md:pt-[16px]">
            <Breadcrumbs crumbs={crumbs} scheme={breadcrumbs.scheme} />
          </div>
        </div>
      ) : null}
      <CmsPageRenderer page={page} ctx={ctx} modules={modules} location={cmsRenderLocation(`/${path}`, query)} />
    </>
  );
}

const DEFAULT_BREADCRUMBS: CmsResolvedPage['breadcrumbs'] = { visible: true, scheme: 'light', trail: [] };
