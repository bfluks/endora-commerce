# Quickstart: verify the marketing-page builder

**Prerequisites**:

- A local stack on this branch: backend on :3001, admin on :3002, storefront on :3000.
- Packages rebuilt with `pnpm run build:packages`.
- Migrations applied with `pnpm --filter backend exec tsx --env-file-if-exists=.env src/db/migrate.ts up`.
- The backend restarted after both.

## 0. Local reference pages stay out of the tree

Scripts that build comparison pages through the admin API live in `local/reference-pages/`. That
directory is excluded through `.git/info/exclude`, which is local to the clone, so it is never
committed and never mentioned in tracked files:

```bash
echo 'local/' >> .git/info/exclude
git check-ignore -v local/reference-pages/build.ts   # must print the exclude rule
```

## 1. Brand tokens (US1, FR-006)

1. Open **Admin → CMS → Brand** (or ⌘K "Brand"). Then:
   - Set the primary colour to a saturated blue.
   - Choose a body font from an uploaded `woff2` asset.
   - Set the dark scheme's text to `#777777`.

   A contrast warning appears for `schemes.dark.text/background`. Save anyway, and the save
   succeeds.
2. Reload a storefront CMS page. Every button and link uses the new primary colour. The page head
   has `<style id="cmsb">`, and the font loads, so the Network panel shows the `woff2` with
   status 200 and a CORS header.
3. Override the primary colour for `pl_b2b_vip` only. Request the same page with that channel's
   header: the override applies there and nowhere else.
4. Without the `cms.brand` permission, the screen is read-only and `PUT` answers 403.

## 2. Sections, anchors and schemes (US1)

1. Build a page with three section blocks:
   - a dark Hero with anchor `start`;
   - a muted MediaText;
   - a Statement with a full-bleed image plus a mobile image.
2. Add a button `{kind: 'anchor', anchor: 'start'}` and check that it scrolls to the hero.
3. Put a second anchor `start` in a Row and save. The save is refused with `CMS_DUPLICATE_ANCHOR`.
4. Drag the MediaText into a Row's column. Its section settings disappear from the sidebar, and
   its scheme stops applying.
5. In DevTools, at 375 px, the Statement uses the mobile image. At 1440 px it uses the desktop
   image.

## 3. Hero (US2)

At 375 px, a hero with a desktop and a mobile video loads only the mobile file. With
`prefers-reduced-motion: reduce` emulated, the poster shows and nothing plays.

## 4. Carousel, tabs, rich text (US4, US5)

1. In a Carousel with three DownloadTiles at 3 per view on desktop, the arrows are hidden. Add a
   fourth tile and they appear.
2. Replace the PDF asset in the asset library. The tile downloads the new version without a page
   edit.
3. View the page source of a page with Tabs and an Accordion. Every panel's text is present.
4. Translate the page with the translate action. The nested panel texts change.

## 5. Dynamic blocks (US6, US7)

1. Publish two blog posts with images, then add `blog.LatestPosts` with limit 3. Check that the
   newest post is first. Switch the blog module off: the block disappears and the editor shows
   the "module off" note.
2. Submit `newsletter.Signup` with consent unticked. The form shows an error by the consent and
   keeps the e-mail. Tick consent and choose one topic. The subscriber appears in the newsletter
   admin with that tag, `source = cms-block`, and `consentAt` set.

## 6. Breadcrumbs and metadata (US8, US9)

1. Make page B a child of page A (`parentPageId`). The trail on B reads Home › A › B, and the
   JSON-LD items are absolute URLs.
2. Unpublish A in the channel. The crumb A shows as plain text.
3. Set A's parent to B. The save is refused with `CMS_PAGE_PARENT_CYCLE`.
4. The page head contains `og:image`, from the page or the default, and `og:locale:alternate`
   for each extra language. Organization JSON-LD carries `logo` and `sameAs`.

## 7. Performance and accessibility (SC-005, SC-005a, SC-006)

```bash
npx lighthouse http://localhost:3000/<slug> --preset=perf --form-factor=mobile \
  --screenEmulation.mobile --throttling-method=simulate --only-categories=performance,accessibility
```

LCP must be ≤ 2.5 s and CLS ≤ 0.1. For INP, record a Lighthouse **timespan** (or a DevTools
Performance recording with CPU throttling 4×) while you open a tab, advance a carousel, expand an
accordion and focus the sign-up field: INP must stay below 200 ms. Run an axe scan in both colour schemes and expect 0 serious
violations. With JavaScript disabled, every section's text must be readable, and nothing may
scroll horizontally at 320 px.

## 8. Demo seed (FR-041, SC-007)

On a **scratch** database, never a developer's working database. `db:reset` wipes the database
and runs `setup` plus the demo seed:

```bash
pnpm --filter backend run db:reset
```

Then:

```bash
pnpm --filter backend exec vitest run test/integration/cms/seeded-content-renders.test.ts
```

Every seeded CMS block and page renders through the storefront without a placeholder.
