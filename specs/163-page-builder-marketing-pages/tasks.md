# Tasks: Page builder for corporate marketing pages (`specs/163-page-builder-marketing-pages/`)

**Input**:

- [spec.md](./spec.md), clarified 2026-10-22 in two sessions;
- [plan.md](./plan.md), whose owner questions Q1–Q3 are answered;
- [research.md](./research.md) (R-0 … R-25);
- [data-model.md](./data-model.md);
- [contracts/blocks.md](./contracts/blocks.md);
- [contracts/storefront-and-admin-api.md](./contracts/storefront-and-admin-api.md);
- [quickstart.md](./quickstart.md).

**Organisation**:

- Phases follow the user stories in priority order. Shared work comes first, in Setup and
  Foundational.
- A large story is split into sub-phases (3a, 3b, …). Each sub-phase is **one builder spawn**,
  has at most 10 tasks, and can be **committed on its own** on
  `feat/163-page-builder-marketing-pages`.
- Work happens in a `git worktree` (T002). Commit with `git commit -s`, an English conventional
  message and no AI trailer.
- Each phase ends with a **Verification** block. It runs only the phase's own new or changed
  tests, the derived-artefact tests whose input the phase changed, and the phase's `[PG]` files.
  The heavy suites run on the fork's CI in the final phase (standing rule 12).
- Phases marked **[UI]** may go to `endora-commerce-designer`.

## Format

`- [ ] T### [P?] [US?] Description — path(s)`

- **[P]** marks a task that may be written in parallel with its neighbours: different files, and
  no dependency on an unfinished task.
- **[US1] … [US10]** names the story served. Setup, Foundational and Polish tasks carry no label.
- **RED** means the deliverable is a failing test. Run it and see it fail **for the reason named**
  before starting the task that turns it green (Constitution III).

## Standing rules for every task

1. **Rebuild what you edit.** Tests read each package's `dist`, while `tsc` reads sources. After
   editing anything under `packages/`, run `pnpm --filter <package> run build` before a test that
   imports it. The packages concerned are `@endora-commerce/contracts`, `page-builder-core`,
   `cms-components`, `page-builder-admin` and the touched modules.
2. **Admin component tests render inside `<StrictMode>`.** Wrap the element passed to
   `renderWithI18n` (`admin/test/helpers/render-with-i18n.tsx`).
3. **Never put a test next to a module's `src/manifest.ts`.** Module unit tests go under
   `src/backend/` beside their subject, admin tests under `admin/test/`, and server-bound tests
   under `backend/test/{contract,integration}/`.
4. **Postgres-backed tests run one file per invocation**, from `backend/`, with the services
   environment taken from the root `.env`. This is the `[PG]` line form:

   ```bash
   (cd backend && eval "$(grep -E '^(POSTGRES_PORT|POSTGRES_USER|POSTGRES_PASSWORD|POSTGRES_DB|REDIS_PORT|MEILISEARCH_PORT|MEILI_MASTER_KEY)=' ../.env)" && env TEST_DATABASE_URL="postgresql://${POSTGRES_USER:-b2b}:${POSTGRES_PASSWORD:-b2b}@localhost:${POSTGRES_PORT:-5432}/${POSTGRES_DB:-b2b}_test" REDIS_URL="redis://localhost:${REDIS_PORT:-6379}" MEILISEARCH_URL="http://localhost:${MEILISEARCH_PORT:-7700}" MEILISEARCH_API_KEY="${MEILI_MASTER_KEY:-devMasterKeyChangeMe}" pnpm exec vitest run <one file>)
   ```

   - A package unit test: `pnpm --filter <package> exec vitest run <path>`.
   - A backend unit test: `pnpm --filter backend exec vitest run --config vitest.unit.config.ts <file>`.
   - A storefront test: `pnpm --filter storefront exec vitest run <file>`.
   - An admin test: `pnpm --filter admin exec vitest run <file>`.
5. **Fixtures are per run.** Every slug, block code, anchor or tag a server-bound test creates
   carries `` `pb163_${randomUUID().slice(0, 8)}` ``, and is deleted in `afterAll`. A test that
   changes a setting reads it first and writes it back in `afterAll`.
6. **A regenerated artefact is committed with its input.** `composer:generate` produces the
   migrations registry, the manifest index and the module reference page. `manifests:generate`
   needs `pnpm install --lockfile-only` beside it.
7. **A new error code lands in one commit with all four of its places**:
   - `ERROR_CODES` in `packages/contracts/src/errors.ts`;
   - the `MINTED_ERROR_CODES` ledger (`backend/test/fixtures/error-code-routing/reference-ledgers.ts`);
   - the owning manifest's `errorCodes`, with its tokens;
   - the sentences in both bundles.
8. **Deleting or moving a file?** In the same commit, `grep -rn` its name and every block name it
   declared across `backend/test`, `admin/test`, `storefront/test`, `backend/scripts`, `docs/` and
   every seeder (AGENTS.md trap 2). Also ask what is **derived** from its location (trap 3).
9. **Every `--cmsb-*` use carries today's literal as its fallback**, for example
   `var(--cmsb-color-primary, #1261a6)`. A page with no brand tokens set must look exactly as it
   does on `origin/master` (R-3).
10. **Section settings render only at the top level** (R-8). No block content may be readable only
    after JavaScript (SC-005). No new dependency (plan § Complexity Tracking).
11. **Public repository, generic product** (FR-040, `specs/conventions/commercial-data.md`):
    - No reference-site name, domain, copy, image or brand colour in any tracked file, including
      test fixtures, preset copy, docs examples and commit messages.
    - Neutral examples only, such as `Acme`, `example.com` and `#1d4ed8`.
    - Comparison pages and their build scripts live under `local/` (T003) and are never committed.
12. **Remote-CI rule.** Locally, run:
    - filtered `typecheck` and `lint` of each workspace the phase touched;
    - the phase's own tests and the derived-artefact tests its inputs feed;
    - its `[PG]` files and the `check:*` scripts named.

    **Never** run locally a `pnpm -r …`, a whole test directory, the whole `test:unit:fast`,
    `test:frontend`, `pack-gate`, `boot-gate` or the docs build. Those run on the fork's CI in the
    final phase. Any command containing a pipe starts with `set -o pipefail;`.
13. **Every deliberately changed existing assertion is named in its task.** A red in an existing
    test that no task names is a defect, not something to update.
14. **Extend, don't narrow** (plan § of that name, binding). A reshaped block keeps a superset of
    its options on `origin/master`. Tokens are defaults with a **Custom** literal override, and
    defaults stay neutral and consistent with today's look. Before reshaping a block, add its
    case to the option-parity test `packages/cms-components/src/components/option-parity.test.ts`. The case records the block's fields on
    `origin/master` (from `git show origin/master:<file>`) as literals and maps each to its
    counterpart. The case is **RED** until the reshape lands, and must never be weakened to pass.
    A block is removed only when its parity case maps every old field.

---

## Phase 1: Setup

**Goal**: confirm the base, stand the worktree up, and keep comparison material out of the tree.

- [X] T001 Drift check against `origin/master`. Stop and report if any of these fails:
  - `git fetch origin master`;
  - `163` is still free: `ls -d specs/163-*` lists only this directory, and
    `git ls-remote --heads origin | grep -c '/163-'` prints 1 or less;
  - the symbols the plan cites still exist: `git grep -n` for `withHideOn`, `CarouselShell`,
    `collectCatalogBlockDataRequests`, `setColorPaletteWriter`, `StorefrontRevalidator`,
    `toPostCard`, `OrganizationJsonLd` and `ROW_LAYOUT_PRESETS`;
  - `git grep -n "main_image_asset_id" packages/modules/blog/src/migrations` prints nothing, so
    the blog column is still missing;
  - `git grep -n "CACHE_NAMESPACES" packages/modules/settings/src/backend/services/cache-admin.service.ts`
    and `ls backend/test/integration/cms/off-state.test.ts` both succeed;
  - `ls backend/test/integration/blog/off-state.test.ts` fails, so the blog off-state file is
    still to be created (T069);
  - record whether `storefront/package.json` lists the `@tiptap/*` packages that
    `packages/cms-components/package.json` lists (T062 needs the answer).
  **Result (2026-10-22):** `origin/master` moved to `b816c1d55` (PR #406); the branch was fast-forwarded to it with no commits of its own. `163` is free (no remote `/163-` head). All eight symbols are present. `main_image_asset_id` exists only on `blog_categories` (the init migration's `blog_posts` table has none). `CACHE_NAMESPACES` is in `cache-admin.service.ts:56`; `cms/off-state.test.ts` exists; `blog/off-state.test.ts` does not. `storefront/package.json` mirrors the eight `@tiptap/*` packages of `cms-components` at `^3.31.3`, so T062 adds any new one in both.
- [X] T002 Stand up the worktree:
  `git worktree add ../wt-163 -b feat/163-page-builder-marketing-pages origin/master` (or reuse the
  existing branch). Then run `bash ../wt-163/scripts/setup-worktree.sh`, copy the root `.env` in,
  and run `pnpm run build:packages`.
  **Result (2026-10-22):** Not a separate worktree: `feat/163-page-builder-marketing-pages` is already checked out in the main checkout, which a worktree cannot share. Work happens there; the local backend must be restarted after `build:packages`.
- [X] T003 Keep reference material local. Append `local/` to `.git/info/exclude` and create
  `local/reference-pages/README.md`, an untracked note. Then check that
  `git check-ignore -v local/reference-pages/README.md` prints the exclude rule and that
  `git status --porcelain` is unchanged.
  **Result (2026-10-22):** `local/` added to `.git/info/exclude`; `git check-ignore` prints the rule; `git status` unchanged.
- [X] T004 Measure the product summary cost (R-16, ruling Q3).
  - Find where a product's description is stored and whether the public list read
    (`listProducts` behind `/api/v1/catalog/products`) can return a 160-character plain-text
    excerpt with no extra query per product.
  - Record the finding under this task: **derive** or **fallback**. Phase 8b implements the
    chosen branch.
  **Result (2026-10-22):** **derive**. `products.description` is a JSONB column on the product row (`product.entity.ts:61`), so the list read has it without an extra query. Phase 8b implements the derived `summary`.

**Verification**: the T001 output is recorded under the task, and `git status --porcelain` is
empty in the worktree.

---

## Phase 2: Foundational — shared schemas, depth context, shared fields and renderers

**Goal**: everything more than one story needs. This covers the shapes of data-model §2–3 and
§6, the top-level context (R-8), and the field factories and renderers for `LinkValue`,
`ButtonSpec`, `ResponsiveImage` and `InlineRichText` (R-9 to R-11). No user-visible change yet.

### 2a. Contracts

- [X] T005 [P] **RED** `packages/contracts/src/page-builder-props.test.ts`:
  - `linkValueSchema` accepts each of the six kinds, and refuses `javascript:` and `data:` URLs
    and an anchor outside `^[a-z][a-z0-9-]{0,63}$`;
  - `buttonSpecSchema` defaults `fill`/`size` and requires `label` when `iconPosition` is `only`;
  - `responsiveImageSchema` refuses a custom ratio with a component above 100;
  - `sectionSettingsSchema` defaults (`scheme: 'inherit'`, `width: 'contained'`, spacing `'l'`);
  - `inlineRichTextSchema` accepts a plain string and normalises it to a one-paragraph document,
    and refuses block nodes other than one paragraph;
  - `normalizeAnchor('Kontakt Us!') === 'kontakt-us'`, `normalizeAnchor('9x')` yields `'a-9x'`.

  (Fails: the module does not exist.)
  **Result (2026-10-22):** `packages/contracts/src/page-builder-props.test.ts` (26 tests). RED on `Cannot find module './page-builder-props.js'`, green after T007. Beyond the list it also asserts the `url` kind's accepted schemes, `//host` refusal, responsive `style`/`fill`, colour overrides (`token:<role>` or `#rrggbb`), every Row width, `{px}` spacing, `''` anchor → none, overlay strength bounds, and the 64-character anchor cap.
- [X] T006 [P] **RED** `packages/contracts/src/cms-brand.test.ts`:
  - `cmsBrandTokensSchema` parses `DEFAULT_BRAND_TOKENS`;
  - it refuses a 3-digit hex, a `stylesheet` font with an `http:` URL, a `typeScale` size of 400,
    and more than 8 font faces;
  - `assessBrandContrast(DEFAULT_BRAND_TOKENS)` returns `[]`;
  - with `schemes.dark.text = '#777777'` on `#000000` it returns exactly one finding,
    `{pair: 'schemes.dark.text/background', required: 4.5}`, with ratio ≈ 4.69 → passes. Use
    `#555555` (≈ 2.9) for the failing case;
  - a `display` size pair uses `required: 3`.

  (Fails: the module does not exist.)
  **Result (2026-10-22):** `packages/contracts/src/cms-brand.test.ts` (12 tests). RED on the missing module, green after T007. **Interpretation:** the "display size pair" is the accent gradient's two stops against each scheme background (the gradient emphasis is a heading device), held to 3:1; findings are `{pair, ratio, required}` only. The `#777777`/`#555555` cases set `schemes.dark.background = '#000000'`; `#555555` gives ≈ 2.82, asserted as 2.7–3.
- [X] T007 Write `packages/contracts/src/page-builder-props.ts` (data-model §3) and
  `packages/contracts/src/cms-brand.ts` (data-model §2: schema, `DEFAULT_BRAND_TOKENS` mirroring
  today's literals from R-0, `assessBrandContrast` with the WCAG relative-luminance formula).
  Export both from `packages/contracts/src/index.ts`. T005 and T006 go green.
  **Result (2026-10-22):** `packages/contracts/src/page-builder-props.ts`, `cms-brand.ts`, and **`page-builder-values.ts` (deviation)**: the zod-free grammars and helpers (`normalizeAnchor`, `isSafeLinkUrl`, `isAspectToken`, `plainTextToInlineRichText`, `inlineRichTextToPlain`, the regexes and token lists) live there and are re-exported by `page-builder-props.ts`, so client code can use them without bundling zod (the storefront's client components import only types from `contracts`). Both files exported from `src/index.ts`. **Deviation from data-model §3's direction**: the types cannot live in `page-builder-core` with `contracts` re-exporting them, since `contracts` cannot depend on it; `page-builder-core/src/types/page-builder-props.ts` re-exports the types (and the zod-free helpers via `@endora-commerce/contracts/page-builder-values`) from its barrel instead. `responsiveSchema` uses `.exactOptional()` so the inferred tiers match `ResponsiveProp<T>` under `exactOptionalPropertyTypes`. Defaults: primary `#1261a6`, slate neutrals, text `#15202b`, border `#d9e0e7`, `system`/`sans` fonts (today's Inter stack), headings 48/40/32/26/22/18 at 1.12/700 on both tiers, body 16/1.65, buttons 32/40/48 px, radius `rounded`, container 1360. No literal exists today for these, so they take neutral values chosen to pass `assessBrandContrast`: secondary `#0f766e`, `primaryHover` `#0f5189`, accent gradient `#3b82f6 → #0f766e` (primary fails 3:1 on the dark scheme), dark scheme `#0f172a`/`#f8fafc`/link `#93c5fd`, `display` 40→56. `contrastRatio` and `relativeLuminance` are exported too. T005 and T006 are green (38 tests).
- [X] T008 Mint `CMS_DUPLICATE_ANCHOR {anchor}`, `CMS_RESERVED_ANCHOR {anchor}` and
  `CMS_PAGE_PARENT_CYCLE` in the four places of standing rule 7. The places are
  `packages/contracts/src/errors.ts`, `backend/test/fixtures/error-code-routing/reference-ledgers.ts`,
  the `errorCodes` in `packages/modules/cms/src/manifest.ts`, and `packages/modules/cms/i18n/{en,pl}.json`.
  Sentences: "The anchor “{anchor}” is used twice on this page." / "Kotwica „{anchor}” występuje na
  tej stronie dwa razy.", and the matching sentences for reserved anchors and the parent cycle.
  **Result (2026-10-22):** All four places: `ERROR_CODES` (`packages/contracts/src/errors.ts`), `MINTED_ERROR_CODES` (in alphabetical position before `CMS_SLUG_RESERVED`), `cms` manifest `errorCodes` and `i18n/{en,pl}.json`. No `tokens`: like `CMS_SLUG_RESERVED`, the anchor sentences carry a `{anchor}` placeholder through `details`, while manifest tokens are sentence variants. `check:error-translations`: `codes=358 … violations=0 stale=0` (needs the sandbox off, because tsx opens an IPC pipe). The ledger readers `error-code-routing-equality`, `error-code-migration-progress` and `platform-error-code-block` pass (106 tests). No generated artefact names cms codes.

### 2b. Depth context and shared renderers

- [X] T009 [P] **RED** `packages/page-builder-core/src/visibility/with-hide-on.test.tsx`. Render a
  Puck `<Render>` tree and assert that `useSectionContext().topLevel` is:
  - `true` for a root block;
  - `false` inside a `cms.Row` column;
  - `false` inside an array-item slot;
  - `false` inside a carousel slide;
  - `true` for a block inside an `InsertBlock` placed at the root;
  - `false` for the same `InsertBlock` placed inside a column.

  Use a stub `InsertBlock` that renders a nested `<Render>`. (Fails: no context.)
  **Result (2026-10-22):** `packages/page-builder-core/src/visibility/with-hide-on.test.tsx` (8 tests) renders through Puck's `<Render>` with stub Row/Column, array-item-slot Tabs, Carousel/Slide and a stub InsertBlock running a nested `<Render>`. RED on `useSectionContext is not a function`. It also asserts the default outside any block and that the hide-on wrapper's attributes are unchanged.
- [X] T010 Add `BlockDepthContext` and `useSectionContext()` to
  `packages/page-builder-core/src/visibility/with-hide-on.tsx`. The wrapper reads the depth,
  renders the block body as a child component inside `<BlockDepthContext.Provider value={depth +
  1}>`, and keeps the existing `hideOn` attributes. Export both from `page-builder-core`'s barrel.
  T009 goes green. Re-run `packages/cms-components/src/components/*.test.ts` unchanged.
  **Result (2026-10-22):** `with-hide-on.tsx` adds `BlockDepthContext`, `useSectionContext()` (`{depth, topLevel}`) and **`EmbeddedBlockDepth` (addition)**. The wrapper reads the depth, provides the block's own section context, provides `depth + 1` to its children, and mounts the body as a `BlockBody` component. Exported from the barrel. **Addition:** `cms-components` `InsertBlock.tsx` and `InsertTemplate.tsx` wrap their embed in `<EmbeddedBlockDepth>`. Without it, an embed at the root renders at depth 1 and R-8's "embed at the top level is a section" does not hold. Existing `cms-components/src/components/*.test.ts(x)` were re-run unchanged (11 files, 34 tests green), as were `block-boundary.test.tsx` and `storefront/test/ssr/{blocks,block-degradation}.test.tsx` (4 + 4).
- [X] T011 [P] **RED** `packages/cms-components/src/utils/link-href.test.ts`. `resolveLinkHref`
  maps each `LinkValue` kind (R-11):
  - `asset` uses `assets[id].url`, then `/assets/file/<id>` rebased by `mediaBaseUrl`;
  - an unsafe `url` gives `null`;
  - `_blank` adds `rel="noopener noreferrer"`.

  Also **RED** `packages/cms-components/src/components/Picture.test.tsx`:
  - a `ResponsiveImage` with a mobile asset renders `<picture><source media="(max-width:
    767.98px)" srcset=…><img loading="lazy" decoding="async" alt=…></picture>`;
  - with only a mobile image it uses it at every width (spec edge case);
  - `priority` gives `loading="eager" fetchpriority="high"`;
  - the ratio becomes the `--pb-ratio`, `-md` and `-lg` custom properties.

  Also **RED** `src/components/ButtonView.test.tsx`:
  - each style and fill gives `cmsc-btn--<style>-<fill>`, and each size `cmsc-btn--<size>`;
  - `iconPosition: 'only'` renders a round button whose `aria-label` is the label;
  - an anchor link renders `href="#…"`.

  Also **RED** `src/components/InlineRich.test.tsx`:
  - each mark (bold, italic, link, the three `emphasis` variants) and `hardBreak` renders its tag;
  - a legacy plain string renders as text;
  - an unsafe link `href` is dropped.
  **Result (2026-10-22):** Four RED files, each RED on its missing module: `src/utils/link-href.test.ts` (8), `src/components/Picture.test.tsx` (7), `ButtonView.test.tsx` (10) and `InlineRich.test.tsx` (8). React's SSR writes `srcSet=` and `fetchPriority=`, and the assertions use those spellings. Extra cases: tier classes `cmsc-btn--md-*`/`--lg-*` for a responsive style or fill, an unsafe URL rendering no `href`, icon before or after the label, colour overrides (hex, and `token:on-primary` → `var(--cmsb-color-on-primary, #ffffff)`), mark nesting order (link outermost, emphasis innermost), and an empty paragraph rendering nothing.
- [X] T012 Write `packages/cms-components/src/utils/link-href.ts`,
  `src/components/Picture.tsx`, `src/components/ButtonView.tsx` (renders a `ButtonSpec`: classes
  `cmsc-btn cmsc-btn--<style>-<fill> cmsc-btn--<size>`, an icon via `icon-catalog.ts`,
  `iconPosition: 'only'` → round with `aria-label`) and `src/components/InlineRich.tsx`
  (renders `InlineRichText` to `<span>`, `<strong>`, `<em>`, `<a>`, `<br>` and
  `<span class="cmsc-em cmsc-em--<variant>">`, server-safe, no TipTap runtime). Add the
  `cmsc-btn*`, `cmsc-em*`, `cmsc-sr-only` and `.cmsc-picture` rules to
  `packages/cms-components/styles/cms-components.css`, with `--cmsb-*` fallbacks (standing
  rule 9). T011 goes green.
  **Result (2026-10-22):** `src/utils/link-href.ts`, `src/components/{Picture,ButtonView,InlineRich}.tsx`, and **`src/utils/color-value.ts` (addition)**: `token:<role>` → `var(--cmsb-color-<role>, <default literal>)` for the six colour roles, hex as is, anything else ignored. All five are exported from the `cms-components` barrel. `Picture` and `ButtonView` are `'use client'` because they read the render context. `InlineRich` has no hook and no TipTap. CSS appended to `styles/cms-components.css`: `cmsc-btn` (style classes set `--cmsc-btn-c`, `-c-hover` and `-on`; fill classes route them, with md/lg tier classes in media queries), `cmsc-em--{gradient,accent,muted}` (accent reads the scheme's `--cmsb-link`), `cmsc-sr-only`, and `.cmsc-picture` with `--pb-ratio(-md|-lg)`. Every `--cmsb-*` use carries a literal fallback. **Open point for the Button reshape (T024 default-look check):** the `outline` fill is transparent, whereas today's `secondary` variant fills white. T011 is green (33 tests). Tailwind build OK.

### 2c. Shared editor fields

- [X] T013 [P] **RED** `packages/page-builder-core/src/fields/inline-rich-text-field.test.tsx`:
  - the field shows bold, italic, link and three emphasis buttons, and no block formats;
  - Enter inserts a hard break, not a paragraph;
  - the stored value round-trips through `inlineRichTextSchema`;
  - a legacy string prop is shown as text and saved as a document.
  **Result (2026-10-22):** **Moved (deviation)** to `admin/test/modules/cms/inline-rich-text-field.test.tsx` (5 tests, `<StrictMode>`): `page-builder-core` has no TipTap and no jsdom, so the field lives in `cms-components` (T014) and its interaction test runs where jsdom and Testing Library are. RED on `createInlineRichTextField is not a function`. Adds an emphasis-variant case (select all, *Accent highlight* → `{type:'emphasis', attrs:{variant:'accent'}}`, rendered as `span.cmsc-em--accent`) and asserts that showing a legacy string writes nothing until an edit.
- [X] T014 Write `packages/page-builder-core/src/fields/inline-rich-text-field.tsx`, a TipTap
  editor with `Document` limited to one paragraph and an `emphasis` mark extension in
  `packages/cms-components/src/components/rich-content-shared.ts`. Export `emphasisMark` for
  reuse by `RichContent` (Phase 7b). T013 goes green.
  **Result (2026-10-22):** **Placed in `cms-components` (deviation)**, because `page-builder-core` depends on neither TipTap nor `cms-components` (it is the other way round) and no new dependency is allowed: `src/fields/inline-rich-text-field.tsx` (`createInlineRichTextField({label})`, which lazy-loads the editor so a block config imported by the storefront does not pull `@tiptap/react` in) and `src/components/InlineRichTextEditor.tsx` (`InlineRichTextEditor`, `inlineRichTextExtensions`: a `doc` node of content `paragraph`, StarterKit without block nodes, underline, strike or code, an Enter → `setHardBreak` shortcut). `emphasisMark` (with `setEmphasis`/`toggleEmphasis`/`unsetEmphasis`, parsed from and rendered as `span.cmsc-em.cmsc-em--<variant>`) is in `rich-content-shared.ts` and exported from the barrel; `RichContent` does not use it yet. `RichContentEditorField.tsx` now exports its `ToolbarButton`, `Divider` and `LinkDialog` for reuse (not from the barrel). Toolbar titles are English literals, as in `RichContentEditorField` (`cms-components` has no translation layer). T013 green (5), `cms-components` suite 181 green.
- [X] T015 [P] **RED** `admin/test/modules/cms/link-field.test.tsx`:
  - the `LinkValue` field offers URL, page, product, category, file and in-page anchor;
  - page, product and category reuse the existing pickers;
  - file opens the asset picker;
  - anchor lists the anchors of the current canvas (`collectAnchors(data)`) and accepts free
    text, normalised.
  **Result (2026-10-22):** 9 tests, `<StrictMode>`, copy read from `_i18n`'s shipped `core` bundle (every `pageBuilder.linkField.*` key also in `pl`). `apiClient` and `usePageBuilderPuck` are mocked. RED on `createLinkField is not a function`. Also covers the URL kind with `target: '_blank'` and the kept slug-only `createButtonLinkSlugField` (page list under `linkType: 'page'`). Plus `packages/page-builder-core/src/editor/anchors.test.ts` (3, RED on the missing module): document order, de-duplication, slot and `zones` children, malformed anchors skipped.
- [X] T016 Write `packages/page-builder-admin/src/chrome/LinkField.tsx` (generalising
  `packages/modules/cms/src/admin/components/ButtonLinkFields.tsx`, which is then deleted, with
  its imports updated per standing rule 8), plus `createButtonListField` and
  `createResponsiveImageField` in `packages/page-builder-admin/src/chrome/`. The image field uses
  the asset picker for desktop and mobile images, plus ratio, fit and focal point. Add
  `collectAnchors(data)` in `packages/page-builder-core/src/editor/anchors.ts`. T015 goes green.
  **Result (2026-10-22):** `page-builder-admin/src/chrome/LinkField.tsx` (`createLinkField`, `LinkFieldControl`, `LINK_KINDS`), `ButtonListField.tsx` (`createButtonListField`, `DEFAULT_BUTTON_SPEC`: array of up to 6, every `ButtonSpec` property incl. icon, icon position and the colour overrides; style and fill stored as plain values) and `ResponsiveImageField.tsx` (`createResponsiveImageField`: URL or library for desktop and mobile, alt, ratio per tier with presets or custom `w:h`, fit, focal point), all on the barrel. Page, product and category reuse the page list and `CatalogPickers`' single pickers; file reuses `AssetModalFieldControl` with no MIME filter (both now module-level exports, not on the barrel). The page list is `listPageBuilderLinkPages()` in `cms-page-builder-api.ts` (`GET /api/v1/admin/cms/pages?limit=100`, the client-exit precedent). `collectAnchors` is on `page-builder-core`'s main barrel (pure). Copy: 46 `pageBuilder.linkField.*`/`pageBuilder.imageField.*` keys in `_i18n/i18n/{en,pl}.json`. **Compat path:** `createButtonLinkSlugField` moved into `LinkField.tsx` (same stored value, switched by `linkType`/`buttonLinkType`), so `cms.Button` and `cms.Hero` keep their pickers until their reshape; product and category now open the catalog modal pickers instead of the old inline search select. **Standing rule 8:** `ButtonLinkFields.tsx` deleted; `PageBuilderEditor.tsx` imports the field from `@endora-commerce/page-builder-admin`; the derived ledgers are corrected in the same change: the `MOVED` list of `admin/test/modules/batch-sixteen-surfaces.module-owned-surface.test.tsx` and `HARDCODED_STRINGS_BASELINE` in `backend/scripts/i18n-hardcoded-strings.ts` (entry drained, `i18n:hardcoded`: `findings=223 regressions=0`). No other reference in `backend/test`, `admin/test`, `storefront/test`, `backend/scripts`, `docs/` or seeders; code comments avoid the old name so T103's grep stays clean. Extra test: `admin/test/modules/cms/button-image-fields.test.tsx` (6). T015 green (9).

**Verification**:

```bash
pnpm --filter @endora-commerce/contracts exec vitest run src/page-builder-props.test.ts src/cms-brand.test.ts
pnpm --filter @endora-commerce/page-builder-core exec vitest run src/visibility/with-hide-on.test.tsx src/editor/anchors.test.ts
pnpm --filter @endora-commerce/cms-components exec vitest run src/utils/link-href.test.ts src/components/Picture.test.tsx src/components/ButtonView.test.tsx src/components/InlineRich.test.tsx
pnpm --filter admin exec vitest run test/modules/cms/link-field.test.tsx test/modules/cms/inline-rich-text-field.test.tsx test/modules/cms/button-image-fields.test.tsx
pnpm --filter backend run check:error-translations
pnpm --filter @endora-commerce/contracts run typecheck && pnpm --filter @endora-commerce/page-builder-core run typecheck && pnpm --filter @endora-commerce/cms-components run typecheck && pnpm --filter @endora-commerce/page-builder-admin run typecheck && pnpm --filter admin run typecheck
```

---

## Phase 3: User Story 1 — brand-consistent sections with anchors and colour schemes (P1) 🎯 MVP

**Story goal**: an administrator sets the brand once, globally and per channel. Every section
block has an anchor, a colour scheme, a background with art direction, token spacing and a
width. Headings separate the semantic level from the visual size and support highlighted
phrases.

**Independent test**: spec US1. Quickstart §1–§2.

### 3a. Brand tokens: backend (FR-006, FR-006a, FR-006b)

- [X] T017 [P] [US1] **RED** `backend/test/contract/cms/brand-tokens.contract.test.ts` `[PG]`.
  Covers contract §1:
  - `GET` admin returns `effective === DEFAULT_BRAND_TOKENS` when nothing is set;
  - `PUT` with scope `all` and `cms.brand` returns `{version, warnings}` with a warning for a
    low-contrast pair, and the save persists;
  - `PUT` without `cms.brand` (a `cms.read` admin) returns 403;
  - a stale `expectedVersion` returns 409;
  - a malformed body returns 400;
  - the channel scope with `tokens: null` removes the override;
  - the public `GET /api/v1/storefront/cms/brand-tokens` with `x-sales-channel` of the overridden
    channel returns the override, the other channel returns global, and no header returns the
    system default channel's set (Principle XII: an override must not leak across channels);
  - exactly **one** audit entry per write, with action `cms.brand_tokens.update`, object
    `cms_brand_tokens` and before/after, and no `settings` audit row (Principle XIII; analysis C2);
  - a write rolled back by a forced failure leaves no row change and no audit entry.
  **Result (2026-10-22):** 10 tests, RED on `relation "cms_brand_tokens" does not exist`, green after T019/T020. The 403 uses `stub-content-manager-session` (`cms.read`+`cms.write`, no `cms.brand`); the forced rollback is a per-run deferred constraint trigger (fires at COMMIT, after the row write and the audit insert), dropped in `finally`. The storefront case uses three scopes (global, an override channel, the system default channel) and two `pb163_*` channels, all removed in `afterAll`; the table's prior rows are restored. Unknown channel → `404 UNKNOWN_SALES_CHANNEL`; malformed body → 400 (`VALIDATION_FAILED`, the repo's code for the contract's "VALIDATION_ERROR"). Also carries T021's descriptor case.
- [X] T018 [P] [US1] **RED** `packages/modules/cms/src/backend/services/brand-tokens-service.test.ts`:
  - `read` returns the channel row, else the global row, else `DEFAULT_BRAND_TOKENS`, in one
    query;
  - `update` with a stale version throws the version conflict before writing;
  - after commit, `storefrontRevalidator.revalidate(['cms:brand'])` is called once;
  - a failing revalidator is logged and does not throw;
  - a rolled-back Command calls no revalidation.
  **Result (2026-10-22):** 11 tests, RED on `Cannot find module './brand-tokens-service.js'`. Beyond the list: the channel scope's audit object id, a `tokens: null` removal (`delete`, after `null`, version 0) and the contrast findings returned by a save.
- [X] T019 [US1] Scaffold `pnpm --filter backend run migration:new -- --module cms --name
  brand_tokens` with the `cms_brand_tokens` table (data-model §1.3; `down` drops it). Add the
  entity `packages/modules/cms/src/backend/entities/cms-brand-tokens.entity.ts`. In
  `packages/modules/cms/src/manifest.ts`:
  - declare the permission `cms.brand` (`requires: ['cms.read']`, label key
    `adminRoles.permission.cms.brand`, `en` "Edit brand settings", `pl` "Edycja ustawień marki");
  - declare the palette action `open-cms-brand` (`targetRoute: '/cms/brand'`,
    `requiredPermission: 'cms.read'`, icon `palette` or the nearest `KnownIconNameSchema` name).

  Then run `composer:generate` (standing rule 6).
  **Result (2026-10-22):** `migrations/20261022T163218_cms_brand_tokens.ts` (`unique nulls not distinct ("sales_channel_id")`; PG 16 is the documented floor), added to `migrations/index.ts` by hand as the scaffolder asks; `entities/cms-brand-tokens.entity.ts` (`@GlobalEntity()`) in the `entities` array. `cms.brand` declared (`requires: ['cms.read']`, labels in `cms/i18n/{en,pl}.json`). `composer:generate` changed `backend/src/db/migrations-registry.generated.ts` and `docs/docs/module-reference/cms.md` only. **Deferred to 3c: the palette action `open-cms-brand`** — `backend/test/integration/_admin_surfaces/batch-sixteen-palette-off-state.test.ts` requires every `cms` action to target a route `cms`' own admin layer declares, `/cms/brand` lands with the screen, and there is no stub-route precedent. 3c adds the action, its `actions.openCmsBrand.*` labels and `'open-cms-brand'` to that file's `SUBJECTS`. `KnownIconNameSchema` has no `Palette`; 3c decides whether to add it or use an existing name.
- [X] T020 [US1] Write `packages/modules/cms/src/backend/services/brand-tokens-service.ts`:
  - `read(salesChannelId | null)`;
  - `update(scope, tokens, expectedVersion)` as the Command `cms.brand_tokens.update` through
    `commandBus.run`, upserting or deleting the scope's `cms_brand_tokens` row in the Command's
    transaction (never through `settingsAdminService`; R-1, R-2);
  - revalidation after commit.

  Add the routes in `packages/modules/cms/src/backend/routes.admin.ts` (`GET`/`PUT
  /api/v1/admin/cms/brand-tokens`) and `routes.storefront.ts` (`GET
  /api/v1/storefront/cms/brand-tokens`, `cache-control: public, max-age=60`). Wire them in
  `packages/modules/cms/src/backend/index.ts`. Add the `cms-brand` entry with
  `storefrontTags: ['cms:brand']` to the settings module's `CACHE_NAMESPACES`
  (`packages/modules/settings/src/backend/services/cache-admin.service.ts`). T017 and T018 go
  green.
  **Result (2026-10-22):** `services/brand-tokens-service.ts` (`CmsBrandTokensService`: `read`, `effective`, `update`; `select … for update`, version check before any write, `insert … on conflict do nothing returning id` so a racing first save is a 409; a no-op reset skips the audit; fire-and-forget revalidation after commit with logged failures; a stored set the schema refuses reads as unset). HTTP shapes added to `packages/contracts/src/cms-brand.ts` (`putCmsBrandTokensRequestSchema`, `cmsBrandTokensAdminReadSchema`, scope/state/finding schemas; 2 new tests in `cms-brand.test.ts`). Routes in `routes.admin.ts` (GET `cms.read`, PUT `cms.brand`) and `routes.storefront.ts`; wired through `plugin.ts` (`brandTokensService` on the handle) and `index.ts` (`revalidateStorefront` → `cmsStorefrontRevalidator`). The tag is `CMS_STOREFRONT_CACHE_TAGS.brand = 'cms:brand'` in `contracts/storefront-cache-tags.ts`; the `cms-brand` namespace mirrors the existing `cms` entry (settings already imports that vocabulary; `check:module-boundary` clean), with `patterns: []`, labels `cache.namespace.cms-brand.*` in `settings/i18n/{en,pl}.json`, and a new case in `backend/test/unit/settings/cache-admin-service.test.ts` (RED first).
- [X] T021 [US1] Extend `GET /api/v1/admin/cms/page-builder/config` with `?salesChannelId=` and
  `brandTokens` in the descriptor:
  - `packages/contracts/src/cms.ts` `cmsPageBuilderDescriptorSchema`;
  - `packages/modules/cms/src/backend/services/page-builder-registry.ts`;
  - the existing descriptor contract test, with the changed assertion named here.
  **Result (2026-10-22):** `brandTokens: cmsBrandTokensSchema.optional()` on the descriptor; `PageBuilderRegistry.setBrandTokensResolver` + `describe({salesChannelId})` (defaults when no resolver); the route parses `?salesChannelId=` as a uuid. **No existing assertion changed** — none pins the descriptor's keys; the new cases are two in `page-builder-registry.test.ts` (RED on `setBrandTokensResolver is not a function`) and one in the T017 file.
- [X] T022 [US1] Off state: extend `backend/test/integration/cms/off-state.test.ts` `[PG]`. With
  `cms` deactivated on each axis, the brand admin and storefront routes do not answer and the
  palette action and `/cms/brand` nav entry are absent. The new probes are part of the harness's
  restoration assertion after both axes (Principle XVII; analysis X1). The `cms_brand_tokens` rows
  survive the off/on cycle. Check the permission inventory:
  `backend/test/contract/admin_users/permission-inventory.test.ts` `[PG]`.
  **Result (2026-10-22):** three probes added (admin GET, admin PUT, storefront GET) inside the harness, so restoration covers them on both axes; a `cms_brand_tokens` row (random channel id, never read) is asserted to survive and removed in `finally`. The palette action and `/cms/brand` nav entry land in 3c (see T019); their off-state is `batch-sixteen-palette-off-state.test.ts`'s. Green (1); permission inventory green (12) with no read-size change. Not run RED first — the routes existed when the probes were added.

**Verification**: T017, T022 and the permission-inventory file `[PG]`, then:

```bash
pnpm --filter @endora-commerce/mod-cms exec vitest run src/backend/services/brand-tokens-service.test.ts
pnpm --filter backend run check:action-route-permissions
pnpm --filter backend run composer:generate && git status --porcelain
```

### 3b. Brand tokens: CSS, storefront injection, preview (FR-006, FR-006c, SC-004)

- [X] T023 [P] [US1] **RED** `packages/cms-components/src/brand/brand-css.test.ts`:
  - `brandTokensToCss(DEFAULT_BRAND_TOKENS).css` defines every variable listed in data-model §2;
  - the three `[data-cmsb-scheme=…]` blocks rebind `--cmsb-fg`, `--cmsb-bg`, `--cmsb-fg-muted`,
    `--cmsb-border` and `--cmsb-link`;
  - one `@media (min-width: 1024px)` block holds the desktop sizes;
  - an `asset` font emits one `@font-face` per face with `font-display: swap` and a `fontLinks`
    preload for the body regular face;
  - a `stylesheet` font emits a `<link rel="stylesheet">` entry;
  - a family name with `;` or `}` is refused (CSS injection);
  - the output contains no `</style`.
  **Result (2026-10-22):** 10 tests, RED on `Cannot find module './brand-css.js'`, green after T025. Beyond the list: the built-in values equal the stylesheet's fallback literals, a refused family falls back to its generic's system stack, a non-`https:` stylesheet URL and a non-hex colour are dropped, and the module's token lists equal the contracts'. `DEFAULT_BRAND_TOKENS` comes from the new `@endora-commerce/page-builder-core/brand-tokens` subpath (a re-export of `contracts/cms-brand`; the core barrel re-exports the types only), because `cms-components` deliberately does not depend on `contracts`.
- [X] T024 [US1] **RED** `packages/cms-components/src/brand/fallback-parity.test.tsx`. Render
  `Button`, `Heading`, `Text`, `Hero` and `Row` with jsdom computed styles and **no**
  `<style id="cmsb">`. The colours, font family and sizes must equal the values on
  `origin/master`, recorded as literals in the test. The test also asserts that the built
  stylesheet reads `--cmsb-color-primary`, `--cmsb-font-body` and `--cmsb-t-h1-size`, each with
  today's literal as fallback. It is **RED** for those variable names only: it fails until the
  stylesheet reads them, never on a value. It guards standing rule 9 and the e-mail editor, which
  shares the stylesheet. Each later phase that reshapes a block adds that block's **default
  render** to this test: with no tokens, the default colours, alignment and sizes equal today's
  (standing rule 14).
  **Result (2026-10-22):** 6 tests (`// @vitest-environment jsdom`), RED only on `var(--cmsb-t-h1-size,48px)` missing; every value case was green against the pre-change build. Origin literals recorded: `cms.Button` primary `#1261a6` fill and border with a white label, secondary white fill with primary border and label, ghost transparent with a primary label, the `cmsc:font-sans` stack, 14px/700; `cms.Heading` 48/40/32/26/22/18 px, `#15202b`, the inline Inter stack, 700; `cms.Text` 16px, `#243447`; `cms.Hero` white text, `clamp(1.75rem,3vw,2.5rem)` heading, primary CTA; `cms.Row` and the page container 1360px, 24px side padding, 24px gaps. Harness: jsdom ignores `@layer` (layers unwrapped ahead of the unlayered rules), does not substitute `var()` (resolved in the test: ancestor chain, then fallback), and drops `clamp()` and a `border-color` shorthand holding `var()` (both read from the built rule text). A mutation run (three fallbacks edited in `dist`) turned four cases red. Reads `dist/cms-components.css`, so it needs `pnpm --filter @endora-commerce/cms-components run build` first. Puck needs a `ResizeObserver` stub under jsdom (`vi.hoisted`). `jsdom` is not a `cms-components` devDependency: vitest resolves the environment from the workspace install (adding it needs a registry round-trip, see the 3b report).
- [X] T025 [US1] Write `packages/cms-components/src/brand/brand-css.ts` and export it. In
  `packages/cms-components/styles/cms-components.css`, replace the hard-coded literals found in
  R-0 with `var(--cmsb-*, <literal>)`. This covers the buttons (`.cmsc-pb-btn-*`), the slate text
  and border colours, `--pb-page-padding`, the row max width and the default gaps. In
  `src/components/typography.ts`, `FONT_FAMILY_CSS.sans` becomes
  `var(--cmsb-font-body, Inter, system-ui, …)` and the heading sizes map to `--cmsb-t-h*-size`
  with today's pixel values as fallbacks. T023 and T024 go green.
  **Result (2026-10-22):** `src/brand/brand-css.ts` (`brandTokensToCss(tokens, {assetUrl?})` returns `{css, fontLinks}`; family names from a letters/digits/space/`-_.` alphabet, always quoted; asset URLs as escaped CSS strings; stylesheet links `https:` only; non-hex colours and non-finite numbers dropped; every `<` escaped), on the barrel and at `@endora-commerce/cms-components/brand/brand-css`. Stylesheet: `@theme --font-sans` reads `--cmsb-font-body`; `.cmsc-pb-page` sets `--pb-page-padding: var(--cmsb-gutter, 24px)`; every `1360px` reads `--cmsb-container`; the default gaps and page-padding fallbacks read `--cmsb-gutter`; the legacy `.cmsc-pb-btn-*` variants (all tiers) read `--cmsb-color-primary`/`-on-primary`, and secondary keeps its `#fff` fill; the column divider reads `--cmsb-border`; section-surface text reads `--cmsb-fg`/`--cmsb-fg-muted`; slate greys read the `--cmsb-n-*` step whose default equals the literal; the newsletter button reads `--cmsb-color-secondary`. Self-surface colours (white card fills, editor chrome, icon picker, skeletons) stay literal. Every fallback equals the literal it replaced. `typography.ts`: `FONT_FAMILY_CSS.sans` is `var(--cmsb-font-body, Inter, system-ui, -apple-system, sans-serif)`, plus a new `headingSizeClass(level)`. `cms.Heading` (both renders) uses `.cmsc-pb-heading-size-h1…h6` = `var(--cmsb-t-hN-size, <today's px>)` instead of an inline size when it has no custom size, and its class colour is `var(--cmsb-fg,#15202b)`. Package suite green (22 files, 197 tests); `storefront/test/ssr/blocks.test.tsx` green (4).
- [X] T026 [US1] Storefront delivery:
  - `storefront/lib/api/brand.ts` `getBrandTokens()` with `{revalidate: 300, tags: ['cms:brand']}`,
    returning `null` on 404 (cms off);
  - `storefront/lib/server-context.ts` fetches it in parallel with the channel;
  - `storefront/lib/theme/StorefrontDocument.tsx` renders `<style id="cmsb">` and the font links
    in `<head>` when tokens are present;
  - `StorefrontDocument` also sets `--cmsb-header-offset` on `:root` to the storefront header's
    height: the sticky header's CSS height variable, or `0px` when the header is not fixed
    (US1 acceptance 2; analysis U1).

  Test: **RED** `storefront/test/theme/brand-style.test.tsx`. The tag is present with tokens,
  absent when the fetch returns null, and the CSS is escaped (no `</style` breakout).
  `--cmsb-header-offset` is set in both cases.
  **Result (2026-10-22):** `storefront/lib/api/brand.ts` (`getBrandTokens`, tag `CMS_STOREFRONT_CACHE_TAGS.brand`, `null` on 404 and on any failed read, Next control-flow errors rethrown). `getServerContext()` adds it to the existing `Promise.all` with the same channel signal and returns `brandTokens`, and `app/layout.tsx` passes it on. `StorefrontDocument` gains a `<head>`: `<style id="cmsb-header-offset">` always (`73px`, `121px` from 877px: the sticky `.industria-header` plus `.industria-nav` as `globals.css` sizes them, because no header-height variable exists to read), and with tokens the font links and `<style id="cmsb">` (asset fonts rebased onto the API origin). Test green (7), RED on `Cannot find module '/lib/api/brand'`. **Coordinator decision 1:** `GET /api/v1/storefront/cms/brand-tokens` declares `salesChannelAccess: 'open'` and has a `cms` entry in `CHANNEL_ACCESS_OPEN_ROUTES` (`backend/test/helpers/channel-access-open-routes.ts`). The changed assertion is *the routes answering on a closed channel are exactly the ledgered ones* in `backend/test/contract/sales_channels/channel-access-open-routes.test.ts`, whose expected set gains the route. It was RED with the entry and without the route option (`ledger entries the server refuses on a closed channel`) and is green with both (3 tests; `routes=213 open=36`).
- [X] T027 [US1] Admin preview: `packages/modules/cms/src/admin/components/PageBuilderEditor.tsx`
  requests the descriptor with the page's first sales channel. Through Puck's `overrides.iframe` it
  injects `<style id="cmsb">` and the font links into the iframe document, and updates them when
  the descriptor changes. Test: **RED** `admin/test/modules/cms/preview-brand-tokens.test.tsx`
  checks that the iframe document receives the tag with the descriptor's primary colour.
  **Result (2026-10-22):** `cms/src/admin/components/PreviewBrandTokens.tsx`: `PreviewBrandTokens` writes, updates and removes `style#cmsb` and `link[data-cmsb-font]` in the document Puck hands `overrides.iframe`, and `PreviewBrandTokensProvider` around `<Puck>` carries `descriptor.brandTokens`, because the overrides are memoised once. `cmsClient.getPageBuilderConfig(salesChannelId?)` adds `?salesChannelId=`. `PageBuilderEditor` gains `salesChannelId` (the descriptor is refetched when it changes), and `PageEditor` passes `scope.salesChannelIds[0] ?? null`; the other editors pass none and get the global set. Test green (6), RED on the missing component: injection with the primary colour inside `<StrictMode>`, update, removal, the provider path, font links, the query string, and the wiring checked on the source (jsdom does not paint the iframe).

**Verification**: T023, T024, T026 and T027 by file, then:

```bash
pnpm --filter @endora-commerce/cms-components run build
pnpm --filter storefront exec vitest run test/ssr/blocks.test.tsx   # SSR floor unchanged
```

### 3c. Brand screen (FR-006–FR-006c, XVI) [UI]

- [X] T028 [P] [US1] **RED** `admin/test/modules/cms/brand-page.test.tsx`:
  - the screen loads global tokens;
  - the channel picker switches to "overrides for <channel>" with an "inherits global" state and
    a "Reset to global" action;
  - an overridden channel shows the notice that later global changes do not apply to it (spec
    Assumptions, channel brand overrides);
  - editing the primary colour shows a live sample in the light, muted and dark schemes;
  - a low-contrast pair shows an `Alert` with the pair name, and Save stays enabled;
  - a font of kind `asset` opens the asset picker filtered to font files;
  - a user without `cms.brand` sees read-only fields and no Save;
  - a 409 shows the conflict message and reloads.
  **Result (2026-10-22):** 8 tests inside `<StrictMode>` over the real session/presence providers and `apiClient` stubs, RED on `Failed to resolve import ".../admin/pages/BrandPage"`, green after T029. The channel is named by the picker (`SalesChannelPicker` returns an id only), so "overrides for <channel>" is the picker's selected row plus the inherits/overridden state, not a heading carrying the name. Reset of a stored override asks `window.confirm` first. The asset case asserts the `GET /api/v1/admin/assets?…mime=font%2F` request.
- [X] T029 [US1] Write `packages/modules/cms/src/admin/pages/BrandPage.tsx`, with sections for
  Colours, Schemes, Typography, Buttons, Spacing and Layout. It is composed from admin-kit
  `PageHeader`, `Section`, `Card`, `ColorPicker`, `Select`, `Input`, `Alert`, `SaveButtonGroup`,
  `sales-channel-picker` and `asset-picker` (plan IX). Add the API client to
  `packages/modules/cms/src/admin/api/cms-client.ts`, and the route plus nav entry to
  `packages/modules/cms/src/admin/index.ts`. Put every string in `packages/modules/cms/i18n/{en,pl}.json`
  under `brand.*`. T028 goes green.
  **Result (2026-10-22):** `pages/BrandPage.tsx` (scope card, Colours with palette/gradient/neutral scale, Schemes with the dark decorative backdrop, Typography with the two font roles and a type-scale table, Buttons, Spacing, Layout; contrast `Alert` from `assessBrandContrast(draft)`, Save never disabled by it; the client re-validates with `cmsBrandTokensSchema` and names refused fields; read-only without `cms.brand`), `components/BrandPreview.tsx` (light/muted/dark samples in a **shadow root**: `brandTokensToCss` with `:root`→`:host`; `@font-face` rules and stylesheet links go to the admin head under `data-cmsb-preview-font`, since a shadow tree registers no font face), `components/BrandFontFields.tsx` (system/asset/stylesheet). `cmsClient.getBrandTokens`/`putBrandTokens`. 146 `brand.*`/`nav.cmsBrand.*`/`actions.openCmsBrand.*` keys in `cms/i18n/{en,pl}.json`. Route `/cms/brand` (`cms.read`) and nav row (content, weight 450, icon `Layers`) in `admin/index.ts`. **Palette action deferred from T019:** `open-cms-brand` → `/cms/brand`, `cms.read`, icon `Layers` (no palette glyph on `KnownIconNameSchema`; none added), weight 136, ten keywords (the schema's ceiling: the contract's six plus `marka`, `czcionki`, `kolory`, `motyw`); added to `SUBJECTS` in `batch-sixteen-palette-off-state.test.ts`, to the route/nav table of `admin/test/modules/batch-sixteen-surfaces.module-owned-surface.test.tsx` and to `cms/src/backend/manifest.test.ts`; `composer:generate` re-rendered `docs/docs/module-reference/cms.md` (the action row, and the `cms.brand` permission row it was still missing). **admin-kit addition (no new primitive):** `AssetPicker`/`AssetFieldPicker` `acceptMimePrefix` admits `'font/'` (the uploader is not narrowed by it) — T101 owes `@endora-commerce/admin-kit` a changeset. Checks: `check:action-route-permissions` (`open-cms-brand` resolves to `cms.read`, findings unchanged at 2 ledgered), `check:class-vocabulary` findings=0, `i18n:hardcoded` regressions=0.

**Verification**: `pnpm --filter admin exec vitest run test/modules/cms/brand-page.test.tsx`, plus
admin and module `typecheck`/`lint`.

### 3d. Section settings, schemes, backgrounds (FR-000–FR-005, FR-010)

- [X] T030 [P] [US1] **RED** `packages/cms-components/src/components/Section.test.tsx`. The
  `Section` wrapper at the top level renders `<section class="cmsc-section" id=… data-cmsb-scheme=…
  data-width=…>` with padding custom properties per breakpoint. Nested, it renders children only.
  Background cases:
  - an image gives a positioned `Picture` with an overlay element;
  - a video gives two `<video muted playsinline loop preload="none" poster>` elements with
    `data-bp="mobile|desktop"`;
  - `decorative` paints `--cmsb-decorative` (R-8a).

  A scheme of `inherit` sets no attribute.
  **Result (2026-10-22):** `src/components/Section.test.tsx` (19) RED on `Failed to resolve import "./Section.js"`, plus `src/hooks/use-breakpoint-video.test.tsx` (8, jsdom; RED on the missing hook): only the visible breakpoint's video plays, never under reduced motion or without IntersectionObserver, a single video is `data-bp="all"`. Beyond the list: spacing vars per tier (`--cmsc-section-pt|pb[-md|-lg]`, a token reads `var(--cmsb-space-<t>, <built-in px>)`), `{px}`, custom width vars, gradient/solid overlays, solid/gradient paint incl. `token:`, the spacing scale equal to `DEFAULT_BRAND_TOKENS.spacing`, and stylesheet assertions (scroll-margin, padding-only spacing, layered scheme defaults).
- [X] T031 [US1] Write `packages/cms-components/src/components/Section.tsx` and
  `src/hooks/use-breakpoint-video.ts`. The hook plays only the visible video when `matchMedia`
  and `IntersectionObserver` agree, and never under `prefers-reduced-motion`. Add the
  `.cmsc-section*` and `[data-cmsb-scheme]` rules to `cms-components.css`, including
  `scroll-margin-top: var(--cmsb-header-offset, 0px)`. Spacing is padding only, so adjacent dark
  sections touch (FR-005). T030 goes green.
  **Result (2026-10-22):** `Section.tsx` (`Section`, `withSection`, `SECTION_ADOPTION_DEFAULTS`) and `hooks/use-breakpoint-video.ts`, both on the barrel. Media layer absolutely placed (`z-index:-1`, `isolation`), so no CLS; image via `Picture` (art direction, lazy); videos `muted playsInline loop preload="none" poster`, no autoplay. CSS: `.cmsc-section*` (padding-only spacing incl. side padding vars, widths `contained|wide|full|viewport|bleed|custom`, frame, editor neutralisation, nested in-flow rows in a bleed section), scheme defaults = `DEFAULT_BRAND_TOKENS.schemes` inside `@layer base` so the unlayered `<style id="cmsb">` always wins. **Addition:** `brand-css.ts` writes `--cmsb-decorative: url(…)` into a scheme's rule when it has `decorativeAssetId` (new case in `brand-css.test.ts`, RED first), otherwise R-8a could not paint. T030 green.
- [X] T032 [P] [US1] **RED** `packages/page-builder-core/src/fields/section-field.test.tsx`:
  - the section field group shows anchor with live normalisation, scheme, background (with the
    mobile image, poster, mobile video, overlay, position and decorative), spacing top and bottom
    per breakpoint, and width;
  - `resolveFields(…, {parent: {…}})` hides the group, and `parent: null` shows it.
  **Result (2026-10-22):** `packages/page-builder-core/src/fields/section-field.test.tsx` (16, jsdom + react-dom/client, no Testing Library in this package) RED on `Failed to resolve import "./section-field.js"`. Also: the host-supplied asset input, the block's spacing default shown when unset, content position only on request, nothing written until an edit, the block's own `resolveFields` run first, and a fixed field set returned by it still gets the group back at the top level (Map, SimpleTable).
- [X] T033 [US1] Write `packages/page-builder-core/src/fields/section-field.tsx` and
  `src/types/section.ts` (extending `types/background.ts`). In the admin, replace the background
  sub-field with the asset-picker version in
  `packages/modules/cms/src/admin/components/PageBuilderEditor.tsx`, which applies to every
  section block, not the five-name list. T032 goes green.
  **Result (2026-10-22):** `fields/section-field.tsx` (`createSectionSettingsField`, `withSectionSettingsField`, `sectionFieldsFor`, `SECTION_FIELD_KEY`; the field carries `sectionDefaults`, `contentPosition`, `assetInput`) and `types/section.ts` (`SectionBackgroundValue` = `BackgroundValue` + R-9 keys, `SectionSettingsValue`, `SECTION_SPACE_FALLBACKS`, option lists), on the barrel. **Contracts (extend):** `sectionSettingsSchema.contentPosition` is now per breakpoint (`responsiveSchema`), as Row's is today; new case in `page-builder-props.test.ts`, RED first. Admin: `BackgroundFields.tsx` `AdminSectionAssetInput`/`withAdminSectionAssetInput`; `PageBuilderEditor` swaps it into every bundled block whose fields carry `section`. Test `admin/test/modules/cms/section-asset-input.test.tsx` (3; written after the wiring, so not seen RED). T032 green.
- [X] T034 [US1] `cms.Row` adopts `section`. **First**, add the Row case to the option-parity
  test (standing rule 14, RED). It maps:
  - `sectionLayout` → `width` (`viewport` and `bleed` included);
  - `contentMaxWidth` and `customMaxWidthPx` → `width: 'custom'` + `customMaxWidthPx`;
  - `contentPosition` and `background` → `section`;
  - margin and padding → spacing with `{px}`;
  - `cornerRadius`, `shadow`, `border`, `overflow`, `minHeight` and the inner column fields kept.

  Then implement the mapping of data-model §3.4. At the top level, `section` carries those
  options; nested rows keep today's fields. A top-level row's default spacing equals today's
  default padding as `{px}`. The block lives in
  `packages/cms-components/src/components/Row.tsx`, its type in `src/schema/component-types.ts`,
  and its `responsiveFields` and `translatable` in `packages/modules/cms/src/manifest.ts`. Update
  the Row fixture in `packages/modules/cms/src/backend/services/translation/block-declarations.test.ts`.
  Test: `Row.test.tsx` covers a top-level dark row with an anchor, and a nested row ignoring its
  `section`.
  **Result (2026-10-22):** `option-parity.test.ts` created with the Row case (8; Row's `origin/master` b816c1d55 fields as literals) RED on `rowSectionFromLegacy is not a function` / no `section` field, then green. `Row.tsx`: `withHideOn(withSectionSettingsField(…, {defaults: {px:16}×2, contentPosition: true}))`; top level renders through `Section` with the row's box (margin, border, radius, shadow, side padding) on the `<section>`; `rowSectionFromLegacy` maps `sectionLayout`/`fullBleed` → width, `contentPosition` → start/center/end per tier, `background` as is, padding above/below → `{px}` per tier; a row with no `section` renders from it, and `resolveData` writes it at the top level; `resolveFields` hides `sectionLayout`, `contentPosition`, `background` at the top level and relabels padding "Inner spacing (left and right)"; nested rows render exactly as before. **Deviation:** `contentMaxWidth`/`customMaxWidthPx` stay the row's own content frame at both levels (one `width` cannot hold both an outer extent and a 720 px frame, which an editor can set today), with `section.width: 'custom'` offered beside them; `margin` stays the row's outer margin rather than folding into padding (folding changes a row with a background). `Row.test.tsx` (6). `component-types.ts` `RowProps.section`, `SectionBlockProps`. Manifest: `'section'` in Row's `responsiveFields`; `translatable` unchanged. `block-declarations.test.ts` Row fixture carries legacy and section values, expected `[]`. **Changed existing assertion (standing rule 13):** `fallback-parity.test.tsx` "cms.Row keeps today's page container…" reads the container frame from `.cmsc-section[data-width="full"] > .cmsc-section__frame` instead of `.cmsc-pb-row-inner` (values unchanged); two cases added (default top-level render: 16 px all sides, contained, no colour; nested `full_width` row keeps its frame).
- [X] T035 [US1] Add `section` to the blocks that otherwise keep their shape (data-model §4):
  `cms.LogoStrip`, `cms.Video`, `cms.Map`, `cms.SimpleTable`, `catalog.CategoryGrid` and
  `catalog.CategoryList`. That means the component files, `component-types.ts`, and both
  manifests (`cms`, `catalog`). One parameterised test,
  `packages/cms-components/src/components/section-adoption.test.tsx`, renders each at the top
  level with `scheme: 'dark'` and an anchor, and nested.
  **Result (2026-10-22):** `withSection(config, {defaults: SECTION_ADOPTION_DEFAULTS})` on `LogoStrip`, `Video`, `Map`, `SimpleTable`, `CategoryGrid`, `CategoryList`; their props interfaces extend `SectionBlockProps`; other fields, defaults and renders untouched (legacy margin/padding/border keep applying at both levels), and spacing defaults to `none` so stored pages look the same. `section-adoption.test.tsx` (30 = 5 × 6) RED on the missing wrapper (18 failed), green after; covers top level dark + anchor, nested ignored, no spacing without `section`, the field group top-level only with every other field kept, `section` not in `defaultProps`. Manifests: `'section'` added to the six `responsiveFields` (`cms`, `catalog`); `block-declarations.test.ts` fixtures of the four `cms` blocks carry a `section` (expected unchanged).

**Verification**: the tests above by file, plus
`pnpm --filter storefront exec vitest run test/ssr/blocks.test.tsx test/ssr/block-ssr-floor.ts`
and `pnpm --filter backend run check:block-names`.

### 3e. Anchors (FR-001, edge case "anchor values")

- [X] T036 [P] [US1] **RED** `packages/modules/cms/src/backend/services/anchor-guard.test.ts`.
  `collectTreeAnchors(languages)` finds section anchors and rich-text heading `id`s at any depth,
  including slots in array items and carousel slides. `assertAnchors`:
  - refuses a duplicate within one language tree with `CMS_DUPLICATE_ANCHOR {anchor}`;
  - allows the same anchor in two language trees;
  - refuses `main-content`, `cmsb` and every id in `storefront/app/reserved-anchors.ts` (mirrored
    as a contract constant `RESERVED_ANCHORS` in `packages/contracts/src/page-builder-props.ts`)
    with `CMS_RESERVED_ANCHOR`.
  **Result (2026-10-22):** `anchor-guard.test.ts` (20) RED on the missing module, then green: `collectTreeAnchors` reads `props.section.anchor` only on the components of a language tree's root `content` (coordinator ruling: section settings render only at the top level and the field is hidden on nested blocks, so a stale nested anchor must not refuse a save; tested), and TipTap `heading.attrs.anchor` at any depth (array-item slots, slides, legacy zones, legacy `tiptapContent`), so a nested heading anchor does conflict with a root section anchor (tested); `InsertBlock` not followed; the synced `html` is deliberately not read (it repeats the doc's anchors); reserved and duplicate refusals are `422` with `details: {anchor}`; `RESERVED_ANCHORS` lives in `page-builder-values.ts` (re-exported through `page-builder-props.ts`): `main-content`, `cmsb`, `cmsb-header-offset`, `b2b-locale`, `b2b-currency`, `ga-gtag-src`, `ga-gtag-init`, `gtm-init` (the ids the root layout and its chrome render).
- [X] T037 [US1] Write `packages/modules/cms/src/backend/services/anchor-guard.ts` and call it from
  `setContent` in `cms-page-service.ts`, `cms-block-service.ts` and `cms-template-service.ts`
  (422). Create `storefront/app/reserved-anchors.ts`, exporting the contract constant. **RED →
  green** `backend/test/contract/cms/anchors.contract.test.ts` `[PG]`: a page `PUT` with a
  duplicate gets 422 naming the anchor, a block `PUT` likewise, and a template `PUT` likewise.
  **Result (2026-10-22):** `assertAnchors({[language]: data})` runs in each `setContent` after the version check, inside the Command, so a refusal writes and audits nothing (the written language tree only; other languages are their own trees); no route change needed (`HttpError` 422 carries `details.anchor`). `storefront/app/reserved-anchors.ts` re-exports the contract constant. `anchors.contract.test.ts` `[PG]` (6: duplicate and reserved × page, block, template) RED on `expected 200 to be 422`, then green.

**Verification**: T036 by file, T037 `[PG]`.

### 3f. Headings, buttons, colour tokens (FR-007–FR-009)

- [X] T038 [P] [US1] **RED** the Heading and Button cases in the option-parity test (standing
  rule 14):
  - Heading `fontFamily`, `fontStyle`, `color`, `fontSize`, `fontWeight`, `textAlign` and
    `lineHeight`;
  - Button `variant` (`ghost` → `fill: 'text'`), `backgroundColor`, `textColor`, `target` and the
    link types.

  Also **RED** `packages/cms-components/src/components/Heading.test.tsx`:
  - `level: 'h2'` with `size: 'display'` renders `<h2 class="cmsc-t cmsc-t--display">`;
  - `level: 'p'` renders `<p>`;
  - an `emphasis` gradient phrase renders `span.cmsc-em--gradient`;
  - a legacy `text: 'Plain'` renders as text;
  - `size: {px: 37}` with a custom font family and weight 300 renders those literal values (the
    Custom override);
  - the default is `level: 'h2'`, `size: 'h2'`, with today's default colour.

  Also **RED** `Button.test.tsx`: a `ButtonSpec` with `link.kind: 'anchor'` renders
  `href="#start"`, `iconPosition: 'only'` renders an `aria-label`, `fill: 'text'` renders today's
  ghost look, and `backgroundColor`/`textColor` overrides apply.
  **Result (2026-10-22):** `option-parity.test.ts` +9 (Heading 4, Button 5; origin/master b816c1d55 fields as literals, now 17), `Heading.test.tsx` (9), `Button.test.tsx` (9), all RED on `headingFromLegacy`/`buttonFromLegacy is not a function`, missing fields and the old markup, then green after T039. Extra cases: a colour token, a Custom px size per tier, a stored heading and a stored button rendering as before, Button `align`. Default-look check in `src/brand/fallback-parity.test.tsx` (now 9). **Changed existing assertions (standing rule 13):** "cms.Button: each variant keeps today's colours…" reads `cmsc-btn--primary-<fill>` and `--cmsc-btn-border` instead of `cmsc-pb-btn-<variant>` (values unchanged; checked for stored and reshaped buttons); "cms.Heading: every level keeps today's size…" renders each level both stored (no `size`) and reshaped (`size` = level), since the new default `size` is `h2`; the unused `declared()` helper was removed. One case added: the default Heading (h2, 40px, 700, 1.12, #15202b, today's font stack, left).
- [X] T039 [US1] Reshape `cms.Heading` and `cms.Button` per contracts/blocks.md. The files are
  `src/components/Heading.tsx` and `Button.tsx`, `component-types.ts`, the `cms` manifest (with
  Heading `translatable: [{path: 'text', format: 'tiptap'}]` and Button `button.label`), the admin
  overrides in `PageBuilderEditor.tsx` (the link field), and the fixtures in
  `block-declarations.test.ts`. Heading keeps font, size, weight, style and line height as
  **Custom** overrides of the tokens in an "Advanced" group (contracts/blocks.md). Nothing is
  removed. T038 and the two parity cases go green.
  **Result (2026-10-22):** `Heading.tsx`: `text` is `InlineRichText` rendered by `InlineRich` (legacy string read as text), `level` h1–h6 or `p`, `size` a responsive type token or `custom` (+ responsive `fontSize`, `{px}` accepted on read), `align` start/center/end, `color` token or hex, and an "Advanced:" group (`font` heading/body/custom, `fontFamily`, new `customFontFamily`, `fontWeight`, `fontStyle`, `lineHeight`); defaults `level`/`size` h2, `font: 'heading'`, no literal colour. New `.cmsc-t--<token>` rules in `cms-components.css` read `--cmsb-t-<token>-size|lh|w|ls` with the built-in scale as fallback (`typography.ts` `TYPE_SCALE_FALLBACKS`). `headingFromLegacy` maps a stored heading (resolveData, once); a heading with no `font`/`size` renders as before. `Button.tsx`: `button: ButtonSpec` (responsive style/fill) + `align`, rendered by `ButtonView`; `buttonFromLegacy` maps a stored button (render and resolveData). `secondary` → primary/outline stays white-filled through `.cmsc-pb-button { --cmsc-btn-outline-bg: var(--cmsb-bg, #ffffff) }` (the outline rules now read `--cmsc-btn-outline-bg`, transparent elsewhere). Alignment helpers in new `block-align.ts`. `page-builder-admin`: `createButtonListField({responsive})` and new `createButtonSpecField`; `PageBuilderEditor.tsx` swaps `cms.Button`'s `button` for it (the old `linkSlug` override removed; Hero's kept). Manifest: Heading `translatable: [{path:'text', format:'tiptap'}]`, Button `[{path:'button.label'}, {path:'label'}]` (the second keeps unopened stored buttons translated), fields and `responsiveFields` updated (also in `cms-components/src/index.ts`). **Codec (addition):** `translation/extract.ts` reads a plain string under a `tiptap` declaration as plain text, so stored headings stay translatable; `block-declarations.test.ts` Heading/Button fixtures reshaped plus a "stored before the reshape" case for each (33). **Deviations:** the heading's inline canvas editing (`contentEditable` textarea) is replaced by the inline rich-text field; `reveal` is not added (Phase 12); a stored heading's `fontWeight`/`lineHeight` now apply without a custom size (today they were ignored unless `fontSize` was set); a stored url button with an unsafe URL renders without a link.
- [X] T040 [US1] Colour fields accept token references. In
  `packages/page-builder-core/src/fields/color-field.tsx` and `color-field-utils.ts`, the palette
  popover lists "Brand" roles first and stores `token:<role>`. Add `resolveColorValue(value)` in
  `packages/cms-components/src/utils/` (`token:primary` → `var(--cmsb-color-primary)`, hex
  unchanged) and use it wherever blocks apply a colour prop. Test: `color-field-utils.test.ts` and
  `resolve-color-value.test.ts`.
  **Result (2026-10-22):** RED first: `color-field-utils.test.ts` +4 (now 9), `cms-components/src/utils/resolve-color-value.test.ts` (4). `page-builder-core/src/types/brand-colors.ts` (on the barrel): `BRAND_COLOR_ROLES` (six roles with their default literals), `brandColorRole`, `brandColorFallback`, `resolveColorValue` (`token:<role>` → `var(--cmsb-color-<role>, <literal>)`, unknown role → undefined, anything else unchanged). `cms-components/src/utils/color-value.ts` re-exports it (the role table moved out of it, not duplicated), keeps the strict `colorValueToCss`, adds `iconColorProps` (a token strokes `currentColor`). Applied in `typographyStyle` (Heading, Text), `backgroundToStyle` (solid, gradient), AnnouncementBar, Hero, Stats, Spacer, FeatureList, Icons, Social and the ImageSlider caption. Colour field: commits `token:<role>` only when the palette context has `brandRoles` (opt-in; the e-mail builder renders for mail clients and stays hex-only). `ColorPaletteModal` lists "Brand colors" first when picking (effective colours from the descriptor's brand tokens, else the defaults); `PageBuilderColorPaletteProvider` takes `brandColors`, passed by `PageBuilderEditor`. Nine `pageBuilder.colorPalette.*` keys in `_i18n/i18n/{en,pl}.json`, literal `t()` calls (`chrome-core-namespace.test.tsx` green).
- [X] T041 [US1] Conformance fixture: rewrite the `cms.Heading` props in
  `backend/scripts/conformance/seed-storefront-fixtures.ts` to `{text: {type: 'doc', …}, level:
  'h1', size: 'h1'}`, and update `storefront/test/conformance/assertions.ts` if it reads the
  heading text. Run `pnpm --filter backend run check:block-names`.
  **Result (2026-10-22):** `seed-storefront-fixtures.ts` writes `{level: 'h1', size: 'h1', font: 'heading', text: {type: 'doc', …}}`. `storefront/test/conformance/assertions.ts` unchanged: `firstHeadingText` strips markup, and `InlineRich` renders the paragraph as a text node. `check:block-names`: `declared=87 rendered=87 … findings=0` (after rebuilding `mod-cms`, whose stale `dist` it reported first).

**Verification**: the tests above by file, the SSR floor, `check:block-names`, and filtered
`typecheck`/`lint` of `cms-components`, `page-builder-core`, `mod-cms`, `admin`, `storefront` and
`backend`.

**Checkpoint (MVP)**: US1 is demonstrable through quickstart §1–§2.

---

## Phase 4: User Story 2 — a full hero for landing pages (P1)

**Story goal**: a hero with media and a mobile alternative, an eyebrow, a title, a subheading
and a statement (each with its own level and size), rich text, any number of buttons, a
scroll-down button and social proof (FR-011, FR-012).

**Independent test**: spec US2. Quickstart §3.

- [X] T042 [P] [US2] **RED** the Hero case in the option-parity test (standing rule 14):
  - `heading` and `subtitle`;
  - the button and its colour overrides;
  - `background` (solid, gradient, image, video);
  - `overlayOpacity`, `textColor`, `contentAlign`, `minHeightPx`, `cornerRadius`, `shadow` and the
    box fields.

  Also **RED** `packages/cms-components/src/components/Hero.test.tsx`:
  - default props render a non-empty hero;
  - three buttons keep their styles;
  - an icon-only button with `link.kind: 'anchor'` gets an `aria-label`;
  - an image hero at the top level in first position renders `fetchpriority="high"`, and a second
    hero renders lazily;
  - a video hero renders the two breakpoint videos with a poster;
  - a reduced-motion environment (mock `matchMedia`) never calls `play()`;
  - `titleLevel: 'p'` with `titleSize: 'display'` renders a `<p>`;
  - the social proof caption renders;
  - the default has no overlay, `align: 'center'`, `titleSize: 'h1'` and today's colours;
  - `media.kind: 'solid'` and `'gradient'` render as today's backgrounds.
  **Result (2026-10-23):** `option-parity.test.ts` +7 Hero cases (origin/master b816c1d55 `HERO_FIELDS` and `HeroProps` as literals, 20 fields mapped; file now 24) and `src/components/Hero.test.tsx` (14, jsdom), RED on `heroFromLegacy is not a function`, the missing `buttons`/`media` fields and the old markup, green after T043. Beyond the list: a hero after another block or nested is lazy; a video plays once on screen when motion is allowed; the 40 % overlay is proposed only when media is first chosen and a chosen overlay is kept; a stored hero renders its texts, overlay, alignment and button as before. **First-position approach:** `useSectionContext().topLevel` plus Puck's public `renderContext` (`data.content[0].props.id === id`), so nothing is stored or threaded through render sites; the editor canvas (no `<Render>`) loads lazily; caveat: an embed's own `<Render>` makes its first block "first" when the embed is at the top level.
- [X] T043 [US2] Reshape `cms.Hero` per contracts/blocks.md:
  - `packages/cms-components/src/components/Hero.tsx`, composing `Section`, `Picture`,
    `InlineRich`, `ButtonView` and `use-breakpoint-video`;
  - `component-types.ts`;
  - the `cms` manifest fields, `responsiveFields` and `translatable`;
  - the admin overrides in `PageBuilderEditor.tsx`: remove the `buttonLinkSlug` override, and use
    the button-list and responsive-image fields;
  - the `cms.Hero` fixture in `block-declarations.test.ts`.

  Name the changed assertions in:
  - `backend/test/contract/cms/page-builder-translation.contract.test.ts` (Hero paths);
  - `backend/test/contract/catalog/category-content.test.ts`;
  - `admin/test/modules/cms/page-builder-i18n.test.ts`.

  T042 goes green.
  **Result (2026-10-23):** `Hero.tsx` composes `Section` (`withSection`, spacing `none` as `SECTION_ADOPTION_DEFAULTS`, so stored heroes look the same), `Picture` (eager + `fetchpriority="high"` only as the page's first top-level block), the breakpoint video pair (`preload="none"`, poster, no `autoplay`, played by `useBreakpointVideo`), `InlineRich`, `ButtonView` and the rich body (`htmlFromTiptap`, new `fields/rich-text-doc-field.tsx`); media `background` or `above` (above reserves a 16:9 frame); overlay in today's slate `rgb(15 23 42)`, solid = today's `overlayOpacity`; `minHeight` auto/half/tall/screen/Custom (`minHeightPx`), `gaps`, per-text `…Size`/`…SizePx` Custom, all responsive through CSS variables (no JS tier on the storefront). `heroFromLegacy` (render and `resolveData`) carries every origin field; a carried hero keeps today's title/subtitle look (no size token) and spacing (no `gaps`). Defaults: no media/overlay, title `h1`/`h1`, one primary button, scheme colours, and — **coordinator ruling 2026-10-23 (plan rule 3 over the contract)** — `align: 'start'` (today's `contentAlign: 'left'`) and no `gaps`, so today's 12 px / 20 px spacing under the title and subheading applies (new rule `.cmsc-pb-hero__subheading.cmsc-pb-hero__text--token { margin-bottom: 20px }`); changed assertions named in `Hero.test.tsx` (default case) and `fallback-parity.test.tsx` (default render: left-aligned, 12/20 px). `component-types.ts` `HeroProps`/`HeroMedia` (legacy fields `@deprecated`); `Button.tsx` exports `BUTTON_SPEC_OBJECT_FIELDS`/`specAtTier`, `Heading.tsx` `TYPE_SIZE_OPTIONS`; `use-breakpoint-video` takes a selector and `Section` now plays only its own `:scope > .cmsc-section__media` pair. Manifest/index: translatable `eyebrow`, `title`/`subheading`/`statement`/`body` (tiptap), `buttons[].label`, `socialProof.caption`, `media.image.alt`, **plus `socialProof.image.alt` (addition)** and legacy `heading`/`subtitle`/`buttonLabel`; `responsiveFields` updated. Admin: new `HeroFields.tsx` (`withAdminHeroFields`: library media control, `createButtonListField({responsive})`, responsive social-proof image); `PageBuilderEditor` uses it, drops the `buttonLinkSlug` override and takes `cms.Hero` out of the background-field loop; `resolveFields` filters the host's `params.fields` so the overrides survive. Tests: `admin/test/modules/cms/hero-fields.test.tsx` (8, `<StrictMode>`, RED on the missing module); `block-declarations.test.ts` Hero fixture reshaped + a "stored before the reshape" Hero (34). **Changed existing assertion (standing rule 13):** `fallback-parity.test.tsx` "cms.Hero keeps today's…" now renders a hero stored with origin's `defaultProps` (values unchanged, plus min height, margins, overlay and alignment); one case added for the new default render (h1 48px/700/1.12, `#15202b`, today's font, centred, primary button, no overlay; file 10). The three named tests (`page-builder-translation` [PG] 18, `category-content` [PG] 14, `page-builder-i18n` 3) pass **unchanged**. **Deviations:** `reveal` deferred to Phase 12; stored video heroes no longer autoplay unconditionally (FR-012); `createButtonLinkSlugField` has no caller left (kept, still tested; its "kept until reshape" comments are now stale — noted for T103); an embed's first hero loading eagerly is accepted.
- [X] T044 [US2] i18n field labels for Hero, Heading and Button under `blocks.<name>.fields.*` in
  `packages/modules/cms/i18n/{en,pl}.json`, resolved by
  `packages/modules/cms/src/admin/components/page-builder-i18n.ts` (R-24; implemented in T095; this
  task adds the keys). The keys must exist before T094's test enumerates them.
  **Result (2026-10-23):** 254 keys per language in `cms/i18n/{en,pl}.json` (real Polish), inserted after each block's `description`: `blocks.{hero,heading,button}.fields.<field>.label` and `….options.<value>` for every field and select option of the reshaped blocks (incl. `hideOn`, and `section` for the hero); sub-fields of object/array fields as `….fields.<field>.fields.<sub>.label` (an extension of R-24's grammar for T095 to confirm). `HeroFields.tsx` already reads three of them (`media.fields.kind`, `.videoSource`, `.image`) for its accessible names, which `i18n:hardcoded` required (`regressions=0`).

**Verification**: T042 by file, the three named existing tests, the SSR floor, and the
`page-builder-translation` contract test `[PG]`.

---

## Phase 5: User Story 3 — media-and-text and call-to-action compositions (P1) [UI]

**Story goal**: MediaText, BackgroundPanel, CtaCard and Statement are new. FeatureList, Stats and
Testimonial are reshaped (FR-013–FR-018).

**Independent test**: spec US3. Rebuild an "about us" page from these blocks plus the hero and
compare at 375, 768 and 1440 px.

- [X] T045 [P] [US3] **RED** `packages/cms-components/src/components/MediaText.test.tsx`:
  - `mediaSide: 'end'` puts the media after the text on desktop (`data-media-side`);
  - `mobileOrder: 'text-first'` sets `data-mobile-order`;
  - `rows` with `alternate` flip the side per row;
  - features render the icon, title and body;
  - the footnote renders;
  - a video renders with a poster and `preload="none"`.
  **Result (2026-10-23):** `MediaText.test.tsx` (12, jsdom, through Puck's `<Render>`), RED on the block not being registered (nothing rendered), green after T047. Beyond the list: neutral defaults (h2 at the h3 size, start side, media first, `5-5`, centred, a 4:3 placeholder frame), the side and mobile order also asserted on the stylesheet's media-query rules, `data-split`/`data-valign`, the divider only between rows, buttons through `ButtonView`, a lazy image in a ratio frame, autoplay = muted/looped/`data-bp="all"` with no `autoplay` attribute (else `controls`), and section at the top level only.
- [X] T046 [P] [US3] **RED** `BackgroundPanel.test.tsx`, `CtaCard.test.tsx` and
  `Statement.test.tsx` in `packages/cms-components/src/components/`. The cases are text side and
  mobile position, the card scheme and two-column list, and a statement with a muted continuation
  and with a full-bleed image anchored at the bottom.
  **Result (2026-10-23):** `BackgroundPanel.test.tsx` (5), `CtaCard.test.tsx` (5), `Statement.test.tsx` (4), RED on the unregistered blocks, green after T047. Beyond the list: the panel's art-directed lazy image, min height per breakpoint as `--cmsc-panel-min-h(-md|-lg)`, an uploaded icon as a `currentColor` mask; the card's `data-decorative`, image side and rich body; the statement's neutral default (h2 at h3, start) and no bleed without an image.
- [X] T047 [US3] Write `MediaText.tsx`, `BackgroundPanel.tsx`, `CtaCard.tsx` and `Statement.tsx`.
  Register them in `packages/cms-components/src/index.ts` (barrel and `defaultPageBuilderConfig`).
  Add their types to `component-types.ts`. Declare them in the `cms` manifest under `content` with
  fields, `responsiveFields`, `translatable` (contracts/blocks.md), `labelKey`/`descriptionKey`
  and `en`/`pl` labels. Add fixtures to `block-declarations.test.ts` and CSS to
  `cms-components.css`. T045 and T046 go green.
  **Result (2026-10-23):** `MediaText.tsx`, `BackgroundPanel.tsx`, `CtaCard.tsx`, `Statement.tsx` (each `withHideOn(withSection(…))`, default section spacing `l`), the shared renderers `section-parts.tsx` (heading with level/size token or Custom px, rich body, button row, `ItemIcon` — catalog icon or uploaded SVG as a `mask-image` filled with `currentColor` — and responsive values as custom properties per breakpoint, never a script-decided tier) and `fields/section-block-fields.ts`; registered in `index.ts`, types in `component-types.ts`, CSS appended to `cms-components.css` (every `--cmsb-*` with its literal). Manifest: weights 92/94/96/98 in `content`, `translatable` per contract **plus `rows[].media.image.alt` (addition)**, `en`/`pl` labels; `block-declarations.test.ts` fixtures for the four. Admin: new `admin/components/SectionBlockFields.tsx` (`withAdminSectionBlockFields`: MediaText media control with image/video/poster/autoplay, button lists, image and uploaded-icon pickers), applied in `PageBuilderEditor.tsx`; test `admin/test/modules/cms/section-block-fields.test.tsx` (7, `<StrictMode>`, RED on the missing module). **Deviations:** "full bleed" is the section's `width: 'bleed'` — the panel's `defaultProps` carry `section: {width: 'bleed', spaceTop/Bottom: 'none'}`, and a statement proposes it in `resolveData` when its first image is chosen (a width already set is kept) — rather than a CSS breakout; Statement `reveal` deferred to Phase 12 (as Hero); new blocks carry no legacy box fields (the contract lists none).
- [X] T048 [P] [US3] **RED** the FeatureList, Stats and Testimonial cases in the option-parity test
  (standing rule 14):
  - FeatureList: `columns`, `gap`, `iconColor`, `iconSize` and `align`;
  - Stats: `columns`, `gap`, `align` and `valueColor`;
  - Testimonial: avatar URL/library, `background`, `cornerRadius` and `shadow`.

  Also **RED** `FeatureList.test.tsx`, `Stats.test.tsx` and `Testimonial.test.tsx`.
  They cover columns 1–4 per breakpoint as CSS variables; an uploaded SVG icon rendered with
  `mask-image` and `background-color: currentColor` (US3 acceptance 2); an image below the
  grid; stats with an image and a 2 × 3 grid (US3 acceptance 3); a testimonial with the
  image-overlay layout. Each block's default render without the new optional props equals today's
  (`layout: 'card'` for the testimonial).
  **Result (2026-10-23):** `option-parity.test.ts` +11 (FeatureList 4, Stats 4, Testimonial 3; origin/master b816c1d55 fields as literals, every field mapped; file now 35), `FeatureList.test.tsx` (8), `Stats.test.tsx` (5), `Testimonial.test.tsx` (6), RED on `featureListFromLegacy`/`statsFromLegacy`/`testimonialFromLegacy is not a function`, the missing `body`/`gapPx`/`avatar`/`layout` fields and the old inline-style markup; green after T049. Default renders added to `src/brand/fallback-parity.test.tsx` (now 13): FeatureList, Stats and Testimonial, each as the new default **and** as a block stored with origin's props, against origin's literals (mutation-checked). **No existing assertion changed.**
- [X] T049 [US3] Reshape `cms.FeatureList`, `cms.Stats` and `cms.Testimonial` (components, types,
  manifest, fixtures, admin overrides). Remove `cms.Testimonial` from the background-override name
  list in `PageBuilderEditor.tsx`, since every section block now uses the section field.
  `cms.NewsletterSignup` stays in that list until T076 settles its future. Name the changed assertion in
  `backend/test/contract/cms/page-builder-translation.contract.test.ts` (Testimonial paths). T048
  goes green.
  **Result (2026-10-23):** `FeatureList.tsx`, `Stats.tsx`, `Testimonial.tsx` reshaped as section blocks (`SECTION_ADOPTION_DEFAULTS`, so stored pages keep their spacing) with idempotent `*FromLegacy` applied at render and in `resolveData`: an item's `description` → rich `body`, a px `gap` → `'custom'` + `gapPx`, a px `iconSize` → `'custom'` + `iconSizePx`, `left`/`right` → `start`/`end`; the avatar fields → `avatar` (`ResponsiveImage`, today's alt "<author> avatar"), a plain quote → a document (rendered as text while unopened). Columns and gap are now CSS custom properties (`--cmsc-fl-*`, `--cmsc-stats-*`; today's JS viewport tier is gone, so no hydration shift). Today's title/value looks apply while no size token is chosen (`'default'` option); defaults keep today's look with `iconColor`/`valueColor` `token:secondary` (built-in `#0f766e`, today's teal). Manifest `translatable`/`responsiveFields` updated (plus legacy `items[].description`), fixtures reshaped plus "stored before the reshape" cases (block-declarations 41). Admin: `cms.Testimonial` removed from the background-override list; its card `background` keeps the library field through `withAdminSectionBlockFields`, with `image` and `avatar` pickers (the old avatar override removed). `page-builder-translation.contract.test.ts` [PG] 18/18 **unchanged** — no Testimonial assertion needed changing (a stored plain `quote` is read as plain text under the `tiptap` path). **Deviations (plan rule 3 / T048 "default render equals today's" over the contract's defaults):** FeatureList `columns` default 3 (not `{base:1, desktop:3}`), `gap` Custom 24 px (not `m`, which is 40 px on desktop), `titleSize` unset = today's look (not `h6`); the contract's Stats `grid` is today's `columns`, kept by name and 1–6 range; FeatureList/Stats `align` keep `end` (today's `right`).
- [X] T050 [US3] Field-label keys (`blocks.<name>.fields.*`, `en`/`pl`) for the seven blocks of
  this phase.
  **Result (2026-10-23):** 452 keys per language in `cms/i18n/{en,pl}.json` (real Polish), derived from the built configs' fields with T044's grammar (`….label`, `….options.<value>`, `….fields.<sub>.…` for object/array sub-fields; a field the admin replaces with one control — images, avatar, uploaded icon, section — has its label only; button lists carry the Hero's nine button sub-keys): the four new blocks' `label`/`description` plus fields before `blocks.logoStrip.label`, the three reshaped blocks' after their `description`. `SectionBlockFields.tsx` reads `blocks.mediaText.fields.media.fields.*` for its accessible names (`i18n:hardcoded` regressions=0).

**Verification**: the tests above by file, the SSR floor, `check:block-names`,
`block-declarations.test.ts`, and the translation contract test `[PG]`.

---

## Phase 6: User Story 4 — one carousel, many item kinds (P2) [UI]

**Story goal**: `cms.ContentSlider` becomes the Carousel. Its slides per view are CSS-driven, it
gains fade, peek, bleed, control placement and auto-hidden controls, and it gets four item
blocks. `cms.ImageSlider` is removed (FR-019–FR-022, FR-041a).

**Independent test**: spec US4. Quickstart §4 steps 1–2.

- [X] T051 [P] [US4] **RED** `packages/cms-components/src/components/carousel/CarouselShell.test.tsx`:
  - the server render sets `--pb-spv`, `-md` and `-lg` from `slidesPerView` and renders every
    slide (no tier-dependent JavaScript output, which fixes the hydration shift);
  - `effect: 'fade'` stacks the slides and toggles `aria-hidden`;
  - the arrows are `<button>` elements with accessible names;
  - when `scrollWidth <= clientWidth` (mocked), the controls get `hidden`;
  - autoplay is off by default and never starts under reduced motion;
  - `role="region"` with `aria-roledescription="carousel"`, and each slide is "n of m".
  **Result (2026-10-23):** `carousel/CarouselShell.test.tsx` (11, jsdom; SSR via `renderToString`, client via `createRoot`/`act`), RED on `no carousel region`, the missing `CarouselSlides` export and `CSS.escape` at render (old shell), green after T052. Beyond the list: server and client write the same `style` (no hydration shift), a CSS-length gap (brand variable), `labels` overrides (Polish sample), dots named "Go to slide n" with `aria-current`, `aria-controls` on the track, the slot list skipping a child that renders nothing, header/below/overlay placement, `bleed` classes, and the editor preview mode (no arrows, previewed page, `:nth-child` hiding CSS).
- [X] T052 [US4] Rewrite `packages/cms-components/src/components/carousel/CarouselShell.tsx` and
  the carousel CSS in `cms-components.css` (slide width `calc((100% - (spv - 1) * gap) / spv)`,
  bleed via negative inline margin up to the viewport edge). Keep the editor preview mode
  (`editor-carousel-preview.ts`) working. Run the existing
  `packages/page-builder-core/src/editor/puck-action-guards.test.ts` unchanged. T051 goes green.
  **Result (2026-10-23):** `CarouselShell.tsx` rewritten: `--pb-spv(-md|-lg)`/`--pb-gap(-md|-lg)` on a `role="region"` root (fade forces 1), `CarouselSlides` (exported; each child a `group` "n of m", fade's inactive slides `aria-hidden`) used directly for lists and as Puck's published slot `as`, arrows as named `<button>`s with `aria-controls`, dots after measuring (fade lists: on the server), controls `hidden` when `scrollWidth <= clientWidth`, autoplay only when asked, never under reduced motion, paused on hover/focus, with a pause button; `aria-live` off while autoplaying. Editor mode kept (`previewPage`, `editorCarouselId`, `editorSlideCount`, page CSS without `CSS.escape`; whole slides per view at the previewed tier). Stylesheet: the carousel block replaced (`--cmsc-slide-w: calc((100% - (spv - 1) * gap) / spv)` per breakpoint, block track + flex slide list, fade grid, `bleed-end`/`-both` via negative margin and matching padding, header row, placement rules, hidden controls keep their box so hiding shifts nothing, 24 px dot targets drawing today's 8 px dot, 44 px hit area around today's 36 px arrows, focus rings), every `--cmsb-*` with today's literal. **Editor guard (addition):** `CAROUSEL_SLIDE_TYPES` in `page-builder-core/src/editor/puck-action-guards.ts` (on `./editor` and `./editor/puck-guards`) lets the four item blocks into `slides`; new `puck-action-guards.carousel-items.test.ts` (3, RED on `CAROUSEL_SLIDE_TYPES is not iterable`); `puck-action-guards.test.ts` and `editor-carousel-preview.test.ts` unchanged and green (12 with the new file). `catalog.ProductSlider` keeps its JS tier until T071.
- [X] T053 [P] [US4] **RED** `CarouselImage.test.tsx`, `CarouselSplit.test.tsx`,
  `LinkTile.test.tsx` and `DownloadTile.test.tsx`:
  - a download tile is a single `<a href={assetUrl} download>` with the label as its accessible
    name;
  - a missing asset renders nothing on the storefront and a warning in preview
    (`useBlockRenderEnvironment().preview`);
  - a link tile resolves each link kind;
  - `hoverZoom` sets a class;
  - a `CarouselImage` caption honours every `captionPlacement` and the `captionStyle` fields.

  Also **RED** the ImageSlider case in the option-parity test (standing rule 14). It maps every
  ImageSlider item field (image URL/library, `title`, `titlePlacement`, title background, colour,
  border colour, border width, border radius and padding) to `cms.CarouselImage`, and every
  slider option to the Carousel.
  **Result (2026-10-23):** `CarouselImage.test.tsx` (6), `CarouselSplit.test.tsx` (4), `LinkTile.test.tsx` (4), `DownloadTile.test.tsx` (4), all through Puck's `<Render>`, RED on the unregistered blocks; `option-parity.test.ts` +8 (now 43): a ContentSlider case (4: every origin field incl. `slides` allowing Slide and Row, ranges 1–8 / 0–48 px / 2–15 s, `contentSliderFromLegacy` value for value) and the ImageSlider case (4: every item field → `cms.CarouselImage` incl. the eight placements plus `below` and the five style fields, every slider option → the Carousel, `carouselImageFromImageSliderItem` value for value), RED on the missing modules and fields (`gapPx`, `controls`), green after T054. Download tile: one `<a href download>`, named by its content (title, subtitle, label; no `aria-label`), a file-type badge; missing asset → nothing for customers, `role="note"` warning in preview (`useBlockRenderEnvironment().preview` or the canvas).
- [X] T054 [US4] Write the four item blocks in the hidden category, allowed only in
  `ContentSlider.slides`. Reshape `cms.ContentSlider` per contracts/blocks.md (header, `effect`,
  `controls`, `bleed`, label "Carousel"/"Karuzela"). Update the manifest, types, barrel, config,
  fixtures and the admin overrides (responsive-image field for the item images, asset picker for
  `fileAssetId`). T053 goes green.
  **Result (2026-10-23):** `CarouselImage.tsx`, `CarouselSplit.tsx` (reuses `cms.MediaText`'s media, now exported as `MediaTextMediaFrame`/`MEDIA_TEXT_MEDIA_FIELD`; at most two buttons), `LinkTile.tsx`, `DownloadTile.tsx`, registered in `index.ts` and the manifest's hidden `internal` category with `translatable` per contract; their CSS appended. `ContentSlider.tsx`: label "Carousel", a section block (`SECTION_ADOPTION_DEFAULTS`), `header` (heading/lead/button) with `headingLevel`/`headingSize`/`headingSizePx` **(addition, as the other section blocks)**, `slidesPerView` a responsive number 1–**8** step 0.25 **(contract says 1–6; plan rule 1 keeps today's 8)**, `gap` token + Custom `gapPx`, `effect`, `controls {arrows, dots, placement}`, `bleed`, autoplay off, `intervalMs` 2000–20000, equal height, box fields; defaults three CarouselImages, `{1.15, 2, 3}`, `s`, arrows below. `contentSliderFromLegacy` (render + `resolveData`): `showArrows`/`showDots` → `controls` with **`placement: 'overlay'`** (today's arrows over the edges, dots below), px gap → Custom. Types in `component-types.ts`. Admin: new `CarouselFields.tsx` (`withAdminCarouselFields`: responsive image fields, link fields, `createMediaTextMediaField`, a 2-button list, header button spec, file picker) applied in `PageBuilderEditor.tsx`; new `page-builder-admin` `createFileAssetField` (no MIME filter); new `CarouselAddSlideMenu.tsx` (menu button: free content or one of the four kinds) in `ContentSliderActionBarExtras.tsx`, whose editor page size now counts fade as 1; `cms/i18n` labels ("Carousel"/"Karuzela", four item labels/descriptions, `pageBuilder.carousel.addSlide.*`). Tests: `ContentSlider.test.tsx` (6, written after the implementation, so not seen RED), `admin/test/modules/cms/carousel-fields.test.tsx` (7, `<StrictMode>`, RED on the missing module), `block-declarations.test.ts` Carousel fixture with a header plus four item fixtures (44), `fallback-parity.test.tsx` +2 (15: a slider stored on origin keeps one per view, 16 px gap and padding, today's arrows and dot colours; the new default keeps the arrow look and 16 px mobile gap). **Changed existing assertion (standing rule 13):** `backend/test/unit/cms/hidden-drawer.test.ts` "is hidden and holds exactly the slot-only blocks" now lists the four item blocks after `cms.Column` and `cms.Slide`.
- [X] T055 [US4] Remove `cms.ImageSlider`, only once its option-parity case from T053 is green. Delete `src/components/ImageSlider.tsx`,
  `image-slider-item.ts`, `image-slider-title.test.ts` and `image-slider-item.test.ts`. Remove it
  from the barrel, the config, the manifest, i18n and `block-declarations.test.ts`. Remove the
  references in `PageBuilderActionBar.tsx`, `SliderPreviewActionBarExtras.tsx` and
  `PageBuilderEditor.tsx`. Leave `frozen-block-renames.ts` untouched. Run standing rule 8's grep
  for `ImageSlider` and fix each hit outside `frozen-block-renames.ts` and old migrations.
  **Result (2026-10-23):** Removed after the T053 case was green: the four files, the barrel export and config entry, its `component-types.ts` types, its stylesheet block, the manifest entry, `pageBuilder.components.ImageSlider` and `blocks.imageSlider.*` in both bundles, the `block-declarations.test.ts` fixture, the `PageBuilderActionBar.tsx`/`SliderPreviewActionBarExtras.tsx` branches and the `PageBuilderEditor.tsx` item override (`createSlideImageField` stays, `cms.LogoStrip` uses it); stale `dist` files deleted. Standing rule 8 grep: no hit in `backend/scripts`, `docs/`, seeders or `admin/test`; left `frozen-block-renames.ts`. **Derived ledger (trap 3), changed existing assertions named:** `backend/test/unit/cms/frozen-block-renames-codomain.test.ts` gains `REMOVED_FROM_THE_PLATFORM` (`cms.ImageSlider`, held to be a map value nobody declares; subtracted in "read a registry…", skipped in "every value is declared…") and `BORN_NAMESPACED` gains the four item blocks **and Phase 5's `cms.MediaText`, `cms.BackgroundPanel`, `cms.CtaCard`, `cms.Statement`, which already had this file red** (7 green).
- [X] T056 [US4] **RED → green**
  `backend/test/integration/cms/removed-block-placeholder.test.ts` `[PG]`. A page whose stored
  content contains a `cms.ImageSlider` node and a following `cms.Heading` resolves on the
  storefront by-slug route. The SSR render (via `storefront/test/ssr/block-degradation.test.tsx`
  extended) shows the placeholder empty for customers and keeps the heading (FR-041a).
  **Result (2026-10-23):** `removed-block-placeholder.test.ts` `[PG]` (3): the admin descriptor and the registry no longer know the image slider and do declare the Carousel and its items; the page resolves by slug with the stored node and the heading as stored; the read leaves the document untouched (`pb163_*` page removed in `afterAll`). `block-degradation.test.tsx` +2 (6): the name is not keyed, and a stored slider before a heading renders the heading and nothing of the slider. **Not seen RED:** written after T055 had already removed the block.
- [X] T057 [US4] Field-label keys for the Carousel and its four items (`en`/`pl`).
  **Result (2026-10-23):** 166 keys per language in `cms/i18n/{en,pl}.json` (real Polish), derived from the built configs with T044's grammar and inserted after each block's `description`; a field the admin replaces with one control (images, links, media, file, uploaded icon, section, slides) has its label only, the button fields carry the nine button sub-keys.

**Verification**: the tests above by file, the SSR floor, `module-blocks.test.tsx`,
`block-degradation.test.tsx`, `check:block-names`, and T056 `[PG]`.

---

## Phase 7: User Story 5 — tabs, accordions and expandable text with nested content (P2)

**Story goal**: tab and accordion panels hold blocks, and rich text gains read-more, check
lists, button links, heading anchors and hidden headings (FR-023–FR-025).

**Independent test**: spec US5. Quickstart §4 steps 3–4.

### 7a. Tabs and Accordion as slots

- [X] T058 [P] [US5] **RED** `packages/cms-components/src/components/Tabs.test.tsx` and
  `Accordion.test.tsx`:
  - two Tabs blocks on one page have distinct ids (`useId`);
  - arrow keys, Home and End move focus and the panel;
  - the `pills` variant;
  - the fade effect;
  - every panel's content is in the server HTML, with inactive panels `hidden`;
  - accordion `allowMultiple` false closes the others;
  - accordion collapsed panels are in the server HTML.
  **Result (2026-10-23):** `Tabs.test.tsx` (8) and `Accordion.test.tsx` (7), jsdom through Puck's `<Render>` (SSR via `renderToString`, keyboard/click via `createRoot`/`act`), RED on colliding ids (6 unique of 12), empty panels, focus not following the arrows, no fade class and `number 2 is not iterable` (origin's `defaultOpen` number field crashed the render); pills, click, icon position, `allowMultiple` and the stored-HTML panel were already green (today's behaviour, kept). `option-parity.test.ts` +5 (now 48, written first per rule 14): every origin field of both blocks mapped (`items[].content` → `items[].panel`), every option value kept, the panel slot's `disallow`, `tabsFromLegacy`/`accordionFromLegacy` value for value and via `resolveData`, RED on the missing slot, helpers and `resolveData`.
- [X] T059 [US5] Reshape `cms.Tabs` and `cms.Accordion` so that `items[].content` is a slot
  (disallow `cms.Column`, `cms.Tabs` and `cms.Accordion`). Update the components, types,
  manifest (`translatable` drops `items[].content`) and fixtures. Name the changed assertions in
  `packages/modules/cms/src/backend/services/translation/extract.test.ts` and `scope.test.ts`
  (Accordion), and in `backend/test/contract/cms/page-builder-translation.contract.test.ts`.
  T058 goes green.
  **Result (2026-10-23):** **Deviation — the slot is `items[].panel`, not `items[].content`:** Puck cannot read a stored HTML string at a slot path (measured: `<Render>` throws `arr.some is not a function`, `walkTree` throws `content.map is not a function`), and the storefront never runs `resolveData`, so `content` stays the stored HTML, rendered (sanitised as today) by the new `panel-slot.tsx` `PanelBody` until the editor's `resolveData` moves it into the slot as one `cms.RichContent` (HTML kept, TipTap JSON where a DOM parses it); `panelSlotField` disallows `cms.Column`, `cms.Tabs`, `cms.Accordion`. `Tabs.tsx`: `useId` ids, roving tab index, Left/Right (wrapping)/Home/End with focus, every panel server-rendered with `hidden`, `effect: 'none'|'fade'` (new, CSS fade off under reduced motion), panel and tab focus rings; every origin option kept. `Accordion.tsx`: `useId` trigger/panel ids, `aria-controls`, panels `role="region"` with `hidden`, `defaultOpen` read as a number or a list (single-open keeps the first). Types: `PanelItem` in `component-types.ts`. **Deviation — the manifest keeps `items[].content` (`format: 'html'`):** it now only ever holds a stored, unconverted panel, and dropping it would leave such pages untranslated (the T039 precedent); the slot's blocks translate through their own declarations (comment in the manifest). Hence **no existing assertion changed** in `extract.test.ts`, `scope.test.ts` or `page-builder-translation.contract.test.ts` (their Accordion is a stored HTML panel, still translated); `extract.test.ts` +1 (a slot panel beside a stored one, inject round trip); `block-declarations.test.ts`: the Tabs/Accordion fixtures now hold slot panels (nested `cms.RichContent`/`cms.Heading` prose) and the stored HTML shapes moved to "blocks stored before the reshape" (46 in the file).
- [X] T060 [US5] **RED → green**
  `backend/test/contract/cms/page-builder-translation-nested.contract.test.ts` `[PG]`. Translating
  a page with a Tabs block whose panel holds a `cms.RichContent` and an `cms.Accordion` whose
  panel holds a `cms.Heading` returns translated nested texts and an unchanged structure (US5
  independent test). Use the existing fake translator from the translate contract tests.
  **Result (2026-10-23):** `[PG]` (1): a Tabs panel's `cms.RichContent`, a stored HTML panel and an Accordion panel's `cms.Heading` come back `[en] …`, exactly six string leaves change and every other leaf (types, ids, options, synced HTML) is as sent, no untranslatable block (`ScriptedTranslator` echo, settings reset in `afterAll`). **Not seen RED:** green on first run, since `extract` already walks any array of components (R-13's rationale).

### 7b. Rich text extensions (R-14)

- [X] T061 [P] [US5] **RED** `packages/cms-components/src/utils/sanitize-html.test.ts` additions:
  - `details`, `open` and `summary` are kept;
  - `id` on `h2` matching the anchor pattern is kept, a non-matching `id` is dropped, and `id` on
    `p` is dropped;
  - `class="cmsc-list--check"` on `ul` is kept;
  - `<a class="cmsc-btn …">` is kept;
  - `div` and `button` are still dropped.

  Also **RED** `rich-content-shared.test.ts`: `generateHTML` of a doc with a `readMore` node, a
  check list, a button link, an anchored heading and an `srOnly` heading produces exactly the
  output in R-14's table.
  **Result (2026-10-23):** `sanitize-html.test.ts` +5 (rich policy: `details`/`open`/`summary`; `id` kept on `h1`–`h6` only when it matches the anchor pattern, judged decoded, dropped on `p`/`details`/`summary`; check-list and button classes kept; `div`/`button` still dropped; a handler on `details`/`summary` inert), RED on the first two. **Deviation — file:** the `generateHTML` table is in the new `rich-content-extensions.test.ts` (5, jsdom), not `rich-content-shared.test.ts`, whose node environment and "no DOM" case stay untouched; RED on `no mark type emphasis` and the missing `id`/class/`details` output. It asserts R-14's exact HTML for all six rows through `generateHTML` and `htmlFromTiptap`, the attributes read back, nothing extra by default, `open` only when set, and an invalid anchor or unknown button style dropped.
- [X] T062 [US5] Implement the R-14 extensions in
  `packages/cms-components/src/components/rich-content-shared.ts`, the policy additions in
  `src/utils/sanitize-html.ts`, the toolbar buttons in `RichContentEditorField.tsx`, and the CSS
  for `.cmsc-read-more`, `.cmsc-list--check` and `.cmsc-sr-only` in `cms-components.css`. If T001
  recorded that `storefront/package.json` mirrors the `@tiptap/*` list, add any new TipTap
  package there too, at the same version. Change no version. T061 goes green.
  **Result (2026-10-23):** `rich-content-shared.ts`: `readMoreNode`/`readMoreSummaryNode` (`<details class="cmsc-read-more"><summary>`; shown open in the editor through a node view), `richContentAttributes` (heading `anchor` → pattern-checked `id`, `srOnly` → `cmsc-sr-only`, bullet list `listStyle: 'check'`, link `variant` → `cmsc-btn cmsc-btn--<style>-<fill>` from `BUTTON_LINK_VARIANTS`), `emphasisMark` added; policy: `details`/`summary`, `open`, anchored `id` on headings. `sanitize-html.ts`: `allowAttr` receives the decoded value. `RichContentEditorField.tsx`: emphasis buttons (labels moved here and shared with `InlineRichTextEditor`), heading anchor dialog (normalised as typed), hidden-heading toggle, check list, read-more insert, link "Show as" select. CSS: `.cmsc-read-more`, `ul.cmsc-list--check` (drawn tick), editor-only reveal of `.cmsc-sr-only` (`.cmsc-sr-only` itself already existed); every `--cmsb-*` with its literal. **No new `@tiptap/*` package** (custom extensions on `@tiptap/core`); no version changed. The toolbar has no test of its own.

**Verification**: the tests above by file, the SSR floor, and T060 `[PG]`.

---

## Phase 8: User Story 6 — dynamic listings: news, products, link lists (P2)

**Story goal**: `blog.LatestPosts` from real posts, a showcase product card with a summary, and a
link-row list (FR-026–FR-028).

**Independent test**: spec US6. Quickstart §5 step 1.

### 8a. Blog backend

- [X] T063 [US6] Scaffold the migration
  `pnpm --filter backend run migration:new -- --module blog --name post_main_image`
  (`blog_posts.main_image_asset_id uuid null`; `down` drops it). Add the entity property in
  `packages/modules/blog/src/backend/entities/blog-post.entity.ts`, the asset-reference entry in
  `blog-asset-references.ts`, and the field in the admin create and patch schemas
  (`packages/contracts/src/blog.ts`) and the post update Command snapshot. Run `composer:generate`.
  **Result (2026-10-23):** `migration:new --module blog --name post_main_image` → `20261023T063013_blog_post_main_image.ts` (`blog_posts.main_image_asset_id uuid null`, FK to `assets` and an index, mirroring `blog_categories`; `down` drops all three), registered in `migrations/index.ts`; `composer:generate` added only this class to `migrations-registry.generated.ts`. Entity property, `mainImageAssetId` on the admin summary/detail (`uuid | null`) and create/patch schemas, the service's insert/patch/mappers, and `blog_post_main_image` in `blog-asset-references.ts` plus `assetReferenceKindSchema` (case added to `integration/blog/asset-references.test.ts`, 6/6 [PG]). **Deviation:** `blog` has no Command Bus write for a post (the admin PATCH calls `BlogPostService.patch` directly), so there is no Command snapshot to extend; the field travels in the patch body and the returned detail.
- [X] T064 [P] [US6] **RED** `backend/test/contract/blog/posts-list.contract.test.ts` `[PG]`:
  - `GET /api/v1/blog/posts?limit=3` returns the three newest published posts of the resolved
    channel, with `mainImageUrl` set for a post with an image;
  - `categorySlug` filters;
  - an unknown category returns `[]`;
  - `limit=25` returns 400;
  - a post published only in the other channel never appears, and no header resolves to the
    system default channel (Principle XII);
  - a draft never appears.
  **Result (2026-10-23):** new `[PG]` file, 7 cases on two channels the file creates (newest three with `mainImageUrl`, default limit and no draft/foreign post, `categorySlug`, unknown category `[]`, `limit=25` → 400, the other channel's post only there, no header → system default only). RED on 404 (route missing), then 7/7.
- [X] T065 [US6] Implement the route in `packages/modules/blog/src/backend/routes.storefront.ts`
  and the query in `services/blog-storefront-resolver.ts`, reusing `toPostCard`. Add the request
  and response schemas to `packages/contracts/src/blog.ts`. Add the image picker to the blog admin
  post editor (`packages/modules/blog/src/admin/…`) with `en`/`pl` labels. T064 goes green.
  **Result (2026-10-23):** `GET /api/v1/blog/posts` in `routes.storefront.ts` over `BlogStorefrontResolver.listPosts` (channel-joined post and category, `toPostCard`, Redis key `…:list:<slug>:n<limit>`; a channel with `blog.enabled=false` lists `[]`); `blogPostsListQuerySchema`/`blogPostsListResponseSchema` and `BLOG_POSTS_LIST_{MAX,DEFAULT}_LIMIT` in `contracts/src/blog.ts`; cards gain optional `primaryCategoryName` (chip) and `url` (`/<prefix>/<slug>`). **Found and fixed:** no composition ever passed `blogStorefrontDeps`, so every card's `mainImageUrl` was `null` (data-model §1.2's "no code change" did not hold); `blog/backend/index.ts` now defaults `resolveAssetUrl` to `assetsLibraryPort.getAsset` through `lazyPort` (public assets only, `rethrowIfModuleDisabled`). Post editor: library `AssetFieldPicker` + hint, keys `fields.mainImage`/`postEditor.mainImageHint` en/pl; 4 cases added to `admin/test/modules/blog/blog-editors-settings-panel.test.tsx` (43/43). OpenAPI baseline regenerated (additions only: this route, plus `brand-tokens` ×2 from Phase 3 and two routes master had already added — `admin/feedback`, `quote-requests/{id}/prepare-customer-basket`). T064 green.

### 8b. Block-data seam, LatestPosts, products, LinkList

- [X] T066 [P] [US6] **RED** `packages/cms-components/src/utils/block-data.test.ts`, moved from
  `catalog-block-data.test.ts` per standing rule 8:
  - the `blog-posts` request kind is collected from `blog.LatestPosts` props;
  - duplicate requests are merged;
  - a failed read is omitted and does not reject;
  - the catalog kinds behave exactly as before (the existing cases kept and named).
  **Result (2026-10-23):** `catalog-block-data.test.ts` moved to `utils/block-data.test.ts`: the 9 catalogue cases kept (renamed describes, "…as before"), 5 new `blog-posts` cases (collected with limit default 6 and clamp 1–12, duplicates merged, failed read omitted without rejecting, absent owner skipped and not asked, no blog reader → skipped). **Named change (rule 13):** "hands on the seven fields" → "eight fields" (`summary`). RED on the missing module, then 16/16.
- [X] T067 [US6] Generalise the seam:
  - `catalog-block-data.ts` becomes `block-data.ts`;
  - `storefront/components/CatalogBlockData.tsx` becomes `BlockData.tsx`, with the source gaining
    `listBlogPosts` from `storefront/lib/api/blog.ts`;
  - `storefront/lib/page-builder/catalog-block-data.ts` becomes `block-data.ts`;
  - the callers `CmsPageRenderer.tsx` and `Hook.tsx` are updated;
  - the admin `AdminCatalogPreviewProvider.tsx` gains the blog reader (admin blog list API).

  Skip a request whose owner module is absent, using the presence the storefront already resolves.
  Grep and fix every old name (standing rule 8). T066 goes green.
  **Result (2026-10-23):** `utils/block-data.ts` (`BlockDataRequest` union + `blog-posts`, `BlockData`, `BlockDataSource` with optional `fetchBlogPosts` and `isModulePresent`, `blockDataOwnerOf`, `blockDataKey`, `collectBlockDataRequests`, `resolveBlockData`, `BLOCK_DATA_CONCURRENCY`), `hooks/use-block-data.ts` (`useBlockData`), context `BlockDataContext`/`useProvidedBlockData`; preview bridge and `catalog-fetch.ts` gain `fetchBlogPosts`. Storefront: `components/BlockData.tsx`, `lib/page-builder/block-data.ts` (`resolveBlockDataFor(documents, ctx, modules?)`, `listBlogPosts` in `lib/api/blog.ts`), `CmsPageRenderer` (optional `modules`, passed by `app/page.tsx` and `[...slug]/page.tsx`) and `Hook.tsx` (passes `modules`). Admin `AdminCatalogPreviewProvider` gains the blog reader (admin posts + category tree + admin asset URL). Rule 8: old names fixed in `storefront/test/ssr/{catalog-blocks,blocks}.test.tsx` and `admin/test/modules/cms/catalog-block-data-source.test.tsx` → `block-data-source.test.tsx`; no hit in `backend/test`, `backend/scripts` or seeders. **Left for T103/T101:** `git grep` still hits `docs/docs/upgrading-an-instance.md` (+ pl and translation cache, the 0.105.0 upgrade note) and the CHANGELOGs — history, not rewritten; and the subpath `@endora-commerce/cms-components/utils/catalog-block-data` is gone, which an instance storefront copied from the 0.105.0 CLI imports — T101's changeset must say so (or a re-export shim be decided). New storefront test `test/ssr/blog-latest-posts.test.tsx` (3: channel/language on the read, SSR HTML, no read while `blog` is off).
- [X] T068 [P] [US6] **RED** `packages/cms-components/src/components/LatestPosts.test.tsx`:
  - provided data renders cards (image, category chip, title, read-more link) in carousel and
    grid layouts;
  - no posts renders nothing for customers and "No posts" in preview;
  - the header button renders.
  **Result (2026-10-23):** 7 cases (registered with neutral defaults; carousel cards with image, chip, title, read-more link; grid layout; `/blog/<slug>` fallback without `url`; nothing for customers and "No posts" in preview; header heading and button; header above a grid). RED on the unregistered block, then 7/7.
- [X] T069 [US6] Write `LatestPosts.tsx`. Declare `blog.LatestPosts` in
  `packages/modules/blog/src/manifest.ts` (category `content`, fields, `translatable`) with
  `en`/`pl` block labels and field labels (`blocks.blog.LatestPosts.fields.*`) in
  `packages/modules/blog/i18n/`. Register it in `defaultPageBuilderConfig`.
  Add a fixture to the cms translation declarations test, which covers the blocks of every module.
  If that test is cms-only, add `packages/modules/blog/src/backend/block-declarations.test.ts`
  mirroring it. **Create** `backend/test/integration/blog/off-state.test.ts` `[PG]` on the harness
  of `backend/test/integration/cms/off-state.test.ts` (the file does not exist yet; analysis I1).
  With `blog` off on each axis:
  - `/api/v1/blog/*`, including `/posts`, does not answer;
  - the admin blog surfaces and palette actions are absent;
  - the blog settings are not editable;
  - `blog.LatestPosts` is filtered from the storefront config.

  Everything is restored after both axes (Principle XVII). T068 goes green.
  **Result (2026-10-23):** `LatestPosts.tsx` (section block, `withSection`; carousel through `CarouselShell` or grid with responsive `columns`; loading/empty render nothing for customers) and `carousel/carousel-parts.tsx` (`CAROUSEL_HEADER_FIELDS`, `CAROUSEL_TRACK_FIELDS`, `carouselHeaderNode`, `carouselShellOptions`, `CarouselHeaderBlock`; `ContentSlider.tsx` now uses them, its 6+11 tests unchanged and green); `CarouselHeaderOptions`/`CarouselTrackOptions`/`LatestPostsProps` types; registered as `blog.LatestPosts` in `defaultPageBuilderConfig`; CSS appended (rule 9 fallbacks). Blog manifest: block (category `content`, translatable header×3 + `readMoreLabel`) and its own `blockCategories` `content` entry (the manifest validator refuses a block whose section the manifest does not declare). Labels under `blocks.latestPosts.*` (labelKey stem, as every other block; the task text said `blocks.blog.LatestPosts.fields.*`) — 95 keys en/pl in `blog/i18n`. The cms declarations test is cms-only, and a blog-local copy would import `cms`' extractor (Constitution I), so the fixture lives in `backend/test/unit/blog/block-declarations.test.ts` (blog + both catalog listings, 4/4). **Created** `backend/test/integration/blog/off-state.test.ts` [PG] (3/3): harness over 7 routes incl. `/api/v1/blog/posts`, admin presence, `blog.posts_per_page`, permission catalogue, restoration; plus, per axis, the descriptor drops `blog.LatestPosts` and storefront presence reports `blog` absent, both restored. Palette action left to `batch-sixteen-palette-off-state.test.ts` (already covers `new-post`), as the cms file does. Admin link pickers: new `ListingFields.tsx` + loop in `PageBuilderEditor.tsx`, `admin/test/modules/cms/listing-fields.test.tsx` (4). **Named derived-ledger change (trap 3):** `frozen-block-renames-codomain.test.ts` `BORN_NAMESPACED` gains `blog.LatestPosts` and `cms.LinkList` (7/7). T068 green.
- [X] T070 [US6] Product summary per T004's finding.
  - **Derive**: `CmsProductSummary.summary` in `packages/cms-components/src/schema/catalog-types.ts`
    and the catalog read that fills it (`packages/modules/catalog/src/backend/…`, with its contract
    test extended).
  - **Fallback**: `manualSubtitles: Record<slug, string>` on ProductGrid and ProductSlider, plus
    an admin field next to each picked product.

  Test: `CmsProductCard.test.ts` covers `variant: 'showcase'` (neutral backdrop, name, summary or
  subtitle, "more" link with `ctaLabel`).
  **Result (2026-10-23):** derive. `catalog/src/backend/services/product-summary-text.ts` (`productSummaryText`: tags/scripts stripped, entities decoded, ≤160 chars cut at a word boundary with `…`; unit test 7) called synchronously in `toSummary` on the description the row already holds, through the same override/language pick as the PDP — no query per product; the PDP spreads the summary. `summary` optional on `productSummarySchema` and `CmsProductSummary`; the seam hands it on. `contract/catalog/products-list.test.ts` extended (4 [PG] cases: plain text ≤160 at a word boundary, request language, `null` without description, on the product read too) — RED on `undefined`, then 6/6. `CmsProductCardView` `variant: 'showcase'` (neutral backdrop, name, summary, "more" link labelled by `ctaLabel`, default "More"; no price/SKU); `CmsProductCard.test.ts` +3 (RED on the missing markup, then 5/5).
- [X] T071 [US6] Reshape `catalog.ProductGrid` and `catalog.ProductSlider`: `header`,
  `cardVariant`, `ctaLabel`, `footerButton`; the slider takes the Carousel options from T052. The
  work covers the components, `packages/modules/catalog/src/manifest.ts`, `catalog/i18n`, the
  fixtures and `ProductGrid` and `ProductSlider` tests.
  **Result (2026-10-23):** parity cases first (`option-parity.test.ts`, origin `b816c1d55` literals): grid 3, slider 5 — RED on missing fields/`productSliderFromLegacy`, then green (56/56 in the file). Grid keeps every field and default, adds the header, `cardVariant` (+`showcase`), `ctaLabel`, `footerButton`, top-level `section` with adoption defaults; list view keeps the horizontal card. Slider takes the Carousel options (`productSliderFromLegacy` = the Carousel's legacy carry: arrows overlay + dots, px gap → Custom), keeps today's defaults (1/4/8, 16 px, 5 s, arrows+dots overlay), plus the same additions; shared `catalog/product-listing-parts.tsx`. Catalog manifest translatable (header×3, `ctaLabel`, `footerButton.label`) and `responsiveFields`; 222 field-label keys en/pl in `catalog/i18n`. Storefront SSR floor, `module-blocks`, `catalog-blocks`, `block-ssr-floor`, `block-degradation` green (57) unchanged.
- [X] T072 [P] [US6] **RED** `LinkList.test.tsx`, then write `cms.LinkList`: rows with a title, a
  description and a `ButtonSpec`, plus a divider. Update the manifest, types, fixtures and
  `en`/`pl` labels.
  **Result (2026-10-23):** `LinkList.test.tsx` (5) RED on the unregistered block, then `LinkList.tsx` (section block; heading, rows 1–50 of title/description/`ButtonSpec`, divider; untitled rows skipped), `LinkListProps`/`LinkListItem` types, registration, CSS, cms manifest entry (category `content`, translatable heading/title/description/button label), 57 keys en/pl (`blocks.linkList.*`), cms declarations fixture (47/47), row-button link pickers via `ListingFields.tsx`. 5/5.

**Verification**: T064 and the blog off-state file `[PG]`; the tests above by file; the SSR floor;
`module-blocks.test.tsx`; `check:block-names`; `check:module-boundary`; `check:port-dependencies`.

---

## Phase 9: User Story 7 — newsletter sign-up that actually subscribes (P3)

**Story goal**: `newsletter.Signup` subscribes through the newsletter module, with topics and a
required consent, and works without JavaScript (FR-029).

**Independent test**: spec US7. Quickstart §5 step 2.

- [X] T073 [P] [US7] **RED** `storefront/test/newsletter/subscribe-route.test.ts`, with the backend
  client stubbed:
  - without `consent` → 303 to `returnTo?newsletter=error&reason=consent#anchor`, or 400 JSON with
    `Accept: application/json`;
  - an invalid e-mail → `reason=email`;
  - success calls `subscribeNewsletter` with `tags`, `source: 'cms-block'` and the resolved
    channel code, then 303 with `newsletter=pending`;
  - a `returnTo` of `https://evil.example/` falls back to `/`;
  - topic codes outside the pattern are dropped;
  - the newsletter module absent (presence) → 404.
  **Result (2026-10-23):** 18 cases (`vi.mock` of `lib/api/newsletter` and `lib/api/module-presence`), RED on `Cannot find module '/app/newsletter/subscribe/route'`. Beyond the list: JSON `active`, the `default` channel when no header is stamped, the `returnTo` query kept with an earlier outcome replaced, four more unsafe `returnTo` shapes (`//host`, `/\host`, `javascript:`, a relative path), a bad anchor omitted, no `tags` without topics, `reason=topics`, and a backend failure → `unavailable`.
- [X] T074 [US7] Write `storefront/app/newsletter/subscribe/route.ts` (contract §4). T073 goes green.
  **Result (2026-10-23):** the handler: `getModulePresence().isPresent('newsletter')` else 404; `formData()` (urlencoded or multipart); e-mail by the contracts' `newsletterSubscribeRequestSchema.shape.email`, consent `on`, topics `^[a-z0-9_-]{1,64}$` (deduplicated, at most 12), anchor `SECTION_ANCHOR_RE`, `returnTo` same-origin path or `/`; channel from the stamped `x-sales-channel` or `default` (as the registration page); `subscribeNewsletter({…, source: 'cms-block'})`; 303 with a relative `Location` (a proxy's public origin is not known here), or `{status}`/`{error}` JSON 200/400; `no-store`. **Additions to contract §4:** `error: 'topics'` with a hidden `topicsRequired=on` (the block's `topicsRequired` would otherwise be unenforced), and a backend refusal is `unavailable`. T073 18/18.
- [X] T075 [P] [US7] **RED** `packages/cms-components/src/components/NewsletterSignupForm.test.tsx`:
  - the form posts to `/newsletter/subscribe` with hidden `returnTo` and `anchor`;
  - topics render as a checkbox group;
  - the consent checkbox is `required` and its label renders a link;
  - with JavaScript, a submit with consent unticked shows the error next to the consent and keeps
    the e-mail (US7 acceptance 1);
  - `?newsletter=pending` on the URL shows the pending message without JavaScript.
  **Result (2026-10-23):** 12 cases (jsdom; `renderToString` for the server HTML, `createRoot` + `act` for the JS cases, `fetch` stubbed), RED on the unregistered block (`expected undefined to be defined`, "no form rendered"). Beyond the list: neutral defaults, the e-mail field's `<label>`, `returnTo` `/` and no anchor when unknown, a topic with an invalid tag code not offered, the hidden `topicsRequired`, the `fetch` post (`Accept: application/json`, the form's fields) with the outcome in the `role="status"` region, a backend `email` refusal shown next to the e-mail, a consent refusal from the URL without JavaScript, and the layout modifier.
- [X] T076 [US7] **Owner decision first** (plan § *Extend, don't narrow*, open point). Ask with a
  recommendation:
  - (a) keep `cms.NewsletterSignup` as the external-endpoint form (`actionUrl`), reshaped with
    `section` and an optional consent checkbox, beside `newsletter.Signup`;
  - (b) drop the external target.

  The recommendation is (a): it keeps today's option, and the two blocks are different concepts
  (any external endpoint versus the platform's own newsletter). Record the answer here. Under
  (a), add the `cms.NewsletterSignup` case to the option-parity test and keep the block;
  everything below about removing it does not apply. Then write `NewsletterSignupForm.tsx`.
  **Owner decision (2026-10-23): (a).** `cms.NewsletterSignup` stays as the external-endpoint form
  (gains `section` and an optional consent checkbox, with its option-parity case), beside
  `newsletter.Signup`. Declare `newsletter.Signup` in
  `packages/modules/newsletter/src/manifest.ts` (category `forms`, fields, `translatable`) with
  `en`/`pl` block labels and field labels (`blocks.newsletter.Signup.fields.*`) in
  `packages/modules/newsletter/i18n/`, and register it in the config. Only under (b): remove
  `cms.NewsletterSignup` (component, barrel, config, cms manifest, i18n, fixture, admin override
  list) per standing rule 8.
  Extend `backend/test/integration/newsletter/off-state.test.ts` `[PG]`: with `newsletter` off,
  the block is filtered. The new probe is part of the harness's restoration assertion after both
  axes (analysis X1). T075 goes green.
  **Result (2026-10-23):** under (a). **`cms.NewsletterSignup`:** parity case first (`option-parity.test.ts`, origin `b816c1d55` literals: 11 fields and the defaults) RED on the missing `showConsent` and `section`, then green (59/59 in the file); every field, control and default kept, plus `section` (top level only, `SECTION_ADOPTION_DEFAULTS`, so a stored form gets no spacing) and `showConsent` (default `false`) with an inline-rich `consentLabel` shown once it is on; added to `section-adoption.test.tsx`'s block list (35/35, RED on the 3 section cases first); `fallback-parity.test.tsx` unchanged and green (15/15, on a freshly built stylesheet). **`newsletter.Signup`:** `NewsletterSignupForm.tsx` exports `Signup` (the local segment of the name, which the SSR floor reconciles exported configs by), `NEWSLETTER_SUBSCRIBE_PATH`, `NEWSLETTER_SIGNUP_MAX_TOPICS`; fields `heading` (inline rich), `headingLevel`, `text` (rich), `emailLabel`, `placeholder`, `buttonLabel`, `topicsLegend`, `topics` (0–12 `{label, tagCode}`), `topicsRequired`, `consentLabel`, `layout`, and `messages` (pending, active, consent, email, topics, unavailable — translatable, neutral English defaults); without JS the outcome is read from the new `CmsRenderProvider` `location` (`{path, query}`, `useCmsRenderLocation`), which `CmsPageRenderer` takes and `app/page.tsx` and `[...slug]/page.tsx` fill from `searchParams` (`lib/page-builder/render-location.ts`); with JS the form turns `noValidate`, checks the e-mail and consent itself, posts with `fetch` and keeps the typed address. Registered in `defaultPageBuilderConfig`; CSS `.cmsc-pb-signup*` and `.cmsc-pb-newsletter__consent` (rule 9 fallbacks). Newsletter manifest: the block (category `forms`, 14 translatable paths) and its own `blockCategories` `forms`; labels under the label-key stem `blocks.signup.*` (module-relative, as Phase 8; the task text's `blocks.newsletter.Signup.fields.*` was not used) — 41 keys en/pl in `newsletter/i18n`, plus 11 `blocks.newsletterSignup.fields.*` en/pl in `cms/i18n`; cms manifest: `consentLabel` translatable, `section` responsive. **Named changes (rule 13):** cms `block-declarations.test.ts` NewsletterSignup fixture gains `section`/`consentLabel`, expected + the consent prose (47/47); `backend/test/unit/blog/block-declarations.test.ts` gains the newsletter manifest and a `newsletter.Signup` fixture (5/5, written after the manifest, so not seen RED); derived ledger `frozen-block-renames-codomain.test.ts` `BORN_NAMESPACED` + `newsletter.Signup` (7/7, after `mod-newsletter` was rebuilt). Off-state `[PG]`: `newsletter/off-state.test.ts` + per-axis probe (descriptor drops `newsletter.Signup`, keeps `cms.NewsletterSignup`, storefront presence `false`, both restored) — 3/3. New `storefront/test/ssr/newsletter-signup.test.tsx` (3: server HTML, outcome without JS, nothing while `newsletter` is absent).
- [X] T077 [US7] **RED → green** `backend/test/integration/newsletter/cms-block-subscribe.test.ts`
  `[PG]`. A subscribe with `source: 'cms-block'` and two known tags plus one unknown records the
  subscriber with the two tags, `consentAt` set and `source = 'cms-block'`, and the unknown tag is
  ignored. This is the backend half of quickstart §5 step 2; the endpoint itself is unchanged.
  **Result (2026-10-23):** `[PG]` 1/1 through `POST /api/v1/newsletter/subscribe` on the test server (per-run `pb163_*` tags and e-mail, deleted in `afterAll`): `source = 'cms-block'`, `consentAt` set, exactly the two known tags linked, no tag created for the unknown code, and the `newsletter_subscribe` audit entry carrying `source: 'cms-block'`. Green on its first run: the endpoint was already right, so this pins it rather than turning anything green.

**Verification**: T073 and T075 by file; T076's off-state file and T077 `[PG]`; the SSR floor;
`check:block-names`.

---

## Phase 10: User Story 8 — breadcrumbs that follow the page tree (P3)

**Story goal**: an explicit parent page drives the breadcrumb trail and its JSON-LD. Breadcrumbs
can be hidden and given a scheme (FR-030–FR-032).

**Independent test**: spec US8. Quickstart §6 steps 1–3.

- [X] T078 [US8] Scaffold `pnpm --filter backend run migration:new -- --module cms --name
  page_tree_and_share` with the four `cms_pages` columns, the check constraint and the index
  (data-model §1.1). Add the entity properties in `cms-page.entity.ts`. Run `composer:generate`.
  Extend `backend/test/integration/cms/migration.test.ts` `[PG]`, naming the changed assertion.
  **Result (2026-10-23):** `cms/src/migrations/20261023T052237_cms_page_tree_and_share.ts` (`Migration20261023T052237CmsPageTreeAndShare`: the four columns, self-FK `cms_pages_parent_page_id_fk` `on delete set null`, `cms_pages_breadcrumbs_scheme_check`, `cms_pages_parent_page_id_idx`), registered in `migrations/index.ts`; four `CmsPage` entity properties (all in `OptionalProps`); `composer:generate` added only the registry line. `migration.test.ts`: no existing assertion changed — one new case (columns/types/defaults, FK delete rule, index, check constraint); 8/8 `[PG]`.
- [X] T079 [P] [US8] **RED** `backend/test/contract/cms/page-tree.contract.test.ts` `[PG]`:
  - `PATCH` with `parentPageId` set to the page itself → 422 `CMS_PAGE_PARENT_CYCLE`;
  - A → B → A → 422;
  - depth 9 → 422;
  - deleting the parent clears `parentPageId` on the child;
  - by-slug for the child returns `breadcrumbs.trail = [{name: A, slug: a}]`;
  - with A unpublished in the channel, the trail gives `slug: null`;
  - with A published only in the other channel, the request for this channel gives `slug: null`
    (Principle XII);
  - `breadcrumbsVisible: false` and the scheme round-trip;
  - the `cms_page.update` audit entry's before/after includes the four fields.
  **Result (2026-10-23):** 13 cases (also: defaults on create, a missing parent → 404 `CMS_PAGE_NOT_FOUND`, a two-level branch hung under level 7 → 422, `parentPageId` on the admin list, meta-title crumb names, an unknown scheme → 400); RED 13/13 on the absent fields, green 13/13 `[PG]` after T080. Depth = levels with the root as level 1, at most 8 (`CMS_PAGE_TREE_MAX_DEPTH`), counting the moved page's own subtree.
- [X] T080 [US8] Implement the parent and breadcrumb fields:
  - `cms-page-service.ts`: the row type, create, patch, the cycle check, `toDetail`/`toSummary`
    and `auditState`;
  - `packages/contracts/src/cms.ts`: the detail, create, patch and list schemas and
    `cmsResolvedPageSchema.breadcrumbs`;
  - `storefront-resolver.ts`: the trail per channel through `cms_page_sales_channels`;
  - `cms-page-read-port.ts`.

  Name the changed assertions in `storefront-page-by-slug.contract.test.ts`, the seo and megamenu
  `cross-module-ports` tests and `seed-storefront-fixtures.ts` (explicit column list). T079 goes
  green.
  **Result (2026-10-23):** contracts: `cmsBreadcrumbsSchemeSchema`/`CmsBreadcrumbsScheme` (exported), summary `parentPageId`, detail `breadcrumbsVisible`/`breadcrumbsScheme`/`shareImageAssetId`, the four optional on create/patch, `cmsResolvedPageSchema.breadcrumbs`, `CmsPageRecord.parentPageId`. Service: cycle/self/depth refusal inside the Command under a transaction advisory lock (nothing written, no audit), audit state carries the four fields, descendants' slugs are invalidated on patch/transition/delete. Resolver: one recursive query, slug from `cms_page_sales_channels` for the request channel only when published and active, else `null`. Named changes: `storefront-page-by-slug.contract.test.ts` first case gains `breadcrumbs: {visible: true, scheme: 'light', trail: []}`; `backend/test/unit/seo/cross-module-ports.test.ts` `pageRecord` gains `parentPageId: null`. Unchanged, by reading: the megamenu `cross-module-ports.test.ts` record is a cast and `cross-module-targets.test.ts` uses `em.create` with the new props optional; `seed-storefront-fixtures.ts` keeps its column list (all four columns are nullable or defaulted, and the default is today's trail). Green: by-slug 5/5, admin-pages 15/15, storefront-cache 3/3, write-atomicity 2/2 `[PG]`; `cms-page-service.test.ts` 9/9, seo 5/5, megamenu 12/12.
- [X] T081 [US8] Admin: `packages/modules/cms/src/admin/editors/PageEditor.tsx` gains a parent
  picker (reusing admin-kit `cms-picker`, excluding the page and its descendants), "Show
  breadcrumbs" and the breadcrumb scheme, with `en`/`pl` labels. Extend
  `admin/test/modules/cms/cms-editors-settings-panel.test.tsx`.
  **Result (2026-10-23):** a "Breadcrumbs" card between the metadata card and the scope picker; parent via the kit's `CmsPagePicker`, which gained two additive props, `excludeIds` and `selectedLabel` (T101 owes `@endora-commerce/admin-kit` a changeset); the excluded set is the page plus its descendants from the admin list. Nine `pageEditor.breadcrumbs.*` keys in `cms/i18n/{en,pl}.json` with real Polish. Three new cases (stored values shown and all three saved; self and descendants not offered; both bundles translated); RED on the missing keys, then 27/27; `kit-pickers`, `admin-kit-identity`, `batch-sixteen-surfaces`, `preview-brand-tokens` green (101 tests over 5 files).
- [X] T082 [US8] Storefront: `storefront/app/(content)/[...slug]/page.tsx` renders the trail
  (Home › ancestors › page), hides it when not visible, and applies the scheme. In
  `storefront/components/Breadcrumbs.tsx`, a null slug renders text, and the JSON-LD `item` values
  become absolute (`siteUrl()`). Test: `storefront/test/seo/breadcrumbs.test.tsx`.
  **Result (2026-10-23):** `[...slug]/page.tsx` builds Home › trail › page, renders nothing when hidden, and wraps the trail in `data-cmsb-scheme`; `light` paints nothing, so an untouched page looks as before, while `muted`/`dark` paint a full-width `--cmsb-bg` band and the trail reads `--cmsb-fg-muted`/`--cmsb-link`/`--cmsb-border` with fallbacks. `Breadcrumbs`: `href: string | null`, a null crumb is a `<span>` with no JSON-LD `item`, every `item` is `absoluteUrl(href)` (all callers). New test 5/5 (RED 5/5 first). Named change: `json-ld-escaping.test.tsx` expects `absoluteUrl('/p/x</script>…')` (percent-encoded) plus a "no raw `<`" assertion; `components.test.tsx` and `test/conformance` unchanged and green.

**Verification**: T078 and T079 `[PG]`; the admin and storefront tests by file;
`composer:generate` leaves `git status` clean.

---

## Phase 11: User Story 9 — sharing and search metadata (P3)

**Story goal**: a sharing image per page with a default, locale alternates, and complete
Organization data (FR-033–FR-035, as amended by ruling Q1).

**Independent test**: spec US9. Quickstart §6 step 4.

- [X] T083 [P] [US9] **RED** additions to `backend/test/contract/cms/storefront-page-by-slug.contract.test.ts`
  `[PG]`:
  - `share.imageUrl` is the page image;
  - without one, it is `cms.default_share_image_asset_id`'s asset;
  - without either, it is null;
  - `languages` lists the page's languages.
  **Result (2026-10-23):** a `sharing metadata (feature 163)` block of 5 cases (also: a per-channel default answers only its channel, Principle XII; deleting an asset a page uses as its sharing image → 409 `ASSET_REFERENCED`); fixtures `pb163_*`, deleted and the setting restored in `afterAll`. RED 4/4 on `SETTING_NOT_REGISTERED` and the absent `languages`; the asset-scan case measured RED with the scan clause removed from `dist`. Green 10/10 `[PG]`.
- [X] T084 [US9] Declare `cms.default_share_image_asset_id` in the cms manifest. Resolve `share`
  and `languages` in `storefront-resolver.ts`, using the `share_image_asset_id` column from T078.
  Add `share_image_asset_id` to the asset-reference scan in
  `packages/modules/cms/src/backend/services/asset-references.ts`. Add the sharing-image picker to
  `PageEditor.tsx`. T083 goes green.
  **Result (2026-10-23):** `CMS_SETTING_CODES.DEFAULT_SHARE_IMAGE_ASSET_ID` (string, `cms_page_builder`, `''`); contracts `cmsResolvedPageSchema.share`/`languages`; resolver: own image (public assets only) cached with the page, the default applied after the cache through a late-bound `setDefaultShareImageResolver` reading `settingsReadPort` with the request channel id, `languages` = declared languages carrying content; scan gains `cms_pages.share_image_asset_id`; `PageEditor` "Sharing" card with the kit's `AssetFieldPicker`, which gained additive `chooseLabel`/`changeLabel`/`clearLabel` props (T101 owes admin-kit a changeset), 7 `pageEditor.share.*` keys en/pl. Named changes: `boot-hook-split.test.ts` stub handle gains the setter; `i18n-hardcoded-strings.ts` loses the drained `AssetFieldPicker.tsx` entry. Admin test 29/29 (2 new cases, RED first).
- [X] T085 [P] [US9] **RED** `storefront/test/seo/cms-metadata.test.ts`. `generateMetadata` for a
  CMS page returns:
  - `openGraph.images[0].url` from `share.imageUrl`;
  - `openGraph.locale` for the served language;
  - `openGraph.alternateLocale` for the others;
  - `twitter.card: 'summary_large_image'` when an image exists.

  On the home page, a CMS-backed home page uses the same metadata.
  **Result (2026-10-23):** 5 cases (image + `en_US` + `alternateLocale` + large card, no image → no images/alternates and `summary`, meta-title fallback, CMS-backed `/`, built-in `/` keeps only its canonical; no `alternates.languages`); RED 5/5, then green.
- [X] T086 [US9] Implement it in `storefront/app/(content)/[...slug]/page.tsx` and
  `storefront/app/page.tsx`. T085 goes green.
  **Result (2026-10-23):** `storefront/lib/seo/cms-share-metadata.ts` (`cmsSocialMetadata`, `openGraphLocale`) used by both routes; `app/page.tsx` replaces `export const metadata` with `generateMetadata` (canonical `/` on both paths). `check:storefront-indexability` 0 findings; storefront `test/seo` 503/503.
- [X] T087 [P] [US9] **RED** `backend/test/contract/settings/shop-info.contract.test.ts` `[PG]`:
  `logoUrl` comes from `shop.logo_asset_id`, `socialProfiles` from `shop.social_profiles`, and a
  write of `http://…` to `shop.social_profiles` is refused by the write validator.
  **Result (2026-10-23):** 4 cases (declarations; `logoUrl` null then the asset's URL; `socialProfiles`; `http://` and a non-URL → 422 `VALIDATION_FAILED`, nothing stored); settings read first and restored in `afterAll`. RED 4/4 on 404 `SETTING_NOT_REGISTERED`, green 4/4 `[PG]`.
- [X] T088 [US9] Declare the two settings in `packages/modules/settings/src/manifest.ts`, extend
  `ShopInfoSchema` and the shop-info resolver, and register the validator. In
  `storefront/components/seo/OrganizationJsonLd.tsx`, emit `logo` and `sameAs`, and render the
  component on every CMS page as well as on `/`. Test: `storefront/test/seo/organization-jsonld.test.tsx`.
  T087 goes green.
  **Result (2026-10-23):** `shop.logo_asset_id` (string, `''`) and `shop.social_profiles` (`string_list`, `[]`) added, no existing default changed; `ShopInfoSchema.logoUrl`/`socialProfiles`; the resolver resolves the logo through `assetsLibraryPort` per call (public only, a gone asset → `null`, `rethrowIfModuleDisabled` first) and filters stored profiles to `https:`; `createSocialProfilesValidator` registered by `settings` into its own registry. `settings` now declares `assets_library` (both `nonDeactivatable`, no cycle; `composer:generate` re-rendered `docs/docs/module-reference/settings.md`, `manifests:generate` changed nothing). `OrganizationJsonLd` emits `logo`/`sameAs` and renders on every CMS page; `[...slug]/seo.ts` declares `Organization`. Organization test 4/4 (RED 2/4 first). Named changes: `shop-info-resolver.test.ts` expectations gain the two fields (+2 cases, 5/5); `breadcrumbs.test.tsx` mocks `OrganizationJsonLd` and its fixture gains `share`/`languages`.

**Verification**: T083 and T087 `[PG]`; T085 and the Organization test by file.

---

## Phase 12: User Story 10 — restrained motion (P3)

**Story goal**: an opt-in fade-up or word reveal, hover zoom and decorative backdrops. All of it
is off under reduced motion, and content is visible without JavaScript (FR-036–FR-037).

**Independent test**: spec US10.

- [X] T089 [P] [US10] **RED** `packages/cms-components/src/hooks/use-reveal.test.tsx`:
  - the server render has no `data-cmsc-reveal`, so content is visible;
  - on mount with motion allowed, the attribute becomes `pending`, then `done` on intersection,
    once;
  - under `prefers-reduced-motion: reduce` it never sets `pending`;
  - with `desktopOnly` below 1024 px it never sets `pending`.

  Also **RED** `src/utils/split-words.test.ts`: the word split keeps whitespace and inline marks,
  and the joined text equals the source.
  **Result (2026-10-23):** `use-reveal.test.tsx` (11, jsdom, `<StrictMode>`) RED on the missing module, plus `split-words.test.ts` (7) and `components/motion.test.tsx` (11: SSR words/fade-up/default render of Hero, Statement, LinkTile, CarouselSplit, the fields, client pending, stylesheet scoping) RED on missing classes/fields/rules, a `section-field.test.tsx` case (RED on the missing "Entrance reveal" control). Beyond the list: one shared observer, nothing for `effect: 'none'`, the editor canvas or no IntersectionObserver, and content already on screen at mount is left as is (no flash, no delayed LCP).
- [X] T090 [US10] Write `src/hooks/use-reveal.ts` and `src/utils/split-words.ts`. Apply them in
  `Section`, for the section-level reveal, and in `Hero` and `Statement`, for the block-level
  `words`. Add the CSS for `[data-cmsc-reveal="pending"]` and the word stagger by `--i`, plus
  `.cmsc-hover-zoom`, all inside `@media (prefers-reduced-motion: no-preference)`. Add `reveal` to
  the section field (T033) and `hoverZoom` to the image-bearing items. T089 goes green.
  **Result (2026-10-23):** `hooks/use-reveal.ts` (attribute written to the DOM, no re-render; one module-level IntersectionObserver) and `utils/split-words.ts` (`splitWords`, `countWords`, `splitHtmlWords`), both on the barrel; `InlineRich` gains `wordStart`/`countInlineRichWords`, `BlockHeading`/`RichBody` a `wordStart`. `Section` fades its frame (`editing` prop from `withSection`; off when a `tier` is set); `Hero` (on `.cmsc-pb-hero__content`: statement + body) and `Statement` (heading + body) get `reveal: revealField()` (none/fade-up/words, desktop only), unset by default. Section field: "Entrance reveal" none/fade-up + "Reveal on desktop only" (a section's `words` reads as fade-up). `hoverZoom` (off) on `cms.LinkTile` and `cms.CarouselSplit` → `.cmsc-hover-zoom`. CSS block after the decorative rule, all inside `no-preference`, word stagger capped at 1.6 s. `cms` en/pl keys for `hero`/`statement` `reveal.*` and `linkTile`/`carouselSplit` `hoverZoom.*`. No existing assertion changed; `fallback-parity` 15 green unchanged.
- [X] T091 [US10] Dark decorative layer: `schemes.dark.decorativeAssetId` from the tokens becomes
  `--cmsb-decorative` in `brand-css.ts`. `Section` paints it when `background.decorative` is set
  (R-8a, FR-005 as amended). Update `brand-css.test.ts` and `Section.test.tsx`.
  **Result (2026-10-23):** `--cmsb-decorative` and the `[data-decorative='1']` paint already existed (T031), reused. Gap closed: a gradient background replaced the backdrop through the `background` shorthand; with `decorative` it is now `background-image: var(--cmsb-decorative, none), linear-gradient(…)` (`Section.test.tsx` +3, the gradient case RED first); `brand-css.test.ts` +1 (no variable for a missing or malformed id; green at once). Not built: an animated backdrop or a blend mode (no token field for either).

**Verification**: the tests above by file and the SSR floor.

---

## Phase 13: Polish — presets, field-label i18n, docs, changesets

### 13a. Editor polish (FR-039, FR-042) [UI]

- [X] T092 [P] **RED** `admin/test/modules/cms/section-presets.test.tsx`:
  - the drawer's "Section presets" panel lists six presets;
  - inserting "Downloads" puts a Carousel with three `DownloadTile`s at the drop position without
    replacing the canvas;
  - preset copy comes from `cms` i18n in the admin language;
  - every preset tree passes `check-block-names` (its literals are declared names).
  **Result (2026-10-23):** 11 cases over the **real** `PageBuilderEditor` mounted in jsdom (new non-test harness `admin/test/modules/cms/page-builder-editor-harness.tsx`: descriptor from the `cms`/`catalog`/`blog`/`newsletter` manifests, shipped bundles, real session providers, selection through the editor's outline), RED on `Unable to find … role "group" and name "Gotowe sekcje"`. Six presets named in Polish; "Downloads" after the selected first block → `cms.ContentSlider` with three `cms.DownloadTile` (unique ids) between the two existing blocks, Polish copy, a `role="status"` announcement; nothing selected → appended at the end; every built tree and every source tree literal names a declared block. **Drop position (decision):** a preset is a section, so it goes to the top level after the selected block's top-level section, else at the end of the page (click-to-insert, R-22's "no new interaction pattern"; no drag). jsdom does not evaluate Puck's `min-width` media query, so the side bar is `display:none` there and the drawer queries use `hidden: true`.
- [X] T093 Write `packages/cms-components/src/editor/section-presets.ts` (six builders) and
  `packages/modules/cms/src/admin/components/SectionPresetsPanel.tsx`, wired in
  `PageBuilderEditor.tsx` next to the row layout picker. Put neutral placeholder copy
  (standing rule 11) in `packages/modules/cms/i18n/{en,pl}.json` under `presets.*`. T092 goes green.
  **Result (2026-10-23):** `section-presets.ts` (`SECTION_PRESETS`: hero, mediaText, ctaCard, downloads, featureGrid, statement — each `build(t)` spreads the block's own `defaultProps`, fresh ids, literal `type`s; `presetBlockNames`) and `SectionPresetsPanel.tsx` (a labelled group above the drawer's list inside the `drawer` override; Puck `insert` with `recordHistory: false` then `replace` of the tree, selecting it — the insert itself is not a history step, so undo should take the whole section back (reasoned, not exercised by a test); a preset whose blocks the editor's context lacks is not listed). 45 `presets.*` keys per language, generic copy. The builders were written with T092, so they were not seen RED on their own. T092 11/11.
- [X] T094 [P] **RED** `admin/test/modules/cms/page-builder-field-i18n.test.ts`. With the admin in
  Polish, every field label of every new and reshaped block resolves from
  `blocks.<name>.fields.*`, and the English fallback is used for unchanged blocks. The test
  enumerates the block list in data-model §4, including `blog.LatestPosts`,
  `newsletter.Signup` and the two catalog blocks. Their keys resolve from the **owning module's**
  bundle, not from `cms` (analysis U4).
  **Result (2026-10-23):** 28 cases on the editor's own config (`buildPageBuilderEditorConfig`, now exported from `PageBuilderEditor.tsx` as a pure function the component calls — a refactor, no behaviour change): the 24 blocks of data-model §4 (incl. `cms.NewsletterSignup`, kept by T076), each field/option of the static set **and** of its `resolveFields` output at the top level walked recursively (sub-fields `….fields.<sub>.…`), plus en/pl key parity, English kept for unchanged `cms.Text`, and a stable translated field object across `resolveFields` calls; and 3 mounted-editor cases in Polish (cms, blog, newsletter). RED (wiring removed) 28/31 failing on English labels. **Not mounted:** `catalog.ProductGrid` — selecting it in the jsdom editor never settles (a synchronous loop after its category picker's read, with and without the label wiring); its labels are asserted on the config only.
- [X] T095 Extend `packages/modules/cms/src/admin/components/page-builder-i18n.ts` to resolve
  field and option labels (R-24), looking each block's keys up in the bundle of the module that
  declares the block. Add any keys missing after T044, T050, T057 and T069–T076. Also localise
  the storefront-facing carousel labels ("Previous slide", "Next slide", "n of m") through the
  `labels` prop `CarouselShell` accepts, from the page language. T094 goes green.
  **Result (2026-10-23):** `page-builder-i18n.ts`: `applyPageBuilderTranslations(config, t, labelFor, fieldLabelFor)` translates `fields` and wraps `resolveFields` (cached per source field object), keys under the block's `labelKey` stem in the **declaring** module's scope (R-24 grammar plus T044's sub-field nesting, confirmed); a field relabelled for one placement names its sibling key in `metadata.pageBuilder.labelKey` (Row's top-level padding → `…padding.topLevelLabel`). 122 keys added (`cms` 118: `cms.Row`/`Tabs`/`Accordion` fields, `NewsletterSignup` box fields, `editorName` on every block; `catalog` 2, `blog` 1, `newsletter` 1), real Polish. **Carousel labels (approach):** a serialisable `carouselLabels` (`CmsCarouselLabelText`, `{n}`/`{m}` templates — a server component cannot pass functions) on `CmsRenderProvider`; `CarouselShell` merges English < context < its `labels` prop, so every carousel (Carousel, product slider, latest posts) follows; `storefront/lib/page-builder/carousel-labels.ts` reads 8 new `cms.carousel.*` messages (en-US, pl-PL) by `page.language` in `CmsPageRenderer`. Tests: `CarouselShell.test.tsx` +2 (RED on the English names), `storefront/test/ssr/carousel-labels.test.tsx` 3 (RED on the missing module). T094 31/31. **Also (coordinator item): `cms.Heading` text is edited on the canvas again** — `createInlineRichTextField({ canvas: true })` marks the field; `editor/inline-rich-text-canvas.tsx` exports `INLINE_RICH_TEXT_FIELD_TRANSFORMS`, Puck's own `fieldTransforms` facility (the one behind `contentEditable`), rendering the same TipTap inline editor in place (canvas variant: block typography, floating toolbar while focused, `registerOverlayPortal`, writes the same `InlineRichText` through Puck's `replace`); `PageBuilderEditor` passes it to `<Puck>`; the side-bar field stays, and both editors follow an edit made in the other (a focused one is left alone). No new dependency. `heading-inline-canvas.test.tsx` 6 (real `<Puck>`, iframe off), RED on the missing module; the follow-the-other-editor case was written after the fix (not seen RED).
- [X] T096 **RED → green** `admin/test/modules/cms/section-settings-visibility.test.tsx`. In the
  real editor config, a MediaText dropped at the root shows the "Section" field group. Moved into a
  Row column, it no longer shows it. Dropped into a Tabs panel, it does not show it either.
  **Result (2026-10-23):** 4 cases in the mounted editor (MediaText at the root, in a Row column, in a Tabs panel; a root Row and its Column), RED 3/4: **a real defect** — inside Puck's store a root-zone block's `parent` is the root node (`{type: 'root', props: {id: 'root'}}`), not `null`, so the section group was hidden at the top level in the real editor (and Row's legacy carry in `resolveData` never ran there). Fixed with `isTopLevelParent` (`page-builder-core`, on the barrel) in `withSectionSettingsField`/`sectionFieldsFor` and `Row` (+1 case in `section-field.test.tsx`). **Addition:** the outline's `collectChildItems` now walks any array-item slot (`items[].panel`, R-13), so blocks inside a Tabs/Accordion panel are listed and selectable (+2 cases in `outline-data.test.ts`, RED on the panel case). The blocks are placed there in the mounted data rather than dragged (no drag in jsdom).

### 13b. Documentation and release intent

- [X] T097 [P] Update `packages/modules/cms/docs/cms/index.md`:
  - the block table, with new, reshaped and removed blocks and what changed shape (ruling Q5:
    "stored content of a reshaped block shows a placeholder until re-edited");
  - section settings;
  - schemes;
  - anchors;
  - presets;
  - the parent page and breadcrumbs;
  - the sharing image.
  **Result (2026-10-23):** `cms/index.md` gains a block table (new, reshaped, gained-section, removed `cms.ImageSlider`; `cms.NewsletterSignup` kept as the external-endpoint form beside `newsletter.Signup`), "Content saved before a block changed shape" (legacy mapping renders stored content as before; a removed block degrades to the placeholder — see the spec-drift note in the PO report), section settings, schemes, anchors (rules, reserved list, both 422s), presets (written to T093's contract, to be re-read once T092/T093 land), parent page and breadcrumbs, sharing image and metadata, motion; HTTP, cache-tag and error tables updated.
- [X] T098 [P] Add `packages/modules/cms/docs/cms/brand.md`: the brand screen, global and
  per-channel scope, the contrast warnings, and fonts by the three kinds, with the
  `CORS_ALLOWED_ORIGINS` and bucket-CORS note (R-5). Register it as the module docs require
  (`specs/conventions/module-documentation.md`). Use only neutral examples.
  **Result (2026-10-23):** new `packages/modules/cms/docs/cms/brand.md` (screen, `cms.brand`, global vs full-copy channel override and reset, contrast pairs and thresholds, three font kinds, `CORS_ALLOWED_ORIGINS` and bucket-CORS note, audit/cache, engineer section with routes and the `--cmsb-*` variable table and fallback rule); registered by `composer:generate`, whose only change was the `modules/cms/brand` row in `docs/sidebars.modules.generated.js`; `extending-page-builder` moved to `sidebar_position: 3`.
- [X] T099 [P] Update `packages/modules/cms/docs/cms/extending-page-builder.md`:
  - section blocks and `useSectionContext`;
  - `--cmsb-*` variables with fallbacks;
  - the generalised block-data seam;
  - the "Suggested follow-up" list, with newsletter wiring done, plus three follow-ups: a
    module-owned server-data hook, islands, and `hreflang` with per-language URLs.

  Also update `packages/modules/blog/docs/blog/index.md` (post image, LatestPosts),
  `packages/modules/newsletter/docs/newsletter.md` (Signup block, `cms-block` source) and the
  catalog docs (showcase card).
  **Result (2026-10-23):** `extending-page-builder.md` gains *Section blocks* (`withSection`, `SECTION_ADOPTION_DEFAULTS`, `useSectionContext`, `EmbeddedBlockDepth`; package-block editor group noted as untested), *Brand variables* (fallback rule, `resolveColorValue`), *the block-data seam* (closed union, owner skip, deprecated `utils/catalog-block-data` re-export), *extend, don't narrow* for block authors, slot notes, and the follow-up table (newsletter done; server-data hook, islands, `hreflang`); blog (main image, `/api/v1/blog/posts`, `blog.LatestPosts`), newsletter (`newsletter.Signup`, `/newsletter/subscribe`, `cms-block`), catalog (`catalog.md`: product listings, showcase card, `summary`) and settings (shop logo, social profiles) pages updated.
- [X] T100 Polish translations: the matching pages under
  `docs/i18n/pl/docusaurus-plugin-content-docs/current/modules/{cms,blog,newsletter,catalog}/`
  and their `docs/translation-cache/pl/*.json` entries with a fresh `hashSourceBody()`. Then run
  `pnpm --filter backend run check:docs-translations` and `check:module-docs`.
  **Result (2026-10-23):** Polish for all seven module pages (new `modules/cms/brand.md`) plus the stale generated `module-reference/{cms,settings}.md`, nine cache entries with fresh `hashSourceBody()`; `check:docs-translations` `sources=166 findings=0`, `check:module-docs` `findings=0` (after removing three `packages/modules/…` paths it reported as `derived-fact-in-prose`), `check:language` OK.
- [X] T101 Changesets: one `.changeset/163-<package>-<meaning>.md` per published package meaning.
  The packages are `contracts`, `page-builder-core`, `cms-components`, `page-builder-admin`,
  `mod-cms`, `mod-blog`, `mod-newsletter`, `mod-catalog` and `mod-settings`. Each states the
  reshaped and removed blocks for `cms-components` and `mod-cms` (`specs/conventions/release-intent.md`).
  Then run `pnpm --filter backend run check:release-intent -- --since origin/master`.
  **Result (2026-10-23):** 16 `.changeset/163-*.md` files, one per meaning, covering all eleven changed packages (`admin-kit`, `cms-components`, `contracts`, `mod-i18n`, `mod-blog`, `mod-catalog`, `mod-cms`, `mod-newsletter`, `mod-settings`, `page-builder-admin`, `page-builder-core`), `minor` for new API and breaks (removed `cms.ImageSlider` and its exports, Tabs/Accordion panels at `items[].panel`, removed `hooks/use-catalog-block-data` and `useProvidedCatalogBlockData`, the deprecated `utils/catalog-block-data` re-export kept), `patch` for the blog card image fix and label-only bumps; `check:release-intent --since origin/master` on a snapshot commit of the working tree (temporary index, detached scratch worktree, both removed): `changed=386 changesets-added=16 … violations=0`; default mode `C1=0 C2=0 C3=0 C4=0 … violations=0`.

---

## Phase R: Owner review 2026-10-23 — Section container, editor panel clarity

**Goal**: apply the owner's review of the editor (plan § *Owner ruling 2026-10-23*): a dedicated
`cms.Section` container replaces section settings on blocks; the component options panel is made
easier to read and loses its horizontal scroll.

### R1. Section container block [US1]

- [X] T109 [US1] **RED** `packages/cms-components/src/components/SectionBlock.test.tsx`: `cms.Section`
  renders `<section class="cmsc-section" id=… data-cmsb-scheme=… data-width=…>` with its
  background layer, spacing and reveal, and renders its slot children inside the frame; default
  props render an empty, neutral section (no colour, contained, today's spacing); a Section
  dropped inside a slot is refused by the editor guards (`puck-action-guards`) and, if stored
  nested, renders its children without the section wrapper.
  **Result (2026-10-23):** `SectionBlock.test.tsx` (13, through Puck's `<Render>`) RED 12/13 on `cms.Section` missing from the config (`expected undefined to be defined`, empty renders), the missing stylesheet rules, slots that admit it (`cms.Column.content` and three more), the guard not reverting (`expected false to be true`) and 22 other blocks carrying `section`; the 13th ("a stray `section` prop on another block is ignored") is a regression guard that passed from the start. Covers: frame with anchor/scheme/width/spacing vars and the children inside `.cmsc-section__frame`; image background with picture and overlay, solid paint; no reveal state in server HTML; content position per breakpoint (`data-position`, `-lg`); neutral defaults (`section` unset, `content: []`, no scheme/background/id, `contained`, `l` spacing 40/64 px); the stylesheet's `viewport` min height and position rules; the slot's own `disallow`; **every slot of every block** refuses it (walks `allow`/`disallow`, array and object sub-fields); `shouldRevertPuckAction` reverts an insert into `col-1:content` and `s-1:content` and a move out of the root, keeps a root insert and reorder; stored nested in Row › Column it renders children with no `<section class="cmsc-section">` and no id; no other block carries a `section` field or default.
- [X] T110 [US1] Write `cms.Section` (component, types, manifest declaration in the `layout`
  palette section, `translatable: []`, en/pl labels and field labels), reusing `Section.tsx`,
  the section field (`createSectionSettingsField`) and the admin asset pickers. Root-only: every
  slot in the config disallows `cms.Section`.
  **Result (2026-10-23):** `components/SectionBlock.tsx`: `cms.Section` = `withHideOn(withSectionSettingsField(config, { label: 'Section settings', contentPosition: true }))` with a `content` slot (`disallow: SECTION_SLOT_DISALLOW` = `cms.Section`, `cms.Column`), editing render with the preview tier, published render through the frame. **Deviation (naming):** the block is exported as `Section` (the SSR floor's second author matches an export to the block name's local segment; `SectionBlock` was refused as `unregistered-block`), so the frame component in `Section.tsx` is renamed `SectionFrame` (`SectionFrameProps`). The frame gains `contentPosition` (`data-position(-md|-lg)`, per tier in the editor) and `useSectionAnchor()` (context with the section's anchor). CSS: `[data-width='viewport']` gets `min-height: 100svh` (plan table: full viewport height and width; no other block renders the frame any more) and flex `justify-content` per `data-position` tier. Types: `SectionBlockProps` is now `cms.Section`'s (`section`, `content`). Registered first in `defaultPageBuilderConfig` (`responsiveFields: ['section']`); manifest `cms.Section` in `layout`, weight 5, `translatable: []`, `responsiveFields: ['section']`; en/pl `blocks.section.{label,description}` and `fields.{editorName,hideOn,section,content}.label` ("Section"/"Sekcja"). Admin asset pickers: unchanged code — `PageBuilderEditor` swaps them in by field key, so `cms.Section` gets them (comment updated). Root-only: `Column`, `Slide` and the panel slot (`PANEL_DISALLOW`) add `cms.Section`; Row (`allow: ['cms.Column']`) and the Carousel (`allow` list) already exclude it; `page-builder-core` `puck-action-guards.ts` gains `ROOT_ONLY_TYPES` and `isRootZone` (on `./editor`), reverting insert/move of a root-only block outside `root:*`. `frozen-block-renames-codomain.test.ts` `BORN_NAMESPACED` + `cms.Section` (derived ledger, trap 3). `page-builder-field-i18n.test.ts` lists `cms.Section` (32 green). Block-declarations: `cms.Section` fixture (no prose) and a case proving a heading in its slot is translated through its own declaration (49).
- [X] T111 [US1] Remove `section` from every other block (list in plan § *Owner ruling
  2026-10-23*): components, types, manifests, `withSectionSettingsField` callers,
  `section-block-fields`, admin overrides, `block-declarations.test.ts` fixtures,
  `section-adoption.test.tsx` (delete or rewrite against `cms.Section`), option-parity cases
  (the parity target for those blocks is their `origin/master` field set, unchanged by this).
  Blocks keep their intrinsic visuals; where a block relied on section width or background
  (BackgroundPanel, Statement full-bleed image, Hero), give it the equivalent intrinsic option or
  document that it is achieved by wrapping it in a Section.
  **Result (2026-10-23):** `withSection`/`SECTION_ADOPTION_DEFAULTS` wrappers removed from Hero, MediaText, BackgroundPanel, CtaCard, Statement, FeatureList, Stats, Testimonial, ContentSlider, LinkList, LatestPosts, ProductGrid, ProductSlider, `newsletter.Signup`, `cms.NewsletterSignup`, LogoStrip, Video, Map, SimpleTable, CategoryGrid, CategoryList (Tabs/Accordion never had it); `withSection`, `SECTION_ADOPTION_DEFAULTS` deleted (branch-only API); `SectionBlockProps` dropped from 21 prop interfaces; `section: _section` destructures removed (stray props never reach the DOM: `BoxStyled` picks its keys); `'section'` dropped from every other `responsiveFields` (`cms-components` index, `cms`/`catalog`/`blog`/`newsletter` manifests); per-block `blocks.*.fields.section.*` labels removed from the bundles (cms 13, catalog 2, blog 1, newsletter 1 per language). The six T035 blocks are byte-identical to `origin/master` again apart from the block-data rename. Intrinsic visuals: BackgroundPanel loses its `section: {width: 'bleed'}` default and Statement its `resolveData` that proposed a bleed section — edge to edge is now a Section with `bleed`/`full` around them (documented in `cms/index.md`, contract). Hero keeps its own media/overlay/min height. `newsletter.Signup`'s no-JS `anchor` now comes from the enclosing Section (`useSectionAnchor()`). Tests: `section-adoption.test.tsx` rewritten (46 = 23 blocks × {no `section` field at either level nor in defaults; renders the same inside a dark anchored Section as alone}); option-parity: 7 top-level `toContain('section')` flipped to `not.toContain` (Hero, FeatureList, Stats, Testimonial, Carousel, ProductGrid, NewsletterSignup) — the origin field sets are untouched; one case each replaced in `ContentSlider.test.tsx`, `FeatureList.test.tsx`, `MediaText.test.tsx` ("is a section at the top level" → "a stray `section` prop renders no section"); `motion.test.tsx` 2 cases put the section reveal on a `cms.Section`; `NewsletterSignupForm.test.tsx` renders the form inside an anchored Section (2 cases renamed); `block-declarations.test.ts` (cms, blog) lose the `...section` spreads; admin `section-settings-visibility.test.tsx` rewritten (4: the Section shows the group; a MediaText in it, at the root, in a column, in a panel, a root Row and its Column show none), `section-asset-input.test.tsx` (2 changed: only `cms.Section` carries the field); storefront `newsletter-signup.test.tsx` fixture inside a Section.
- [X] T112 [US1] Restore `cms.Row` to its `origin/master` shape and behaviour (`git show
  origin/master:…/Row.tsx`), keeping only fixes this branch made that are not section-related
  (record them); the option-parity Row case maps every origin field to itself. Name every changed
  existing assertion (`Row.test.tsx`, `fallback-parity.test.tsx`).
  **Result (2026-10-23):** `Row.tsx` restored verbatim from `origin/master` (no diff left); `RowProps` loses `section`; the manifest Row entry is origin's again (the T034 comment and `'section'` removed). **Non-section fixes kept: none** — every change this branch had made to `Row.tsx` (`rowSectionFromLegacy`, `ROW_SECTION_DEFAULTS`, top-level render through the section, `resolveFields`/`resolveData` at the top level, the `RowPublishedBody` refactor that served it) was section-related; the T096 `isTopLevelParent` fix lives in `page-builder-core` and stays. Bundle key `blocks.row.fields.padding.topLevelLabel` removed (the generic sibling-label mechanism in `page-builder-i18n.ts` stays, comment de-Row'ed). Option-parity Row case rewritten (2): every `ROW_ON_ORIGIN` field is offered as itself with origin's options at both levels; no `section` at either level nor in defaults. **Changed existing assertions:** `Row.test.tsx` — all 6 T034 cases replaced by 3 (origin render at top level with no `.cmsc-section`; a stray stored `section` renders byte-identical to none; inside a dark Section the row's markup is unchanged); `fallback-parity.test.tsx` — "cms.Row keeps today's page container…" reads `.cmsc-pb-row-full-width .cmsc-pb-row-inner` again (values unchanged), "cms.Row default render" now asserts no `.cmsc-section` and origin's `BoxStyled` vars (`--pb-padding:16px…`, `--pb-margin:0px…`), and the nested case drops its `closest('.cmsc-section')` line.
- [X] T113 [US1] Follow-on: anchor guard reads `section.anchor` only on top-level `cms.Section`
  nodes (`anchor-guard.ts` + tests); the hero's first-block priority looks through a top-level
  Section (`Hero.tsx` + test); presets wrap their block in a `cms.Section`
  (`section-presets.ts` + test); `check:block-names`, the SSR floor and the translation contract
  stay green.
  **Result (2026-10-23):** `anchor-guard.ts` reads `section.anchor` only on root `cms.Section` nodes (heading anchors at any depth unchanged); `anchor-guard.test.ts` fixtures moved to `cms.Section` + 1 case (a stray `section` on a root Hero/Row is not an anchor and does not collide), RED on `['intro','intro','stray']`, then 21 green; `anchors.contract.test.ts` [PG] fixture's section anchor moved onto a Section (6 green). **Addition:** the editor's `collectAnchors` (link picker) lists only top-level `cms.Section` anchors — `anchors.test.ts` RED on 5 anchors instead of 2, then green; `link-field.test.tsx` canvas fixture moved to Sections (9 green). Hero `useIsLeadBlock`: depth 0 and first, or depth 1 inside a first top-level `cms.Section` whose first child it is; `Hero.test.tsx` +1 (first in first Section → high, second lazy; in a second Section lazy; in a Row inside the Section lazy) — written with the change, not seen RED on its own. Presets: each builder returns `inSection(block)` (Hero's Section with `spaceTop/Bottom: 'none'`, others neutral); `section-presets.test.tsx` RED 4/12 (`expected 'cms.ContentSlider' to be 'cms.Section'` …), then 12 green, +1 case (every preset is one Section holding one non-Section block). `check:block-names` declared=98 rendered=98 findings=0; SSR floor green (66 in `storefront/test/ssr`); translation contracts [PG] 18 + nested 1 green.
- [X] T114 [US1] Docs and changesets follow the ruling: `cms/docs/cms/{index,extending-page-builder}.md`
  (+ Polish + translation cache), contracts/blocks.md and data-model.md in this directory, and the
  affected `.changeset/163-*.md` files.
  **Result (2026-10-23):** `cms/docs/cms/index.md`: block table drops the "Section block" column and gains `cms.Section`; Row, LogoStrip/Video/Map/SimpleTable, CategoryGrid/List back to "Unchanged"; BackgroundPanel/Statement say edge to edge is a Bleed/Full Section; "Section settings" rewritten for the container (top level only, slots refuse it, neutral defaults, content position, viewport height, the sign-up's anchor); anchors, presets, motion follow. `extending-page-builder.md`: "Section blocks" → "Sections" (no `withSection`; slots' `disallow`, `ROOT_ONLY_TYPES`, `SectionFrame`, lead hero, `useSectionAnchor`); the stale follow-up row about package blocks removed. Polish pages mirrored and both cache entries rewritten with `hashSourceBody()` (`check:docs-translations` findings=0). `contracts/blocks.md`: "Section blocks: the common part" → "`cms.Section`" contract; hero media loading, statement background, panel slot, newsletter anchor and `cms.NewsletterSignup` wording updated. `data-model.md`: §3.4 is the Section's prop with the ruling note, §4 table loses the column and gains `cms.Section`/Row unchanged, §6 anchor rule. Changesets: `163-page-builder-section-settings-and-anchors.md` rewritten (the Section block, `SectionFrame`, `useSectionAnchor`, `ROOT_ONLY_TYPES`/`isRootZone`, `collectAnchors`; `mod-catalog` dropped from it — its own changesets cover it); "section settings" removed from the catalog, blog, carousel, new-blocks, reshaped-blocks and newsletter ones, presets and lead hero described; `check:release-intent` default mode violations=0. Not touched: the git-ignored generated copy under `docs/docs/modules/cms/` (rebuilt by the docs sync).

### R2. Component options panel [US1] [UI]

- [X] T115 [US1] Audit the Puck sidebar for the reshaped and new blocks with the `ux-laws` skill:
  field grouping and hierarchy (group headings, spacing between groups, separators), responsive
  triplets (Mobile / Tablet / Desktop) that wrap or crowd, label length, and every place that
  scrolls horizontally (the colour palette control among them). Record the findings here.
  **Result (2026-10-23):** findings, by impact (the first, third and fourth are on `origin/master` too):
  1. **Every custom control was unstyled (cause of the sideways scroll).** 18 sites named Puck's CSS-module class `_Input-input_bsxfo_26` (page-builder-core: section, colour, spacing, border, background, responsive, editor-name fields, the scope selectors; page-builder-admin: AssetPickers, LinkField, ResponsiveImageField, CatalogPickers, re-exported to cms' Hero/Section/Background fields; cms-components: SimpleTable, catalog fallback fields). Puck 0.23 renamed it (`_Input-input_qyenz_29`), so no `width: 100%`, padding, border or focus outline applied: a `<select>` was as wide as its longest option (section Width: "Full viewport, content in the container"), an `<input>` 20 characters wide. Similarity (they looked unlike Puck's native fields) and the overflow below.
  2. **The palette row, concretely** (`color-field.tsx`): `w-12` swatch + text box `flex: 1` without `min-width: 0` (its automatic minimum is its ~20-character intrinsic width, finding 1) + "Palette" button + two gaps ≈ 48 + 8 + ~170 + 8 + ~62 ≈ 296 px, against 288 px of field width (320 − Puck's 2 × 16 px padding) and ~260 px inside the section field, an array item or an object fieldset. The scroll container (`fields-tab-panel.tsx` `scrollStyle`, `overflowY: auto`, so `overflow-x` computes to `auto`) then scrolled the whole panel sideways. Every colour field (section background/gradient, button colours, Stats, Spacer, Hero …) had it.
  3. **Top-level fields ran into each other.** `FieldsTabPanel` wraps each field in a `<div>` to put it on its tab, so Puck's separator `._PuckFields-field + ._PuckFields-field` (rule + 8 px) never matched (Common Region, Proximity) — the "options blend together" of the screenshot.
  4. **One `<label>` around many controls** (`PuckFieldLabel` defaults to Puck's `el="label"`): the section settings (dozens of controls with their own nested `<label>`s, invalid; a click on any text focused the anchor), the colour field (only the swatch was named; the text box and Palette button had no accessible name), Hide on (nested labels). WCAG 1.3.1, 4.1.2.
  5. **Contrast.** Control labels `opacity-80` and hints `opacity-60/70` over Puck's `--puck-color-text-secondary` (#5a5a5a) give ≈ 4.2:1 and ≈ 3.0–3.4:1 at 12 px, under 4.5:1 (section field, link and image fields, background field, catalog fallback, the "Applies … / Inherited value shown" hints, the editor-name hint).
  6. **English only** (FR-039): the section field's ~80 labels and options, the colour field's "Palette", Hide on's Mobile/Tablet/Desktop.
  7. **Hierarchy.** The section's group titles (`<legend>` 12 px semibold at 80 %) were the size of the labels; nine controls in one flat list, anchor first, the rarely used reveal and content position last (Hick, Serial Position).
  8. **Responsive triplets.** Space above/below, custom max width and content position were `grid-cols-3` of ~85 px columns, each with a visible "Space above — Mobile" label that wrapped to two lines and repeated the group's label three times (Miller, Prägnanz); a custom px box fell under one column. The image field's ratio was three stacked selects with three long labels. "Inherit" never said what was inherited (Tesler).
  9. **Focus/keyboard.** Native controls are reachable, but with finding 1 their focus indicator was the UA default only; checkbox rows had no minimum target (WCAG 2.5.8, 24 px).
  Not in scope (pre-existing, recorded): the Responsive tab's "Scope settings" select, its hints ("Applies: … (from Base)", "Inherited value shown — …") and the editor-name hint are English-only `page-builder-core` strings; `CatalogPickers.tsx:479` carries a pre-existing `react-hooks/exhaustive-deps` lint warning.
- [X] T116 [US1] Fix them in the shared field components (`page-builder-core/src/fields/*`,
  `page-builder-admin/src/chrome/*`, `cms-components/src/fields/*`) and their CSS: clear group
  headings with visual separation, collapsible advanced groups, responsive values laid out so the
  20rem-wide sidebar never scrolls horizontally, palette control wrapping inside the sidebar.
  Admin tests in `<StrictMode>` assert no horizontal overflow (`scrollWidth <= clientWidth`) for
  the palette field and the section field at the sidebar width.
  **Result (2026-10-23):** fixed in the shared components, so every block gets it. **Before → after, per finding:**
  (1) `page-builder-core/src/fields/field-classes.ts` (no `'use client'`, so a server-rendered block reads strings): `PB_FIELD_INPUT_CLASS` (Puck's look through Puck's variables with fallbacks, `w-full min-w-0 max-w-full`, admin `focus-visible:ring-ring`), `PB_FIELD_LABEL_CLASS`, `PB_FIELD_HINT_CLASS`; all 18 stale-class sites now use it (no `bsxfo` left in the tree). (2) Colour row: `flex min-w-0` with a `w-10 shrink-0` swatch, a `flex-1 min-w-0` text box, a `shrink-0` button — it fits any width. (3) `FieldsTabPanel`: tab-hidden wrappers carry `hidden` and `data-pb-field`; a React 19 `<style href precedence>` rule draws Puck's rule + 8 px between the shown, non-empty wrappers. (4) `PuckFieldLabel` takes Puck's `el`; the section, colour and Hide on fields use `el="div"`, the colour field's swatch, text box and button are named each (`"<label> — colour picker"`, `"<label>"`, `"Palette — <label>"`, visible text first, SC 2.5.3), Hide on's checkboxes are a named group; link and image fields use Puck's `FieldLabel el="div"` for their title. (5) No `opacity-*` on any label or hint in the touched fields: the label/hint classes use the secondary text colour at full strength (≈ 6.9:1). (6) `fields/field-text.tsx`: `PAGE_BUILDER_FIELD_TEXT` (83 keys, the English), `PageBuilderFieldTextProvider`, `useFieldText()`; page-builder-admin `PageBuilderFieldText` answers from `core` (`pageBuilder.fieldText.<key>`, 83 keys in `_i18n/i18n/{en,pl}.json`, real Polish) and is mounted by `PageBuilderColorPaletteProvider`, so the page editor and the e-mail editor both get it without a caller change; the section field, colour field, breakpoint switch and Hide on read all their copy through it. (7) `fields/field-ui.tsx`: `FieldGroup` (`<section>` + `<h3>` 11 px uppercase semibold with a rule and 16 px above; none on the first), `FieldDisclosure` (native `<details>`, closed, with a summary of what is set inside), `FieldControlLabel` (label 4 px from its control, fields 12 px apart, groups 16 px + rule: Proximity). The section reads Appearance (scheme, background — its dependent controls indented under a left rule, then the decorative backdrop), Spacing, Layout (width, custom max width, content position), then **Advanced, collapsed** (anchor, entrance reveal; summary e.g. "#contact · Fade and rise"). (8) `ResponsiveTiers` + `FieldTierScope`: one label and a Mobile / Tablet / Desktop segmented switch (WAI-ARIA tabs: roving tabindex, ←/→/Home/End, 24 px targets, wraps under the label if narrow), one full-width control below; a breakpoint with its own value shows a dot and is named "Desktop (own value)"; the switch is shared by the section's triplets (Tablet on "Space above" shows Tablet on "Space below"); the inherit option says what it inherits ("Inherit (L)"). Each control keeps its accessible name ("Space above — Mobile"), so `section-field.test.tsx` (18) passed unchanged. The image field's ratio uses the same switch. Not reused: the Responsive tab's scope `<select>` (per component and per tab; a select costs two clicks where a segmented switch costs one) — the new switch starts on Mobile, the base every breakpoint inherits, as the scope does. (9) Checkbox rows `min-h-6` and fully clickable (Fitts).
  **Tests:** `admin/test/page-builder-admin/sidebar-field-layout.test.tsx` (11, `<StrictMode>`, Polish bundle): colour field and section field in a 320 px column — `scrollWidth <= clientWidth` (trivial in jsdom, which does not lay out; kept for a browser run) **and** the responsible classes (every control `w-full min-w-0 max-w-full`, colour row `min-w-0`, text box `flex-1 min-w-0`, swatch and button `shrink-0`, no `grid-cols-3`, no stale class, no `opacity-*`); the colour field has no `<label>` around its controls and names each; group headings are `heading` level 3 (`Wygląd`, `Odstępy`, `Układ`); Advanced is a closed `<details>` holding the anchor and reveal; its summary shows `#kontakt`; one combobox per triplet, the switch's tabs `Telefon/Tablet/Komputer`, shared across triplets, arrow keys, "Dziedzicz (L)"; an overridden tier named "Komputer (własna wartość)"; no English left; every `PAGE_BUILDER_FIELD_TEXT` key in both `core` bundles (English equal to the package's); and in the real `PageBuilderEditor` (Polish) the Section's groups are translated and the separator rule is mounted over ≥ 2 field wrappers. Written with the change (not seen RED). **Changed existing assertion:** `button-image-fields.test.tsx` "sets a ratio per breakpoint" — the desktop ratio select is no longer in the accessibility tree until its tab is chosen: it now asserts that, clicks the "Desktop" tab, then continues unchanged. Changeset `.changeset/163-page-builder-options-panel.md` (page-builder-core, page-builder-admin minor; cms-components, mod-i18n patch).
  **Verification:** core `src/fields` + whole core suite 182/182; admin `test/modules/cms/*` + `test/page-builder-admin/*` 31 files 267/267; neighbouring editor suites (batch-eleven/-sixteen surfaces, blog settings panel, newsletter, transactional e-mails, document templates) 11 files 213/213; cms-components `SectionBlock.test.tsx` 13/13; backend `_i18n` bundle tests 79/79; mod-i18n 6/6; `check:class-vocabulary` findings=0; `i18n:hardcoded` regressions=0 drained=0; `check:release-intent` violations=0; typecheck and lint of page-builder-core, page-builder-admin, cms-components, mod-cms, admin, mod-i18n clean except the pre-existing `CatalogPickers.tsx:479` warning.

### R3. Responsive values on the Responsive tab [US1] [UI]

Owner review 2026-10-23 (second): a value per breakpoint lives on Puck's **Responsive** tab, as on
`cms.Row` (fields with `PB_RESPONSIVE_METADATA`, listed in `responsiveFields`, edited per
breakpoint through the editor's scope switcher), not in a Mobile / Tablet / Desktop switch inside
a field of the main tab.

- [X] T117 [US1] `cms.Section`'s settings become its own top-level props — `anchor`, `scheme`,
  `background`, `width`, `customMaxWidthPx` (number), `spaceTop`, `spaceBottom`,
  `contentPosition`, `reveal` — the three per-breakpoint ones responsive fields on the Responsive
  tab; the old `section` object goes (unreleased, no compatibility). Renderer input, anchor guard,
  link-picker anchors, presets, docs, contracts, data model and changesets follow.
  **Result (2026-10-23):** **RED first:** `page-builder-core` `section-field.test.tsx` rewritten (15) RED 15/15 (`createSectionSpaceField is not a function` …); `SectionBlock.test.tsx` 7/16 RED (no top-level fields, `fields['section']` still there, no Responsive-tab fields, no `resolveFields` hiding `customMaxWidthPx`, flat fixtures rendered nothing). Then: **core** `fields/section-field.tsx` rewritten — `createSectionBackgroundField` (composite, main tab, marked `sectionBackground: true`; `isSectionBackgroundField`), `createSectionAnchorField`, `createSectionRevealField`, `createSectionSpaceField` (custom field **with `PB_RESPONSIVE_METADATA`**: one select + Custom px for the breakpoint the Responsive tab's scope switcher selects — `useComponentScope` on the selected component, as `spacing-field` does; above the base a first option "Inherit (M)" clears the override; a value with only its base is stored plain; nothing written until an edit). Removed (branch-only API): `createSectionSettingsField`, `withSectionSettingsField`, `sectionFieldsFor`, `SECTION_FIELD_KEY`, `SectionSettingsField`, and from `field-ui.tsx` `FieldGroup`, `FieldDisclosure`, `FieldTierScope` (no user left); `isTopLevelParent` kept (SectionPresetsPanel). **cms-components** `SectionBlock.tsx`: fields `scheme`, `width` (Puck selects), `customMaxWidthPx` (Puck number, shown only with `width: 'custom'` via `resolveFields`, as Row does), `background`, `anchor`, `reveal` (core custom fields), `spaceTop`/`spaceBottom` (core responsive field), `contentPosition` (Puck select with `PB_RESPONSIVE_METADATA`, i.e. the standard `ResponsiveSelectControl`); `defaultProps` stay `{ content: [] }`; `SECTION_RESPONSIVE_FIELDS = ['spaceTop','spaceBottom','contentPosition']` used by the registration and mirrored in the cms manifest. Field order (enhancer): General = name, hide on, scheme, background, width, (max width), anchor, reveal; Responsive = space above, space below, content position. `SectionBlockProps extends HideOnProps, SectionSettingsValue`; the frame (`SectionFrame`) API is unchanged — `SectionBlock` hands it the picked settings. Contracts: `sectionSettingsSchema.customMaxWidthPx` is a plain number (+1 case refusing a per-breakpoint one). Anchor guard and `collectAnchors` read `props.anchor` of root `cms.Section`; the hero's lead lookup reads only the Section's `content`, so it needed no change (its tests stay green). Presets spread the Section's settings (`spaceTop/Bottom: 'none'` on the hero's). Admin: `PageBuilderEditor` swaps the asset picker into every field `isSectionBackgroundField` (keyed on the field, not a block/prop name); `withAdminSectionAssetInput` takes a `SectionBackgroundField`. **i18n:** the Section's field and option labels now come from the cms bundle (`blocks.section.fields.{scheme,background,width,customMaxWidthPx,anchor,reveal,spaceTop,spaceBottom,contentPosition}.label`, options of scheme/width/contentPosition, en+pl, the Polish taken from the former core keys); `fields.section.label` removed; 27 keys per language dropped from `pageBuilder.fieldText.*` (groups, Advanced, scheme/width/position words, labels now the fields', `tier.inherit`). **Advanced group / disclosure:** not kept — Puck renders one field per prop with its own label and separator, so a collapsed group of two props (anchor, reveal) cannot be drawn without coupling the fields; they are ordered last (Serial Position) instead. **Changed existing assertions:** `SectionBlock.test.tsx` — "is registered as a block with a section field and a slot" → "…whose settings are top-level props, and a slot"; "neutral by default" now `defaults` equal `{ content: [] }`; fixtures flat; +3 (Responsive-tab fields and `responsiveFields`, max width only with custom width, plain px max width). `Section.test.tsx` "writes the custom width as --cmsc-section-max per breakpoint" → "…at every breakpoint" (plain 880). `section-field.test.tsx` all cases rewritten against the new fields (the T116 per-field switch cases are gone; the background, anchor and reveal cases keep their assertions). `sidebar-field-layout.test.tsx`: the five section-field cases (headings, closed Advanced, its summary, the in-field tier switch, Polish labels) replaced by: background field contained in 320 px and named; reveal/anchor in Polish; in the real Polish editor each setting has its own wrapper, `spaceTop`/`spaceBottom`/`contentPosition` hidden on General and shown on Responsive with the scope selector, no `[role=tab]` inside any field, the spacing select's options in Polish; the manifest's `responsiveFields`. `section-asset-input.test.tsx` rewritten (3: exactly one carrier `cms.Section.background`; swap keeps render/label; source loop keyed on `isSectionBackgroundField`). `heading-inline-canvas.test.tsx` "leaves every other custom field's value" uses `background` instead of `section` as its example. Flat fixtures (no assertion change): `anchor-guard.test.ts` (+1 case: top-level `anchor` read, a `section` object not; stray `anchor` on a Hero not read), `anchors.test.ts` (same two kinds of fixture), `link-field.test.tsx`, `section-presets.test.tsx` (+1: no `section` object, hero's spacing as props), `Row.test.tsx`, `NewsletterSignupForm.test.tsx`, `section-adoption.test.tsx`, `motion.test.tsx`, cms `block-declarations.test.ts`, `anchors.contract.test.ts` [PG], storefront `newsletter-signup.test.tsx`. The admin cases were written before the implementation but first run after it (not seen RED). Docs: `cms/index.md` (Section settings: each a field, Responsive tab and Scope settings, Max width), `extending-page-builder.md` (flat props, `responsiveFields`, the core field factories), Polish pages mirrored, both cache entries rewritten with `hashSourceBody()`. `contracts/blocks.md` `cms.Section` prop table (tab per prop), `data-model.md` §3.4 (+ T117 note), §4, §6; plan's ruling bullet. Changesets: `163-page-builder-section-settings-and-anchors.md` (flat props, new field exports), `163-page-builder-options-panel.md` (no group/disclosure/tier-scope exports; the switch is for nested values).
- [X] T118 [US1] Audit the other new and reshaped blocks for values per breakpoint hidden inside
  custom or object fields with the in-field switch; move top-level ones to the Responsive tab,
  keep and record nested ones.
  **Result (2026-10-23):** the in-field Mobile / Tablet / Desktop switch (`ResponsiveTiers`) had exactly two users: the Section's field (gone with T117) and `ResponsiveImage.ratio` in page-builder-admin's `ResponsiveImageField`. Per value:
  - **Already top-level on the Responsive tab, no change:** Hero `minHeight`, `minHeightPx`, `gaps`, `headingSize(Px)` …; carousel `slidesPerView`, `gap`, `gapPx` (`carousel-parts` `CAROUSEL_TRACK_FIELDS`, ContentSlider/CarouselImage/CarouselSplit/ProductSlider/LatestPosts); FeatureList and Stats `columns`; BackgroundPanel `minHeight`; Heading's size/weight/align; `cms.Button` `align`; Row's fields. Each carries `PB_RESPONSIVE_METADATA` and is in its `responsiveFields`.
  - **Kept in the field, with the compact switch: `ResponsiveImage.ratio`** — a sub-key of an image object (`image` of BackgroundPanel, CtaCard, FeatureList, Stats, Testimonial (+`avatar`), CarouselImage, LinkTile, DownloadTile `hoverImage`, Statement `background.image`, Hero `socialProof.image`), often inside an array item or another object. Puck gives a field one tab, and the image's other keys (source, asset, alt, fit, position) are not responsive, so the ratio cannot move to the Responsive tab without splitting the `ResponsiveImage` shape (data-model §3.3); `ResponsiveTiers` stays for it only (its doc says so).
  - **Kept as is, recorded: `ButtonSpec.style` / `fill`** of `cms.Button`'s `button` object, Hero's `buttons` items and the admin `createButtonListField({ responsive: true })` lists (MediaText, BackgroundPanel, CtaCard). They are Puck selects with `PB_RESPONSIVE_METADATA` nested in an object/array field, so they already use the standard `ResponsiveSelectControl` and the component's scope — no in-field switch — but they show on the General tab with their parent, where the scope switcher is not visible (it is chosen on the Responsive tab). Pre-existing pattern (origin's `cms.Button`); not changed here.
  - No other custom field holds a responsive value (MediaText's `media` composes the image field above).

### R4. Defects from the local rebuild

A rebuild of a reference page on the local instance (comparison material under `local/`, never
committed) found these defects in the new blocks.

- [X] T119 [US2] (B1) Rich bodies stored only as TipTap JSON render on the server, with the
  same HTML on server and client, no DOM and no new dependency.
  **Result (2026-10-23):** cause: `htmlFromTiptap` called `@tiptap/core` `generateHTML`, whose `getHTMLFromFragment` reads `document`; in Node it threw and the catch returned `''`, so every `RichBody` (Hero, MediaText body/footnote, FeatureList items, Statement, CtaCard, BackgroundPanel, CarouselSplit, Testimonial quote, NewsletterSignup text) and `cms.RichContent` without `html` (also inside Tabs/Accordion panels) was missing from the server HTML and hydrated with a mismatch. **RED:** new `cms-components/src/components/rich-body-ssr.test.tsx` (node env, no jsdom, `renderToString` through Puck's `<Render>`) 13/15 red — `htmlFromTiptap(doc('Hello'))` gave `''` and each of the 12 blocks' sentences was absent (`expected '<div>…' to contain 'Media body sentence.'`). **Fix:** `components/tiptap-html.ts` `tiptapJsonToHtml(content, extensions)` — `getSchema(extensions)` (cached per extension list) + `schema.nodeFromJSON`, then a port of ProseMirror's `DOMSerializer.serializeFragment`/`renderSpec` that builds a string tree from the same `toDOM` specs (so every extension's `renderHTML` and global attribute — emphasis, readMore/summary, check list, button-link variant, heading anchor/srOnly, image, textAlign, colour, highlight — is honoured; adjacent text with equal marks shares one mark element; void elements; `innerHTML` escaping). `htmlFromTiptap` = `sanitizeRichHtml(tiptapJsonToHtml(…))`, the same sanitiser; unknown node types still render `''`. No `@tiptap/pm` import (not a declared dependency), no new dependency. **Parity:** `rich-content-extensions.test.ts` (jsdom) +1: a document with every node and mark the schema allows equals `sanitizeRichHtml(generateHTML(…))` — the one difference is colour notation (jsdom's/the browser's `style.cssText` rewrites `#958DF1` as `rgb(149, 141, 241)`; the string keeps the stored hex), normalised in the comparison. Then 15/15 and 6/6. **Changed existing assertion:** `rich-content-shared.test.ts` "returns empty string when DOM serialization is unavailable" (`typeof html === 'string'`) → "serializes without a DOM" (`'<p>Hi</p>'`), +1 (unknown node type renders `''`); the extensions test's header comment no longer says node env renders nothing. Changeset `163-cms-tabs-accordion-panels-and-rich-text.md` (paragraph "Rich text renders on the server").
- [X] T120 [US2] (B2) `cms.RichContent` reads the section's colour scheme.
  **Result (2026-10-23):** `RICH_CONTENT_PROSE_CLASS` loses its colour, size and line-height utilities and gains `cmsc-pb-rich-content`; the stylesheet's `.cmsc-pb-rich-content` reads `color: var(--cmsb-fg, #243447)`, `font-size: var(--cmsb-t-body-size, 16px)`, `line-height: var(--cmsb-t-body-lh, 1.65)`, h1–h4 `var(--cmsb-fg, #15202b)`, h1–h6 `font-family: var(--cmsb-font-heading, inherit)`, links `var(--cmsb-link, #2563eb)` (not on `.cmsc-btn` button links, which keep their button colours), blockquote `var(--cmsb-border, #d9e0e7)` / `var(--cmsb-fg-muted, #475569)` — today's literals as fallbacks (standing rule 9). Inside an explicitly `light` Section the scheme's own values apply (body `#15202b`, link `#1261a6`), as for every scheme-aware block. Same `a:not(.cmsc-btn)` guard added to the existing `.cmsc-pb-rich a`. **Tests** (`brand/fallback-parity.test.tsx`, built CSS, new describe "scheme, fonts and overflow of the new blocks"): no-token parity (body `#243447`, 16 px, 1.65, h2 `#15202b`, link `#2563eb`, quote `#475569`); in a dark Section text and heading `#f8fafc`, link `#93c5fd`, quote `#cbd5e1`; with `--cmsb-t-body-size`/`--cmsb-font-heading` set, 18 px and the heading font. RED 3/3 — the no-token case too, because jsdom does not match Tailwind's escaped `[&_h2]` descendant selectors (heading read `rgb(36, 52, 71)`), a harness limit rather than a regression; the CSS-class rules make it measurable.
- [X] T121 [US2] (B3) Images in rich bodies fit their column.
  **Result (2026-10-23):** `.cmsc-pb-rich img, .cmsc-pb-hero__body img, .cmsc-pb-feature-list__body img { max-width: 100%; height: auto }` (the Hero and FeatureList bodies do not carry `cmsc-pb-rich`). Test (same describe): an image in the body of MediaText, FeatureList, Statement, CtaCard, BackgroundPanel, Hero, Testimonial, CarouselSplit computes `max-width: 100%`, `height: auto` — RED 8/8, then green. On the running instance (`local/reference-pages/diag.mjs 375`) `scrollWidth` is 375 and no element but off-screen carousel slides (inside their clipped tracks) passes the viewport.
- [X] T122 [US2] (B4) Body text in the brand body font, headings in the heading font.
  **Result (2026-10-23):** audit: headings of the new blocks already use the heading font (`.cmsc-pb-block-heading`, the `--token` classes, LinkTile, post card); body text and the untokened FeatureList title / legacy hero heading inherited the page font. One zero-specificity rule gives the roots of Hero, MediaText, FeatureList, BackgroundPanel, CtaCard, Statement, Stats, Testimonial, CarouselSplit, CarouselImage, Tabs, Accordion, LinkList, LinkTile, DownloadTile and the sign-up `font-family: var(--cmsb-font-body, inherit)`; headings inside a rich body and `.cmsc-pb-feature-list__title`, `.cmsc-pb-hero__heading` `var(--cmsb-font-heading, inherit)`. With no tokens both resolve to `inherit` — the page's font, as on `origin/master`. Tests (same describe): per block, no tokens → no family set (`inherit`); with `--cmsb-font-body`/`--cmsb-font-heading` → the body's and an `h4` inside it's family; FeatureList title. RED 17/17 (`'depends on user agent'`), then green.
- [X] T123 [US2] (B5) `cms.Tabs`' tab list stays inside the page at 375 px.
  **Result (2026-10-23):** pre-existing on `origin/master` (same `.cmsc-pb-tabs__list` rule), fixed here as asked: the list `flex-wrap: wrap` (wrap rather than scroll: no hidden tab, no clipped underline indicator, desktop unchanged when the tabs fit), each tab `min-width: 0; overflow-wrap: anywhere`. Markup, roles, roving tabindex and arrow keys unchanged (`Tabs.test.tsx` green). Test (same describe) RED (`flex-wrap` not `wrap`), then green.
- [X] T124 [US1] (gap a1) A full-width background with contained content, without the viewport's height.
  **Result (2026-10-23):** **extend, don't narrow** — every `width` keeps its meaning; new optional `contentWidth: 'contained' | 'wide' | 'full' | 'custom'` (contracts `SECTION_CONTENT_WIDTHS`/`sectionContentWidthSchema` in `sectionSettingsSchema`; core `SECTION_CONTENT_WIDTH_OPTIONS`, `SECTION_WIDTHS_WITH_CONTENT_WIDTH`, type `SectionContentWidth`). It applies to `full`, `viewport`, `bleed` (backgrounds wider than the page container): `SectionFrame` writes `data-content-width` and, for `custom`, the `--cmsc-section-max*` vars; unset or with another width, nothing changes. CSS: `[data-content-width=contained|wide|full|custom] > .cmsc-section__frame` (container + gutters / wide + gutters / edges / custom + gutters, per breakpoint for custom); `min-height: 100svh` stays on `viewport` only. Editor: a `contentWidth` select (General tab, after Width) shown by `resolveFields` only with those three widths; `customMaxWidthPx` also with `contentWidth: 'custom'` (fields filtered in place, order kept); `viewport`'s option label now says "Full viewport height, content in the container" (en/pl). cms bundle: `blocks.section.fields.contentWidth.{label,options.*}` en+pl. **RED:** `SectionBlock.test.tsx` +3 (field offered only with full/viewport/bleed and `customMaxWidthPx` with a custom content width; `data-content-width` written only where it applies, custom max width vars; stylesheet rules and no `min-height` on `bleed`/`full`) RED 3/3 (`expected undefined to be 'select'` …); contracts `page-builder-props.test.ts` +1 RED (`expected undefined to be 'contained'`); then green. Docs: `cms/index.md` Section table + "Content width" row (+ Polish, cache rewritten with `hashSourceBody()`, `check:docs-translations` findings=0); `contracts/blocks.md` prop table, `data-model.md` §3.4; changeset `163-page-builder-section-settings-and-anchors.md`. Height as a separate responsive `minHeight`: not added (YAGNI; `viewport` remains the full-height choice).
- [X] T125 [US1] (B8) `cms.Row` column span given as a plain number stays that span on mobile.
  **Result (2026-10-23):** **pre-existing on `origin/master` (b816c1d55), recorded, not fixed here.** `Row.tsx` and `page-builder-core/src/types/box-styles.ts` (`buildResponsiveSpanVars`: a plain number is the base, inherited by tablet and desktop) are identical to `origin/master`, and so is `.cmsc-pb-row-col { grid-column: span var(--pb-col-span, 12) }`; `Column.tsx` differs only by the `cms.Section` slot refusal. Candidate follow-up outside 163: default the mobile span to 12 when a stored plain span is below 12 (a behaviour change for stored pages, so it needs its own decision).

**R4 verification (2026-10-23):** cms-components whole package 53 files / 607 green (fresh `dist/cms-components.css`, kept); contracts `page-builder-props.test.ts` 29; page-builder-core 27 files / 179; storefront `test/ssr/blocks.test.tsx` + `block-ssr-floor.test.tsx` 19 and the other six `test/ssr` files 47; admin section/i18n/sidebar files 7 / 71; backend `_i18n` bundle tests 79; `check:block-names` findings=0, `check:class-vocabulary` findings=0, `i18n:hardcoded` regressions=0 drained=0, `check:docs-translations` findings=0; typecheck + lint of contracts, page-builder-core, cms-components, mod-cms clean, typecheck of admin, storefront, page-builder-admin clean; `pnpm run build:packages` exit 0. Running instance: the rebuilt page's MediaText rich body sentence is in `curl` HTML; browser diagnostics at 375 and 1440 px: no hydration warning, `scrollWidth` equal to the viewport (a first run right after the rebuild logged one carousel `data-pb-carousel-uid` attribute mismatch that did not recur).

### R5. Gaps found by the local rebuild (owner request 2026-10-23)

Every item extends an existing block where one covers the concept (FR-041a, plan § *Extend, don't
narrow*): today's options and default look stay; tests first; en+pl labels; translatable texts
declared; content in the server HTML; responsive top-level values in the Responsive tab; docs
(EN+PL+cache) and changesets follow. Generic names and copy only.

- [X] T126 [US2] `cms.Video` plays a self-hosted file: source `embed` (today) or `file` (asset,
  optional mobile asset, poster asset), aspect ratio per breakpoint, autoplay/muted/loop/controls,
  breakpoint pair + reduced-motion rules of R-9; the hero and MediaText video frames accept a
  ratio instead of a fixed 16:9.
  **Result (2026-10-23):** **RED first:** new `cms-components/src/components/Video.test.tsx` (15) RED 11/15 (`expected undefined to be 'embed'` for the default `source`, `paddingTop` `''` for `67:20` — `aspectPadding` knew three ratios —, no `.cmsc-pb-video__frame`, no `<video>`, no `source` field, `aspectRatio` not responsive, stylesheet rules missing); the 4 green from the start are regression guards (origin embed markup, nothing-chosen renders nothing, reduced motion and non-autoplay never play). New `video-frame-ratio.test.tsx` (4) RED 3/4 (Hero and MediaText frames wrote no `--pb-ratio*`, stylesheet 16:9 literal); new core `fields/aspect-ratio-field.test.tsx` (6) RED (module missing). **Extend, don't narrow:** every `origin/master` field kept (option-parity case "cms.Video, extended with a self-hosted file": each origin field offered as itself for an embed, select values a superset, today's `16:9`/`4:3`/`1:1` among `ASPECT_TOKENS` — green from the start, a guard: the extension renames nothing); a stored video without `source` is an embed and keeps today's padded `<div style="padding-top:56.25%">` (fallback-parity +1). **Implementation:** `Video.tsx` — `source: 'embed' | 'file'` (default `embed`), `videoAssetId`, `mobileVideoAssetId`, `posterAssetId` (`resolveFields`: provider for an embed, the three asset fields for a file); `aspectRatio` is the new core `createAspectRatioField` (responsive metadata, Responsive tab, every aspect token without `auto` plus Custom `w:h`; `responsiveFields` + `aspectRatio` in the registry and the cms manifest). Embed: one ratio at every breakpoint keeps today's padded frame (`ratioPadding`), a ratio per breakpoint writes `--pb-ratio*` on `.cmsc-pb-video__frame`. File: `.cmsc-pb-video__frame--file` reserving the ratio, a `data-bp` pair (or `all`) with `preload="none"`, `playsinline`, the poster, `aria-label` = title, never `autoplay`; with `autoplay` muted + `data-autoplay`, started by `useBreakpointVideo(ref, 'video[data-bp][data-autoplay]')` (on screen, never under reduced motion); otherwise `controls` (today's default on); a direct file URL in `url` when no library video is chosen; nothing chosen renders no player for customers (an empty reserved frame in the editor). New `utils/aspect-ratio.ts` (`ratioToCss`, `ratioPadding`, `ratioVars`, `sanitizeRatio`, `uniformRatio`; `Picture` now imports `ratioVars` from it). **Hero / MediaText:** `media.ratio?: Responsive<AspectToken>` on a video; the hero writes it on `.cmsc-pb-hero__media--above[data-kind=video]`, MediaText on `.cmsc-pb-media-text__video`; CSS `aspect-ratio: var(--pb-ratio, 16 / 9)` plus md/lg tiers (unset = today's 16:9). Admin: `page-builder-admin` exports `ResponsiveRatioControl` (the image field's in-field ratio switch, extracted; `defaultRatio`, `allowAuto`), used by `HeroFields` and `SectionBlockFields` for the video ratio (nested value, T118 policy); `PageBuilderEditor` gives `cms.Video` library pickers for its three asset fields. Admin test `video-image-fields.test.tsx` (4, StrictMode) — written after the implementation, not seen RED. **i18n:** cms `blocks.video.fields.*` (36 keys: every field and option, en+pl) and `blocks.{hero,mediaText}.fields.media.fields.ratio.label`; description updated; core field text `ratio.auto`, `ratio.custom`, `ratio.customValue` (+ `_i18n` en/pl). `page-builder-field-i18n.test.ts` lists `cms.Video` (RED on the missing keys, then green). **Block declarations:** `title` stays the only prose; `block-declarations.test.ts` fixture gains `source`, the three asset ids and `aspectRatio` as non-prose (green with the change; not run before it).
- [X] T127 [US3] `cms.Image` gains art direction (mobile image), ratio per breakpoint, an overlay
  (solid/gradient, direction, strength), full-width option, and an optional caption laid out
  below or beside the image (covers a standalone "image + caption" such as a social-proof line).
  **Result (2026-10-23):** **RED first:** new `cms-components/src/components/Image.test.tsx` (16) RED 14/16 (no `loading="lazy"`, no `<picture>`/`<source>`, no `.cmsc-pb-image__frame`, overlay, `<figure>`, fields and stylesheet rules); the 2 green from the start are guards (defaults unchanged, `auto` ratio adds no frame). **Extend, don't narrow:** option-parity case "cms.Image, extended…" (every origin field offered as itself for either source, select values a superset — a guard, green from the start); fallback-parity +1 (one inline-block `<img>`, `width: auto`, `max-width: 100%`, `object-fit: cover`, opacity 1, no wrapper). **Implementation:** `Image.tsx` — `mobileSrc` / `mobileAssetId` (the chosen source's one shown; Data tab), `ratio` (`createAspectRatioField`, `auto` default, Responsive tab, in `responsiveFields`), `overlay` (`SectionOverlay`, object field kind/direction/strength, the Section's black via the now exported `overlayStyle`), `caption` (textarea) and `captionPlacement` (`below`/`beside`, shown once there is a caption). Each option adds only its own wrapper: `<picture class="cmsc-pb-image__picture">` (`display: contents`) with a `(max-width: 767.98px)` source; `.cmsc-pb-image__frame` (`--ratio` reserves the space per breakpoint, the image covers it; holds the `aria-hidden` overlay); `<figure class="cmsc-pb-image__figure" data-caption>` + `<figcaption>` (muted small text; `beside` is an inline-flex row for an "avatar group + sentence" line). The width goes on the outermost wrapper in the flow (figure below, else frame, else img); a link wraps the image, never the caption. The `<img>` is now `loading="lazy" decoding="async"` (the one deliberate markup change of the default render). **Full width:** the existing `widthMode: 'full'`; edge to edge is a Section with the Bleed width (documented, no new prop). Space is reserved only with a ratio: the asset map carries no dimensions. Admin: `PageBuilderEditor` swaps `mobileSrc`/`mobileAssetId` for the URL box and the library picker, as for `src`/`assetId`. **i18n:** cms `blocks.image.fields.*` (52 keys, en+pl), description updated; `page-builder-field-i18n.test.ts` lists `cms.Image` (RED, then green). **Translatable:** manifest `[{ path: 'alt' }, { path: 'caption' }]`; `block-declarations.test.ts` fixture expects `alt` and `caption` as prose and the mobile image, ratio, overlay and placement not.
- [X] T128 [US5] Rich-text images: size (width in px or %), alignment (left/center/right) and an
  inline mode that sits in the text line; sanitizer keeps only the needed attributes/classes.
  **Result (2026-10-23):** **RED first:** new `cms-components/src/components/rich-image.test.tsx` (12) RED 11/12 (no class/style written, no `inlineImage` node, the width style dropped by the sanitiser, no `ImageDialog` export/controls, no stylesheet rules); the stored-image case is a guard (green from the start). Two expectations of my own were corrected after the first run, not the code: the sanitiser writes an empty `alt` as a bare `alt` (pre-existing canonical form). **Implementation** (`rich-content-shared.ts`): `richImageNode` = TipTap `Image.extend` + `align` (`left`/`center`/`right` → `class="cmsc-rich-img cmsc-rich-img--<align>"`) and `size` (`RICH_IMAGE_SIZE_RE`, whole px up to 4 digits or 1–100 % → `style="width: …"`), parsed back from that markup; `inlineImageNode` (`inlineImage`, inline, `src`/`alt`/`title`/`size`, `img.cmsc-rich-img--inline` with parse priority 60) — a node of its own because a ProseMirror node is inline or block, and making `image` inline would invalidate every stored top-level image. An image stored before renders byte-identical. Both serialise identically through the DOM-free `tiptapJsonToHtml` and TipTap's `generateHTML` (test). **Sanitiser:** `HtmlSanitizePolicy.cleanStyle(style, tag?)` (optional second argument, other policies unchanged); the rich policy keeps `width` matching `RICH_IMAGE_SIZE_RE` on `<img>` only (on `<p>` dropped, `50vw`, `height`, `position` dropped); classes stay as before (global `class`, no narrowing). **Editor:** `ImageDialog` (exported, `RichImageChoice`) gains Width + unit (px/%), Alignment (Default/Left/Center/Right, disabled for inline) and "In the line of text"; the toolbar button edits a selected image of either kind (prefilled; replacing it may switch block ↔ inline). Toolbar copy stays English like the rest of that toolbar (pre-existing; `i18n:hardcoded` regressions=0). **CSS:** `.cmsc-rich-img` (max-width 100 %, height auto), `--left/--center/--right` (block, auto margins), `--inline` (inline-block, middle). **Not done:** rich-text image `alt` is not a translatable text of the codec (pre-existing for every rich image; out of scope).
  **R5 T126–T128 verification (2026-10-23):** cms-components whole package 61 files / 763 green (fresh `dist/cms-components.css`, kept); page-builder-core 28 / 185; mod-cms `block-declarations.test.ts` 49; admin `video-image-fields`, `page-builder-field-i18n`, `hero-fields`, `section-block-fields`, `button-image-fields`, `sidebar-field-layout`, `section-asset-input` 7 / 73; storefront `test/ssr/blocks.test.tsx` + `block-ssr-floor.test.tsx` 19; mod-i18n 6; backend `test/unit/_i18n` 11 / 191; `check:block-names` findings=0, `check:class-vocabulary` findings=0, `i18n:hardcoded` regressions=0 drained=0, `check:docs-translations` findings=0, `check:release-intent` violations=0; typecheck + lint clean for page-builder-core, cms-components, mod-cms; page-builder-admin lint clean but for the pre-existing `CatalogPickers.tsx:479` warning; admin and storefront typecheck clean; `pnpm run build:packages` exit 0. Docs: `cms/index.md` (Image, Video rows split from the "Unchanged" rows; RichContent, Hero, MediaText rows), `extending-page-builder.md` (`createAspectRatioField`, `ResponsiveRatioControl`), Polish pages mirrored, both cache entries rewritten with `hashSourceBody()`. `contracts/blocks.md` (`cms.Video`, `cms.Image`, rich-text images; hero and MediaText `media.ratio`), `data-model.md` §4. Changeset `163-page-builder-video-image-rich-images.md`.
- [X] T129 [US4] Carousel controls: arrow placement per breakpoint, arrow style
  (outline/solid/round, size), and a caption scrim for overlay captions on carousel images.
  **Result (2026-10-23):** **RED first:** `carousel/CarouselShell.test.tsx` +7 (RED on no `--off-*` classes, the header group still rendered in a mobile editor preview, no `--arrows-*` classes, no grid), `ContentSlider.test.tsx` +6, `CarouselImage.test.tsx` +5, `option-parity.test.ts` +6 ("R5 carousel controls, grid and filter; the tab bar", RED on `controlsPlacement`/`controls.arrow*`/`layout`/`filter`/`tags`/`tabStyle` missing); all green after. **Placement:** new top-level `controlsPlacement` (`Responsive<'below'|'header'|'overlay'>`, `PB_RESPONSIVE_METADATA`, in `responsiveFields` of the Carousel, `catalog.ProductSlider` and `blog.LatestPosts` — `cms-components` index and the cms/catalog/blog manifests) in the shared `CAROUSEL_TRACK_FIELDS`; the `controls.placement` sub-field is gone (one control per concept), every value kept. A placement stored inside `controls` wins at render (the editor canvas merges `defaultProps`, measured in Puck 0.23's DropZone) and is moved by `resolveData` (`carouselPlacementMoved`, ContentSlider/ProductSlider/LatestPosts); `contentSliderFromLegacy` also writes `controlsPlacement`. `CarouselShell` renders each placement used once and the stylesheet removes it where it does not apply (`__controls--off-sm|md|lg`, `display:none !important` per media range); one placement for every tier renders exactly the old markup; the editor shows only the previewed tier's placement. **Arrow look:** `controls.arrowVariant` (`default`=today, `outline`, `solid`), `arrowShape` (`round`, `square`), `arrowSize` (`s` 32 / `m` 36 = today / `l` 44 px), `arrowColor` (`createColorField`, strict `colorValueToCss`) → root classes `cmsc-pb-carousel--arrows-*` and `--pb-arrow-color`; nothing added for today's values. **Scrim:** `cms.CarouselImage.captionScrim {kind: none|gradient|solid, strength 0–90, default {none, 60}}`, only for an overlay caption: an `aria-hidden` layer (gradient from the caption's top/bottom edge, centre → even tint, `--pb-scrim`), the caption drops its own box (`__caption--on-scrim`) unless it has a background. **Changed existing assertions (standing rule 13):** `ContentSlider.test.tsx` default `controls` → `{arrows: true, dots: false}` + `controlsPlacement: 'below'`; `option-parity.test.ts` ProductSlider additions `'controls.placement'` → `'controlsPlacement'` and its defaults `controls: {arrows, dots}` + `controlsPlacement: 'overlay'` (same values, new place). Defaults moved likewise in `ProductSlider.tsx`/`LatestPosts.tsx`. `block-declarations.test.ts` Carousel fixture carries `controlsPlacement` and the arrow look as non-prose.
- [X] T130 [US4] Carousel layout `carousel | grid` (columns per breakpoint) for every item kind;
  `cms.LinkTile` ratio per breakpoint.
  **Result (2026-10-23):** RED with T129's files plus `LinkTile.test.tsx` +3 (no `metadata` on `ratio`, placeholder inline `aspect-ratio`). `cms.ContentSlider` gains `layout` (`carousel` default, `grid`) and `columns` (1–6, responsive, default `{1,2,3}`); `resolveFields` hides the carousel-only options (`slidesPerView`, `effect`, `controls`, `controlsPlacement`, `bleed`, `autoplay`, `intervalMs`) for a grid and `columns` for a carousel. `CarouselShell` `layout="grid"`: no region/carousel role, the slide list a `role="list"` of `listitem`s, `--pb-cols(-md|-lg)` + gap (previewed tier only in the editor, no page-hiding `<style>`), no arrows/dots/autoplay; stylesheet grid `repeat(var(--cmsc-cols), minmax(0, 1fr))` for the published list and the editor dropzone. Every item kind (four items, `cms.Slide`) renders in it (test). Editor: `ContentSliderActionBarExtras` drops the page navigation for a grid (**not covered by a test**: the action bar is not mounted in jsdom anywhere). `cms.LinkTile.ratio` is a responsive select (Responsive tab, `responsiveFields: ['ratio']` in index and manifest), each tier validated (unknown → 4:3); the image passes it to `Picture`, the empty placeholder uses `cmsc-picture--ratio` with the same `--pb-ratio*` vars. `LinkTile.test.tsx` "frames the image at the tile's ratio" unchanged and green.
- [X] T131 [US4] Optional category filter: carousel items carry tags; the Carousel can show a
  filter bar (all + tags, editable labels) that filters items client-side with the full set in the
  server HTML; keyboard and ARIA.
  **Result (2026-10-23):** **RED first:** new `carousel/carousel-filter.test.tsx` (7, RED on the missing module), `ContentSlider.test.tsx` filter case, tag cases in `CarouselImage`/`LinkTile`/`CarouselSplit`/`DownloadTile.test.tsx`, `storefront/test/ssr/carousel-labels.test.tsx` +1 (RED on no `aria-label="Filtruj"`). New `carousel/carousel-filter.tsx`: `ITEM_TAGS_FIELD`, `parseItemTags` (comma-separated, trimmed, lower-cased, unique), `itemTagsAttribute` (`data-pb-tags`), `carouselFilterFromProps`, `filterButtons`, `itemHasTag`, `CarouselFilterBar` (`role="toolbar"` named "Filter", toggle buttons with `aria-pressed`, one tab stop, Left/Right wrapping, Home/End; a press filters, moving the focus does not). `tags` on `cms.CarouselImage` (figure), `CarouselSplit` (root), `LinkTile` (tile), `DownloadTile` (the `<a>`) and `cms.Slide` (via the new `BoxStyled` `attributes` prop). The Carousel's `filter {show, allLabel, tags[{tag, label}]}` (default `{false, '', []}`; an empty "All" label reads the page language's word; a blank tag label shows the tag). `CarouselShell` `filter` prop, carousel and grid: the server renders the bar with "All" pressed and **every item, none hidden**; on a press the client reads each item's tags from the DOM, sets `hidden` on the others (React-owned, via the slides context), renumbers the rest "n of m", resets to the first page, re-measures, and a `role="status"` `aria-live="polite"` `.cmsc-sr-only` line announces "{n} of {m} shown"; filtering is off in the editor canvas. `.cmsc-pb-carousel__slide[hidden] { display:none !important }` (beats equal height's `display:flex`). Bar CSS wraps (no horizontal scroll at 375 px), 36 px buttons, pressed one filled with the scheme's text colour, focus ring. Words: `CmsCarouselLabelText` + `filter`, `filterAll`, `filterCount`; storefront `cms.carousel.filter|filterAll|filterCount` (en "Filter"/"All"/"{n} of {m} shown", pl "Filtruj"/"Wszystkie"/"Pokazano {n} z {m}") through `cmsCarouselLabels`. Manifest `translatable` + `filter.allLabel`, `filter.tags[].label` (tags are keys); `block-declarations.test.ts` Carousel fixture expects both labels, item fixtures carry `tags` as non-prose (not seen RED: the manifest was edited first).
- [X] T132 [US5] Tabs pill-bar styling: bar border/background, active and inactive colours as
  tokens or hex, size; mobile wrapping from T123 kept.
  **Result (2026-10-23):** **RED first:** `Tabs.test.tsx` +4 (RED on no `tabStyle` field, no classes/vars). `cms.Tabs.tabStyle {size: s|m|l, barBackground, barBorderColor, activeBackground, activeColor, inactiveBackground, inactiveColor}` (an object field after Align; colours `createColorField`, written only when a hex or known token: `colorValueToCss`) → `--cmsc-tabs-bar-bg|bar-border|active-bg|active-fg|bg|fg` on `.cmsc-pb-tabs`, `cmsc-pb-tabs--size-s|l` and `cmsc-pb-tabs--bar` once the bar has a background or border; nothing set → today's classes and no `style`. Stylesheet: the existing tab rules read those properties with today's literals as fallbacks (list background transparent and bottom border `#e2e8f0`, tab `#64748b`, underline active `#0f172a`, pills active `#0f172a`/white, boxed active `#f1f5f9`); sizes 13/14/16 px; a bar is padded, and around pills a `fit-content` capsule (`max-width: 100%`, 24/28 px radius, centred/stretched with the align option) that still wraps (T123's `flex-wrap` untouched). Variant, effect and align options unchanged (option-parity R5 case). `block-declarations.test.ts` Tabs fixture carries `tabStyle` as non-prose.
  **R5 (T129–T132) verification:** cms-components whole package 61 files / 763 (incl. `brand/fallback-parity.test.tsx` +8 "carousel controls, grid, filter and scrim; the tab bar": default arrows 36 px white/#334155/round, outline/l/square and solid colour, the `--off-*` media rules, grid and hidden items, filter bar, scrim and caption, tabs' default colours and the styled capsule — written after the stylesheet, not seen RED; jsdom does not expand a `var()` inside `background`/`border` shorthands or parse `#0000`, so those are read from the shorthand or the built rule); page-builder-core editor guards (`puck-action-guards*`, `editor-carousel-preview`) 12; mod-cms 27 files / 301; backend unit `blog/block-declarations`, `cms/hidden-drawer`, `cms/frozen-block-renames-codomain` 17; admin `test/modules/cms` + `sidebar-field-layout` 26 files / 226 (field labels: `page-builder-field-i18n` 34, en+pl keys added to the cms, catalog and blog bundles, the `controls.fields.placement` keys replaced); storefront `test/ssr` 8 files / 67 incl. `blocks.test.tsx`, `block-ssr-floor.test.tsx`, `carousel-labels.test.tsx`; `check:block-names` findings=0, `check:class-vocabulary` findings=0, `i18n:hardcoded` regressions=0, `check:docs-translations` findings=0, `check:release-intent` violations=0; typecheck clean for mod-cms, mod-catalog, mod-blog, storefront, admin, and cms-components except other tasks' test files (`Image.test.tsx`, `Video.test.tsx`, `rich-image.test.tsx`); lint clean except `rich-content-shared.ts:252` (naming, not R5's). `dist/cms-components.css` rebuilt and kept; cms-components JS emitted with `--noEmitOnError false` because of those other files. Docs: `cms/index.md` block table + new "Carousels: controls, grid and filter" section (Polish mirrored, cache rewritten with `hashSourceBody()`); `contracts/blocks.md` (Carousel props, items, Tabs), `data-model.md` §4; changeset `163-cms-carousel-controls-grid-filter-and-tab-bar.md`. Not done: a browser check at 375 px on the running instance (no page with these options exists locally, and the `b2b` database is not written by this task).
- [X] T133 [US2] Hero: editor-chosen order of eyebrow/title/subheading/statement/body/buttons/
  social proof; media width option so media can extend beyond the content frame inside a Section.
  **Result (2026-10-23):** **RED first:** `Hero.test.tsx` +7 (new describe "element order and media width") RED 5/7 — the chosen order ignored (`expected [ 'eyebrow', 'title', … ] to deeply equal [ 'buttons', 'title', 'body', … ]`), no `order`/`mediaWidth` fields (`expected undefined to be 'array'`), no edge-to-edge class or rules, no 20 px rule; the two default-order cases green from the start (fallback parity). `option-parity.test.ts` new describe "R5 extensions keep every option" (branch field sets before R5 as literals, top level and nested, plus the additions; additions absent from `defaultProps`) RED for Hero, Accordion, Text, Statement, RichContent, ProductGrid, ProductSlider (`additions (top): expected [ … ] to deeply equal ArrayContaining ["order", "mediaWidth"]`). **Implementation:** `order?: Array<{element: HeroElement}>` (array of one select, max 7) — `heroElementOrder` puts the listed elements first, each once, then the rest in today's order (unknown/repeated ignored, so nothing is ever hidden); unset is today's order. **Not per breakpoint (decision):** the DOM order is the reading and focus order (WCAG 1.3.2/2.4.3), so a CSS `order` per tier was rejected. `mediaWidth?: 'content' | 'viewport'` beside the placement: `viewport` (only with image/video media) adds `cmsc-pb-hero--media-viewport` — the hero stops clipping, media above becomes a `100vw` band (`margin-left/right: calc(50% - 50vw)`, as Section `bleed`), media behind and its overlay span `left/right: calc(50% - 50vw)`; no breakout under `[data-puck-entry]`; assumes the hero is centred in the page, as Section `bleed` does. CSS: buttons/social proof placed before another element keep 20 px below (`:not(.cmsc-pb-hero__stack) > :is(actions, proof):not(:last-child)`; margins collapse, so today's order is unchanged), a social proof placed first sits flush. Labels en+pl (`blocks.hero.fields.{mediaWidth,order}.*`, `order.fields.element.options.*`). **Addition:** `page-builder-i18n.ts` summarises an item of a one-select list by that option's translated label (`page-builder-i18n.test.ts` +1, RED `expected 'Buttons' to be 'Przyciski'`, then green); the Hero's own `getItemSummary` answers in English otherwise. `fallback-parity.test.tsx` new describe (R5): default hero spacing 12/20 px, nothing under the last button row, no media class; buttons placed first keep 20 px.
- [X] T134 [US3] Typography: Accordion titles choose a heading level and size; `cms.Text`,
  `cms.Statement` and `cms.RichContent` gain a max text width (token or px).
  **Result (2026-10-23):** **RED first:** `Accordion.test.tsx` +4 RED 3/4 (no `h2.cmsc-pb-accordion__heading`, no `cmsc-t--h4`, `Cannot read properties of undefined (reading 'options')`; the "unset is today's" case green); new `components/text-max-width.test.tsx` (14) RED 11/14 (no `cmsc-text-max`, no fields, no rules; the three unset cases green); the R5 parity cases above. **Accordion:** `titleLevel` (`none` default, `h2`–`h6`; **no `h1`** — the page's one H1 stays the title's) wraps each trigger button in that heading (WAI-ARIA accordion pattern; `.cmsc-pb-accordion__heading { margin: 0; font: inherit }` so it adds no look); `titleSize` (`sizeFieldWithDefault`, responsive) + `titleSizePx` (shown by a new `resolveFields` only with Custom), via `sizedTextProps` (a tier left on `default` among chosen ones reads `body`); a sized title takes `var(--cmsb-font-heading, inherit)`. Unset: bare button, title span with no class or style added. **Measure:** new `components/text-max-width.ts` — `textMaxWidth: Responsive<'none'|'narrow'|'medium'|'wide'|'custom'>` (36/48/60 rem; no brand token exists for a measure, so the names are this package's) + `textMaxWidthPx` (Custom, 160–2000), both on the Responsive tab; published as `cmsc-text-max` + `--cmsc-text-max(-md|-lg)`, editor canvas as the tier's inline `max-width`; nothing written when unset. `cms.Text` (on the `<p>`; the measure follows `data-align(-md|-lg)` centre/right), `cms.Statement` (heading and body; centred with `align: center`), `cms.RichContent` (prose wrapper; gains `resolveFields`). `BlockHeading`/`RichBody` (`section-parts.tsx`) accept an extra `style`. Types `TextMaxWidth`/`TextMaxWidthProps` in `component-types.ts`. `responsiveFields` in `index.ts` and the cms manifest (Text, RichContent, Statement, Accordion `titleSize(Px)`). Labels en+pl (`blocks.{text,richContent,statement}.fields.textMaxWidth*`, `blocks.accordion.fields.titleLevel/titleSize/titleSizePx.*`). **Changed existing assertion (standing rule 13):** `admin/test/modules/cms/page-builder-field-i18n.test.ts` "an unchanged block keeps its English labels" now reads `cms.Spacer` instead of `cms.Text` (Text's new fields are translated). `fallback-parity.test.tsx`: accordion triggers 15 px/600 with no heading, a heading adds no margin, `titleSize: 'h4'` → 26 px; Text/Statement/RichContent unset → no `max-width`; a centred Text with `medium` → `48rem`, margins `auto`. Nothing translatable added (translation contract not re-run: no path changed).
- [X] T135 [US6] Product cards choose the text line shown (summary, SKU, none).
  **Result (2026-10-23):** **RED first:** `CmsProductCard.test.ts` +4 RED 3/4 (summary/SKU/none ignored; the `default` case green — today's lines) and new `components/catalog/product-listing-parts.test.tsx` (6, renders both listings through `<Render>` with `CatalogPreviewProvider` data) RED 4/6 (no `cardTextLine` field, the line not handed on); R5 parity cases above. **Implementation:** `ProductCardTextLine = 'default' | 'summary' | 'sku' | 'none'`; `CmsProductCardView` `textLine` — `default` keeps each style's own line (SKU on default/compact/horizontal, still under `showSku`; summary on `showcase`), `summary` puts the summary under the name on every style, `sku` the SKU (above the name, as today) on every style, `none` neither. `catalog.ProductGrid` / `catalog.ProductSlider` gain `cardTextLine` right after `cardVariant` (`PRODUCT_LISTING_CARD_FIELDS`), unset by default, handed to each card through `listingCardTextLine`. Labels en+pl in the catalog bundle (`blocks.{productGrid,productSlider}.fields.cardTextLine.*`). **Not extended:** `catalog.ProductCard` (it has no showcase style; its `showSku` switch already chooses its line). No contract or API change (`summary` exists since T070). Docs: `catalog.md` option table (+ Polish, cache).
- [X] T136 [US10] Decorative layer: document and test that an animated SVG asset can be the dark
  scheme's decorative layer (and that reduced motion swaps it for a static rendering where the
  browser allows), no group background (FR-005 ruling).
  **Result (2026-10-23):** new `cms-components/src/brand/decorative-layer.test.tsx` (5, jsdom, built stylesheet + `brandTokensToCss` with a dark `decorativeAssetId`, two adjacent dark decorative `cms.Section`s through `<Render>`): each Section computes `background-image: url(<file route of the asset>)`, `cover`, top centre, `no-repeat`; no ancestor paints a background and only the two Sections carry `data-decorative` (no group background); a light Section asking for it paints `none`; no `prefers-reduced-motion: reduce` rule touches the layer; the documented example SVG parses, has no script, no external reference, no SMIL, and its animation sits only inside `@media (prefers-reduced-motion: no-preference)`. **Not seen RED for a product reason:** its two first failures were the harness's (jsdom drops the quotes in `url("…")`; each Section sits in its own `withHideOn` wrapper, so two Sections are not siblings), corrected in the test; then green with no code change — it records behaviour T031/T091 built (the asset is referenced by id, so an SVG needs no code: the library stores it as `image/svg+xml`, the brand screen's picker accepts `image/*`, and the file route's `style-src 'unsafe-inline'` lets its inner `<style>` run). **No code change:** the page cannot stop an animation inside an image, so reduced motion is the SVG's own media query; no static-fallback token was added (none exists; YAGNI). Docs: `cms/docs/cms/brand.md` new "The decorative backdrop" (per section, animated SVG, reduced motion **where the browser evaluates the media query inside an SVG image — support differs, so check the asset**, CSS not SMIL, the example), `index.md` § Motion names this one exception; Polish mirrors, cache rewritten with `hashSourceBody()`. `data-model.md` §2 notes it.

**R5 (T133–T136) verification (2026-10-23):** cms-components whole package 61 files / 763 green (fresh `dist/cms-components.css`, kept); admin `page-builder-field-i18n`, `page-builder-i18n`, `hero-fields`, `section-presets` 59; storefront `test/ssr/blocks.test.tsx` + `block-ssr-floor.test.tsx` + `catalog-blocks.test.tsx` 35; mod-cms `block-declarations.test.ts` + `page-builder-registry.test.ts` 69; backend `blog/block-declarations` 5, `_i18n` 191; `check:block-names` declared=98 rendered=98 findings=0, `check:class-vocabulary` findings=0, `i18n:hardcoded` regressions=0 drained=0, `check:docs-translations` findings=0, `check:release-intent` violations=0; typecheck + lint of cms-components, mod-cms, mod-catalog, admin clean (mod-catalog: three pre-existing `react-hooks/exhaustive-deps` warnings in files not touched); `pnpm run build:packages` exit 0. Changeset `163-page-builder-hero-order-text-measure-card-line.md`; `contracts/blocks.md` (Hero, Statement, Accordion, listings, new `cms.Text`/`cms.RichContent` section) and `data-model.md` §2/§4. Translation contract `[PG]` not run: no translatable path changed.
- [X] T137 Re-run `local/reference-pages/build-home.mjs` (local only, never committed) using the
  new options; update `local/reference-pages/home-gaps.md`.
  **Result (2026-10-23):** the local rebuild (14 Sections, 75 blocks) uses the R5 options; HTTP 200,
  rich bodies in the server HTML, no page overflow at 375/1440. Library assets still unavailable
  locally (missing `ASSETS_LIBRARY_HMAC_KEY`), so media are hotlinked in the local build only.
  New defects N1–N3 → T138–T140; remaining gaps listed in the local `home-gaps.md`.

### R6. Defects found by the second local rebuild

- [X] T138 [US1] A `cms.Row` inside a Section with `width: 'bleed'` and a `contentWidth` gets a
  second side inset (the bleed row rule pads inside a frame that already pads); align the row's
  columns with the Section's content frame.
  **Result (2026-10-23):** the stylesheet's bleed-row rule (and its Puck-preview twin) is scoped to `.cmsc-section[data-width='bleed']:not([data-content-width])`; `Row.tsx` untouched. RED first in `brand/fallback-parity.test.tsx` ("T138 … adds no inset of its own": `contained: expected '24px' not to be '24px'`), with a companion case keeping today's 1360 px / 24 px frame for a bleed Section with no content width. Probe on `/ref-home` `#park-maszynowy`: frame content, heading and first column all at 80 (1440) and 24 (375); `.cmsc-pb-row-inner` padding 0 (was 24 px).
- [X] T139 [US3] `cms.FeatureList` body text (and every other block body using a fixed neutral
  colour) ignores the colour scheme and fails AA contrast on dark Sections; read `--cmsb-fg-muted`
  / `--cmsb-fg` with today's literals as fallback.
  **Result (2026-10-23):** audit of every `color:` with a fixed neutral in the stylesheet. Changed to `var(--cmsb-fg-muted, var(--cmsb-n-…, <today>))`: `.cmsc-pb-feature-list__desc`, `.cmsc-pb-product-card__sku|__stock`, `.cmsc-pb-category-list__count`, `.cmsc-pb-carousel-image__placeholder`; the underline tab's active colour reads `--cmsb-fg` before `--cmsb-n-900`. Surfaces under scheme text: inside `[data-cmsb-scheme]` a new `--cmsc-surface-tint` (translucent ink, `rgb(15 23 42 / 6%)`, dark scheme `rgb(255 255 255 / 10%)` — not `color-mix()`, whose minifier fallback is the opaque text colour) paints category chips and the boxed active tab; a bordered product card takes `--cmsb-bg`/`--cmsb-border`; an active pill inverts the scheme. Already following the scheme: Stats labels, Testimonial role, LinkList description, RichContent, image caption, product summary. Not changed (self-contained surfaces or editor-only): carousel arrows/pause (white buttons), DownloadTile type chip, table header, the video's invalid-URL editor hint; and **option defaults** that are light literals by design — `cms.Testimonial` background `#f8fafc`, `cms.NewsletterSignup` `#f0fdfa`, `cms.Text` colour `#243447` — which stay light on a dark Section until the editor changes them (rule 14 forbids moving a default). RED first: three fallback-parity cases (FeatureList in a dark Section `rgb(71, 85, 105)`; SKU contrast 3.75 < 4.5; product card stayed white); each also asserts today's colour with no scheme. Probe: `.cmsc-pb-feature-list__desc` is `rgb(163, 163, 163)` (the brand's dark muted) on `#000`, 8.6:1 (was `rgb(75, 85, 99)`, 2.6:1).
- [X] T140 [US4] Media frames ignore the block's corner radius and the scheme: `cms.LinkTile`
  (fixed light background and 8 px radius), carousel image frames and `cms.Video` file frames
  (`rounded-lg`); the block's corner-radius option reaches the media frame, the default stays
  today's look, and placeholder backgrounds follow the scheme.
  **Result (2026-10-23):** none of the three had an option reaching the frame (`cms.Video`'s box `cornerRadius` defaults to `none` and styles the box only, so it was not reused: that would have squared every default video). New `mediaCornerRadius` (`CORNER_RADIUS_FIELD` values; **Image corners** on `cms.LinkTile`/`cms.CarouselImage`, **Frame corners** on `cms.Video`), default `medium`; `utils/media-radius.ts` writes `--pb-media-radius`, read by `.cmsc-pb-link-tile__media`, `.cmsc-pb-carousel-image`, `.cmsc-pb-video__frame` and `.cmsc-pb-video iframe` with `8px` fallback; a chosen value also sets the embed frame's radius over `cmsc:rounded-lg`. Backdrops: `--cmsc-media-bg: transparent` inside `[data-cmsb-scheme]` (tile media, carousel image), empty placeholders paint `--cmsc-surface-tint`; with no scheme today's `#f1f5f9`. Deliberately changed existing assertion: `Video.test.tsx` "the frame reserves the ratio per breakpoint" now expects `border-radius: var(--pb-media-radius, 8px)`. RED first: three fallback-parity cases (`expected undefined to be 'medium'`). i18n: 15 keys each in the cms `en`/`pl` bundles. Docs: `packages/modules/cms/docs/cms/index.md` (Video and carousel-item rows, a scheme paragraph under *Colour schemes*), Polish mirrored, cache rewritten with `hashSourceBody()`; `contracts/blocks.md`, `data-model.md` §4; changeset `163-page-builder-media-corners-and-scheme-text.md`. Probe: tile media and carousel image backgrounds `rgba(0, 0, 0, 0)` on the dark bands (were `rgb(243, 244, 246)`); with `--pb-media-radius: 0px` set in the page, the tile media and video file frame compute `0px`. The stored `/ref-home` blocks keep 8 px until the page is rebuilt with the option (the `b2b` database is not written here).

  **R6 (T138–T140) verification (2026-10-23):** cms-components whole package 61 files / 771 green (fresh `dist/cms-components.css`, kept; `brand/fallback-parity.test.tsx` +8 R6 cases); typecheck + lint clean for cms-components, mod-cms, storefront; `pnpm run build:packages` exit 0; storefront `test/ssr` `blocks`, `block-ssr-floor`, `carousel-labels`, `catalog-blocks` 39; admin `page-builder-field-i18n` + `page-builder-i18n` 38; mod-cms `block-declarations` + `page-builder-registry` 69; backend `blog/block-declarations` 5, `cms/hidden-drawer` + `cms/frozen-block-renames-codomain` 12; `check:class-vocabulary` findings=0, `check:block-names` declared=98 rendered=98 findings=0, `i18n:hardcoded` regressions=0 drained=0, `check:docs-translations` findings=0, `check:release-intent` violations=0. The probe run logged N4's `catalog.ProductSlider` hydration attribute mismatch once more (not in R6's scope).

- [X] T141 [US4] Defect N4 (intermittent): a published carousel's generated ids
  (`data-pb-carousel-uid`, the track `id`, every `aria-controls`) hydrate with an attribute
  mismatch on `/ref-home` (`catalog.ProductSlider`); every `CarouselShell` user is exposed. Make
  the ids independent of the tree above the block, with a server-render + hydrate regression test
  for `cms.ContentSlider` and `catalog.ProductSlider` with provided block data.
  **Result (2026-10-23):** root cause — `CarouselShell` built the ids from `useId()`, which was
  already the hook (no counter, no `Math.random`, no data-derived id); its value encodes the whole
  component path from the application root, Next.js's app-router tree and the root layout
  included. Decoding the logged pair (server `_R_3cas…`, client `_R_dhbin…`, which is today's
  server value too): the server and client bits agree from the carousel up to and including the
  CMS page renderer's own lists (14 bits) and differ only **above the page component** — the
  server had rendered the tree above the page in a different shape, with the same DOM, on that one
  request (both sightings followed a package rebuild under the running dev server; not reproduced
  since). The block data is not the cause: it changes the DOM, and the diff was attributes only.
  Fix: `CarouselShell` takes `instanceId` (the block's Puck id) and builds its ids from it, with
  `useId()` only as the fallback when no id is given; `cms.ContentSlider`, `catalog.ProductSlider`
  and `blog.LatestPosts` pass it in the published render too (the editor keeps
  `editorCarouselId`). Ids now read `pb-carousel-<block id>`, identical on server and client.
  Trade-off: the same reusable block embedded twice on one page repeats its carousel ids (Puck ids
  are unique within one document). RED first in `carousel/carousel-hydration.test.tsx`: the server
  renders the page one list level deeper (`[null, page]`, no DOM) than the hydrating client, and
  React logged "A tree hydrated but some attributes … didn't match" with
  `data-pb-carousel-uid="pb-carousel-_R_5_"` vs `"_R_m_"` (ContentSlider) and `"_R_d_"` vs
  `"_R_1m_"` (ProductSlider) — 4 failing, then 4 green. Verification: cms-components whole package
  62 files / 775 green (fresh `dist/cms-components.css`, kept); typecheck + lint clean;
  `pnpm run build:packages` exit 0; storefront `test/ssr` `blocks`, `block-ssr-floor`,
  `carousel-labels`, `catalog-blocks` 39 green; `/ref-home` loaded 5 times through the probe:
  ids `pb-carousel-catalog.ProductSlider-ref003`, `…ContentSlider-ref009`, `…ContentSlider-ref052`,
  no hydration warning (the only console error is the `/favicon.ico` 404). Not changed: `cms.Tabs`,
  `cms.Accordion` and the newsletter forms also render `useId()` values into attributes and would
  mismatch the same way if the tree above the page diverged again.

### R7. Remaining gaps after the second rebuild (owner request 2026-10-26)

Same rules as R5 (extend existing blocks, today's options and default look kept, tests first,
en+pl, translatable texts, server HTML, Responsive tab for top-level responsive values, docs and
changesets, generic names only).

- [X] T142 [US2] A mobile video may be given as a URL as well as a library asset (`cms.Video`
  file source, Hero video media, MediaText video), with the same breakpoint and reduced-motion
  rules.
  **Result (2026-10-26):** **RED first:** option-parity new describe "R7 extensions keep every option (T142, T145, T146)" (the fields of `cms.Video` with a file source, `cms.Hero` with `media.*`, `cms.MediaText` `media.*` and `cms.Tabs` before R7 as literals, plus the additions) RED on `Video additions (top): expected [ 'hideOn', 'source', 'url', …(15) ] to deeply equal ArrayContaining ["mobileUrl"]` and `MediaText media.videoSource (top) → media.videoSource: expected [ 'kind', 'image', …(4) ] to include 'videoSource'`; `Video.test.tsx` +5 (RED 4/5 on `expected [ 'all' ] to deeply equal [ 'mobile', 'desktop' ]` and no `mobileUrl` field; the reduced-motion pair case green from the start, a guard), `Hero.test.tsx` +2 (RED), `MediaText.test.tsx` +8 (RED 6/8; "never starts it under reduced motion" and "never starts a pair that is not set to autoplay" green, guards), admin `hero-fields.test.tsx` +1 and `section-block-fields.test.tsx` +1 (StrictMode, RED: no "Mobile video URL" textbox, no "Video source" combobox). **`cms.Video`:** `mobileUrl` (file only, `resolveFields` drops it for an embed), `assetUrl(mobileVideoAssetId) || absolutizeMediaUrl(mobileUrl)` — the library file wins, a relative URL is made absolute against the media origin as `url` is; the pair, `preload="none"`, poster and `useBreakpointVideo` rules unchanged. **Hero:** `media.mobileVideoUrl`; the mobile video follows `videoSource` (URL source → `mobileVideoUrl`, library → `mobileVideoAssetId`) and takes the other kind when its own is unset. **MediaText (and `cms.CarouselSplit`, which shares the media):** `media.videoSource` (`library` = today, `url`), `videoUrl`, `mobileVideoAssetId`, `mobileVideoUrl`; each kind is the other's fallback; a video now renders whenever any source is set (was: only with `videoAssetId`). One source = today's single `<video>` (no `data-bp` with controls, `data-bp="all"` with autoplay); a distinct mobile video = a pair `data-bp="mobile"|"desktop"`, shown one at a time by new rules `.cmsc-pb-media-text__video > video[data-bp=…]` (as the hero's and the Video's). **Markup change (deliberate):** an autoplaying media-and-text video also carries `data-autoplay`, and `MediaText`/`CarouselSplit` start only `video[data-bp][data-autoplay]` (as `cms.Video` does), so a non-autoplaying pair is never started. **Admin:** `HeroFields` shows the mobile library picker with the library source and a "Mobile video URL" input with the URL source; `SectionBlockFields`' media control gains a "Video source" select (library first) and, per source, the video and mobile video pickers or the two URL inputs; their labels are the bundle's keys. Labels en+pl: `blocks.video.fields.mobileUrl.label`, `blocks.hero.fields.media.fields.mobileVideoUrl.label`, `blocks.mediaText.fields.media.fields.{videoSource,videoUrl,mobileVideoAssetId,mobileVideoUrl}.*`. Nothing translatable added (URLs and asset ids); `block-declarations.test.ts` Video (`mobileUrl`) and MediaText row media fixtures carry them as non-prose (green with the change; not run before it). `fallback-parity.test.tsx` R7 case (a pair shows the mobile video below the tablet tier; a single video displays as today) written after the stylesheet, not seen RED.
- [X] T143 [US4] Carousel filter bar style: `pills` (today) or `underline` tabs, plus alignment.
  **Result (2026-10-26):** **RED first:** `carousel/carousel-filter.test.tsx` +4 (RED 2/4 on no `--underline`/`--align-*` class and `carouselFilterFromProps` dropping both; "pills at the start add no class" and "underline filters and moves the focus" green from the start, guards), `ContentSlider.test.tsx` new describe (filter `style`/`align` options RED), option-parity R7 case, `fallback-parity.test.tsx` R7 case (RED on the missing rules). `filter.style: 'pills' | 'underline'` and `filter.align: 'start' | 'center' | 'end'` (object fields after `tags`, unset by default = today's pills at the start); `carouselFilterFromProps` passes known values only; `CarouselFilterBar` takes `variant`/`align`, the new `filterBarClassName` writes `cmsc-pb-carousel__filter--underline` and `--align-center|end` (nothing for today's). Same `toolbar`, `aria-pressed`, roving tab stop and keyboard for both looks. CSS: a 1 px rule under the bar (`--cmsb-border`, `#d9e0e7`), tabs with no box, inactive `--cmsb-fg-muted` (`#64748b`, 4.76:1), the pressed one 2 px underlined in `--cmsb-fg` (`#15202b`) and semibold, still 36 px tall and wrapping. Alignment is one value (a nested field, T118 policy), not per breakpoint. **Changed existing assertion (standing rule 13):** `ContentSlider.test.tsx` "shows the filter bar…" — `filter`'s object field keys now `['show', 'allLabel', 'tags', 'style', 'align']`. Two expectations of my own corrected after the first green run, not the code: the pressed tab's computed `border-radius` is `0px`, and its `#0000`/`currentColor` border is read from the built rule (jsdom does not parse `#0000`, as in T129). Labels en+pl (`blocks.contentSlider.fields.filter.fields.style|align.*`). Nothing translatable added.
- [X] T144 [US4] Carousel caption typography: caption size (type token or px, per breakpoint)
  and font role on `cms.CarouselImage` and `cms.LinkTile` titles/labels; `cms.LinkTile` label
  style (text link with arrow, button, none).
  **Result (2026-10-26):** **RED first:** `CarouselImage.test.tsx` +4 (RED 3/4; "nothing chosen is today's caption" green, a guard), `LinkTile.test.tsx` +4 (RED 3/4; "nothing chosen is today's tile" green), option-parity R7 case, fallback-parity R7 cases (RED: no rules, no span). New `components/item-text.tsx`: `ItemText` (nothing chosen → the text exactly as before; a size via `sizedTextProps` and/or a font role → one span with the token class, `--pb-text-size(-md|-lg)` and `font-family`), `itemFontField` (`default | heading | body`), `itemFontFamily` (`--cmsb-font-heading`/`--cmsb-font-body` with today's stack). The span carries the size so the item's own rules (`__caption` 0.875 rem/600, `__title` 1.125 rem/600) need no out-ranking. `cms.CarouselImage`: `captionSize` (`sizeFieldWithDefault`, responsive) + `captionSizePx` (shown by a new `resolveFields` only with Custom) + `captionFont`; fallback token `small`. `cms.LinkTile`: `titleSize/titleSizePx/titleFont` (fallback `h6`), `labelSize/labelSizePx/labelFont` (fallback `body`; the arrow sits inside the sized text) and `labelStyle` (`link` = today, `button` = a `span.cmsc-btn.cmsc-btn--primary-solid.cmsc-btn--medium.cmsc-pb-link-tile__button` inside the tile's one link — no nested control —, `none` = no label); `resolveFields` added for the two Custom px. Editor: the previewed tier (`usePreviewBreakpointTier`), published: CSS per breakpoint. `responsiveFields` in `index.ts` and the cms manifest (`captionSize(Px)`; `titleSize(Px)`, `labelSize(Px)` beside `ratio`). CSS: `__caption-text`/`__title-text` `display: block`; the button `align-self: flex-start`, wrapping, the button's hover colour on tile hover. Labels en+pl (`blocks.carouselImage.fields.caption{Size,SizePx,Font}.*`, `blocks.linkTile.fields.{title,label}{Size,SizePx,Font}.*`, `labelStyle.*`; 76 keys per cms bundle with T143/T147). Nothing translatable added; `block-declarations.test.ts` fixtures carry the new props as non-prose (green with the change; not run before it).
- [X] T145 [US2] Hero spacing per element: the gap after each element can be set (token or px),
  falling back to the single `gaps` value; today's look unchanged.
  **Result (2026-10-26):** **RED first:** `Hero.test.tsx` new describe (5): RED 3/5 on `expected null to be 'title subheading'` (no `data-space-after`), no `spaceAfter` field and no stylesheet rules; "unset carries nothing new" and "an item without a space is ignored" green from the start (guards); option-parity R7 case (Hero `spaceAfter` with `element`/`space`/`spacePx`, every token + Custom, absent from `defaultProps`). **Implementation:** `spaceAfter?: Array<{element, space: SpaceToken | 'custom', spacePx?}>` (array field, max 7, `GAP_OPTIONS` for the space, `spacePx` 0–400; type `HeroSpaceAfter`), not per breakpoint (a nested value, T118 policy) — a token still differs by breakpoint through its built-in px. The first entry per element counts; an unknown element or space is ignored. Rendered on `.cmsc-pb-hero__content` only when something is listed: `data-space-after="<elements in default order>"` and `--cmsc-hero-after-<element>` (below the desktop tier: `var(--cmsb-space-<t>, <mobile px>)` or the px) and `-lg` (desktop px); the editor canvas writes its previewed tier's value only. CSS: per element `.cmsc-pb-hero__content[data-space-after~='<e>'] > .cmsc-pb-hero__<class>:not(:last-child) { margin-bottom: var(--cmsc-hero-after-<e>) }` (`-lg` from 1024 px) and `… + * { margin-top: 0 }`, which out-rank today's 12/20 px, the T133 order rules and the `gaps` stack, so it works in either spacing mode; unlisted elements keep `gaps` or today's spacing. **Addition:** the array declares `metadata.pageBuilder.summaryField: 'element'` and `page-builder-i18n.ts` summarises an item of such a list by that select's translated option, as T133 did for one-select lists (`page-builder-i18n.test.ts` +1, RED `expected 'Statement' to be 'Wyróżnienie'`, then green; a several-field list naming no summary field keeps its own summary). Labels en+pl `blocks.hero.fields.spaceAfter.*` (19 keys). `block-declarations.test.ts` Hero fixture carries `spaceAfter` as non-prose. `fallback-parity.test.tsx` R7 cases (a Custom 40 px after the title replaces the 12 px, the subheading keeps 20 px and gets no top margin; with `gaps: 'm'` a token `xl` after the subheading gives 56 px there and 0 above the buttons, the title→subheading gap stays 24 px) written after the stylesheet, not seen RED; today's default spacing is held by the existing T133 case.
- [X] T146 [US5] Tabs: space between the tab bar and the panel (token or px). A three-column
  panel (side text | media | text) is built with `cms.Row`/`cms.Column` inside the panel; if that
  works, document it with an example in the docs instead of adding a MediaText layout.
  **Result (2026-10-26):** **RED first:** `Tabs.test.tsx` new describe "space between the tab bar and the panel" (4): RED 3/4 (no `cmsc-pb-tabs--panel-gap` class, `block.resolveFields is not a function`, no rules); "nothing set" green (guard); option-parity R7 case (Tabs `panelGap`/`panelGapPx`, responsive metadata, px only with Custom). **Implementation:** `panelGap` (`gapField`: every spacing token + Custom, `PB_RESPONSIVE_METADATA`) and `panelGapPx` (`gapPxField`, shown by a new `resolveFields` only when some tier is Custom), both in `responsiveFields` (`index.ts` and the cms manifest), not in `defaultProps`. Set at any tier → `cmsc-pb-tabs--panel-gap` + `--cmsc-tabs-panel-gap(-md|-lg)` through the shared `gapVars` (fallback 12 px); the editor writes its previewed tier's value (Tabs now has an editing/published render pair, `usePreviewBreakpointTier`). CSS: `.cmsc-pb-tabs--panel-gap > .cmsc-pb-tabs__list { margin-bottom: var(--cmsc-tabs-panel-gap, 12px) }` + md/lg rules; unset keeps the list's `margin-bottom: 12px`. **Three-column panel: verified, documented, no new layout.** `Tabs.test.tsx` new describe (2), green from the start: the panel slot refuses `cms.Column`/`cms.Tabs`/`cms.Accordion`/`cms.Section` but not `cms.Row`, a Row's slot allows only columns, and two tabs each holding a Row of three Columns (spans 3/5/4 of 12 on desktop, 12 below) render every column's content in order in the server HTML, the inactive panel `hidden`. Docs: new section "Tabs: a panel in columns" with the step-by-step example (Polish "Zakładki: panel w kolumnach"). Labels en+pl `blocks.tabs.fields.panelGap.*`, `panelGapPx.label`. `block-declarations.test.ts` Tabs fixture carries the gap as non-prose. `fallback-parity.test.tsx` R7 case (12 px unset, Custom 32 → 32 px, token `l` → 40 px) written after the stylesheet, not seen RED.
- [X] T147 [US4] Carousel controls: alignment of controls below the track
  (start/center/end/space-between, per breakpoint) and a split mode with the previous/next arrows
  at the two sides; per-arrow style only if both arrows can differ without new markup.
  **Result (2026-10-26):** **RED first:** `carousel/CarouselShell.test.tsx` +5 (RED 3/5; "centred is today's" and "the row keeps its markup and reading order" green, guards), `ContentSlider.test.tsx` (RED on no `controlsAlign`/`nextArrowVariant` field), option-parity R7 case for the three carousels, fallback-parity R7 cases. **Alignment:** top-level `controlsAlign` (`center | start | end | between | split`, `PB_RESPONSIVE_METADATA`, in the shared `CAROUSEL_TRACK_FIELDS`, so on the Carousel, `catalog.ProductSlider` and `blog.LatestPosts`; `responsiveFields` in `index.ts` and the cms/catalog/blog manifests; hidden for a grid in the Carousel's and LatestPosts' `CAROUSEL_ONLY`), unset by default. `CarouselShell` `controlsAlign` → root classes `cmsc-pb-carousel--ctl-<v>` (unless centred) and `--ctl-md|lg-<v>` only where a breakpoint changes it; the editor previews one tier (a base class only); a grid none. The stylesheet aligns the `below` and `dots` rows through child combinators (a carousel nested in a slide keeps its own): `start`/`end`/`between` = `justify-content`, `split` = the previous arrow `margin-inline-end: auto` and the next `margin-inline-start: auto`, the dots centred between (logical margins, so RTL mirrors); md/lg classes reset the margins. The DOM and focus order (previous, dots, pause, next) never change — no CSS `order`. **Per-arrow style: implemented**, because both arrows already carry their own class (`__arrow--prev`, `__arrow--next`) and need no new markup: `controls.nextArrowVariant` (`same` first = the arrows' style, `default`, `outline`, `solid`) → root class `cmsc-pb-carousel--next-arrow-<v>` restyling `__arrow--next` (the previous arrow keeps `arrowVariant`; shape, size and colour stay shared). Two fallback-parity regexes of my own corrected after the first run (the minifier joins the `lg-center` and `lg-split` selectors into one rule), not the code. Labels en+pl in the cms, catalog and blog bundles (`controlsAlign.*`, `controls.fields.nextArrowVariant.*`). Fixtures: `block-declarations.test.ts` Carousel and backend `blog/block-declarations.test.ts` track carry both as non-prose.

  **R7 (T143, T144, T147) verification (2026-10-26):** cms-components whole package 63 files / 870 green (fresh `dist/cms-components.css`, kept); mod-cms `block-declarations` 49 + `page-builder-registry` 20; backend `blog/block-declarations` 5, `_i18n` 11 / 191; admin `page-builder-field-i18n` + `page-builder-i18n` 39 (written keys before the run, not seen RED); storefront `test/ssr` `blocks`, `block-ssr-floor`, `carousel-labels`, `catalog-blocks` 39; `check:block-names` declared=98 rendered=98 findings=0, `check:class-vocabulary` findings=0, `i18n:hardcoded` regressions=0 drained=0, `check:docs-translations` findings=0, `check:release-intent` violations=0; typecheck + lint clean for cms-components, mod-cms, mod-catalog, mod-blog (three pre-existing `react-hooks/exhaustive-deps` warnings each in catalog and blog admin files not touched), backend typecheck clean; `pnpm run build:packages` exit 0. Docs: `cms/index.md` (block table row of the carousel items; the "Carousels" section: next arrow style, controls alignment, filter bar style and alignment, item typography and label style), Polish mirrored, cache entry rewritten with `hashSourceBody()`; `contracts/blocks.md` (Carousel `controls`, `controlsAlign`, `filter`, R7 paragraph; CarouselImage, LinkTile), `data-model.md` §4; changeset `163-page-builder-carousel-filter-style-item-typography-controls-align.md`. Not done: a browser check on the running instance (the `b2b` database is not written by these tasks).
- [X] T148 [US1] Section: optional overlap with the previous Section (pull up by a token or px,
  per breakpoint, with stacking order) and collapse of an empty Section (no blank padding when
  every child renders nothing, e.g. a data block with no data), server-side where possible.
  **Result (2026-10-26):** **RED first:** `option-parity.test.ts` new case "cms.Section, extended with an overlap (T148)" (the Section's fields and select options before R7 as literals, top level with a bleed width and custom content width) RED on `expected [ 'hideOn', 'scheme', …(10) ] to include 'overlap'`; `SectionBlock.test.tsx` +7 (RED 6/7: no field, no `data-overlap`/vars, editor tier, stylesheet rules for the pull-up and the empty collapse; the 7th records the DOM the collapse rule reads — `.cmsc-section__frame > div > .cmsc-pb-hide-on:empty` for `blog.LatestPosts` with no posts); `fallback-parity.test.tsx` +4 (RED 2/4: the overlapping frame `calc(-1*40px)`, `z-index: 1`, `flow-root`; the empty collapse; the untouched Section — 40 px, frame in place, no z-index — and the first-block case green from the start); contracts `page-builder-props.test.ts` +1 and core `section-field.test.tsx` +1 (`defaultValue`) RED, then all green. **Overlap:** contracts `sectionSettingsSchema.overlap?: Responsive<SpaceValue>`; core `createSectionSpaceField({ label, defaultValue })` (`SectionSpaceFieldOptions`; default still `'l'`) so the overlap is the same token-or-px control showing **None** until set; `cms.Section` field `overlap` last on the Responsive tab (`SECTION_RESPONSIVE_FIELDS`, cms manifest `responsiveFields`), not in `defaultProps`. `SectionFrame` writes `data-overlap="1"` and `--cmsc-section-overlap(-md|-lg)` only when some tier pulls (`none`/`{px:0}` everywhere → nothing; an untouched Section's markup is unchanged). CSS: `z-index: 1` on the section (above the previous one, `position: relative` without z-index), `display: flow-root` unless `data-position` (so the negative margin cannot collapse through a Section with no space above and drag its background along), and the **frame** gets `margin-top: calc(-1 * overlap)` per media tier — the content sits over the previous section's background, this section's box and background stay; a vertical margin adds no width (live probe on the running storefront, an overlap injected into the 4th Section: frame −80 px at 375 / −120 px at 1440, section top unchanged, `scrollWidth` 375 / 1440). The page's first block (`.cmsc-pb-hide-on:first-child`) is not pulled. **Editor (decision):** the canvas does not pull (`.cmsc-section--tier`), so the previous section stays selectable and droppable; it writes the previewed tier's value only and draws a hatched, `pointer-events: none` band of that height at the top of the Section. **Empty collapse (pure CSS, decision):** server-side was rejected — whether a block renders anything is known only when it renders (block data, hide-on per breakpoint). A published Section (not `--tier`, not `data-media`) whose frame holds only empty block wrappers drops padding, `min-height` and pull-up: `:not(:has(> .cmsc-section__frame > * > :not(.cmsc-pb-hide-on:empty)))`, plus one rule per media tier where a wrapper hidden there (`[data-hide-<tier>='1']`) counts as empty; the DOM of non-empty Sections is untouched. A Section with an image/video background keeps its size (media is content). Fallback: without `:has()` the rules drop and today's padding stays. Live: the reference page's empty news Section (0 posts) now measures 0 px at 375 and 1440 (was the ~250 px band). Labels en+pl `blocks.section.fields.overlap.label`. **Changed existing assertions (standing rule 13):** `SectionBlock.test.tsx` "puts space above, space below, content position and overlap on the Responsive tab, and nothing else" (was without `overlap`); `admin/test/page-builder-admin/sidebar-field-layout.test.tsx` "declares the Section's responsive fields in its manifest" (+`overlap`). Docs: `cms/index.md` Section table row + "An empty Section takes no space" (Polish mirrored, cache rewritten with `hashSourceBody()`); `contracts/blocks.md` (`overlap` prop, Overlap and Empty collapse bullets), `data-model.md` §3.4; changeset `163-page-builder-section-overlap-and-empty-collapse.md`. **Verification:** cms-components whole package 63 files / 870; core `section-field` 16; contracts `page-builder-props` 30; mod-cms `manifest`, `page-builder-registry`, `block-declarations` 90; admin `sidebar-field-layout`, `section-settings-visibility`, `section-block-fields`, `page-builder-field-i18n` 55; storefront `test/ssr/blocks.test.tsx` + `block-ssr-floor.test.tsx` 19; backend `_i18n` 191; `check:block-names` findings=0, `check:class-vocabulary` findings=0, `i18n:hardcoded` regressions=0 drained=0, `check:docs-translations` findings=0, `check:release-intent` violations=0; typecheck + lint clean for contracts, page-builder-core, cms-components, mod-cms, admin; `dist/cms-components.css` rebuilt and kept. Not done: a browser check of the editor band (the canvas was not opened).
- [X] T149 [US5] Stable element ids for Tabs, Accordion and the newsletter sign-up forms (block id
  first, `useId()` as fallback), as T141 did for carousels, with a hydration regression test.
  **Result (2026-10-26):** **RED first:** new `components/block-dom-ids-hydration.test.tsx` (16, T141's method: the server renders the page one list level deeper, `[null, page]`, than the hydrating client) for `cms.Tabs`, `cms.Accordion`, `cms.NewsletterSignup` (consent on) and `newsletter.Signup`: RED 8/16 — a hydration warning for each block and ids from `useId()` (`expected '_R_6_-panel-0' to contain 'cmsTabs-1'`, `'_R_6_-email'` for the sign-up); "two blocks keep distinct ids" and "without a block id, `useId()` still gives resolvable ids" green from the start (guards). **Fix:** new `components/block-dom-id.ts` `useBlockDomId(prefix, blockId)` → `<prefix>-<block id, sanitised to [A-Za-z0-9_-]>`, `useId()` only when the block has no id (the hook is always called). Tabs (`pb-tabs-…-tab-n`/`-panel-n`), Accordion (`pb-accordion-…`), `cms.NewsletterSignup` (`pb-newsletter-…-consent`) and `newsletter.Signup` (`pb-signup-…-email|…-error|-consent…|-topics-error`) build their ids from it, published and in the editor. Trade-off as T141: the same reusable block embedded twice on one page repeats its ids. `CarouselShell` not refactored onto the hook (T141's code, unchanged). Existing `Tabs`/`Accordion`/`NewsletterSignupForm` tests and storefront `test/ssr/newsletter-signup.test.tsx` green unchanged (no assertion named a `useId` value).

  **R7 (T142, T145, T146, T149) verification (2026-10-26):** cms-components whole package 63 files / 870 green (fresh `dist/cms-components.css`, kept); mod-cms `block-declarations` + `page-builder-registry` 69; admin `hero-fields`, `section-block-fields`, `page-builder-i18n`, `page-builder-field-i18n`, `video-image-fields` 5 files / 60; storefront `test/ssr` `blocks`, `block-ssr-floor`, `newsletter-signup`, `module-blocks` 38; backend `_i18n` 11 / 191, `cms/hidden-drawer` + `cms/frozen-block-renames-codomain` 12; `check:block-names` declared=98 rendered=98 findings=0, `check:class-vocabulary` findings=0, `i18n:hardcoded` regressions=0 drained=0, `check:docs-translations` findings=0, `check:release-intent` violations=0; typecheck clean for cms-components, mod-cms, admin, storefront; lint clean for cms-components, mod-cms, admin (storefront: pre-existing `no-img-element` warnings only); `pnpm run build:packages` exit 0. Docs: `cms/index.md` block table (Hero, MediaText, Video, Tabs rows) + new "Tabs: a panel in columns" section, Polish mirrored, cache entry rewritten with `hashSourceBody()`; `contracts/blocks.md` (Hero `media`/`spaceAfter`, MediaText `media`, Tabs `panelGap`, element ids for Tabs/Accordion and the sign-up, Video `mobileUrl`), `data-model.md` §4; changeset `163-page-builder-mobile-video-url-hero-spacing-tab-gap.md`. Not done: a browser check on the running instance (the `b2b` database is not written by these tasks).

### R8. Gaps after the third rebuild (owner request 2026-10-26)

Same rules as R5/R7.

- [X] T150 [US1] Fix R7-1: the carousel (filter buttons, captions, controls) and the product card
  text inherit the storefront font instead of the brand body font; set the brand body font on the
  carousel and card roots with today's fallback.
  **Result (2026-10-26):** **RED first:** `brand/fallback-parity.test.tsx` new describe "R8 …" — the carousel root (a `cms.ContentSlider` with its filter bar) and the product card root (`CmsProductCardView`): RED on `expected [ '', 'inherit' ] to include 'depends on user agent'` (no rule set a font on either root), then green. **Fix (CSS only):** `.cmsc-pb-carousel` and `.cmsc-pb-product-card` join T122's zero-specificity `:where(…) { font-family: var(--cmsb-font-body, inherit) }` group, so the filter buttons (`font: inherit`), the header lead, the controls and every card text follow the brand body font; with no brand font they inherit the page's font as on origin/master (standing rule 9), and a block's own font rule (`.cmsc-pb-block-heading`, a token class, an inline style) still wins. Each case also asserts the no-token look. Not done: a browser check on the running instance (the `b2b` database is not written by this task).
- [X] T151 [US1] Text weight option: block headings and item texts (carousel captions, tile titles
  and labels, feature titles, card titles) can choose a weight (token default or 300–800), today's
  weight kept by default.
  **Result (2026-10-26):** **RED first** (with T152/T153): new `components/text-weight-and-measure.test.tsx` (49, T151–T153) RED 40/49 on missing fields, inline weights and measures (`expected '' to be '300'`, `expected [ … ] to deeply equal ArrayContaining{…}`); the nine "unset … as today" cases were green from the start (guards). Option-parity new describe "R8 text weight, heading measure and controls to the first slide (T151–T153)" (the top-level fields of 14 blocks before R8 as literals, plus the additions, none in `defaultProps`) RED 15/15 (`cms.CtaCard additions: expected [ 'hideOn', 'cardScheme', …(10) ] to deeply equal ArrayContaining{…}`). Fallback-parity R8 case RED (no `__title-text` span for a weight). **Implementation:** `typography.ts` `textWeightField(label)` (`Default` first, then `FONT_WEIGHT_OPTIONS` 300–800, one value, not per breakpoint) and `textWeightCss` (a known weight, numeric strings too; anything else ignored). `BlockHeading` takes `weight` (inline `font-weight` over the size token's); `section-parts.tsx` exports `blockHeadingStyleFields()` (`headingWeight` + T152's measure; `{ measure: false }` for the weight only), `blockHeadingStyle(props)` and `isUnusedHeadingMaxWidthPx`. `headingWeight` on `cms.MediaText`, `cms.BackgroundPanel`, `cms.CtaCard`, `cms.LinkList`, `cms.FeatureList`, `cms.Stats`, `cms.Statement` and the shared `CAROUSEL_HEADER_FIELDS` (so `cms.ContentSlider`, `catalog.ProductGrid`, `catalog.ProductSlider`, `blog.LatestPosts`). `cms.Hero.titleWeight` (on `HeroText`, also over the stored hero's legacy title class). Items: `ItemText` gains `weight` (one more property of its span; no span when nothing is chosen) → `cms.CarouselImage.captionWeight`, `cms.LinkTile.titleWeight`/`labelWeight`; `cms.FeatureList.titleWeight` (every item title, with or without a title size); `PRODUCT_LISTING_CARD_FIELDS.cardTitleWeight` → `listingCardTitleWeight` → `CmsProductCardView` `nameWeight` on `__name` of every card style. Types: `TextWeight`, `BlockHeadingStyleProps` (`component-types.ts`). `ProductGrid` destructures the new props out of its box props. Labels en+pl (`blocks.<block>.fields.{headingWeight,titleWeight,captionWeight,labelWeight,cardTitleWeight}.label` + `options.default|300…800`, Polish wording of `cms.Heading`'s weight) in the cms, catalog and blog bundles. Fixtures: `block-declarations.test.ts` (cms) and backend `blog/block-declarations.test.ts` carry every new prop as non-prose (green with the change; not run before it). Nothing translatable added.
- [X] T152 [US2] Hero title (and other block headings using `BlockHeading`) gain a maximum width
  (token or px, per breakpoint), unset by default.
  **Result (2026-10-26):** **RED first:** in T151's files (`text-weight-and-measure.test.tsx`: no field, no `cmsc-text-max`, no `data-align`; fallback-parity: hero title `max-width` `expected 'none' to be '900px'`). **Implementation:** T134's measure reused (`text-max-width.ts`, no new vocabulary): `BlockHeading` takes `maxWidth`/`maxWidthPx`/`align` → `cmsc-text-max` + `--cmsc-text-max(-md|-lg)` published, the previewed tier's inline `max-width` in the editor, and `data-align="center|right"` only when held in a centred or end-aligned block (`cms.Stats` centred by default, `cms.FeatureList` and `cms.Hero` from their `align`), read by the existing `.cmsc-text-max[data-align]` rules. `headingMaxWidth` (`textMaxWidthField`, responsive metadata) + `headingMaxWidthPx` (shown by each block's `resolveFields` only when some tier is Custom) on the BlockHeading blocks of T151 **except `cms.Statement`**, whose `textMaxWidth` already holds its heading (one control per concept). `cms.Hero` `titleMaxWidth`/`titleMaxWidthPx` (`CUSTOM_PX_FIELDS`). All in `responsiveFields` of `index.ts` and the cms/catalog/blog manifests (Responsive tab). Labels en+pl (`…headingMaxWidth.*`, `…headingMaxWidthPx.label`, `blocks.hero.fields.titleMaxWidth*`). One expectation of my own corrected after the first green run, not the code: the fixture's `headingMaxWidthPx: { desktop: 900 }` gains `base: 720` (a responsive value without `base` resolves to the fallback). Fallback parity: unset → `max-width` none; Custom 900 in a centred hero → 900 px, margins `auto`.
- [X] T153 [US4] Carousel controls align to the first slide when the track bleeds past the content
  edge (option: align to the container or to the track), today's alignment by default.
  **Result (2026-10-26):** **RED first:** `carousel/CarouselShell.test.tsx` new describe (3): RED 1/3 (no `--ctl-to-slide` class); "unset or the container is today's" and "the controls row keeps its markup" green from the start (guards); `text-weight-and-measure.test.tsx` T153 describe (5, RED: no `controlsAlignTo` field, no class, no rule), option-parity R8 case, fallback-parity R8 case (`expected 'auto' to be 'calc((100%-(1.25-1)*16px)/1.25)'`). **Decision on the name:** the option is `controlsAlignTo: 'container' | 'slide'` ("The content edge" / "The first slide"): with a bleeding track the track itself reaches the window edge, so "the track" of the task is its first slide, where the reference aligns. **Implementation:** a field in the shared `CAROUSEL_TRACK_FIELDS` after `controlsAlign` (so on the Carousel, `catalog.ProductSlider` and `blog.LatestPosts`; hidden for a grid in the Carousel's and LatestPosts' `CAROUSEL_ONLY`), one value (not per breakpoint), unset by default; `carouselShellOptions` passes only `slide`; `CarouselShell` `controlsAlignTo` → root class `cmsc-pb-carousel--ctl-to-slide` (published and in the editor; none for a grid). CSS: `.cmsc-pb-carousel--ctl-to-slide > :is(__controls--below, __controls--dots) { width: var(--cmsc-slide-w); max-width: 100%; box-sizing: border-box }` — one slide's width from the same slides-per-view and gap variables, so `controlsAlign` (`end`, `split`, …) aligns to the first slide; one slide per view is the content width (no change); header and overlay controls are not moved. Markup and reading order unchanged. Labels en+pl in the cms, catalog and blog bundles (`controlsAlignTo.*`). Not done: a browser check at 1440 on the running instance (the `b2b` database is not written by this task).

  **R8 (T150–T153) verification (2026-10-26):** cms-components whole package 65 files / 969: 961 green, the 8 red are T155/T156's own RED cases of the parallel task (Tabs scroll, Column distribution/order), none of T150–T153 (fresh `dist/cms-components.css`, kept); mod-cms `block-declarations`, `page-builder-registry`, manifest 90; backend `blog/block-declarations`, `cms/hidden-drawer`, `cms/frozen-block-renames-codomain` 17, `_i18n` 11 / 191; admin `page-builder-field-i18n`, `page-builder-i18n`, `hero-fields`, `carousel-fields`, `listing-fields`, `section-block-fields`, `sidebar-field-layout` 7 / 76; storefront `test/ssr` `blocks`, `block-ssr-floor`, `carousel-labels`, `catalog-blocks` 39; `check:block-names` declared=98 rendered=98 findings=0, `check:class-vocabulary` findings=0, `i18n:hardcoded` regressions=0 drained=0, `check:docs-translations` findings=0, `check:release-intent` violations=0; typecheck + lint clean for cms-components, mod-cms, mod-catalog, mod-blog (three pre-existing `react-hooks/exhaustive-deps` warnings each in catalog and blog admin files not touched), backend typecheck clean; `pnpm run build:packages` exit 0. Docs: `cms/index.md` new "Headings: weight and width" section, the Hero row, the carousel table (**Align the controls to**) and the item typography paragraph; `catalog.md` **Card title weight** row; Polish mirrored, both cache entries rewritten with `hashSourceBody()`; `contracts/blocks.md` § R8, `data-model.md` §4; changeset `163-page-builder-text-weight-heading-measure-controls-to-slide.md`. No existing assertion was changed.
- [X] T154 [US1] The dark scheme's decorative layer accepts a URL as well as a library asset (as
  T142 did for video); same safety rules as other URLs.
  **Result (2026-10-26):** **RED first:** contracts `cms-brand.test.ts` +1 (RED: the unknown key was stripped, so `http:`, `//host`, `javascript:`, quotes, `)`, `<` and an over-long URL all parsed), `brand-css.test.ts` +6 (RED 3: no `--cmsb-decorative` from a URL, no `mediaUrl`; the asset-wins and drop-unsafe cases green from the start, guards), `decorative-layer.test.tsx` +1 (RED: a dark decorative Section painted `none`), admin `brand-page.test.tsx` +2 and contract `[PG]` `brand-tokens.contract.test.ts` +1 (written before the change, not run before it). **Contracts:** `schemes.*.decorativeUrl?: brandMediaUrlSchema` with `BRAND_MEDIA_URL_RE` = `https://…` or `/path` (not `//`), ≤ 2048, no `"'<>()\\` or whitespace (the font stylesheet's rule plus site-relative paths), re-exported from `page-builder-core/brand-tokens`. **`brandTokensToCss`:** asset id wins, else the URL, re-checked with the same rule restated (`BRAND_CSS_MEDIA_URL_RE`, held equal by the test), a `/path` passed through the new `mediaUrl` option (default identity), written with `cssString` (hex-escapes quotes, parentheses, `<`); a `mediaUrl` output cannot close the string or the `<style>`. Storefront `StorefrontDocument`, admin `BrandPreview` and `PreviewBrandTokens` pass `mediaUrl: toAbsoluteAssetUrl` (the API origin, as a relative video URL is rebased). **Brand screen:** under the dark scheme's asset picker a **Decorative backdrop URL** input (`type=url`, trimmed, cleared value removes the key, hint and placeholder); an invalid URL is refused on save by the existing schema check, naming `schemes.dark.decorativeUrl`. Labels en+pl `brand.schemeField.decorativeUrl|decorativeUrlHint|decorativeUrlPlaceholder`. No migration (JSONB). Docs `cms/brand.md` § The decorative backdrop + For engineers (schema, `mediaUrl`, untrusted-input rule), Polish mirrored, cache rewritten with `hashSourceBody()`; `data-model.md` §2.
- [X] T155 [US5] Tabs bar on narrow screens: `wrap` (today, T123) or a single scrolling line
  (scroll-snap, keyboard reachable, no page overflow).
  **Result (2026-10-26):** **RED first:** `Tabs.test.tsx` new describe (5): RED 4/5 (no `barOverflow` field, no class, no `scrollIntoView`, no rules); "the arrow keys … still move focus" green from the start (guard); option-parity R8 case (Tabs fields before R8 as literals + `barOverflow` options `['wrap','scroll']`) RED; `fallback-parity.test.tsx` R8 cases (2) RED. **Implementation:** `cms.Tabs.barOverflow?: 'wrap' | 'scroll'` (radio, General tab, not in `defaultProps`; unset/`wrap` = today's markup, byte for byte); `scroll` adds `cmsc-pb-tabs--scroll`: the list `flex-wrap: nowrap; max-width: 100%; overflow: auto hidden; overscroll-behavior-x: contain; scroll-snap-type: x proximity`, tabs `flex-shrink: 0; white-space: nowrap; scroll-snap-align: start; min-width: auto` (stretch-aligned tabs never squeeze); centred bar via auto margins (no unreachable start); underline/boxed bar line as an inset shadow and the active underline without the -1 px overlap (it would be clipped); focus ring drawn inside the tab (`outline-offset: -2px`). Roles, ids, roving tab index and keys unchanged; a focused tab is scrolled into view by the browser, a tab chosen with the pointer gets `scrollIntoView({block: 'nearest', inline: 'nearest'})`. **Defect found and fixed here:** T146's insertion had cut the R-13 rule `.cmsc-pb-tabs__tab:focus-visible, .cmsc-pb-tabs__panel:focus-visible` in two, so a focused tab had no outline (its selector had been merged into the panel-gap margin rule); restored, asserted in `Tabs.test.tsx`. No existing assertion changed. Labels en+pl `blocks.tabs.fields.barOverflow.*`; `block-declarations.test.ts` Tabs fixture carries it as non-prose. Docs `cms/index.md` Tabs row + "Tabs: a panel in columns" paragraph, Polish mirrored, cache rewritten; `contracts/blocks.md` § "R8: tab bar overflow …", `data-model.md` §4. Not done: a browser check at 375 px on the running instance (no page with the option locally; `b2b` not written).
- [X] T156 [US3] Columns: a Column can distribute its blocks vertically (start, center, end,
  space-between, last block to the bottom), and a block can take a different order per
  breakpoint inside a Column without duplicating it (generic responsive order on the block
  wrapper, applied only in flex/grid containers).
  **Result (2026-10-26):** **RED first:** page-builder-core `with-hide-on.test.tsx` +4 (RED 2/4: no vars, no `stackOrder` field; "unset/`auto` is byte-identical" and "a non-order value is ignored" green from the start, guards), new `cms-components/src/components/Column.test.tsx` (9, all RED), option-parity R8 cases (Column fields before R8 as literals + `distribute`; a `cms.Text` in a Column = its top-level fields + `stackOrder`) RED, `fallback-parity.test.tsx` R8 Column case RED. **Column:** `distribute?: 'start' | 'center' | 'end' | 'space-between' | 'last-to-bottom'` (General tab, not in `defaultProps`) → `data-pb-distribute` (nothing for unset/`start`/an unknown value); the column, its box, the box's `.cmsc-pb-bg-content` layer and the block stack become flex columns and the stack is distributed (`last-to-bottom` = `margin-top: auto` on its last block); applies where the Row stretches its columns (its default). The published slot is now named `cmsc-pb-column-stack` (appended to the editing slot's classes) — the one markup change for an unset column, no look change. **Order:** `withHideOn` adds `stackOrder?: Responsive<'auto' | 'first' | '1'–'6' | 'last'>` (Responsive tab) through a `resolveFields` it now composes for every wrapped block, offered only when `params.parent.type` is in the new `BLOCK_ORDER_PARENTS` (`['cms.Column']`) — so no block's static field set changes (it is not in any manifest's `responsiveFields`, like `hideOn`); the wrapper writes `data-pb-order="1"` + `--pb-order(-md|-lg)` (`first` −1, `last` 99, `auto` 0, a missing tier inherits) only when some tier is not `auto` (else byte-identical); `.cmsc-pb-hide-on[data-pb-order]` reads it as `order` per breakpoint, and `.cmsc-pb-column-stack:has(> .cmsc-pb-hide-on[data-pb-order])` makes that column a flex column. CSS `order` applies only to flex/grid items, so the value is inert anywhere else. **DOM/focus order note:** the order is visual only — DOM, reading and Tab order stay the stored order (WCAG 1.3.2/2.4.3); recorded in the docs (reorder only where both orders make sense), `contracts/blocks.md` and `data-model.md`. The editor canvas keeps the stored order (Puck's draggable wrapper sits between the stack and the block), so drag-and-drop matches the outline. In a distributed or ordered column neighbouring margins add instead of collapsing (documented). `cms.Row` untouched (byte-identical to `origin/master`). Labels en+pl: `blocks.column.fields.distribute.*` and `blocks.<block>.fields.stackOrder.*` for every block with field keys in the `cms`, `catalog`, `blog` and `newsletter` bundles (`cms.Section` excepted: top level only); admin `page-builder-field-i18n.test.ts` +29 (each new/reshaped block plus Text and RichContent resolved in a Column shows the Polish label and options; written after the keys, not seen RED). `block-declarations.test.ts`: the shared `box` fixture carries `stackOrder`, the Column fixture `distribute`, both non-prose. Docs `cms/index.md` Column row + new "Columns: distribution and order" section, Polish "Kolumny: rozmieszczenie i kolejność", cache rewritten; `contracts/blocks.md`, `data-model.md` §4.

**R8 (T154–T156) verification (2026-10-26):** contracts `cms-brand.test.ts` 15; page-builder-core whole package 28 files / 190; cms-components whole package 65 / 969 (fresh `dist/cms-components.css`, kept); mod-cms whole package 27 / 301 (incl. `block-declarations.test.ts`); backend unit `blog/block-declarations`, `cms/hidden-drawer`, `cms/frozen-block-renames-codomain`, `_i18n` 14 / 208; `[PG]` `test/contract/cms/brand-tokens.contract.test.ts` 11/11; admin `test/modules/cms` 25 / 222 (incl. `brand-page`, `page-builder-field-i18n`, `page-builder-i18n`, `preview-brand-tokens`), `test/page-builder-admin` + `test/modules/blog` 8 / 99; storefront `test/ssr` (9 files) + `theme/brand-style` + `channel-theme` 10 / 87; `check:block-names` declared=98 rendered=98 findings=0, `check:class-vocabulary` findings=0, `i18n:hardcoded` regressions=0 drained=0, `check:docs-translations` findings=0, `check:release-intent` violations=0; typecheck clean for contracts, page-builder-core, cms-components, mod-cms, admin, storefront, backend; lint clean (warnings pre-existing in files not touched) for the same; `pnpm run build:packages` exit 0. Changeset `163-page-builder-backdrop-url-tab-scroll-column-order.md`. No existing assertion was changed.
- [X] T157 Re-run `local/reference-pages/upload-assets.mjs` and `build-home.mjs` with library assets
  and the R8 options (local only, never committed); refresh `home-gaps.md`.
  **Result (2026-10-26):** the local rebuild takes every medium from the asset library (40/41
  uploaded; one SVG with an XML header refused, see the asset-library notes below), posters
  captured, a generic animated SVG backdrop on the dark scheme, R8 options in use; HTTP 200,
  no overflow or hydration warnings at 375/768/1440. Found outside this feature's scope: the
  asset library refuses an SVG starting with `<?xml …?>` (415) and its storage self-check reports
  a fresh local store as broken (ENOENT) although uploads work — candidates for separate issues.

### R9. Section group and remaining gaps after the fourth rebuild (owner request 2026-10-26)

Same rules as R5/R7/R8. Skipped by the owner: a static reduced-motion variant of the backdrop;
the asset-library defects found in T157.

- [X] T158 [US1] `cms.SectionGroup`: top-level container whose slot accepts only `cms.Section`;
  owns scheme, background and decorative layer painted once behind all its Sections (no seams),
  optional spacing; Sections inside inherit the group's scheme unless they set their own.
  `cms.Section` may be nested only in a group (editor guards updated). Anchor guard, hero
  first-block lookup, empty-Section collapse and presets look through a top-level group.
  **Result (2026-10-26):** **RED first:** new `cms-components/src/components/SectionGroup.test.tsx` (21, jsdom, built stylesheet + `brandTokensToCss` with a dark decorative asset) RED 21/21 (`cms.SectionGroup` undefined, `ROOT_ONLY_TYPES` `['cms.Section']`, no `SectionGroupFrame`, no stylesheet rules, guard kept a Section out of `g-1:content` and let other blocks in, five slots admitting the group); two expectations of my own corrected after the first green run, not the code: the "stored nested" cases asserted no `<section` at all, but `cms.Row` renders its own `<section>` (now: no `<section class="cmsc-section…">`). `Hero.test.tsx` +1 (RED `expected [] to deeply equal ['high','lazy']`), core `anchors.test.ts` +1 and mod-cms `anchor-guard.test.ts` +2 (RED: group and grouped Section anchors not read), contracts `page-builder-props.test.ts` +2 (RED: no `sectionGroupSettingsSchema`), admin `section-presets.test.tsx` +1 (RED: the preset went to the root, group still 2 Sections). `anchors.contract.test.ts` [PG] +1 written with the change (not seen RED). **Block:** `cms.SectionGroup` (`components/SectionGroupBlock.tsx`, exported `SectionGroup`; `withHideOn`): fields `scheme`, `background` (the Section's `createSectionBackgroundField`, so the admin's asset picker swaps in by field), `anchor`, `spaceTop`/`spaceBottom` (`createSectionSpaceField({ defaultValue: 'none' })`, Responsive tab, `SECTION_GROUP_RESPONSIVE_FIELDS`), slot `content` `allow: ['cms.Section']`; `defaultProps` `{ content: [] }`; registered after `cms.Section`; manifest `layout`, weight 6, `translatable: []`, `responsiveFields: ['spaceTop','spaceBottom']`; contracts `sectionGroupSettingsSchema` (scheme `inherit`, spacing `none`); types `SectionGroupBlockProps`. **Frame** (`Section.tsx` `SectionGroupFrame`): top level only (nested → children only) → `<div class="cmsc-section-group" id data-cmsb-scheme data-paint data-media data-decorative style="--cmsc-group-p(t|b)(-md|-lg)">` and, when it paints (scheme or own background), one `.cmsc-section-group__paint` (`aria-hidden`; `paintStyle` + the Section's media/overlay layer; video pair via `useBreakpointVideo`). The group box keeps the page container's width so each Section sizes itself as at the top level; the paint is `absolute`, `z-index: -1` in the group's isolated context, `left: calc(50% - 50vw); width: 100vw` (100 % in the Puck preview); the decorative layer is one cover image from the group's top (`[data-decorative='1'] > __paint`), scheme `--cmsb-bg`/`--cmsb-fg` with today's literals. **Sections inside:** a `SectionGroupContext` (scheme, paints, anchor); `SectionFrame` renders a Section at depth 1 inside a top-level group as a top-level Section with `data-in-group="1"`; scheme inheritance is the CSS variables' (an explicit Section scheme still wins); `data-transparent="1"` (→ `background-color: transparent`) only when the group paints, the Section has no own background (solid, gradient, image, video or `decorative`) and its scheme is unset or the group's — **decision:** a Section with another explicit scheme keeps its scheme's background (a light band in a dark group stays readable); a sign-up in an anchorless grouped Section returns to the group's anchor. A Section nested deeper (depth 2+) is still not a section. **Editor guards** (`page-builder-core` `puck-action-guards.ts`): `ROOT_ONLY_TYPES` += `cms.SectionGroup`; new `SECTION_GROUP_TYPE`, `SECTION_GROUP_CHILD_TYPES`, `isSectionGroupContentZone` (on `./editor`); insert/move into a group's `content` zone reverts anything but `cms.Section`, a root-only block elsewhere outside the root reverts; **defect found and fixed here:** a move's source type was read only from `data.zones`/root, so a move out of any slot zone (a Column out of a Row, a Section out of a group) was never checked — `getItemTypeAtZoneIndex` now falls back to the parent's slot prop. Slots: `SECTION_SLOT_DISALLOW`, `cms.Column`, `cms.Slide` and `PANEL_DISALLOW` add `cms.SectionGroup` (Row and Carousel `allow` lists already exclude it). **Anchors:** `anchor-guard.ts` and `collectAnchors` read a root group's `anchor` and each Section's in its slot (document order: group, then each Section's anchor followed by its headings); a nested group counts nothing. **Hero:** `useIsLeadBlock` depth 2 = first block of the first Section of a first root group. **Presets:** `SectionPresetsPanel` `insertionPoint` — with the selected block in a grouped Section, the preset Section goes into `<group>:content` after it; a selected group → after it at the root. **Overlap (recorded behaviour):** `.cmsc-pb-hide-on:first-child > .cmsc-section[data-in-group][data-overlap]:not(--tier) > __frame` restores the per-tier pull the first-block rule removes, so the first Section of a group pulls up over the block before the group (the group's own space above first); the first Section of a group that opens the page is not pulled; the pulled content paints above the previous block by document order, but a previous Section with its own overlap (`z-index: 1`) stays above it. **Empty collapse:** a grouped Section collapses by T148's rule (DOM unchanged, asserted); an empty published group (not `--tier`/`data-media`) drops its own padding — `:not(:has(…))` over its Sections' frames (no nested `:has()`), per tier counting Sections and blocks hidden there; a media Section or any non-Section in the slot counts as content. **Changed existing assertions (standing rule 13):** `SectionBlock.test.tsx` "every slot of every block refuses it" → "every slot of every block but a Section group's refuses it" (offenders `['cms.SectionGroup.content']`); admin `section-asset-input.test.tsx` "exactly one field … cms.Section's background" → two carriers (`cms.Section.background`, `cms.SectionGroup.background`); admin `page-builder-field-i18n.test.ts` T156 Column-order `it.each` also excludes `cms.SectionGroup` (top level only, never in a Column). Ledgers: `page-builder-field-i18n.test.ts` lists `cms.SectionGroup`; backend `frozen-block-renames-codomain.test.ts` `BORN_NAMESPACED` + `cms.SectionGroup` (derived, trap 3); mod-cms `block-declarations.test.ts` fixture (no prose) + a case translating a heading inside a grouped Section. Labels en+pl `blocks.sectionGroup.{label,description}` and `fields.{editorName,hideOn,scheme(+4 options),background,anchor,spaceTop,spaceBottom,content}.label` ("Grupa sekcji", "Sekcje"). Docs: `cms/index.md` block-table row, Section top-level paragraph, new "Section groups" section, anchors, presets; `brand.md` "Per section, or once for a group"; `extending-page-builder.md` § Sections (group, guards, `SectionGroupFrame`, lead lookup); Polish mirrored ("Grupy sekcji"), the three cache entries rewritten with `hashSourceBody()`; `contracts/blocks.md` new "`cms.SectionGroup`" section (+ Section slot `disallow`, "In a group"), `data-model.md` §3.4a, §4, §6; changeset `163-page-builder-section-group.md`. No new dependency; option-parity and fallback-parity unchanged and green.
  **Verification:** cms-components `SectionGroup`, `SectionBlock`, `Section`, `Hero`, `decorative-layer`, `fallback-parity`, `option-parity`, `section-adoption`, `Row`, `Column`, `Tabs`, `Accordion`, `motion`, `NewsletterSignupForm`, `rich-body-ssr` 15 files / 456 (fresh `dist/cms-components.css`, kept); page-builder-core `src/editor` + `section-field` 58; contracts `page-builder-props` 35; mod-cms whole package 27 / 312; admin `section-presets`, `page-builder-field-i18n`, `section-asset-input`, `link-field`, `section-settings-visibility`, `sidebar-field-layout`, `page-builder-i18n` 107; storefront `test/ssr` `blocks`, `block-ssr-floor`, `newsletter-signup`, `module-blocks` 38; backend unit `cms/frozen-block-renames-codomain`, `cms/hidden-drawer`, `_i18n` 13 files / 203; `[PG]` `test/contract/cms/anchors.contract.test.ts` 7/7 (a first run timed out in `beforeAll` while the test-database template was being built; the rerun passed); `check:block-names` declared=99 rendered=99 findings=0, `check:class-vocabulary` findings=0, `i18n:hardcoded` regressions=0 drained=0, `check:docs-translations` findings=0, `check:release-intent` violations=0; typecheck + lint clean for contracts, page-builder-core, cms-components, mod-cms; typecheck clean for admin, backend, storefront (eslint clean on the touched admin and backend test files); `pnpm run build:packages` exit 0. Not done: a browser check on the running instance (the `b2b` database is not written; T164 rebuilds the reference page with the group); translation contract `[PG]` not run (no translatable path changed: `translatable: []`).
- [X] T159 [US3] Column order per breakpoint inside a Row (on `cms.Column`, Row stays
  byte-identical to origin), so a whole column can move after another on mobile.
  **Result (2026-10-26):** **RED first:** `Column.test.tsx` new describe (6): RED 2/6 (`expected undefined to be 'select'` — no field; no `data-pb-order` on the cell); "unset carries nothing", "a non-order value is ignored", "the cell is a grid item read by the shared rule" and "the editor keeps the stored order" green from the start (guards); option-parity R9 case RED (`expected undefined to deeply equal { pageBuilder: { responsive: true } }`). **Implementation:** `cms.Column.stackOrder` — the T156 vocabulary and name (one concept, one name), labelled **Order in the row**, `PB_RESPONSIVE_METADATA`, a static field after `span`, in `responsiveFields` of `index.ts` and the cms manifest, not in `defaultProps`. page-builder-core now exports `createStackOrderField(label)` and `stackOrderAttributes(value)` (the helper `withHideOn` uses; its own field is built by the factory, unchanged). The published cell (`.cmsc-pb-row-col`, which already carries `cmsc-pb-hide-on`) gets `data-pb-order="1"` + `--pb-order(-md|-lg)` beside its span vars, read by the existing `.cmsc-pb-hide-on[data-pb-order]` rule as the grid item's `order` — **no stylesheet change**. Unset or `auto` everywhere: the cell's markup is unchanged. **Editor (decision):** the canvas writes no order, so dragging a column matches the outline (as T156). **DOM/focus order note:** visual only — DOM, reading and Tab order stay the stored order (WCAG 1.3.2/2.4.3); in the docs, `contracts/blocks.md` § R9 and `data-model.md`. `cms.Row` byte-identical to `origin/master` (`git diff origin/master -- Row.tsx` empty). Labels en+pl `blocks.column.fields.stackOrder.*` ("Order in the row" / "Kolejność w wierszu", options as the blocks'). `block-declarations.test.ts` Column fixture already carries `stackOrder` through the shared `box` (non-prose). `fallback-parity.test.tsx` R9 case (unset `order` 0; an ordered column 99 in a grid) written after the change, not seen RED.
- [X] T160 [US3] MediaText feature titles: size (token or px, per breakpoint) and weight, today's
  16 px / 600 by default.
  **Result (2026-10-26):** **RED first:** `MediaText.test.tsx` new describe (6): RED 5/6 (no `__feature-title-text` span — `expected [ undefined, undefined ] to deeply equal [ 'Fast', 'Second' ]` —, no `featureTitleSizePx`, no rule); "nothing chosen" green (guard); option-parity R9 case RED. **Implementation:** block-level `featureTitleSize` (`sizeFieldWithDefault`, responsive) + `featureTitleSizePx` (shown by `resolveFields` only once a tier is Custom) + `featureTitleWeight` (`textWeightField`), after `features`, applied to the items of every row; types on `MediaTextProps`. The title text goes through the shared `ItemText` (T144/T151) as `span.cmsc-pb-media-text__feature-title-text` inside the unchanged `h3` (token class, fallback token `body` for a tier left on Default among chosen ones; `--pb-text-size*` published, the previewed tier's inline size in the editor; inline weight); CSS `.cmsc-pb-media-text__feature-title-text { display: block; }`. Nothing chosen: no span, today's 16 px / 600 markup. `responsiveFields` (`featureTitleSize(Px)`) in `index.ts` and the cms manifest. Labels en+pl (`blocks.mediaText.fields.featureTitleSize.*`, `featureTitleSizePx.label`, `featureTitleWeight.*`, "Item title …" / "… tytułu elementu"). `block-declarations.test.ts` MediaText fixture carries the three as non-prose (green with the change; not run before it). `fallback-parity.test.tsx` R9 case (unset 16 px/600, no span; Custom 20 + weight 400 reach the span) written after the stylesheet, not seen RED.
- [X] T161 [US4] Carousel filter bar on narrow screens: `wrap` (today) or one scrolling line, as
  T155 did for Tabs.
  **Result (2026-10-26):** **RED first:** `carousel/carousel-filter.test.tsx` new describe (5): RED 4/5 (class, `carouselFilterFromProps` dropping it, no `scrollIntoView`, no rules); "the keys still move the focus" green (guard); option-parity R9 case RED. **Implementation:** `filter.overflow: 'wrap' | 'scroll'` (radio "Buttons that do not fit", after `filter.align`, unset by default); `carouselFilterFromProps` passes known values only; `filterBarClassName(style, align, overflow)` adds `cmsc-pb-carousel__filter--scroll`; `CarouselFilterBar` takes `overflow` and, scrolling, brings a button pressed with the pointer into view (`scrollIntoView({block: 'nearest', inline: 'nearest'})`); `CarouselShell` passes it. Toolbar, `aria-pressed`, roving tab stop and keys unchanged. CSS (T155's pattern): `flex-wrap: nowrap; max-width: 100%; overflow: auto hidden; overscroll-behavior-x: contain; scroll-snap-type: x proximity`, buttons `flex-shrink: 0; white-space: nowrap; scroll-snap-align: start`, focus ring inside (`outline-offset: -2px`), centre/end alignment by auto margins (no unreachable start), underlined: the bar line an inset shadow and no −1 px button overlap. **Changed existing assertion (standing rule 13):** `ContentSlider.test.tsx` "shows the filter bar…" — `filter`'s object field keys now end with `'overflow'`. Labels en+pl `blocks.contentSlider.fields.filter.fields.overflow.*`. `block-declarations.test.ts` ContentSlider fixture carries it as non-prose. `fallback-parity.test.tsx` R9 case (unset wraps; scroll one line, underline inset line, no overlap) written after the stylesheet, not seen RED.
- [X] T162 [US2] A separate poster for the mobile video (asset or URL) on `cms.Video` (file),
  Hero and MediaText video media.
  **Result (2026-10-26):** **RED first:** `Video.test.tsx` +4 (RED 3/4; "no mobile poster" green, guard), `Hero.test.tsx` +3 (RED 2/3; "no mobile poster" guard), `MediaText.test.tsx` +5 (RED 3/5; "no mobile poster" and "equal to the poster" guards), option-parity R9 case, admin `hero-fields.test.tsx` +1, `section-block-fields.test.tsx` +1 (StrictMode, RED: no "Mobile poster image"), `video-image-fields.test.tsx` (extended: `mobilePosterAssetId` a picker — RED `expected 'text' to be 'custom'`). **Implementation:** `mobilePosterAssetId` + `mobilePosterUrl` on `cms.Video` (file source only; `resolveFields` drops them for an embed), `cms.Hero` `media`, `cms.MediaText` `media` (and `rows[].media`, `cms.CarouselSplit` through the shared field and frame); the library image wins, a relative URL is made absolute against the media origin; unset → the poster. The mobile video of a pair takes it; one video with a mobile poster different from the poster renders the pair of the same file (`data-bp="mobile"|"desktop"`, each `preload="none"`, so nothing loads twice) and the existing per-breakpoint display rules pick one; equal to the poster → today's single video. **Admin:** `HeroFields` and `SectionBlockFields` show a **Mobile poster image** picker and a **Mobile poster URL** input whatever the video source (the poster is library-only, so the mobile poster does not follow `videoSource`); `PageBuilderEditor` gives `cms.Video.mobilePosterAssetId` the library picker. Labels en+pl (`blocks.{hero,mediaText}.fields.media.fields.mobilePoster{AssetId,Url}.label`, `blocks.video.fields.mobilePoster{AssetId,Url}.label`). `block-declarations.test.ts` Video, Hero media and MediaText row media fixtures carry them as non-prose. `fallback-parity.test.tsx` R9 case (one video + mobile poster: mobile shown below the tablet tier) written after, not seen RED.

  **R9 (T159–T162) verification (2026-10-26):** cms-components whole package 66 files / 1052 green (fresh `dist/cms-components.css`, kept); page-builder-core `src/visibility` 12; mod-cms whole package 27 / 312 (incl. `block-declarations.test.ts` 51); admin `hero-fields`, `section-block-fields`, `video-image-fields`, `page-builder-field-i18n`, `page-builder-i18n`, `sidebar-field-layout` 6 / 100; storefront `test/ssr` `blocks`, `block-ssr-floor`, `carousel-labels`, `catalog-blocks` 39; backend unit `_i18n`, `cms/hidden-drawer`, `cms/frozen-block-renames-codomain`, `blog/block-declarations` 14 / 208; `check:block-names` declared=99 rendered=99 findings=0, `check:class-vocabulary` findings=0, `i18n:hardcoded` regressions=0 drained=0, `check:docs-translations` findings=0, `check:release-intent` violations=0; typecheck + lint clean for page-builder-core, mod-cms, admin, storefront (typecheck) and cms-components except T158's `SectionGroup.test.tsx:5` (`'createElement' is declared but its value is never read`, not R9's); `pnpm run build:packages` exit 0. Docs: `cms/index.md` (Column, Hero, MediaText, Video rows; the carousel Filter row and filter paragraph; "Columns: distribution and order" + a column-order paragraph), Polish mirrored, cache rewritten with `hashSourceBody()`; `contracts/blocks.md` § R9, `data-model.md` §4; changeset `163-page-builder-column-order-item-titles-filter-scroll-mobile-poster.md`. Not done: a browser check on the running instance (the `b2b` database is not written by these tasks; T164 rebuilds the reference page).
- [X] T163 [US4] Cosmetic options: Tabs pill size per breakpoint; carousel arrow icon (chevron or
  arrow); an inline icon in inline rich text (headings, captions) from the icon catalog; rich-text
  headings follow the brand type scale; product card look options only if a generic, small
  addition covers it (record otherwise).
  **Result (2026-10-26):** **RED first:** `Tabs.test.tsx` new describe (5) RED 5/5 (no `tabSize` field, classes, `resolveData` move or `-md-`/`-lg-` rules); option-parity new describe "R9 tab size per breakpoint and the carousel arrow icon (T163)" (Tabs fields and `controls` sub-fields before T163 as literals) RED 4/4 (`expected undefined to deeply equal { pageBuilder: { responsive: true } }`, `Cannot read properties of undefined (reading 'options')`); `CarouselShell.test.tsx` +3 RED 2/3 (the unset/chevron case green from the start, a guard); `InlineRich.test.tsx` +4 RED 3/4 (unknown name renders nothing: green, a guard); `rich-content-extensions.test.ts` +1 RED (no `inlineIconNode`); `brand-css.test.ts` +3 RED 3/3; contracts `page-builder-props.test.ts` +3 (written before the schema change; not run RED separately); admin `inline-rich-text-field.test.tsx` +2 (written first, not run before the implementation). **(a) Tab size:** top-level `cms.Tabs.tabSize: Responsive<'s'|'m'|'l'>` (`PB_RESPONSIVE_METADATA`, in `responsiveFields` of the registry and the cms manifest), unset by default; it replaces `tabStyle.size` in the editor (one control per concept, every value kept); a stored `tabStyle.size` still renders while `tabSize` is unset and `resolveData` moves it (`tabSizeMoved`). The phone's size writes T132's `--size-s|l` (none for medium); a tablet/desktop size that differs from the tier below adds `cmsc-pb-tabs--size-md-*`/`--size-lg-*` (13/14/16 px, the pill capsule's 24/28 px radius in `@media` 768/1024); one size everywhere = T132's markup byte for byte; the editor writes its previewed tier's class. **(b) Arrow icon:** `controls.arrowIcon: 'chevron'|'arrow'` in the shared `CAROUSEL_TRACK_FIELDS` (Carousel, `catalog.ProductSlider`, `blog.LatestPosts`), `CarouselShell.arrowIcon`; `arrow` = the catalog's `arrowLeft`/`arrowRight` inline SVG (`aria-hidden`, `focusable="false"`, `.cmsc-pb-carousel__arrow-icon` 0.8 em); button, name, classes and the T129/T147 look unchanged; `carouselShellOptions` passes it only for `arrow`. **(c) Inline icon:** contracts `inlineRichNodeSchema` + `{type:'inlineIcon', attrs:{name}, marks?}` (`INLINE_ICON_NAME_RE`, additive); `inlineRichTextToPlain` drops it (it mapped every non-text node to `\n`). `InlineRich` renders `resolveCmsIcon(name)` as `1em` SVG `.cmsc-inline-icon` (`aria-hidden`, `focusable="false"`) inside the node's marks, nothing for an unknown name, not counted by the word reveal. `rich-content-shared.ts` `inlineIconNode` (inline atom; HTML `<span class="cmsc-inline-icon" data-cms-icon aria-hidden="true">`, parsed back): `tiptap-html.ts` writes it exactly as `generateHTML` does (no serializer change). Inline editor: the node with a React node view, toolbar **Insert icon** → a searchable catalog grid dialog (English toolbar, as Bold/Italic/highlights are). CSS: `vertical-align: -0.125em`; in a gradient emphasis the icon takes `var(--cmsb-link, #1261a6)`. Translation: no codec change — the codec already carries any other inline node as one `<n/>`; guarded by `tiptap-inline-codec.test.ts` +4 and `extract.test.ts` +2 (green from the start). **(d) Rich-text headings:** `brandTokensToCss` writes, per heading level whose type style is set, `.cmsc-pb-rich-content hN, .cmsc-pb-rich hN, .cmsc-pb-hero__body hN, .cmsc-pb-feature-list__body hN {font-size/line-height/font-weight/letter-spacing: var(--cmsb-t-hN-*)}` (numeric parts only). **Not a stylesheet rule with literal fallbacks (standing rule 9 read through):** a rich body's headings have no single look of today — they take the host's heading styles (the storefront theme's base `h1`–`h3` 30/22/16 px 600, else the browser's), which an unlayered fallback would override; no brand → no rule → unchanged. `cms.RichContent`'s own 32/26/22/18 px utilities stay the no-brand look. **(e) Product card look: not built** — the rebuild's differences are a "+" glyph (the card link label already takes any text), a rule under each card and a tagline text (data; `cardTextLine: 'summary'` shows it); a border/divider axis on four card styles of two listings would serve one site's look (plan § *Extend, don't narrow* rule 4). **Changed existing assertions (standing rule 13):** `Tabs.test.tsx` T132 "offers the bar's background …" (`tabStyle.objectFields` without `size`; the s/m/l options read from `tabSize`); `option-parity.test.ts` R5 Tabs case path `'tabStyle.size'` → `'tabSize'` (+ its options `['s','m','l']`). i18n: `blocks.tabs.fields.tabStyle.fields.size.*` keys replaced by `blocks.tabs.fields.tabSize.*`; `…controls.fields.arrowIcon.*` en+pl in the cms, catalog and blog bundles. Fixtures: `block-declarations.test.ts` Tabs `tabSize`, Carousel `controls.arrowIcon` as non-prose. `fallback-parity.test.tsx` R9 (T163) +4 (tabs 14 px / small 13 px, the 20 px chevron glyph and the 0.8 em arrow, the inline icon's line and gradient colour, RichContent's built heading utilities and no rich-body heading size in the sheet; written after the stylesheet). **Verification:** cms-components whole package 66 files / 1052 green; contracts `page-builder-props` 35; admin `inline-rich-text-field`, `heading-inline-canvas`, `page-builder-field-i18n`, `page-builder-i18n`, `carousel-fields` 88; mod-cms translation `block-declarations`, `extract`, `tiptap-inline-codec` 81; storefront `test/ssr/blocks`, `block-ssr-floor`, `carousel-labels` 23; `rich-body-ssr` 15; backend unit `_i18n`, `blog/block-declarations`, `cms/hidden-drawer`, `cms/frozen-block-renames-codomain` 208; `check:block-names` findings=0, `check:class-vocabulary` findings=0, `i18n:hardcoded` regressions=0 drained=0, `check:docs-translations` findings=0, `check:release-intent` violations=0; typecheck clean for contracts, page-builder-core, mod-cms, mod-catalog, mod-blog, admin, storefront, and cms-components except T158's `SectionGroup.test.tsx(5,1)` unused `createElement` (also its one lint error); `pnpm run build:packages` exit 0, `dist/cms-components.css` rebuilt and kept. Translation contract `[PG]` not run: the codec did not change. Docs: `cms/index.md` (Heading, RichContent, Tabs rows; **Arrow icon** row; new "Icons in headings and captions" and "Rich-text headings and the type scale"; tab size per breakpoint), `cms/brand.md` (Typography row, the rich-heading rule), Polish mirrored, both cache entries rewritten with `hashSourceBody()`; `contracts/blocks.md` § "R9: cosmetic options (T163)", `data-model.md` §2, §3.5, §4. Changeset `163-page-builder-tab-size-arrow-icon-inline-icon-rich-headings.md`. Not done: a browser check on the running instance (no page with these options locally; `b2b` not written).
- [X] T164 Rebuild the local reference page with the group and the R9 options (local only, never
  committed); refresh `home-gaps.md`.
  **Result (2026-10-26):** The local rebuild script (git-excluded) wraps each run of adjacent dark Sections in one `cms.SectionGroup` (dark scheme, `decorative` on); the grouped Sections drop their own scheme and background. The result is 4 groups and 9 grouped Sections, each with `data-transparent="1"`, and the two image-only bands are inside the groups too. It also applies the R9 options: an audience-panel Column `stackOrder: {base: 'last'}`, MediaText `featureTitleSize: {base: 'h4'}` + `featureTitleWeight: 400`, `filter.overflow: 'scroll'`, a Hero `mobilePosterAssetId`, `tabSize` s/m/l, `controls.arrowIcon: 'arrow'` on three carousels, and one `inlineIcon`. Rich-body headings follow the existing brand type scale, with no brand change. **Checked on the running instance:** HTTP 200 with no missing-block markup, and the rich bodies are in the server HTML. `diag` at 375/768/1440 (3 loads each) shows `scrollWidth` equal to the viewport and no hydration warning; the only console error is the favicon 404. The paint layer spans each group (the window's width, the group's height) and the shots show no seam at the Section boundaries inside a group. Probe values: feature titles and the rich h4 at 24/32 px / 400; tabs 13/14/16 px; the filter on one scrolling line at 375; the social-proof Column last when stacked; the mobile video with its own poster. **Remaining gaps (generic):** a Column cannot be kept inside another column's track on desktop and moved to the panel's end on mobile, so the desktop proof sits one grid row lower; an inline icon has no size (1 em, so 100 px in a display heading); the decorative layer is one `cover` image, so it stretches over a tall group; there is no static backdrop for reduced motion. **No defect found in T158–T163.** One observation: an unset group still writes its six spacing variables (`var(--cmsb-space-none)`). Screenshots and the per-section gap list are in the local, git-excluded rebuild folder.

### R10. Gaps after the fifth rebuild (owner request 2026-10-26)

Same rules as R5–R9. Skipped by the owner: a static reduced-motion backdrop.

- [X] T165 [US3] Column grid placement per breakpoint inside a Row: a Column can span rows and be
  placed at an explicit column/row start (Responsive tab), so a layout like "side column with a
  bottom item, two tall columns" on desktop can stack in another order on mobile without
  duplicating content. `cms.Row` stays byte-identical to origin (placement lives on the Column
  and in CSS); visual order only, DOM/focus order unchanged and documented.
  **Result (2026-10-26):** **RED first:** `Column.test.tsx` new describe (7) RED 5/7 (no `rowSpan`/`columnStart`/`rowStart` fields, no `data-pb-place`/vars on the cells, no stylesheet rules; "unset carries nothing" and "the editor canvas writes no placement" green from the start, guards); option-parity new describe "R10 column placement in the row grid (T165)" (Column fields, `stackOrder` and `distribute` options before R10 as literals) RED (`rowSpan: expected undefined to deeply equal { pageBuilder: { responsive: true } }`); new jsdom `column-placement.test.tsx` (5) — the owner's layout laid out from the **built** stylesheet (layers unwrapped, the tier's `min-width` queries applied, `var()` substituted) and the server HTML with CSS Grid auto-placement (sparse or dense from the computed `grid-auto-flow`) — RED 2/5 (`expected 'row' to be 'row dense'`, B one row high); the stacked mobile/tablet cases and "a Row with no placed column keeps today's flow" green from the start (guards); admin `page-builder-field-i18n.test.ts` +1 (Column order and placement fields in Polish) RED on the stale `dist` (`rowSpan: expected undefined to be defined`). **Fields** (`cms.Column`, Responsive tab, `PB_RESPONSIVE_METADATA`, after `stackOrder`, none in `defaultProps`; in `responsiveFields` of `index.ts` and the cms manifest): `rowSpan` **Height in rows** `1`–`4` (numbers, as `span`), `columnStart` **Start at column** `'auto' | '1'–'12'`, `rowStart` **Start at row** `'auto' | '1'–'4'` (strings, as `stackOrder`); types `ColumnRowSpan`, `ColumnTrackStart`, `ColumnRowStart`. **Markup:** the published cell gets `data-pb-place="1"` and `--pb-col-start(-md|-lg)`, `--pb-row-start(-md|-lg)`, `--pb-row-span(-md|-lg)` beside its span vars only when some tier is not 1 row / `auto`; a missing or unreadable tier inherits the one below; **decision:** a column start that would run past track 12 at that tier's span is clamped to `13 − span` (no implicit tracks). Unset: byte-identical markup (asserted against the plain render). **CSS:** `.cmsc-pb-row-col[data-pb-place] { grid-column: var(--pb-col-start, auto) / span var(--pb-col-span, 12); grid-row: var(--pb-row-start, auto) / span var(--pb-row-span, 1) }` + `-md`/`-lg` in the 768/1024 px queries; `.cmsc-pb-row-cols:has(> .cmsc-pb-row-col[data-pb-place], > * > .cmsc-pb-row-col[data-pb-place]) { grid-auto-flow: row dense }` (published markup is `row-cols > div > row-col`; a Row nested in a column is not reached). **Layout proven:** four columns `span {base 12, desktop 4}`, B and C `rowSpan {desktop 2}`, D `columnStart {desktop '1'}` (+ optional `rowStart {desktop '2'}`) → desktop A (1,1), B (5,1–2), C (9,1–2), D (1,2); 375/800 px A, B, C, D stacked in the stored order; nothing duplicated. **Editor (decision, as T159):** the canvas writes no placement (only its tier's span), so dragging matches the outline. **DOM/focus order note:** visual only — documented in `cms/index.md` § "Columns: placement in the row's grid", `contracts/blocks.md` § R10, `data-model.md` §4. `cms.Row` byte-identical to `origin/master` (`git diff origin/master -- Row.tsx` empty). Labels en+pl `blocks.column.fields.{rowSpan,columnStart,rowStart}.*` ("Wysokość w wierszach", "Początek w kolumnie", "Początek w wierszu", "Następne wolne miejsce"). `block-declarations.test.ts` Column fixture gains the three as non-prose. `fallback-parity.test.tsx` unchanged (green). No existing assertion changed; no new dependency. **Verification:** cms-components whole package 68 files / 1126 green (fresh `dist/cms-components.css`, kept); mod-cms whole package 27 / 314; admin `page-builder-field-i18n`, `page-builder-i18n` 69; storefront `test/ssr` `blocks`, `block-ssr-floor` 19; backend unit `_i18n`, `cms/hidden-drawer`, `cms/frozen-block-renames-codomain` 13 / 203; `check:block-names` declared=99 rendered=99 findings=0, `check:class-vocabulary` findings=0, `i18n:hardcoded` regressions=0 drained=0, `check:docs-translations` findings=0, `check:release-intent` violations=0; typecheck + lint clean for mod-cms and admin (typecheck), cms-components lint clean on the touched files, its typecheck red only on T167's `option-parity.test.ts(2472,17)` TS2352 (not T165's); `pnpm run build:packages` exit 0. Docs: `cms/index.md` Column row + new section, Polish mirrored ("Kolumny: miejsce w siatce wiersza"), cache rewritten with `hashSourceBody()`; changeset `163-page-builder-column-grid-placement.md`. Not done: a browser check on the running instance (T169 rebuilds the reference page).
- [X] T166 [US1] Inline icon in inline rich text: size (em or px) and vertical offset attributes,
  editable in the icon dialog, serialized server-side identically.
  **Result (2026-10-26):** **RED first:** contracts `page-builder-props.test.ts` +3 (accept `size` `'0.5em'`–`'3em'` / `'8px'`–`'200px'` and `offset` −1–1, unchanged; read `null` as unset; refuse `0.4em`, `3.1em`, `7px`, `201px`, `1rem`, `50%`, `1.5px`, an offset of ±1.01/1.5/NaN/`'0.2'`) RED 2/3 (the size/offset keys were stripped; the `null` case green from the start, a guard); `InlineRich.test.tsx` +3 RED 2/3 (the unset/null/out-of-grammar byte-for-byte case green, a guard); `rich-content-extensions.test.ts` +1 RED (both serializers, read back, out-of-grammar dropped). **Contracts:** `page-builder-values.ts` gains `INLINE_ICON_NAME_RE` (moved from `page-builder-props.ts`, still re-exported), `INLINE_ICON_SIZE_RE`, `INLINE_ICON_SIZE_EM`/`_PX`, `INLINE_ICON_OFFSET_EM`, `isInlineIconSize`, `isInlineIconOffset` (re-exported by `page-builder-core`); the node's attrs take `size`/`offset`, each `.nullable().optional()` (additive). **Render:** `InlineRich` `inlineIconPresentation(attrs)` (exported) → `size` as the SVG's `width`/`height` (`1em` unset) and `style="vertical-align:<offset>em"` (positive raises; unset = the stylesheet's `-0.125em`); anything outside the grammar ignored, so a `{name}` icon is T163's markup byte for byte. **Node:** `inlineIconNode` `size`/`offset` attributes with `default: undefined` (decision: not `null`, so a document's JSON stays `{name}` and T163's existing `toEqual` assertions hold unchanged), written as `data-cms-icon-size`/`data-cms-icon-offset` and parsed back with the same checks; `generateHTML` and `tiptap-html.ts` write them identically (no serializer change). **Editor:** the node view draws through `inlineIconPresentation`; the icon dialog gains **Icon size** (text size 1 em / em / px + its number, clamped into range: em to hundredths, px whole) and **Vertical offset (em)** (empty = default, clamped −1–1) above the grid; picking an icon inserts it with them; with an icon selected (node selection) the toolbar button reads **Edit icon** (`aria-pressed`), the dialog opens on its values with the icon marked, **Apply** keeps the name and writes size/offset (`updateAttributes`; an emptied value returns to the default), picking another icon replaces it. **Labels:** the whole icon dialog and its toolbar button now read the page builder's field text (`useFieldText`, keys `inlineIcon.*` in `page-builder-core` `field-text.tsx`; en+pl `pageBuilder.fieldText.inlineIcon.*` in the `_i18n` bundles: "Wstaw ikonę", "Edytuj ikonę", "Rozmiar ikony", "Przesunięcie w pionie (em)", …) — the rest of that toolbar (Bold, Italic, Link, highlights) stays English as before. Admin `inline-rich-text-field.test.tsx` +4 (text size first so an untouched insert is today's `{name}`; em size + offset inserted, schema-valid, drawn so in the editor; px/offset clamped; edit a selected icon via ArrowRight → **Edit icon** → **Apply**) — written with the dialog, not run before it. Translation: no codec change (atomic `<n/>`, attributes travel); `tiptap-inline-codec.test.ts` +2 (no name/size/offset in the segment; restored with both) green from the start (guards). `fallback-parity.test.tsx` R10 (T166) +1 (unset 1 em / `-0.125em`; a sized icon 0.5 em, `vertical-align: 0.4em`, `inline-block`) written after the implementation. No existing assertion changed. **Note for T169:** the gap's ~0.3 em sparkle is below the 0.5 em floor set for this task; `'0.5em'` or a px size (one value for every breakpoint) is the closest — widening the floor is an owner call. Verification: see T167.
- [X] T167 [US1] Decorative layer and image backgrounds of Section and Section group: size
  (cover, contain, auto, px or %), repeat and position options, so a tall group keeps the
  backdrop sharp; today's `cover` by default.
  **Result (2026-10-26):** **RED first:** option-parity new describe "R10 background size, repeat and position on a Section and a Section group (T167)" (the background field rendered on the server; kinds and image focal options before T167 as literals; new Image size/repeat and Backdrop size/repeat/position with today's value selected) RED 4/4 (`expected null to deeply equal { options: [ 'cover', … ] }`); contracts `page-builder-props.test.ts` new describe (4) RED 3/4 (the "stored before T167 unchanged" case green, a guard); `Section.test.tsx` new describe (8) RED 6/8 (unset and ignored-values cases green, guards); `decorative-layer.test.tsx` +3 RED 2/3 (the unset group case green, a guard). **Contracts:** `BACKGROUND_SIZE_KEYWORDS`, `BACKGROUND_REPEATS`, `BACKGROUND_SIZE_PX_MAX` (4000), `BACKGROUND_SIZE_PERCENT_MAX` (400), `backgroundSizeToCss`, `isBackgroundRepeat` (`page-builder-values.ts`, re-exported by `page-builder-core`); `backgroundSizeSchema` (`'cover'|'contain'|'auto'|{px: int 1–4000}|{percent: 1–400}`), `backgroundRepeatSchema`; `sectionBackgroundSchema` += `size`, `repeat` (image) and `decorativeSize`, `decorativeRepeat`, `decorativePosition` (`FocalToken`) — the layer's layout lives in the Section/SectionGroup background value beside `decorative`, not in brand tokens. **Render** (`Section.tsx`, shared by `SectionFrame` and `SectionGroupFrame`): the decorative values are written inline (`background-size`/`-repeat`/`-position`, focal `top` → `top center`) on the `<section>` or the group's `__paint`, only with `decorative` on and a valid value — unset nothing, so the stylesheet's `cover`/`top center`/`no-repeat` holds (no stylesheet change for the layer); over a gradient each is a two-layer list followed by the gradient's today values (`720px, cover`, …). Image: unset/`cover`/`contain` without a repeat stays the `<picture>` (`object-fit` `contain` for contain; unset byte for byte); `auto`, px, % or any repeat → one `<div class="cmsc-section__tile">` in the media layer (overlay above it unchanged) with `--cmsc-tile-image: url("…")` (quoted, `"`/`\` escaped, line breaks dropped), `--cmsc-tile-image-mobile` when the mobile image differs, and inline size/repeat/position; nothing when no image is named. **CSS:** `.cmsc-section__tile { position: absolute; inset: 0; background-image: var(--cmsc-tile-image, none) }`, below 768 px the mobile variable — a px/% size is the same at every breakpoint (no query rewrites it). **Editor** (`page-builder-core` `section-field.tsx`): under an image **Image size** (Cover / Contain / Natural size / Width (px) / Width (%) + its number) and **Image repeat** (No repeat / Tile / Repeat across / Repeat down); under the switched-on decorative toggle **Backdrop size**, **Backdrop repeat**, **Backdrop position** (top first selected); `cover`, `no-repeat` and `top` are stored as nothing; switching the toggle off clears the three. Labels en+pl `pageBuilder.fieldText.section.{imageSize,imageRepeat,decorativeSize,decorativeRepeat,decorativePosition,size.*,sizePx,sizePercent,repeat.*}` ("Rozmiar obrazu", "Wypełnij (z przycięciem)", "Powtarzaj w pionie", "Położenie tła dekoracyjnego", …). `section-field.test.tsx` +2 (written after the field). `fallback-parity.test.tsx` R10 (T167) +2 (untouched image = cover picture, no tile; untouched dark decorative Section with no brand paints `none`, `cover`, `no-repeat`; a tile fills the media layer at 240 px, `repeat`) written after the stylesheet. No existing assertion changed; no new dependency. **Docs:** `cms/index.md` Section Background row + "Icons in headings and captions" (size, offset, Edit icon), `cms/brand.md` § The decorative backdrop (where size/repeat/position live) + For engineers, `extending-page-builder.md` (`.cmsc-section__tile`, the inline decorative values); Polish mirrored (Polish labels), all three cache entries rewritten with `hashSourceBody()`. `contracts/blocks.md` § "R10: inline icon size and offset, background size, repeat and position (T166, T167)", `data-model.md` §3.4, §3.5, §4. Changeset `163-page-builder-inline-icon-size-background-size-repeat.md` (contracts, page-builder-core, cms-components minor; mod-cms, mod-i18n patch). **T166 + T167 verification:** contracts `page-builder-props` 42; page-builder-core `section-field` 18; cms-components whole package 68 files / 1126 green (after T165/T168 landed; fresh `dist/cms-components.css`, kept), `rich-body-ssr` included; admin `inline-rich-text-field`, `sidebar-field-layout` (every field-text key in en+pl), `page-builder-field-i18n`, `page-builder-i18n`, `section-asset-input`, `heading-inline-canvas`, `section-presets` 112; storefront `test/ssr` `blocks`, `block-ssr-floor` 19; mod-cms translation `extract`, `tiptap-inline-codec`, `block-declarations` 83; mod-i18n 6; backend unit `_i18n` `registered-bundles-shape`, `package-bundle-reconcile`, `translation-proof`, `bundle-loader` 86; `check:block-names` declared=99 rendered=99 findings=0, `check:class-vocabulary` findings=0, `i18n:hardcoded` regressions=0 drained=0, `check:docs-translations` findings=0, `check:release-intent` violations=0; typecheck + lint clean for contracts, page-builder-core, cms-components (the T165 note's `option-parity.test.ts(2472,17)` TS2352 was this task's, fixed), mod-cms, admin, storefront (storefront lint: pre-existing `no-img-element` warnings only); `pnpm run build:packages` exit 0. Translation contract `[PG]` not run: no translatable path changed. Not done: a browser check on the running instance (`b2b` not written; T169 rebuilds the reference page).
- [X] T168 [US6] Small generic look options: product card image box background and a divider
  under the card (catalog listings); rich-text "read more" summary style (text or a bare
  chevron); a button that spans the full width per breakpoint (`cms.Button` and button lists).
  **Result (2026-10-26):** **RED first:** option-parity new describe "R10 card image box and divider, full-width buttons (T168)" (the top-level fields of both listings, `cms.Button`, Hero, MediaText, CtaCard, BackgroundPanel and CarouselSplit before T168 as literals, and the nine `ButtonSpec` keys) RED 8/8 (`expected [ …, 'buttons', … ] to deeply equal ArrayContaining [ …, 'buttonsFullWidth' ]`); `CmsProductCard.test.ts` +3 RED 2/3 (the unset case green from the start, a guard); `catalog/product-listing-parts.test.tsx` +4 RED 2/4 (unset green, guards); `rich-content-extensions.test.ts` +2 RED 1/2 (`text`/unset/unknown green, a guard); new `button-full-width.test.tsx` (16) RED on the missing module. **(a) Card look:** `cardImageBackground` (`createColorField`), `cardDivider` (`'none' | 'line'`) and `cardDividerColor` (shown by `resolveFields` only with a line, `withoutUnusedCardFields`) in `PRODUCT_LISTING_CARD_FIELDS` after `cardTitleWeight`, unset by default, handed to every card by `listingCardLook`; `CmsProductCardView` `imageBackground` (strict `colorValueToCss` → the media link's inline `background`), `divider`/`dividerColor` (`cmsc-pb-product-card--divider` + `--pb-card-divider`) on all four card styles. CSS: `border-bottom: 1px solid var(--pb-card-divider, var(--cmsb-border, var(--cmsb-n-200, #e2e8f0)))`, also under `[data-cmsb-scheme]` (T139's border recolour), showcase `padding-bottom: 16px`. This reverses T163 (e) for the image box and the divider only (owner request R10); the "+" glyph and the tagline stay data. **(b) Chevron read-more:** `readMore.attrs.summaryStyle: 'text' | 'chevron'` (default `text`, unknown → `text`) → `class="cmsc-read-more cmsc-read-more--chevron"` on the `<details>`, parsed back from the class; `generateHTML` and the DOM-free `tiptap-html.ts` write it identically (no serializer change); **sanitiser unchanged** (`class` already global). The summary keeps its text (the accessible name): `details.cmsc-read-more--chevron > summary` is a 44 px block, no marker, text pushed out (`text-indent: 100%`, `overflow: hidden`, `nowrap`), a drawn `::after` chevron in `currentColor` turned when `[open]` (no transition under reduced motion); focus ring unchanged. Editor: the node view marks `data-summary-style` (summary stays visible and editable) and the toolbar gains **Read more as a chevron** (English, as the rest of that toolbar; `i18n:hardcoded` regressions=0). **(c) Full width:** new `button-full-width.ts` (`buttonWidthField`, `buttonWidthClasses`): `cms.Button.fullWidth` (top level, after `align`) and a block-level `buttonsFullWidth` after `buttons` on Hero, MediaText (every row), CtaCard, BackgroundPanel and CarouselSplit — `Responsive<'auto' | 'full'>`, `PB_RESPONSIVE_METADATA`, in `responsiveFields` of `index.ts` and the cms manifest; nothing inside `ButtonSpec`. Page: the phone's class (`cmsc-btn--full` / `cmsc-btn-list--full`) and `--md-*`/`--lg-*` where a tier differs (768/1024 px rules); editor: the previewed tier's only. `ButtonRow` takes `fullWidth`; the Hero's actions row the same classes. CSS: a full button `display: flex; width: 100%`, a full list `flex-direction: column; align-items: stretch`. Types `ButtonWidth`, `ButtonListWidthProps`, `ProductCardDivider` (`component-types.ts`). Labels en+pl: cms `blocks.button.fields.fullWidth.*`, `blocks.{hero,mediaText,backgroundPanel,ctaCard,carouselSplit}.fields.buttonsFullWidth.*`; catalog `blocks.{productGrid,productSlider}.fields.{cardImageBackground,cardDivider,cardDividerColor}.*`. Fixtures: `block-declarations.test.ts` Button `fullWidth` and the five lists' `buttonsFullWidth` as non-prose (green with the change; not run before it). `fallback-parity.test.tsx` R10 (T168) +4 (card media `#f8fafc`/showcase `#f1f5f9` unset and a chosen colour; today's card border rules and the divider rule read from the built sheet — jsdom keeps a `var()` in a border shorthand unexpanded —, 16 px showcase padding; today's summary `list-item`/primary/600 and the chevron's 44 px clipped box; buttons `inline-flex` unset, `flex`/100 % full, a full list a stretched column) and `rich-body-ssr.test.tsx` +1 (a chevron passage, summary text and content in the server HTML) — both written after the stylesheet/implementation, not seen RED. No existing assertion changed. **Verification:** cms-components whole package 68 files / 1120: 1110 green, the 10 red are T167's own RED cases of the parallel task (`Section.test.tsx`, option-parity T167), none of T168's (fresh `dist/cms-components.css`, kept); storefront `test/ssr` `blocks`, `block-ssr-floor`, `catalog-blocks`, `block-degradation`, `module-blocks` 57; admin `page-builder-field-i18n`, `page-builder-i18n`, `hero-fields`, `listing-fields`, `button-image-fields` 91; mod-cms `block-declarations`, `page-builder-registry` 71, `manifest.test.ts` 21; mod-catalog package 107; backend unit `blog/block-declarations`, `cms/hidden-drawer`, `cms/frozen-block-renames-codomain`, `_i18n` 208; `check:block-names` declared=99 rendered=99 findings=0, `check:class-vocabulary` findings=0, `i18n:hardcoded` regressions=0 drained=0, `check:docs-translations` findings=0, `check:release-intent` violations=0; typecheck + lint clean for cms-components, mod-cms, mod-catalog (its three pre-existing `react-hooks/exhaustive-deps` warnings), typecheck clean for admin and storefront; `pnpm run build:packages` exit 0. Docs: `cms/index.md` new section "Full-width buttons and a chevron “read more”", `catalog.md` **Card image background** and **Divider under each card** rows; Polish mirrored, both cache entries rewritten with `hashSourceBody()`; `contracts/blocks.md` § "R10: card image box and divider, chevron read-more, full-width buttons (T168)", `data-model.md` §3.6 and §4. Changeset `163-page-builder-card-divider-chevron-read-more-full-width-buttons.md`. Translation contract `[PG]` not run: no translatable path changed (the summary text was already prose). Not done: a browser check on the running instance (no page with these options locally; `b2b` not written).
- [X] T169 Rebuild the local reference page with the R10 options (local only, never committed);
  refresh `home-gaps.md`.
  **Result (2026-10-26):** the local reference page (outside the repository's tracked tree) was
  rebuilt with T165 Column placement (a panel's secondary block placed at the bottom of the first
  column from the desktop up beside two-row columns, last when stacked — one copy), T166 inline icon
  size `0.3em` with a raised offset, T167 backdrop `{px}` size + `repeat-y` + top on the section
  groups (with a tileable local backdrop asset: a non-tileable one shows a seam every tile), and
  T168 card image box background + divider, chevron read-more and phone-only full-width button.
  Published page: HTTP 200, rich bodies in the server HTML, no horizontal overflow and no hydration
  warning at 375/768/1440 (3 loads each); the placement probed at 375 (stored order, secondary
  block last) and 1440 (its bottom level with the two-row image). No defect found in the R10
  options. Observation for the owner: a responsive value saved through the API without `base`
  (e.g. `rowSpan: { desktop: 2 }`) is accepted and kept but read as unset (`isResponsiveProp`
  requires `base`); the editor always writes `base`. Remaining gaps (local list): reduced motion
  for the backdrop left to the asset, no filled/custom inline glyph, no per-breakpoint backdrop
  size, no full-width option on the blog listing's header button.

### R11. Interaction details after the sixth rebuild (owner request 2026-10-26)

Same rules as R5–R10.

- [X] T170 [US1] A responsive value stored without `base` (e.g. `{desktop: 2}`) is read as unset
  today; read it as "no value below the first breakpoint that has one" everywhere responsive
  values are resolved (renderers and CSS variable writers), and document it.
  **Result (2026-10-26):** **RED first:** `page-builder-core` `types/responsive.test.ts` new describe (5) RED 4/5 (`isResponsiveProp({desktop: 2})` false, `resolveResponsive` returned the object, `normalizeResponsive` gave `{base: {desktop: 'xl'}}`, no override seen; "an object with any other key is a plain value" green from the start, a guard) and `fields/scoped-field.test.ts` +2 RED 2/2 (the editor's field reader returned the object, a base write dropped the stored desktop); new `cms-components/src/components/responsive-without-base.test.tsx` (8) RED 8/8 — Column `span`/`rowSpan {desktop}`, `rowSpan {tablet}`, Section `spaceTop {desktop}`/`spaceBottom {tablet}`, `CarouselShell` and `cms.ContentSlider` `slidesPerView`, a block's `stackOrder {desktop}`, Heading `textAlign {desktop}`, `specAtTier` with a baseless style/fill. (The Section case first passed its spacing inside a `section` object, which the block does not read; corrected to the block's flat props after the core fix — the old `normalizeResponsive` gives `{base: {desktop:'xl'}}`, i.e. `l` everywhere, so it is RED by construction, not observed.) **Implementation:** `isResponsiveProp` also accepts a non-array object whose keys are all `base`/`tablet`/`desktop` (at least one; one with `base` as before), so spacing parts, colours and hide-on flags stay plain values; `normalizeResponsive` gives a baseless value the caller's fallback as its base — what an unset value gives — so the tiers below the first one with a value render as unset, the rest inherit upwards; `resolveResponsive`, `responsiveVars`, every `tiers`/`tierValues`/`perTier` helper and all CSS-variable writers that go through them follow. Hand-rolled readers moved onto `isResponsiveProp`: `Button.tsx` (`fillFromVariant`, `specAtTier`: a baseless tier is unset, `ButtonView` applies its default), `block-align.ts` (`mapResponsive` keeps a baseless value baseless), `FeatureList.tsx` (`isNumberOrResponsiveNumber`); `with-hide-on.tsx` (`stackOrder`) and `Column.tsx` (placement) already used it. Editor readers: `scoped-field.tsx` (`responsiveBaseSeed` falls back, `writeScopedValue` seeds the missing base), `section-field.tsx`/`aspect-ratio-field.tsx` (already per tier, fixed by the guard), `page-builder-admin` `ResponsiveImageField` `readRatio` (a baseless ratio leaves the base unset, showing the default). Not changed: the contracts' `responsiveSchema` and the `ResponsiveProp`/`Responsive` types still describe what the editor writes (with `base`); a baseless value is tolerated on read. **Docs:** `cms/extending-page-builder.md` § "Responsive props and visibility" (the stored shapes and the baseless reading), Polish mirrored, cache rewritten with `hashSourceBody()`; `contracts/blocks.md` § R11, `data-model.md` §4; changeset `163-page-builder-carousel-ends-item-hover-baseless-responsive.md`. No existing assertion changed.
- [X] T171 [US4] Carousel ends: a `loop` option (today's behaviour by default); when not looping,
  the previous/next arrow at an end is `disabled` (native attribute, announced), with a
  configurable disabled look (dimmed, or a light outline/colour token).
  **Result (2026-10-26):** **Today's behaviour, read before the change:** `CarouselShell.goTo` wraps modulo the page count — previous on the first page goes to the last, next on the last back to the first; no arrow is ever disabled. Kept as the default (`loop` unset or `true`). **RED first:** `carousel/CarouselShell.test.tsx` new describe "the ends: loop and disabled arrows (T171)" (9) RED 7/9 (no `disabled` on the server or after clicks, focus not handed over, no scroll-driven update, autoplay not stopping, no `--arrow-off-*` classes, `carouselShellOptions` passing no `loop`); "unset is today's wrap-around" and "`loop: true` renders exactly what unset renders" green from the start (guards). One expectation of my own corrected after the first run, not the code: the autoplay case advanced 20 s in one `act` (every tick read the same page), now one interval per `act`. Option-parity new describe "R11 carousel ends and item hover look (T171, T172)" (the three carousels' fields and `controls` sub-fields before R11 as literals) RED on `loop` missing. **Implementation:** `loop` (radio Yes/No, after `effect`) in the shared `CAROUSEL_TRACK_FIELDS` (so `cms.ContentSlider`, `catalog.ProductSlider`, `blog.LatestPosts`; hidden for a grid in the Carousel's and LatestPosts' `CAROUSEL_ONLY`); `controls.disabledArrowLook` (`dim` first, `outline-light`, `color`) and `controls.disabledArrowColor` (`createColorField`); none in `defaultProps`. `carouselShellOptions` passes `loop: false` only, a look only when not `dim`, `color` only with a valid colour (`colorValueToCss`). `CarouselShell`: `loop = true`; with `false`, `goTo` clamps, the previous arrow carries `disabled` on page 0 (also in the server HTML), the next one once measured on the last page, both following the page `onScroll` computes; an arrow disabled while focused (or after the browser dropped its focus to the body) hands the focus to the other arrow of its group (`focusedArrowRef` + an effect, no focus trap); autoplay stops on the last page; root class `cmsc-pb-carousel--arrow-off-light|color` + `--pb-arrow-off-color` only when not looping. Arrows keep their names (`aria-label`), so a disabled arrow is announced as unavailable. CSS: `.cmsc-pb-carousel__arrow:disabled { opacity: .4; cursor: default }`, `--arrow-off-light` transparent fill + `rgba(255,255,255,.4)` outline/glyph, `--arrow-off-color` outline/glyph in the colour. Types `CarouselDisabledArrowLook` (shell + `component-types.ts`), `CarouselControls.disabledArrowLook/Color`, `loop` on `CarouselTrackOptions`/`ContentSliderProps`. Labels en+pl in the cms, catalog and blog bundles (`loop.*`, `controls.fields.disabledArrowLook.*`, `controls.fields.disabledArrowColor.label`; "Zapętlenie na końcach", "Wygląd nieaktywnej strzałki (bez zapętlenia)", "Przygaszona", "Jasny obrys (ciemne tło)", "Kolor nieaktywnej strzałki"). Fixtures: `block-declarations.test.ts` Carousel and backend `blog/block-declarations.test.ts` track carry `loop` and the two controls as non-prose. `fallback-parity.test.tsx` R11 (T171) +2 (unset: no `disabled`, opacity 1, pointer, #334155; not looping: dimmed 0.4/default, light `rgba(255, 255, 255, 0.4)`, colour #1d4ed8, the other arrow untouched) — not seen RED: the built `dist` had been rebuilt by a parallel build with my stylesheet before the first run. **Docs:** `cms/index.md` § "Carousels" (**Loop at the ends**, **Disabled arrow look**; the intro names the loop among the shared options), Polish mirrored, cache rewritten with `hashSourceBody()`; `contracts/blocks.md` § R11, `data-model.md` §4; changeset `163-page-builder-carousel-ends-item-hover-baseless-responsive.md`. No existing assertion changed. Not done: a browser check on the running instance (the `b2b` database is not written by this task).
- [X] T172 [US4] Hover look for carousel items and tiles: caption/title colour on hover (token or
  hex) with a short transition, respecting reduced motion; today's look by default.
  **Result (2026-10-26):** **RED first:** new `components/item-hover-color.test.tsx` (9) RED 6/9 (no class/var for a set colour, no fields, no rules, no reduced-motion rule); the three "unset renders exactly what it rendered before" / "anything but a hex or a known token is ignored" cases green from the start (guards); one expectation of my own corrected (the token in the test was `token:accent`, not a brand role; now `token:secondary`). Option-parity R11 describe (the two items' fields before R11 as literals) RED on `captionHoverColor`/`titleHoverColor`. **Implementation:** `cms.CarouselImage.captionHoverColor` (after `captionStyle`), `cms.LinkTile.titleHoverColor` (after `titleWeight`) and `labelHoverColor` (after `labelWeight`), all `createColorField`, none in `defaultProps`. A valid colour (`colorValueToCss`: hex or a known `token:<role>`) writes `--pb-caption-hover` + `cmsc-pb-carousel-image--hover-caption` on the `<figure>` (only with a shown caption), `--pb-title-hover`/`--pb-label-hover` + `cmsc-pb-link-tile--hover-title`/`--hover-label` on the tile (title only with text; label only for the text-link style — a button label keeps the button's hover). CSS: the text takes the colour on `:hover` and keyboard focus (`:focus-within` on the image, whose link is inside; `:focus-visible` on the tile, which is the link), `transition: color 0.2s ease` only on opted-in items, `transition: none` under `prefers-reduced-motion: reduce`; the caption rule is `!important` (scoped to the opted-in class) so it wins over the caption style's inline colour. Unset: byte-identical markup (asserted). **Product card names: not done** — `CmsProductCardView` does not share the item text parts, so it is not trivially shared. Labels en+pl (`blocks.carouselImage.fields.captionHoverColor.label`, `blocks.linkTile.fields.{title,label}HoverColor.label`; "Kolor podpisu/tytułu/etykiety po najechaniu"). Fixtures: `block-declarations.test.ts` CarouselImage and LinkTile carry them as non-prose. `fallback-parity.test.tsx` R11 (T172) +1 (no transition and today's white caption, #15202b title, #1261a6 label unset; a set colour adds only the 0.2 s transition, colours at rest unchanged) — not seen RED (the `dist` already held the rules, see T171). **Docs:** `cms/index.md` § "Carousels" hover paragraph, Polish mirrored, cache rewritten; `contracts/blocks.md` § R11, `data-model.md` §4; changeset as T171. No existing assertion changed. Not done: a browser check on the running instance.

  **R11 (T170–T172) verification (2026-10-26):** cms-components whole package 70 files / 1194: 1192 green, the 2 red are T175's own `fallback-parity` cases (parallel task: accordion look), none of T170–T172 (fresh `dist/cms-components.css` from `pnpm run build:packages`, exit 0, kept); page-builder-core whole package 28 / 200; mod-cms whole package 27 / 316; backend unit `blog/block-declarations`, `_i18n`, `cms/hidden-drawer`, `cms/frozen-block-renames-codomain` 14 / 208; admin `page-builder-field-i18n`, `page-builder-i18n`, `carousel-fields` 3 / 76; storefront `test/ssr` `blocks`, `block-ssr-floor`, `carousel-labels`, `catalog-blocks` 4 / 39; `check:block-names` declared=99 rendered=99 findings=0, `check:class-vocabulary` findings=0, `i18n:hardcoded` regressions=0 drained=0, `check:docs-translations` findings=0, `check:release-intent` violations=0; typecheck clean for page-builder-core, page-builder-admin, cms-components, mod-cms, mod-catalog, mod-blog, admin and backend; lint clean (0 errors) for the same packages — pre-existing `react-hooks/exhaustive-deps` warnings only (page-builder-admin `CatalogPickers.tsx` 1, catalog 3, blog 3), none in touched files.
- [X] T173 [US5] Rich-text "read more": chevron position (start, center, end) and an option to
  reveal the hidden text above the summary (summary stays the control, DOM order unchanged),
  with an animated open/close that falls back to instant where unsupported and under reduced
  motion.
  **Result (2026-10-26):** **RED first:** `rich-content-extensions.test.ts` new describe (2) RED 1/2 (`expected '<details class="cmsc-read-more cmsc-read-more--chevron">…' to be '…--chevron cmsc-read-more--center cmsc-read-more--reveal-above">…'`; the unset/`start`/`false`/unknown case green from the start, a guard); new admin `rich-content-read-more-toolbar.test.tsx` (2, StrictMode) RED on the stale `dist` (`Unable to find role="combobox" and name "Read more position"`). **Node** (`rich-content-shared.ts` `readMoreNode`): `chevronPosition: 'start' | 'center' | 'end'` (default `start`; `READ_MORE_POSITIONS`) → `cmsc-read-more--center` / `--end`, `revealAbove: boolean` (default `false`) → `cmsc-read-more--reveal-above`, both beside T168's class on the `<details>`, parsed back from the classes; `generateHTML` and the DOM-free `tiptap-html.ts` write them identically (no serializer change); **sanitiser unchanged** (`class` already global). The editor's node view marks `data-position` / `data-reveal-above` (summary aligned, an arrow before it; the content stays below, to edit). **CSS:** text summary `text-align: center|end`, chevron `margin-inline: auto` / `margin-inline-start: auto`; reveal above = `details { display: flex; flex-direction: column }` + `summary { order: 1 }` (+ `margin-top: 8px` while open instead of the bottom margin) — DOM order and the one control unchanged, a browser that cannot flex a `<details>` keeps today's order; animation `::details-content { block-size: 0 → auto }` with `interpolate-size: allow-keywords`, `content-visibility … allow-discrete`, `overflow: clip` + 4 px clip margin, inside `@media (prefers-reduced-motion: no-preference)` and `@supports (interpolate-size: allow-keywords) and selector(::details-content)` — no script, instant elsewhere. **Toolbar** (`RichContentEditorField`): a **Read more position** select (Start / Center / End) and a **Show the revealed text above the summary** toggle (⤒), both disabled outside a passage; labels are page-builder field text (`readMore.position*`, `readMore.revealAbove`; en+pl `pageBuilder.fieldText.readMore.*` in the `_i18n` bundles: "Położenie „czytaj więcej”", "Środek", "Pokazuj rozwinięty tekst nad przyciskiem"). `rich-body-ssr.test.tsx` +1 (a centred chevron revealed above: summary first in the server HTML, with a coloured emphasis of T175) and `fallback-parity.test.tsx` R11 (T173) +1 (unset `display` block / summary at the start; centred `text-align`, chevron end `margin-inline-start: auto`, reveal above flex column with the summary first in the DOM and `order: 1`; the feature-query guard in the built sheet) — both written after the implementation. No existing assertion changed; no new dependency. Verification: see T175.
- [X] T174 [US5] Tabs: hover look for tab buttons (background/text colour tokens or hex) and an
  animated panel change (fade/slide) that actually animates on switch, respecting reduced
  motion; all panels still in the server HTML.
  **Result (2026-10-26):** **Why T059's fade looked instant (measured, Chrome on `/ref-home`):** it did run — a 200 ms `ease-out` fade-in of the incoming panel only (`.cmsc-pb-tabs--fade .cmsc-pb-tabs__panel:not([hidden])`, opacity 0.14 → 0.99 in 200 ms) — but the outgoing panel vanished at once and the height jumped, so it read as a flash; `hidden` was not the cause. **RED first:** `Tabs.test.tsx` new describe "hover look and an animated panel change (T174)" (13) RED 12/13 (no hover fields/vars/class/rules, no `slide`, no `.cmsc-pb-tabs__panels`, no `inert`/`aria-hidden` outgoing panel, no stacking/height rules; "instant: today's markup" green from the start, a guard); option-parity new describe "R11 tab hover look and panel change (T174)" (fields, `tabStyle` sub-fields and `effect` values before T174 as literals) RED on `tabStyle.hoverBackground`. **Hover:** `tabStyle.hoverBackground` / `hoverColor` (`createColorField`, `colorValueToCss`) → `--cmsc-tabs-hover-bg|fg` + `cmsc-pb-tabs--hover`; inside `@media (hover: hover)` a tab that is not selected takes them under the pointer (fallbacks: its own background/colour), `--hover` tabs get a 200 ms background/colour transition (none under reduced motion); boxed tabs with a hover colour take the 6 px top radius. Unset: today's classes, no transition. **Panel change:** `effect` gains `slide` (`none` default, `fade`, `slide`). Animated effects put the panels in `.cmsc-pb-tabs__panels` (one grid cell, panels `display: flow-root`, `[hidden]` → `display: none`); `none` keeps today's markup. On a change the tabs model changes at once; the outgoing panel stays shown with `inert`, `aria-hidden="true"`, `--leaving` (fade out, `pointer-events: none`), the incoming gets `--entering`, the box `--switching` (`overflow: hidden`, `transition: height 300ms`) and an inline height from the outgoing to the incoming panel's (layout effect, subpixel `getBoundingClientRect`); after 300 ms all of it is removed and the outgoing panel is `hidden` again. `slide` = a 24 px shift (`--cmsc-tabs-shift`), reversed by `--back` (an earlier tab), mirrored under `[dir='rtl']`. A second change mid-way hides the first outgoing panel at once. Reduced motion / no `matchMedia` / server: no change state, instant; the stylesheet also drops the animations and height transition under reduced motion. Roles, ids (T149), roving tab index and keys unchanged. **Changed existing assertions (standing rule 13):** `Tabs.test.tsx` T058 "fades between panels only when asked, and never under reduced motion" (the stylesheet assertions now read `.cmsc-pb-tabs__panel--entering` instead of the removed load-time `:not([hidden])` fade) and T132 "offers the bar's background and border, …" (`tabStyle.objectFields` + `hoverBackground`, `hoverColor`); `option-parity.test.ts` T058 "offers each counterpart …" and R5 "cms.Tabs keeps every option and adds the tab bar's look" (`effect` options `toEqual(['none','fade'])` → the first two equal `['none','fade']`, `slide` appended). Labels en+pl `blocks.tabs.fields.effect.options.slide`, `tabStyle.fields.hoverBackground|hoverColor.label`. `block-declarations.test.ts` Tabs fixture carries the hover colours as non-prose. `fallback-parity.test.tsx` R11 (T174) +2 (no transition and today's #64748b with no hover colour; the instant panel in the block's flow; an animated block's box is a grid, the shown panel `flow-root`, the hidden `none`, no animation at rest) — written after the stylesheet; one expectation of my own corrected (the minified sheet writes `.2s`). **Live check (headless Chrome on the running storefront, `/ref-home`, read only):** at 375 px the outgoing panel `inert`+`aria-hidden` fades 0.96 → 0 while the incoming 0.04 → 1, the box height goes 731 → 754 px smoothly over ~300 ms, `scrollWidth` 375; with `reducedMotion: 'reduce'` the switch is instant; hover on a static probe with the built sheet: `rgb(29, 78, 216)` / white, `background-color 0.2s, color 0.2s`. **Verification:** cms-components whole package 70 files / 1194: 1193 green, the 1 red is T175's own case (parallel task; T171/T172's option-parity REDs were green by then); `block-dom-ids-hydration` green unchanged; mod-cms `block-declarations` 51; admin `page-builder-field-i18n` + `page-builder-i18n` 69; storefront `test/ssr/blocks` + `block-ssr-floor` 19; `check:block-names` declared=99 rendered=99 findings=0, `check:class-vocabulary` findings=0, `i18n:hardcoded` regressions=0 drained=0, `check:docs-translations` findings=0, `check:release-intent` violations=0; typecheck + lint clean for cms-components and mod-cms; `pnpm run build:packages` exit 0, `dist/cms-components.css` rebuilt and kept. Docs: `cms/index.md` Tabs row + hover and **Panel change** paragraphs, Polish mirrored, cache rewritten with `hashSourceBody()`; `contracts/blocks.md` (Tabs `effect`, § "R11: tab hover look and panel change (T174)"), `data-model.md` §4; changeset `163-page-builder-tab-hover-and-panel-change.md`. Not done: lazy images in a panel shown for the first time still load when it is shown (unchanged).
- [X] T175 [US3] Highlight colour: the inline `emphasis` mark can take any brand colour token or
  hex in addition to the three variants. Accordion look: icon (chevron or plus/minus), dividers,
  boxed or plain items, title padding, and an animated open/close (reduced motion respected).
  **Result (2026-10-26):** **RED first:** contracts `page-builder-props.test.ts` new describe (2) RED 2/2 (the colour was stripped; `red: expected true to be false`); `InlineRich.test.tsx` +2 RED 1/2 (unset/null/unknown role/out-of-grammar case green, a guard); `rich-content-extensions.test.ts` new describe (3) RED on the missing `data-cms-em-color` (unset case green, a guard); option-parity new describe "R11 the accordion's icon, dividers, item style and title padding (T175)" (Accordion fields and option values before R11 as literals) RED (`Accordion icon (top) → icon: expected [ 'hideOn', 'items', …(10) ] to include 'icon'`); `Accordion.test.tsx` new describe (7) RED 5/7 (unset byte-for-byte and "every panel in the server HTML" green from the start, guards); admin `inline-rich-text-field.test.tsx` +3 RED (`Unable to find … "Highlight colour"`). **(a) Emphasis colour:** contracts `inlineRichMarkSchema` emphasis attrs += `color: colorValueSchema.nullable().optional()` (additive). New `components/emphasis-color.ts` (`emphasisColor` — hex or a known `token:<role>` → `{value, css}`, else `null`; `EMPHASIS_COLOR_ATTR`), shared by `InlineRich` (no TipTap) and the mark. Markup: `<span class="cmsc-em cmsc-em--<variant>" data-cms-em-color="<stored>" style="color: <css>">` (token → `var(--cmsb-color-<role>, <literal>)`); anything outside the grammar → today's span. `emphasisMark.color` (`default: undefined`, so a phrase without one keeps its JSON `{variant}`), parsed back from the attribute with the parse rule at priority 60 (**decision:** ahead of `textStyle`, which otherwise also read the styled span as a second mark); command `setEmphasisColor(color | null)` keeps the variant (`accent` where none; `null` → `{variant}` again). Both serializers identical (TipTap's DOM one compared after the sanitiser, rgb→hex, as T119). **Sanitiser (minimal):** `data-cms-em-color` kept on a `<span>` only with a colour value (the `color` declaration was already allowed). CSS: `.cmsc-em[data-cms-em-color] { background-image: none; -webkit-text-fill-color: currentColor }` — a coloured gradient phrase reads as solid text in its colour. **Editor:** inline toolbar **Highlight colour** (an "A" over the current colour) → dialog: brand role swatches (`BRAND_COLOR_ROLES`, "Brand colour: {role}"), **Custom colour (hex)** text box + `NativeColorInput`, **Apply** only for a valid colour, **Remove colour** when one is set; labels page-builder field text `emphasisColor.*` (en+pl: "Kolor wyróżnienia", "Kolory marki", "Własny kolor (hex)", "Usuń kolor", …). Translation: no codec change; `tiptap-inline-codec.test.ts` +2 (the coloured mark is one numbered tag, comes back with variant and colour) green from the start (guards). **(b) Accordion look** (`Accordion.tsx`, types `AccordionIcon`, `AccordionDividers`, `AccordionItemStyle` in `component-types.ts`): `icon` (`plus` | `chevron`; chevron = empty `aria-hidden` span `cmsc-pb-accordion__icon--chevron` drawn in `currentColor`, turned by `aria-expanded`, pushed to the line end at the end position), `itemStyle` (`plain` | `boxed`; unset follows `variant`, `bordered` = boxed), `dividers` (`none` | `between` | `all`, written and offered — `resolveFields` — for plain items only), `titlePadding` (`gapField`) + `titlePaddingPx` (shown only with Custom) per breakpoint (`gapVars('cmsc-acc-pad')`, Responsive tab, `responsiveFields` of the registry and the cms manifest), all after `titleSizePx`, none in `defaultProps`; root classes `cmsc-pb-accordion--chevron|--plain|--boxed|--dividers-*|--title-pad` only when set — unset is byte-identical (asserted against the plain render). Boxed: 1 px border, 8 px radius, 8 px apart, title and panel inset 16 px. **Animation (decision: always on, CSS only):** the root gets `data-animate` after hydration (`useEffect`), so a panel open by default never grows in on page load; under `@media (prefers-reduced-motion: no-preference)` + `@supports (interpolate-size: allow-keywords)` the panel transitions `height`, `padding-bottom`, `opacity` with `display … allow-discrete` and `@starting-style` (`overflow: clip`, 4 px clip margin); `hidden` stays the closed state (every panel in the server HTML, closed ones out of the accessibility tree); elsewhere instant. Labels en+pl `blocks.accordion.fields.{icon,itemStyle,dividers,titlePadding,titlePaddingPx}.*` ("Plus i minus", "W ramkach", "Linie podziału", "Odstęp nad i pod tytułem", …). Fixture: `block-declarations.test.ts` Accordion gains the five as non-prose (green with the change). `fallback-parity.test.tsx` R11 (T175) +3 (unset: 12 px title row, today's `border-bottom` rule read from the built sheet — jsdom drops a `var()` border shorthand —, no look class, the `+` glyph; between/boxed rules and the 16 px inset, a Custom 20 px padding; an emphasis colour hex/token painted, a coloured gradient with `background-image: none`) — written after the stylesheet. No existing assertion changed; no new dependency. **T173 + T175 verification:** contracts `page-builder-props` 44; cms-components whole package 70 files / 1194 green (fresh `dist/cms-components.css`, kept), `rich-body-ssr` 17 included; admin `inline-rich-text-field`, `rich-content-read-more-toolbar`, `page-builder-field-i18n`, `page-builder-i18n` + one more cms file 91 (5 files); mod-cms whole package 27 / 316 (`block-declarations`, `extract`, `tiptap-inline-codec`, manifest included); mod-i18n 6; storefront `test/ssr` `blocks`, `block-ssr-floor` 19; backend unit `_i18n`, `cms/hidden-drawer`, `cms/frozen-block-renames-codomain` 13 / 203; `check:block-names` declared=99 rendered=99 findings=0, `check:class-vocabulary` findings=0, `i18n:hardcoded` regressions=0 drained=0, `check:docs-translations` findings=0, `check:release-intent` violations=0; typecheck + lint clean for contracts, page-builder-core, cms-components, mod-cms, admin; storefront typecheck clean; `pnpm run build:packages` exit 0. Docs: `cms/index.md` new section `"Read more" placement, accordion look and highlight colours`, Polish mirrored ("Położenie „czytaj więcej”, wygląd akordeonu i kolory wyróżnień"), cache entry rewritten with `hashSourceBody()`; `contracts/blocks.md` § "R11: read-more position and reveal above, accordion look, emphasis colour (T173, T175)", `data-model.md` §3.5, §3.6, §4. Changeset `163-page-builder-read-more-position-accordion-look-emphasis-colour.md`. Translation contract `[PG]` not run: no translatable path changed. Not done: a browser check on the running instance (no page with these options locally; `b2b` not written — T176).
- [X] T176 Rebuild the local reference page with the R11 options (local only, never committed);
  refresh `home-gaps.md`.
  **Result (2026-10-26):** The local rebuild (git-excluded) now uses the R11 options: `loop: false` on the three carousels, with solid arrows and a `color` disabled look (the reference's disabled arrow is a thin dark outline on white, so `outline-light` does not fit there); `titleHoverColor` on the link tiles; a centred chevron read-more revealed above; tab `hoverBackground`/`hoverColor` with the `fade` crossfade; an emphasis colour; and the accordion's chevron, plain items, 16 px title padding and 18 px titles. Published page: HTTP 200, no placeholder, rich bodies in the server HTML, `scrollWidth` equal to the viewport and no hydration warning in 3 loads each at 375/768/1440. Headless-Chrome probes against the reference: points 1, 4 and 5 match within the transition durations; the read-more layout matches. **Bug found:** a `revealAbove` read-more does not animate (the `<details>` is a flex column, so `::details-content` keeps `min-block-size: auto`; opening jumps in one frame, closing snaps after 250 ms). `details.cmsc-read-more--reveal-above::details-content { min-block-size: 0 }`, injected for the test only, restores the animation. Not fixed here. Gaps recorded: no resting title colour on `cms.LinkTile` (so a hover colour cannot read as a lightening on a dark tile) and none on `cms.Accordion`; the accordion's line sits under the item, not under the title.

### R12. Follow-ups from the seventh rebuild (owner request 2026-10-26)

- [X] T177 [US5] Fix B4: a read-more with `revealAbove` does not animate (the flex layout keeps
  `::details-content` at full height); add the missing `min-block-size: 0` and a test.
  **Result (2026-10-26):** **RED first:** `fallback-parity.test.tsx` new describe "R12 … (T177–T179)", case T177, reads the T173 `@supports (interpolate-size: allow-keywords) and selector(::details-content)` block out of the built sheet (brace-matched) and expects `details.cmsc-read-more--reveal-above::details-content{…min-block-size:0…}` inside it — RED on the old `dist`. **Fix:** `styles/cms-components.css`, inside the T173 animation block, `details.cmsc-read-more--reveal-above::details-content { min-block-size: 0 }` (a comment says why). Nothing outside the block changes (the same case keeps an unset passage `display: block`). Browser behaviour: see T180.
- [X] T178 [US4] `cms.LinkTile` resting title and label colour (token or hex), so a hover colour
  has something to change from; today's look by default.
  **Result (2026-10-26):** **RED first:** option-parity new describe "R12 resting tile colours, the accordion's title colour, divider position and icon size (T178, T179)" (the tile's 20 fields after R11 as literals) RED on `titleColor`; `LinkTile.test.tsx` new describe "resting title and label colour (T178)" (5) RED 3/5 (the "unset renders exactly what it rendered before" and "button label / no title" cases green from the start, guards); one expectation of my own corrected (an empty title is `''`, not a doc with an empty text node). **Implementation:** `titleColor` (after `titleWeight`, before `titleHoverColor`) and `labelColor` (after `labelWeight`, before `labelHoverColor`), both `createColorField`, none in `defaultProps`. A valid colour (`colorValueToCss`) writes `--pb-title-color` / `--pb-label-color` + `cmsc-pb-link-tile--title-color` / `--label-color` (title only with text; label only for the text-link style — a button label keeps the button's colours). CSS: `.cmsc-pb-link-tile--title-color .cmsc-pb-link-tile__title { color: var(--pb-title-color) }` (and the label), placed before T172's hover rules, which are also more specific, so a hover colour still wins. Unset: byte-identical markup. **Changed existing assertion (standing rule 13):** `item-hover-color.test.tsx` T172 "offers both fields as colours, each after its weight" → "…each after its resting colour (T178), which follows its weight" (`titleHoverColor` follows `titleColor`, `labelHoverColor` follows `labelColor`). Types in `component-types.ts`. Labels en+pl `blocks.linkTile.fields.{title,label}Color.label` ("Kolor tytułu", "Kolor etykiety"). Fixture: `block-declarations.test.ts` LinkTile carries both as non-prose. `fallback-parity.test.tsx` R12 (T178): unset title #15202b / label #1261a6; set → `rgb(71, 85, 105)` / `rgb(29, 78, 216)` (RED before the stylesheet).
- [X] T179 [US3] Accordion: title colour (token or hex), divider position (under the item or under
  the title) and icon size (token or px); today's look by default.
  **Result (2026-10-26):** **RED first:** option-parity R12 describe (the accordion's 17 fields and 7 selects' values after R11 as literals) RED on `titleColor`; `Accordion.test.tsx` new describe "title colour, divider position and icon size (T179)" (5) RED 4/5 (the byte-identical "unset / unknown / out-of-grammar / `item`" case green from the start, a guard); one expectation of my own corrected (the responsive title size and padding are moved to the Responsive tab, so `titleColor` follows `titleLevel` in the field order). **Implementation** (`Accordion.tsx`, types `AccordionDividerPosition`, `AccordionIconSize`): `titleColor` (`createColorField`) → `cmsc-pb-accordion--title-color` + `--cmsc-acc-title` (the trigger's `color`; the icon, drawn in `currentColor`, follows); `dividerPosition` (`item` first | `title`, after `dividers`, offered for plain items only) → `--divider-title`, written only when the items have a line (not boxed, `dividers` not `none`, not `flush` with `itemStyle` unset); `iconSize` (`s` 16 / `m` 20 / `l` 24 px / `custom`, after `icon`) + `iconSizePx` (8–64, shown only with Custom) → `--icon-size` + `--cmsc-acc-icon` (the icon's `font-size`, `line-height: 1`; a chevron is 1 em square). None in `defaultProps`; an invalid colour, an unknown value or Custom without a positive px writes nothing. CSS (after T175's divider rules, so equal specificity wins): the item's `border-bottom: none`, the trigger's `border-bottom: 1px solid var(--cmsb-n-200, #e2e8f0)`, `between` → no line under the last title and no `border-top` between items, `all` keeps the line above the first; the panel gets `padding-top: 12px`, animated with it (`padding-top` in the transition, 0 while `[hidden]` and in `@starting-style`). Labels en+pl `blocks.accordion.fields.{titleColor,dividerPosition,iconSize,iconSizePx}.*` ("Kolor tytułu", "Położenie linii podziału", "Pod elementem", "Pod tytułem", "Rozmiar ikony", "Mała (16 px)", "Średnia (20 px)", "Duża (24 px)", "Własny rozmiar ikony (px)"). Fixture: `block-declarations.test.ts` Accordion carries the four as non-prose. `fallback-parity.test.tsx` R12 (T179): no root style unset; title colour `rgb(71, 85, 105)`; icon `m` → 20 px. No existing assertion changed; no new dependency.
  **R12 (T177–T179) verification:** `pnpm run build:packages` exit 0, `dist/cms-components.css` rebuilt and kept; cms-components whole package 70 files / 1209 green; mod-cms whole package 27 / 316 (`block-declarations` 51); storefront `test/ssr/blocks` + `block-ssr-floor` 19; admin `page-builder-field-i18n` + `page-builder-i18n` 69; backend unit `_i18n` + `cms/hidden-drawer` 12 / 196; `check:block-names` declared=99 rendered=99 findings=0, `check:class-vocabulary` findings=0, `i18n:hardcoded` findings=222 regressions=0 drained=0, `check:docs-translations` findings=0, `check:release-intent` violations=0; typecheck + lint clean for cms-components and mod-cms. Docs: `cms/index.md` (Carousels: **Title color** / **Label color** paragraph; "Read more" placement section: **Accordion title colour, divider and icon size**), Polish mirrored, cache entry rewritten with `hashSourceBody()`; `contracts/blocks.md` § "R12: animated reveal above, resting tile colours, accordion title colour, divider position and icon size (T177–T179)", `data-model.md` §4; changeset `163-page-builder-reveal-above-animation-tile-colours-accordion-title-divider-icon.md`.
- [X] T180 Rebuild the local reference page with the R12 options (local only, never committed);
  refresh `home-gaps.md`.
  **Result (2026-10-26):** The local rebuild (git-excluded) now sets a resting `titleColor` beside the hover colour on the link tiles, and `titleColor`, `dividerPosition: 'title'` and `iconSize: 'm'` on the accordion. Published page: HTTP 200, no placeholder, R12 classes and variables in the server HTML, `scrollWidth` equal to the viewport and no hydration warning in 3 loads each at 375/768/1440. Headless-Chrome probes against the reference: the tile title rests grey and turns white on hover at ≥ 1024 px; the accordion's title and chevron colour, the line under the title and the 20 px chevron match; the reveal-above read-more now animates both ways over about 250 ms (B4 fixed by T177). Gaps recorded: the resting tile colour is one value for every width (the reference's narrower layouts keep white titles), and the accordion's open/closed spacing (24 px below the line and between closed items on the reference, 12 px / none here).

### R13. Last details from the eighth rebuild (owner request 2026-10-26)

- [X] T181 [US4] `cms.LinkTile` resting title/label colour per breakpoint (Responsive tab), so a
  tile can rest light on touch widths and darker on desktop; a single value keeps working.
  **Result (2026-10-26):** **RED first:** new page-builder-core `fields/responsive-color-field.test.tsx` (4) RED 4/4 (`createResponsiveColorField` missing); option-parity new describe "R13 resting tile colours per breakpoint, the accordion's spacing and title weight (T181–T183)" (the tile's 22 fields after R12 as literals) RED on `titleColor: expected undefined to deeply equal { pageBuilder: { responsive: true } }`; `LinkTile.test.tsx` new describe "resting colours per breakpoint (T181)" (5) RED 5/5; `fallback-parity.test.tsx` R13 (T181) RED (`expected 'rgb(21, 32, 43)' to be 'rgb(255, 255, 255)'`). **Core:** `color-field.tsx` `createResponsiveColorField({label})` (responsive metadata → Responsive tab; the colour control of `createColorField` editing the scope the tab selects, re-read at write time; above the base an empty box and the field text `tier.inheritValue` hint with the inherited colour), `writeResponsiveColor` (a breakpoint set first is stored without `base`, a value with only its base is stored plain, clearing the last colour stores `undefined`), type `ResponsiveColorProp`; all on the barrel. **Block:** `titleColor` / `labelColor` use it (`responsiveFields` in `index.ts` and the cms manifest); types widened to `string | ResponsiveProp<string>`. `restingColors` + `restingColorParts`: a single colour (or one with only its base) → today's `--pb-title-color` + `--title-color` class, byte-identical; a responsive value → per tier with a valid colour of its own `--pb-title-color(-md|-lg)` + `cmsc-pb-link-tile--title-color(-md|-lg)` (the label's the same; an invalid tier writes nothing; a baseless value keeps the tile's own colour below its first tier, T170); the editor resolves the previewed tier into the base. CSS: `@media (min-width: 768px)` / `(min-width: 1024px)` rules for the `-md` / `-lg` classes, placed before T172's hover rules (more specific, so hover still wins). A button label keeps the button's colours at every tier. **Changed existing assertions (standing rule 13):** `LinkTile.test.tsx` T178 "offers both as colours, each before its hover colour" → "…each on the Responsive tab since T181 (its hover colour follows its weight)" and `item-hover-color.test.tsx` T172 "…each after its resting colour (T178)" → "…each after its weight (the resting colours, T178, are on the Responsive tab since T181)": a responsive field is listed with the responsive fields, so `titleHoverColor` now follows `titleWeight`. No new label (the field labels are T178's). Fixture: `block-declarations.test.ts` LinkTile `labelColor` per breakpoint as non-prose.
- [X] T182 [US3] Accordion spacing: gap between the title line and the open panel, and the
  vertical spacing between items (token or px, per breakpoint); today's look by default.
  **Result (2026-10-26):** **RED first:** option-parity R13 describe (the accordion's 21 fields and 11 selects' values after R12 as literals) RED on `Accordion panelGap (top) → panelGap`; `Accordion.test.tsx` new describe "spacing and title weight (T182, T183)" (6) RED 6/6; `fallback-parity.test.tsx` R13 (T182) RED. **Implementation:** `panelGap` / `panelGapPx` ("Space above the open panel") and `itemGap` / `itemGapPx` ("Space between items"), `gapField` / `gapPxField` (spacing token or Custom px 0–160, Responsive tab, `responsiveFields` of the registry and the cms manifest; the px only with Custom via `resolveFields`), none in `defaultProps`. A chosen gap writes `cmsc-pb-accordion--panel-gap` / `--item-gap` + `gapVars('cmsc-acc-panel-gap' | 'cmsc-acc-item-gap')` (all three tiers; a tier left unset gets today's value: panel 0, or 12 px with the line under the title; items 0, or 8 px when boxed). CSS (after T179's 12 px panel rule): the panel's `padding-top` and every item but the last's `margin-bottom` read the variables per breakpoint (`-md`, `-lg` with fallbacks); the panel gap joins T179's animated `padding-top` (0 while `[hidden]` and in `@starting-style`). Unset: byte-identical. Labels en+pl (`blocks.accordion.fields.{panelGap,panelGapPx,itemGap,itemGapPx}.*`: "Odstęp nad rozwiniętym panelem", "Odstęp między elementami", "Własny … (px)"). Fixture: `block-declarations.test.ts` Accordion carries the four as non-prose. No existing assertion changed.
- [X] T183 [US3] Accordion title weight (default today's, or 300–800).
  **Result (2026-10-26):** RED with T182 (option-parity `titleWeight` options; `Accordion.test.tsx` "a title weight … is set on every title" `expected '' to be '700'`; fallback-parity R13 (T183) `expected '600' to be '700'`). `titleWeight` = the shared `textWeightField('Title weight')` (Default, 300–800), right after `titleColor`; `textWeightCss` → inline `font-weight` on every `.cmsc-pb-accordion__title` (merged with a Custom size's inline style; over a size token's weight); Default / unset / unknown → no style, byte-identical (asserted). Labels en+pl `blocks.accordion.fields.titleWeight.*` ("Grubość tytułu", "Domyślna", "Cienka (300)" … "Bardzo gruba (800)"). Fixture: `block-declarations.test.ts` Accordion carries it as non-prose.

  **R13 (T181–T183) verification:** `pnpm run build:packages` exit 0, `dist/cms-components.css` rebuilt and kept; cms-components whole package 70 files / 1225 green; page-builder-core whole package 29 / 204; mod-cms whole package 27 / 316 (`block-declarations` 51); storefront `test/ssr` `blocks` + `block-ssr-floor` 19; admin `page-builder-field-i18n` + `page-builder-i18n` 69; `check:block-names` declared=99 rendered=99 findings=0, `check:class-vocabulary` findings=0, `i18n:hardcoded` findings=222 regressions=0 drained=0, `check:docs-translations` findings=0, `check:release-intent` violations=0; typecheck clean for page-builder-core, cms-components, mod-cms, admin, storefront; lint exit 0 for page-builder-core, cms-components, mod-cms. Docs: `cms/index.md` (Carousels: tile colours per breakpoint paragraph; new bullet **Accordion spacing and title weight**), Polish mirrored ("Odstępy i grubość tytułu akordeonu"), cache entry rewritten with `hashSourceBody()`; `contracts/blocks.md` § "R13: resting tile colours per breakpoint, accordion spacing and title weight (T181–T183)", `data-model.md` §4; changeset `163-page-builder-tile-colours-per-breakpoint-accordion-spacing-weight.md`. No new dependency.
- [X] T184 Rebuild the local reference page with the R13 options (local only, never committed);
  refresh `home-gaps.md`.
  **Result (2026-10-26):** The local rebuild (git-excluded) now gives the link tiles a resting title colour per breakpoint (light below desktop, dark from desktop, the hover colour kept) and the accordion a panel gap and an item gap per breakpoint and a bold title weight; re-measuring the reference also corrected the accordion's title size and title padding (existing options). Published page: HTTP 200, no placeholder, R13 classes and variables in the server HTML, `scrollWidth` equal to the viewport and no hydration warning in 3 loads each at 375/768/1440. Headless-Chrome probes against the reference: the tile title colours match at all three widths; the accordion's trigger height, closed pitch (±2 px), space under a closed line and line-to-text space (±4 px) match. Gaps recorded: the title weight is one value (the reference is lighter below desktop), and the space after an open panel is larger than the reference's (the item gap applies open or closed and the panel's bottom padding is fixed).

### R14. Accordion finishing touches (owner request 2026-10-27)

- [X] T185 [US3] Accordion title weight per breakpoint (Responsive tab); a single stored weight
  keeps working.
  **Result (2026-10-27):** **RED first** (with T186): option-parity new describe "R14 the accordion's title weight per breakpoint, panel bottom space and open-item gap (T185, T186)" (the accordion's 26 fields and 13 selects' values after R13 as literals) RED on `titleWeight (top): expected undefined to deeply equal { pageBuilder: { responsive: true } }`; `Accordion.test.tsx` new describe "title weight per breakpoint, panel bottom space and open-item gap (T185, T186)" (8) RED 7/8 (the "unset, both spaces render today's accordion" case green from the start, a guard); `fallback-parity.test.tsx` R14 (T185) RED `expected '600' to be '500'`. **Implementation** (`Accordion.tsx`): `titleWeight` = T183's `textWeightField` + `PB_RESPONSIVE_METADATA` (same options, Responsive tab; `responsiveFields` of the registry and the cms manifest). `titleWeightOf`: the weight per tier (`resolveResponsive` + `textWeightCss`; `default` / unknown / unset = none). No tier with a weight → nothing; the same weight at every tier (plain, `{base}` only, or equal tiers) → T183's inline `font-weight`, byte-identical (asserted); weights that differ → root class `cmsc-pb-accordion--title-weight` + `--cmsc-acc-title-weight(-md|-lg)`, every tier written, a tier without its own weight given today's (`600`, or a sized title's `var(--cmsb-t-<token>-w, <literal>)`), no inline weight on the titles. The editor resolves the previewed tier into an inline weight. CSS: child-combinator rules on the title (with or without a heading wrapper; a nested accordion is not reached) reading the variables from 768 / 1024 px up. Type widened to `TextWeight | ResponsiveProp<TextWeight>`. **Changed existing assertion (standing rule 13):** `Accordion.test.tsx` T183 "…the weight after the title colour…" → "…the weight with the title size (on the Responsive tab since T185)…" (`titleWeight` now follows `titleSizePx`: a responsive field is listed with the responsive fields). No new label (T183's). Fixture: `block-declarations.test.ts` Accordion `titleWeight` per breakpoint as non-prose.
- [X] T186 [US3] Accordion space after an open panel: the panel's bottom padding becomes an option
  (token or px, per breakpoint), and the item gap can differ for open items (or the open panel's
  own bottom space replaces the gap), so an open item's following title sits where the editor
  wants; today's look by default.
  **Result (2026-10-27):** RED with T185 (option-parity `panelPaddingBottom` missing; `Accordion.test.tsx` classes/variables/stylesheet/fields; fallback-parity R14 (T186) `expected '12px' to be '4px'`). **Implementation:** `panelPaddingBottom` / `panelPaddingBottomPx` ("Space below the open panel") and `openItemGap` / `openItemGapPx` ("Space after an open item"), `gapField` / `gapPxField` (token or Custom px 0–160, Responsive tab, `responsiveFields` of the registry and the cms manifest; the px only with Custom via `resolveFields`), none in `defaultProps`. A bottom space writes `cmsc-pb-accordion--panel-bottom` + `gapVars('cmsc-acc-panel-bottom', …, 12)` (today's 12 px for an unset tier); the panel's `padding-bottom` reads it after the base `padding: 0 0 12px`, and T175's animated `padding-bottom` (0 while `[hidden]` and in `@starting-style`, more specific) opens and closes it. An open-item gap writes `cmsc-pb-accordion--open-gap` + `--cmsc-acc-open-gap(-md|-lg)` (`openGapVars`: a tier without its own value gets the item gap there — `gapCss` of `itemGap`, or today's 0 / 8 px boxed); `.cmsc-pb-accordion--open-gap > .cmsc-pb-accordion__item:not(:last-child):has(> .cmsc-pb-accordion__panel:not([hidden]))` takes its `margin-bottom` from it (after and more specific than T182's item gap); with `data-animate` and no reduced motion the item's `margin-bottom` transitions over 250 ms with the panel. Unset: byte-identical (asserted). Types in `component-types.ts`. Labels en+pl `blocks.accordion.fields.{panelPaddingBottom,panelPaddingBottomPx,openItemGap,openItemGapPx}.*` ("Odstęp pod rozwiniętym panelem", "Odstęp po rozwiniętym elemencie", "Własny … (px)"); admin `page-builder-field-i18n.test.ts` RED (`cms.Accordion: every field and option label resolves` — 20 missing) then green. Fixture: `block-declarations.test.ts` Accordion carries the four as non-prose. No new dependency.

  **R14 (T185, T186) verification:** `pnpm run build:packages` exit 0, `dist/cms-components.css` rebuilt and kept; cms-components whole package 70 files / 1236 green; mod-cms whole package 27 / 316 (`block-declarations` 51); storefront `test/ssr` `blocks` + `block-ssr-floor` 19; admin `page-builder-field-i18n` + `page-builder-i18n` 69; `check:block-names` declared=99 rendered=99 findings=0, `check:class-vocabulary` findings=0, `i18n:hardcoded` findings=222 regressions=0 drained=0, `check:docs-translations` findings=0, `check:release-intent` violations=0; typecheck clean for cms-components, mod-cms, admin, storefront; lint exit 0 for cms-components and mod-cms. Docs: `cms/index.md` bullet **Accordion spacing and title weight** extended (bottom space, open-item gap, weight per breakpoint), Polish mirrored, cache entry rewritten with `hashSourceBody()`; `contracts/blocks.md` § "R14: accordion title weight per breakpoint, panel bottom space and open-item gap (T185, T186)", `data-model.md` §4; changeset `163-page-builder-accordion-weight-per-breakpoint-open-panel-space.md`.
- [X] T187 Local rebuild only: tile title weight 500 from desktop, accordion values re-measured;
  refresh `home-gaps.md` (never committed).
  **Result (2026-10-27):** The local rebuild (git-excluded) gives the accordion a title weight per breakpoint (semibold below desktop, bold from desktop), a bottom space on the open panel per breakpoint and no extra gap after an open item. Published page: HTTP 200, no placeholder, R14 classes and variables in the server HTML, `scrollWidth` equal to the viewport and no hydration warning in 3 loads each at 375/768/1440. Headless-Chrome probes against the reference: the accordion title weights match at all three widths; the space from the last open text line to the next title matches within 0.6 px at all three widths and opens and closes with the panel; the closed pitch is unchanged. Gap recorded: the tile title weight is one value for every width (the reference is lighter below desktop), so the build keeps the lighter weight and differs from desktop; the desktop tile title size also differs (existing option, not changed).
- [X] T188 [US4] `cms.LinkTile` title and label weight per breakpoint (Responsive tab); a single
  stored weight keeps working.
  **Result (2026-10-27):** **RED first:** option-parity new describe "R14 the tile's title and label weight and the caption weight per breakpoint (T188)" (`cms.LinkTile`'s fields after R13 and `cms.CarouselImage`'s 15 fields as literals, the weight options) RED 2/2 (`titleWeight: expected undefined to deeply equal { pageBuilder: { responsive: true } }`); `LinkTile.test.tsx` new describe (5) RED 5/5; `CarouselImage.test.tsx` new describe (2) RED 2/2; `fallback-parity.test.tsx` R14 (T188) RED. **Implementation** (the T185 pattern, in the shared `item-text.tsx`, so `cms.CarouselImage`'s `captionWeight` comes with it at no cost): `titleWeight`, `labelWeight` and `captionWeight` = T151's `textWeightField` + `PB_RESPONSIVE_METADATA` (same options and labels, Responsive tab; `responsiveFields` of the registry and the cms manifest). `itemWeightOf`: the weight per tier (`resolveResponsive` + `textWeightCss`); no tier with a weight → nothing (no span when nothing else is chosen); the same weight at every tier (plain, `{base}` only, equal tiers) → T151's inline `font-weight`, byte-identical (asserted); weights that differ → the text's span gets `cmsc-pb-item-weight` + `--pb-item-weight(-md|-lg)`, every tier written, a tier without its own weight given today's: a sized text's `var(--cmsb-t-<token>-w, <literal>)`, else `initial` (the declaration invalid at computed-value time, so the span inherits the item's own weight — the tile's 600, the caption's or its caption style's — exactly as the text did with no span). **Decision:** a new class rather than the existing `.cmsc-pb-text-weight`, whose `-md`/`-lg` rules fall back to the tier below, which `initial` would trigger; each `.cmsc-pb-item-weight` rule reads only its own tier's variable (from 768 / 1024 px up), after the type tokens' weights. The editor resolves the previewed tier into an inline weight. Types widened to `TextWeight | ResponsiveProp<TextWeight>`. **Changed existing assertions (standing rule 13):** `LinkTile.test.tsx` T178 "…its hover colour follows its weight…" → "…follows its font since T188…" and `item-hover-color.test.tsx` T172 "…each after its weight…" → "…each after its font…": the registry lists responsive fields after the others, so the weights moved from before the hover colours to before the resting colours (now also asserted). No new label. Fixture: `block-declarations.test.ts` `titleWeight` / `labelWeight` / `captionWeight` per breakpoint as non-prose.
  **Verification:** `pnpm run build:packages` exit 0, `dist/cms-components.css` rebuilt and kept (three `.cmsc-pb-item-weight` rules); cms-components whole package 70 files / 1246 green; mod-cms whole package 27 / 316; storefront `test/ssr` `blocks` + `block-ssr-floor` 19; admin `page-builder-field-i18n` 64 + `page-builder-i18n` 5; `check:block-names` declared=99 rendered=99 findings=0, `check:class-vocabulary` findings=0, `i18n:hardcoded` findings=222 regressions=0 drained=0, `check:docs-translations` findings=0, `check:release-intent` violations=0; typecheck clean for cms-components, mod-cms, admin, storefront; lint exit 0 for cms-components and mod-cms. Docs: `cms/index.md` paragraph on the weights per breakpoint after the resting colours, Polish mirrored, cache entry rewritten with `hashSourceBody()`; `contracts/blocks.md` § "R14: tile title and label weight and caption weight per breakpoint (T188)", `data-model.md` §4; changeset `163-page-builder-tile-caption-weight-per-breakpoint.md`. No new dependency.

### R15. News listing (owner request 2026-10-27)

- [X] T189 [US6] `blog.LatestPosts` card look: whatever generic options the local comparison
  shows missing (card background, image ratio per breakpoint, category chip style, title
  size/weight, read-more link with arrow, header lead and "all posts" button placement), today's
  look by default.
  **Result (2026-10-27):** **RED first:** option-parity new describe "R15 the post card's look and the header button's placement (T189)" (`blog.LatestPosts`' 25 fields after R14 and 7 selects' values as literals) RED on `LatestPosts cardBackground → cardBackground: expected [ 'hideOn', 'header', …(23) ] to include 'cardBackground'` (every old field present); `LatestPosts.test.tsx` new describe "card look and header button placement (T189)" (11) RED 10/11 (the "unset, Default or unknown values render today's cards and header" case green from the start, a guard). **Implementation** (`LatestPosts.tsx`, `latestPostsLook(props, tier)`): `cardBackground` (`createColorField`), `cardRadius` (`CORNER_RADIUS_FIELD`), `cardPadding` / `cardPaddingPx` and `cardTextPadding` / `cardTextPaddingPx` (`gapField` / `gapPxField` 0–80, per breakpoint), `imageRatio` (`createAspectRatioField`, no `auto`, per breakpoint), `hoverZoom`, `chipStyle` (`filled` / `outline` / `none`), `cardTitleSize` / `cardTitleSizePx` / `cardTitleWeight` (the shared `ItemText`, per breakpoint), `readMoreIcon` (`none` / `arrow` / `plus`, an `aria-hidden` SVG), `readMoreAlign` (`start` / `end`), `readMoreWeight`, `leadSize` / `leadSizePx` (per breakpoint) and `leadColor`, `headerButtonPlacement` (`below` / `end` / `after`, per breakpoint) and `headerButtonFullWidth` (T168's `buttonWidthField`, per breakpoint); none in `defaultProps`; the responsive ones in `responsiveFields` of the registry and the blog manifest; the Custom px only with Custom (`resolveFields`). Root classes `cmsc-pb-latest-posts--{zoom,card-pad,text-pad,chip-outline,more-end,lead-color,action-<p>,md-action-<p>,lg-action-<p>}` and `--cmsc-post-card-bg`, `--cmsc-post-card-radius`, `--cmsc-post-card-pad(-md|-lg)` (0 px where a tier is unset), `--cmsc-post-text-top` / `--cmsc-post-text-side(-md|-lg)` (today's 16 / 0 px where unset), `--cmsc-post-ratio(-md|-lg)`, `--cmsc-lp-lead-color`; the editor writes the previewed tier's only. `after` renders the button again in `.cmsc-pb-latest-posts__action` after the carousel or grid (only when some tier uses it; the stylesheet shows one copy per breakpoint); `end` lays the header content out in two columns. The shared `carouselHeaderNode` / `CarouselHeaderBlock` take optional `{ lead, button, actionClassNames }` (other callers unchanged). CSS: fallbacks are today's literals (`var(--cmsc-post-card-radius, 8px)`, `var(--cmsc-post-card-bg, var(--cmsb-bg, #fff))` — `background` became `background-color`, `var(--cmsc-post-ratio, 2 / 1)`); the paddings are longhands (a shorthand of variables is opaque to the jsdom CSSOM the parity harness reads); zoom only under `prefers-reduced-motion: no-preference`. Types in `component-types.ts` (`PostChipStyle`, `PostReadMoreIcon`, `HeaderButtonPlacement`). `fallback-parity.test.tsx` R15 (T189) +2 (today's background, 8 px corners, no padding, 16 px above the text, filled chip, 600 read-more, muted lead; breakpoint-only values keep them at the narrowest width) — written after the CSS, not seen RED. Labels en + pl in `blog/i18n` (93 keys each, `blocks.latestPosts.fields.*`, e.g. "Położenie przycisku nagłówka", "Odstęp wokół tekstu"); admin `page-builder-field-i18n` green with them (not seen RED: the labels were written first). Fixture: backend `blog/block-declarations.test.ts` carries the 20 new props as non-prose. No existing assertion changed; no new dependency.
  **Verification:** `pnpm run build:packages` exit 0, `dist/cms-components.css` rebuilt and kept; cms-components whole package 70 files / 1260 green; mod-blog 2 / 22; backend unit `blog/block-declarations` 5; storefront `test/ssr` `blog-latest-posts`, `block-ssr-floor`, `blocks` 22; admin `page-builder-field-i18n` + `page-builder-i18n` 69; `check:block-names` declared=99 rendered=99 findings=0, `check:class-vocabulary` findings=0, `i18n:hardcoded` findings=222 regressions=0 drained=0, `check:docs-translations` findings=0, `check:release-intent` violations=0; typecheck clean for cms-components, mod-blog, storefront, admin, backend; lint 0 errors for cms-components and mod-blog (3 pre-existing `react-hooks/exhaustive-deps` warnings in blog admin pages not touched). Docs: blog module page § "Page Builder block: latest posts" **Card and header look** table, Polish mirrored, cache entry rewritten with `hashSourceBody()`; `contracts/blocks.md` § "R15: post card look, lead and header button placement (T189)", `data-model.md` §4; changeset `163-page-builder-latest-posts-card-look.md`.
- [X] T190 Local only (never committed): create test blog categories and posts with library images
  through the admin API, publish them in the local channels, put the news listing on the local
  reference page and compare; refresh `home-gaps.md`.
  **Result (2026-10-27):** A git-excluded seeding script creates, through the admin API and idempotently, 3 test categories and 8 published test posts with neutral copy and a library image each, in both local channels and both languages (a `--remove` mode deletes them); the storefront list endpoint returns them with images in both channels. The local rebuild puts the news listing with the T189 options on the local page. Published page: HTTP 200, the T189 classes and variables in the server HTML, `scrollWidth` equal to the viewport and no hydration warning in 2 loads each at 375/768/1440. Headless-Chrome probes against the reference: card background and corners, image ratio per breakpoint, chip, title size and weight, read-more icon, alignment and weight, slides per view, arrows, lead and the header button's placement and width match at 375/768/1024/1440 (insets within ±4 px). Gaps recorded: the space under the read-more below desktop, the title's line height (the type token's), the header's fixed spacing, and the container width. Observation: the storefront reads the posts in the browser's language rather than the page's.

### R16. Editor consistency (owner review of the admin editor, 2026-10-27)

Owner feedback from the admin editor: sources that govern their fields, settings shown only
when they apply, one list per concept, and two defects (the listing preview's empty summary and
"(missing renderer)" entries). Plan § *Extend, don't narrow* holds: every stored page renders as
before.

- [X] T191 [US2] `cms.Hero` poster source: a **Poster source** select (Asset library / URL)
  governs both posters in the admin's hero media control — library: **Poster image** + **Mobile
  poster image**; URL: **Poster URL** + **Mobile poster URL**. New `media.posterUrl`, rendered like
  `mobilePosterUrl` (made absolute). A stored media with no source shows the one its values imply.
  **Result (2026-10-27):** **RED first:** `Hero.test.tsx` "poster by URL (T191)" (4) RED 3/4 (the
  "library wins" case green from the start, a guard); admin `hero-fields.test.tsx` the T162 case
  replaced by "T191: the poster source governs both posters…" and "a stored video with no poster
  source shows the one its values imply" (5 cases), written before the control and first run after
  it (not seen RED). **Implementation:** `HeroMedia` (video) gains
  `posterSource?: 'library' | 'url'` and `posterUrl`; `HeroVideos` picks each poster with
  `pickBySource` — unset or `library`: the library image before the URL (today's rule, so a stored
  hero is unchanged); `url`: the URL first, the library image as the fallback. **Decision:** the
  chosen source wins rather than "the library always wins", so switching to URL with a library
  image still stored shows the URL; unset keeps the owner's "library wins". `HeroFields.tsx`:
  `heroPosterSource(media)` (stored, else implied: a URL set and no library image → `url`); the
  control writes `posterSource` only when the editor changes it. The plain `MEDIA_FIELD` gains
  `posterSource` and `posterUrl`. The hero control's kind and source options now read their
  bundle labels. New shared helpers in `cms-components/src/utils/media-source.ts`
  (`impliedMediaSource`, `pickBySource`), exported. Labels en + pl
  `blocks.hero.fields.media.fields.{posterSource,posterUrl}.*`.
- [X] T192 [US2] `cms.Hero` overlay: `direction` only for a gradient, `strength` only for solid or
  gradient (`resolveFields`, stable field objects); "Kind" → "Type" for the overlay and the media
  select, and for every other page-builder select labelled "Kind"; the overlay explains itself.
  **Result (2026-10-27):** **RED first:** `Hero.test.tsx` "overlay fields follow its type (T192)"
  (3) RED 2/3. **Implementation:** `OVERLAY_FIELD` labelled **Overlay (darkens the background
  media)** (the field system has no description slot, so the label carries it); `overlayFieldFor`
  replaces the host field's `objectFields` per `props.overlay.kind` (none: `kind`; solid: `kind`,
  `strength`; gradient: `kind`, `direction`, `strength`), cached per host field object and type in
  a `WeakMap`, so Puck gets the same object each time and the translated copy keeps working. Grep of
  the blocks: "Kind" also labelled `cms.MediaText`'s media select and `cms.Image`'s overlay select;
  all four are now **Type** / **Media type** (en) and **Typ** / **Typ mediów** (pl). **Changed
  existing assertions (standing rule 13):** admin `hero-fields.test.tsx` and
  `section-block-fields.test.tsx` find the select as "Media type"; option-parity T042 reads the
  overlay's strength with a solid overlay (today's `overlayOpacity` is a solid overlay's strength).
- [X] T193 [US2] `cms.Hero` **Elements: order and spacing**: one list `order: [{element, space?,
  spacePx?}]` replaces "Order of elements" + "Space after an element"; a stored `spaceAfter` is
  still read for elements whose item has no space; `resolveData` carries it into `order` once,
  expanded to the full effective order.
  **Result (2026-10-27):** **RED first:** `Hero.test.tsx` "elements: order and spacing in one
  list (T193)" (5) RED 4/5 (the "no `spaceAfter`" case green from the start, a guard) and the T145
  field case rewritten for the merged list (RED); a 6th case
  through Puck's `resolveAllData` was added after the offline ref-home render showed Puck merges the
  resolved props over the stored ones — RED (`spaceAfter` survived), then green with an explicit
  `spaceAfter: undefined`. **Implementation:** `HeroOrderItem` (`space?: SpaceToken | 'custom' |
  'default'`, `spacePx?`); `heroElementSpaces(order, spaceAfter)` (the first `order` item per
  element with a known space, else T145's first valid `spaceAfter` entry) feeds the unchanged
  `spaceAfterAttrs` output (names in the default element order), so markup is byte-identical;
  `carrySpaceAfterIntoOrder(props)` builds the full `heroElementOrder` list, keeps each item's own
  props, attaches the carried space (and `spacePx` only for Custom) and drops `spaceAfter`.
  The `order` field: `space` (**Space after**: **Default (space between items)**, then T145's
  options) and `spacePx` (always shown — Puck's array fields cannot vary per item), summarised by
  `element` (`metadata.pageBuilder.summaryField`). `spaceAfter` leaves the panel and is
  `@deprecated` in the type. No other block has an order + space-after pair. Labels en + pl
  `blocks.hero.fields.order.*`; the `spaceAfter` keys removed. **Changed existing assertions:**
  option-parity's R7, R8 and T168 hero baselines name `spaceAfter`; a documented
  `MOVED_FIELDS = { spaceAfter: 'order' }` meets it by asserting `order` holds `element`, `space`
  and `spacePx` (nothing else relaxed); the R7 spacing case reads `order.space`
  (`['default', …T145's]`). Fixture: `block-declarations.test.ts` carries `order[].space` and the
  T191/T194 props as non-prose.
- [X] T194 [US2] `cms.Video`: Embed shows **Video URL** + **Provider** only; a file has a **File
  source** (library / URL) governing the video and mobile video and a **Poster source** governing
  both posters (new `posterUrl`); `resolveFields` hides the rest; a stored block with no source shows
  the one its values imply.
  **Result (2026-10-27):** **RED first:** `Video.test.tsx` "file and poster sources (T194)"
  (13) RED 12/13 (the embed case green from the start) and the fields case extended (RED). **Implementation:** `fileSource`, `posterSource`,
  `posterUrl` (types and plain fields; the admin keeps its pickers for the asset ids and text boxes
  for the URLs). Render: `pickBySource` per source — unset reads as the library, today's rule.
  `resolveFields`: an embed drops both sources and every file field but `url`; a file drops
  `provider` and the fields of the source not chosen (stored, else `impliedMediaSource`).
  `resolveData` records the implied sources on a file with none (Puck shows a select's stored
  value), which renders what it rendered (asserted: same HTML before and after for five stored
  shapes). **Changed existing assertions:** `Video.test.tsx` T142/T162 "offers the mobile URL /
  mobile poster for a file only" now name the source that offers them; option-parity's Video R7
  and R9 baselines read the union over the four source combinations (`fieldsAcrossSources`, which
  also asserts both selects in each). Labels en + pl `blocks.video.fields.{fileSource,posterSource,
  posterUrl}.*`; admin `video-image-fields.test.tsx` asserts the selects and the `posterUrl` box.
- [X] T195 [US5] Rich-text image dialog: (a) **Image source** Asset library / URL where the host
  provides a picker; (b) the Width row: number fills the row, unit select fixed width.
  **Result (2026-10-27):** **RED first:** `rich-image.test.tsx` "library or URL, and the width
  row (T195)" (5) RED 5/5; admin `page-builder-admin/rich-image-library-picker.test.tsx` (3) was
  written before the admin side but first run after it (green; not seen RED).
  **Implementation:** no seam existed for `cms-components` to reach the admin's pickers (they are
  custom fields built in `page-builder-admin`), so `page-builder-core` gains
  `PageBuilderImagePickerProvider` / `useImagePicker()` (`fields/image-picker.tsx`, a component
  `{onPick, onClose}` answering `{url, alt?}`). `ImageDialog`: with a picker, a source select
  (library first for a new image, URL for an existing one), a **Choose from the library** button
  with a preview of the chosen image, the alt text filled only when empty; without one, today's URL
  field. `page-builder-admin`: `AdminImagePicker` (the asset library modal; a summary's detail is
  read for its alt text) and `pickedImageFromAsset` (the stable `fileUrl`, absolute; alt in the
  admin's language first), mounted by `PageBuilderColorPaletteProvider` next to
  `PageBuilderFieldText`, so the page and e-mail editors both have it. Width row: the conflicting
  `cmsc:w-full` + `cmsc:w-[72px]` split into `DIALOG_CONTROL_CLASS` (no width) + `cmsc:w-full` for
  full-width controls and `cmsc:w-[76px] cmsc:flex-none` for the unit; the classes are in the built
  `dist/cms-components.css`. Copy via `useFieldText` keys `richImage.*`, en + pl in the `core`
  bundle (`pageBuilder.fieldText.richImage.*`; `sidebar-field-layout.test.tsx` checks every key).
- [X] T196 [US6] Product listings: the editor preview's summary line, and the label of the line
  under the product name.
  **Result (2026-10-27):** Root cause confirmed: `mapAdminProductToCmsSummary` returned no
  `summary`, so in the editor the summary line — and a Showcase card's default line — were always
  empty; "Card style default" showed no SKU because the slider's cards were Showcase, whose default
  line is the summary. **Tests first, not seen RED** (written before the code, first run after
  it): admin `admin-catalog-preview-map.test.ts` (summary from the description, in the name's
  language; the existing mapping case gains `summary: null`), `contracts`
  `product-summary-text.test.ts`, and `product-listing-parts.test.tsx` (labels; Showcase's default
  line is the summary).
  **Implementation:** `productSummaryText` and `PRODUCT_SUMMARY_MAX_LENGTH` moved to
  `@endora-commerce/contracts` (`product-summary-text.ts`, a pure helper both modules may import);
  catalog's `services/product-summary-text.ts` re-exports them (its 7 tests unchanged and green;
  `catalog-query.service.ts` unchanged). The admin preview maps the admin payload's `description`
  (picked like the name) through it. `cardTextLine` relabelled **Text under the product name**:
  **Card style default (SKU; summary on Showcase)**, **Short description (from the product
  description)**, **SKU**, **None** (en + pl in `catalog/i18n`). Stored values unchanged.
- [X] T197 "(missing renderer)" placeholders for TipTap nodes in the editors.
  **Result (2026-10-27):** **RED first:** `block-tree.test.ts` "countComponentNames" (3) RED 2/3
  (the "migration walk unchanged" case green, a guard); admin `block-degradation.test.tsx` new case
  (a hero with a TipTap body and a RichContent block: the merge returns the config unchanged, no
  `doc`/`paragraph`/`text`/… entry) and the editor source assertion, written with the switch and
  first run green. **Decision:** `countBlockNames` is unchanged — the rename migrations and the
  report need every `type` (a hand-written node may lack `props`; its header says so) — and a
  sibling `countComponentNames` (a string `type` beside a `props` object) serves the editors. All
  three editors switched: `PageBuilderEditor.tsx`, `EmailEditorPane.tsx`,
  `DocumentTemplateEditor.tsx`; `email-block-contributions.test.tsx` asserts the e-mail pane's use.
  `block-tree.ts` header and `withMissingBlockPlaceholders`' doc updated. **Live check:** the
  running admin (dev server serving the new `page-builder-core` build, verified) opened on the local
  reference page shows no "(missing renderer)" text anywhere in the editor (local Playwright probe,
  git-excluded).

**R16 verification (2026-10-27):** packages built (`--filter "./packages/**" --filter
"!@endora-commerce/cli"`) exit 0, `dist/cms-components.css` rebuilt and kept. Tests: contracts 58
files / 1257; page-builder-core 29 / 207; cms-components 70 / 1295; mod-cms 27 / 316; mod-catalog
11 / 107; mod-blog 2 / 22; mod-document-templates 9 / 159; admin whole suite 358 / 3619;
storefront whole suite 161 / 1691. Backend `test:unit:fast`: 25 files failed in the sandbox, 16
when re-run outside it — all spawn shell scripts or temp-dir fixtures (BSD `date`/`awk`,
`/private/var` paths, `check-pdfmake-footprint.sh` integer test, `check-naming.sh`), none touching
this change. Checks: `check:block-names` findings=0, `check:class-vocabulary` findings=0,
`check:docs-translations` findings=0, `check:module-docs` findings=0, `check:release-intent`
violations=0, `i18n:hardcoded` findings=222 regressions=0, `check:block-renderers`,
`check:bundle-pairing`, `check:default-language-prose` clean, `check:language` OK. Typecheck clean
for contracts, page-builder-core, cms-components, page-builder-admin, mod-cms, mod-catalog,
mod-document-templates, admin, backend, storefront; lint 0 errors (pre-existing warnings only).
**Stored pages:** the local reference page's storefront SSR HTML is identical before and after
outside the dev-mode scripts; rendered offline with the new build, its stored tree and the tree
after the editor's `resolveAllData` (hero `spaceAfter` carried into `order`) give byte-identical
HTML, and its hero and video markup equal the storefront's (URLs masked). Docs: `cms/index.md`
(Rich Content image source, Hero overlay / elements list / poster source, Video sources, the
carried spacing list), `extending-page-builder.md` (what the editors count as a stored block),
`catalog.md` (Text under the product name), Polish mirrored, cache entries rewritten with
`hashSourceBody()`; `contracts/blocks.md` (hero `media`, `overlay`, `order`, `spaceAfter`; video
sources; rich-text images; listing labels), `data-model.md` §4. Changesets
`163-page-builder-media-poster-and-file-sources.md`,
`163-page-builder-hero-overlay-type-and-element-spacing.md`,
`163-page-builder-rich-image-library-picker.md`, `163-catalog-card-text-line-preview-summary.md`,
`163-page-builder-component-names-walk.md`. No new dependency.

### R17. One settings panel (owner's UX audit of the admin editor, 2026-10-27)

A read-only audit of every bundled block's settings panel (field trees, tabs, Polish coverage)
listed 34 items; the owner delegated four decisions (shared translations, links, switches,
sides). Plan § *Extend, don't narrow* holds: every stored page renders byte for byte as before.
RED counts are from the first run of each new test against the pre-R17 code.

- [X] T198 [US1] `withHideOn` re-adds **Hide on** when a block's own `resolveFields` returns a
  constant field set (heading, row, table, map had lost it).
  **Result:** **RED first:** `with-hide-on.test.tsx` "re-adds `hideOn`…" RED 1/13;
  `cms-components/src/editor/panel-consistency.test.ts` "every bundled block keeps Hide on" RED
  4/47 (`cms.Row`, `cms.Heading`, `cms.SimpleTable`, `cms.Map`). **Implementation:** `finish()`
  puts `hideOn` first when absent. `cms.Row`, `cms.Heading` and `cms.Map` now also filter the host's
  field set (`params.fields`) instead of their constants, so the admin's swaps (the row's
  background picker, the map's link picker) survive `resolveFields`.
- [X] T199 [US1] One switch control: `createToggleField({ label, defaultValue?, metadata? })` and
  `ToggleSwitch` in `page-builder-core` — a native `<button role="switch">` with `aria-checked`, named
  by `aria-label` = its visible words, inside a `<label>` (a click on the words toggles it); the
  block's render default while the prop is unset; `metadata.pageBuilder.toggle: true`. With the
  responsive metadata it edits the Responsive tab's breakpoint (`readScopedValue` /
  `writeScopedValue`, inherited hint and reset). Stores the same booleans.
  **Result:** **RED first:** `toggle-field.test.tsx` (6) RED (module missing); the two per-breakpoint
  cases were written after the responsive mode and first ran green. No opacity on the disabled state
  (the side bar's contrast rule, `sidebar-field-layout.test.tsx`).
- [X] T200 [US1] Shared fields translated once (owner decision, item 2). **Decision:** fits
  `specs/conventions/module-i18n.md` — the shared fields are `page-builder-core`'s and
  `cms-components`' own definitions, whose copy already lives in the `core` bundle
  (`pageBuilder.fieldText.*`), and block-specific fields stay module-owned (R-24). A shared field
  carries `metadata.pageBuilder.sharedLabel = { key, en }` (`withSharedFieldLabel`,
  `sharedFieldLabel`, `PAGE_BUILDER_SHARED_FIELD_KEYS`: editorName, hideOn, stackOrder, margin,
  padding, border, background, cornerRadius, shadow, color, fontFamily, fontStyle, fontSize,
  fontWeight, textAlign, lineHeight, minHeight); the marker is honoured only while the field keeps the
  label it was made with, so a block that relabels a shared field (`Image – rounded corners`) keeps
  its own key. `page-builder-i18n.ts` reads `<block key>` → `core:pageBuilder.sharedFields.<key>` →
  English, for labels and options (`applyPageBuilderTranslations`' fifth argument, wired in
  `PageBuilderEditor`), and now translates options a custom field carries. The block keys of shared
  fields were removed from the `cms`, `catalog`, `blog` and `newsletter` bundles (one translation).
  `align` and `linkTarget` are not shared definitions (each block declares its own; `linkTarget` is
  gone with T212), so they stay module-owned.
  **Result:** **RED first:** `shared-field-label.test.ts` RED 1/3 (the editor name and Hide on
  unmarked). `admin/test/modules/cms/page-builder-i18n.test.ts` "shared fields (R17, T200)" (4) was
  written after the resolver and first ran green.
- [X] T201 [US1] The words inside the page builder's controls from the host: spacing (modes, sides,
  the uniform input's name), border (switch, modes, styles, sides), the per-breakpoint hints (the
  inherited value — an object one no longer printed as `[object Object]` — and reset), the editor
  name's placeholder and hint, the core background control and `cms`' admin background control (the
  section background's existing `pageBuilder.fieldText.section.*` keys), and `page-builder-admin`'s
  asset picker (`pageBuilder.assetPicker.*`; the dialog title by asset kind). The core English copy
  is US spelling (`color`). **Result:** **RED first:** `field-copy.test.tsx` RED 6/6. The
  `i18n:hardcoded` ledger for `AssetPickers.tsx` lowered 5 → 2 (two-way ratchet).
- [X] T202 [US1] A border side's **Width (px)** / **Style** / **Color**: small visible labels over
  the three controls and `aria-label`s (with the side, "Top – Width (px)", in the each-side mode).
  **Result:** RED with T201 (2 of the 6 cases).
- [X] T203 [US1] Every bundled block's field and option labels resolve to Polish.
  **Result:** **RED first:** `page-builder-field-i18n.test.ts`, widened from the new and reshaped
  blocks to every block of the CMS palette (deliberately changed, standing rule 13), RED 21 cases:
  19 blocks (`cms.Spacer`, `Text`, `RichContent`, `Icons`, `Social`, `LogoStrip`,
  `AnnouncementBar`, `SimpleTable`, `Map`, `Column`, `Slide`, `ContactFormEmbed`, `RawHtml`,
  `RawJs`, `InsertBlock`, `InsertTemplate`, `catalog.ProductCard`, `CategoryList`, `CategoryGrid`),
  the en/pl symmetry case and the replaced "unchanged block keeps English" case. It walks the editor's
  own config at the defaults and under props that show the conditional settings, expects the owner's
  key or (for a marked shared field) the `core` one, and checks that no block keeps a key for a shared
  field. No allow-list was needed: untranslatable labels (URL, HTML, 16:9, XS…) have keys with the
  same text. Keys were generated from the editor config (a git-excluded dump), Polish written by hand.
- [X] T204 [US1] Switches everywhere a true/false is chosen: every Yes/No radio of the bundled blocks,
  the row's "Clip content" select, the carousel's loop, autoplay, equal heights and its arrows and dots
  (**Show arrows** / **Show dots**, defaults kept: arrows on, dots off, loop on), the border's **Show
  border**, the section reveal's desktop-only, the media-and-text video's autoplay (admin control) and
  a link's **Open in new tab** (shown once the link leads somewhere). **Result:** **RED first:**
  panel-consistency "no Yes/No radio or select stores a boolean" RED 26/47. `option-parity.test.ts`'s
  `optionValues` reads a switch as offering `true` and `false` (deliberately changed).
- [X] T205 [US1] US spelling and one wording: **Color scheme**, **Center**, **Email**, **Alt text**,
  the button fields' **Background color** / **Text color**; the section and section-group descriptions
  and the breadcrumb scheme label. **Result:** **RED first:** "no Colour / Centre / Centred / E-mail"
  RED 7/47; "Alt text" (T220 case) RED.
- [X] T206 [US1] Alignment per breakpoint (Responsive tab) in `cms.Icons`, `Social`, `LogoStrip`,
  `FeatureList`, `Stats`, `Statement`, `Hero`, `Tabs`; options **Left / Center / Right** (tabs:
  **Stretch**), values unchanged. **Renderers:** `responsiveAlign` / `alignTierAttrs`
  (`section-parts.tsx`) — one alignment is today's markup; tiers that differ add `data-align-md/-lg`
  (the hero's content and the feature list's and stats' grids also `cmsc-pb-text-align`, the block
  heading's measure the existing `.cmsc-text-max[data-align-*]` rules), the statement's own media
  rules, the logo strip `cmsc-pb-logo-strip--align-tiers`, the tabs `--align-md-*` / `--align-lg-*`
  placed after the bar's base rules. Icons and Social already read a responsive alignment. Registry and
  manifests' `responsiveFields` updated. **Result:** **RED first:** "`align` is on the Responsive tab…"
  RED 8/8.
- [X] T207 [US1] Gaps: `cms.Social`, `cms.LogoStrip`, `catalog.ProductGrid` and
  `catalog.CategoryGrid` take the spacing-step select + **Custom gap (px)**, per breakpoint; a stored
  number reads as Custom with that px (`numericGapAsCustom`, `resolveData`; `gapCss` reads both);
  carousels' "Gap (px)" → **Custom gap (px)**. Gaps that differ go on `cmsc-pb-gap-tiers`
  (`responsiveGapStyle`); the grids resolve the previewed/viewport tier as before. **Result:** **RED
  first:** RED 4/4 + 3/5.
- [X] T208 [US1] "Custom <thing> (px)" everywhere (heading, title, item title, caption, label, value,
  lead, statement, subheading sizes, maximum widths, paddings, icon size, minimum height). **Result:**
  **RED first:** RED 15/47.
- [X] T209 [US1] Units and ranges: **Font size (px)**, **Minimum height (px)**, **Space between columns
  (px)** / **rows (px)**, the video's **Max width (% of the available width)**; every custom maximum
  width 160–2000 px step 10 (the section's was 0–10000 step 8, the row's 320–1920 step 8; nothing
  stored is clamped); **Minimum height** for the hero and background panel ("Min height").
  **Result:** **RED first:** units case RED; "one range" RED 2/47; "Minimum height" RED 2/3 (the row
  green from the start).
- [X] T210 [US1] **Rounded corners** everywhere; a block with two names each (**Image – rounded
  corners**, **Caption – rounded corners**: carousel image). The video's "Frame corners", the link
  tile's "Image corners" and the post card's "Card corners" are the block's one corner setting, so
  plain **Rounded corners** (the shared translation). **Result:** **RED first:** RED 4/47.
- [X] T211 [US1] A text's weight next to its size, both per breakpoint: every block heading
  (`headingWeight`), the feature list's and hero's `titleWeight`, the media-and-text
  `featureTitleWeight`, the heading's `fontWeight` (moved next to `fontSize`, now **Font weight**).
  **Renderers:** `responsiveWeightProps` / `WeightSpan` (`item-text.tsx`): one weight is today's
  inline `font-weight`; weights that differ wrap the text in one `cmsc-pb-item-weight` span (a tier
  with none inherits the element's own weight). Media and text already used `ItemText`. **Result:**
  **RED first:** "<size> then <weight>" RED 15/21; `text-weight-and-measure.test.tsx` R17 cases RED
  2/2.
- [X] T212 [US1] Links (owner decision, item 5): `cms.Image`, `cms.Icons`, `cms.AnnouncementBar`, each
  `cms.LogoStrip` item and `cms.Map` markers take the shared `LinkValue` (admin: `createLinkField`
  with its pickers). **Legacy reader** (`blockLink`, `blockLinkTarget`, `carriedBlockLink`): a stored
  `href` (+ `linkTarget`) is a `url` link with the same target, a logo's with `_blank`; each block
  writes the anchor exactly as before (a URL as typed — they never filtered it); `resolveData` carries
  it into `link` and clears `href` / `linkTarget`. A marker's popup links its label (DOM nodes).
  **Result:** **RED first:** `block-links.test.tsx` RED 11/16 (the 5 "renders the link it always
  rendered" cases green from the start, guards). `link-field.test.tsx` new "only once the link leads
  somewhere" case written after.
- [X] T213 [US2] Sliders: `withoutUnusedCarouselFields(props, fields)` (`carousel-parts.tsx`) for the
  product slider, carousel and latest posts — interval with autoplay on; arrow look while arrows
  show; disabled-arrow look (and its colour, for Color) with arrows on a carousel that stops; controls
  placement/alignment/align-to while arrows or dots show. The `controls` field is cached per host
  field and kept keys. **Result:** **RED first:** RED 4/4 (the three sliders and the switches' naming case).
- [X] T214 [US1] Sources: Asset library first everywhere (image block, image objects, hero, slide
  image, responsive image control, background controls, video); a new image starts on the library.
  **Decision:** an unset source shows URL when the value has a URL (the renderers read unset as URL),
  else the library; `cms.Image`'s `resolveData` records `'url'` for such an image. **Result:** **RED
  first:** RED 1/2 ("a stored image with no source and a URL" green, a guard). Admin
  `button-image-fields.test.tsx` deliberately changed (a new image starts on the library).
- [X] T215 [US1] Sides **Left / Right** (pl **Z lewej / Z prawej**), values unchanged; labels "<Media
  | Image | Text> side (desktop)" and "Media side (tablet and up)". **Result:** **RED first:** RED 5/5.
- [X] T216 [US1] New blocks follow the section: `cms.Text` no colour, `cms.Icons` / `cms.Social`
  `currentColor`, `cms.AnnouncementBar` `token:primary` / `token:on-primary`; render fallbacks for an
  unset stored colour unchanged. **Result:** **RED first:** RED. `fallback-parity.test.tsx` "cms.Text
  keeps today's size, colour and font" deliberately changed (renders a stored `#243447`; a new text has
  no inline colour).
- [X] T217 [US2] Media and text / carousel split slide: **Poster source** governs both posters (admin
  control, `mediaTextPosterSource` = stored, else implied), new `media.posterUrl`, render through
  `pickBySource` (unset = today's library-first). **Result:** `MediaText.test.tsx` "poster source" (2)
  and admin `section-block-fields.test.tsx` "R17 (T217)" written after the change and first run green
  (the admin case failed on its first run for the missing bundle keys, then green); T162's admin case
  deliberately changed (the URLs show with the URL source).
- [X] T218 [US3] Accordion: **Item style**, item **Title**, **Divider position** only where the items
  have lines (`hasItemLines`: not with dividers none, a flush accordion or boxed items). Accordion /
  Tabs: **Item open at first** / **Tab shown at first** (`createItemIndexField`,
  `itemIndexFieldFor`: "None" (accordion), "1: <title>"…, cached per items), storing the same index; a
  stored list reads as its first element in the select. **Result:** **RED first:** RED 3/3.
- [X] T219 [US2] Order and visibility per block: media-and-text layout after the footnote (vertical
  align **Top / Center / Bottom**, pl Do góry / Do środka / Do dołu); carousel image caption look only
  with a caption, link after the caption; link tile image, title, link label, link first; CTA card
  image side only with an image, card look after the content; stats metrics before the image; feature
  list image next to the features; background panel text side after the buttons; social brand colours
  before (and hiding) the icon colour; video accessible title under the sources, muted hidden for an
  autoplaying file, corners last on the General tab (the ratio and width are responsive, so "next to"
  is the end of General); image + alt on General; row content position only with a minimum height;
  product/category grid **Equal items height** per breakpoint next to columns/view. **Result:**
  **RED first:** RED 14 cases (order and visibility, plus "Equal items height", which the first draft
  asserted non-responsive and was corrected with the design). `option-parity.test.ts` reads each block
  with props under which its conditional settings apply (`APPLIES`, deliberately changed).
- [X] T220 [US2] Wording: hero overlay directions as the image's; product card **Button label**, **Card
  style**, "Image height (px, empty = automatic)", "Max width (px, empty or 0 = full width)"; map
  markers summarised by label or "lat, lng", up to 50; latest posts number + category on the Data tab,
  the category from the blog's categories (`createBlogCategorySlugField` in `page-builder-admin`, the
  blog's admin tree as the catalog pickers read the catalog's; a text box when it cannot load; still
  the slug). **Result:** **RED first:** RED 4/4.

**R17 verification (2026-10-27):** packages built (`--filter "./packages/**" --filter
"!@endora-commerce/cli"`) exit 0, `dist/cms-components.css` rebuilt and kept. Tests: contracts 58
files / 1257; page-builder-core 32 / 225; cms-components 72 / 1718; mod-cms 27 / 316; mod-catalog
11 / 107; mod-blog 2 / 22; mod-newsletter 7 / 57 (outside the sandbox: its SMTP test listens on a
port); mod-document-templates 9 / 159; admin whole suite 358 / 3645; storefront whole suite 161 /
1691. Backend `test:unit:fast` outside the sandbox: the same 16 environment-bound files as R16 (BSD
tools, temp-dir fixtures, shell checks) plus `migration-order-boot-warning.test.ts`, which timed out
while the admin suite ran beside it and passes 3/3 alone. Checks: `check:block-names` findings=0,
`check:class-vocabulary` findings=0, `check:docs-translations` findings=0, `check:module-docs`
findings=0, `check:release-intent` violations=0, `check:block-renderers` findings=0,
`check:bundle-pairing` findings=0, `check:default-language-prose` violations=0,
`check:module-boundary` violations=0, `check:test-ownership` findings=0, `manifests:check` up to
date, `i18n:hardcoded` findings=219 regressions=0 (ledger lowered for `AssetPickers.tsx`),
`check:language` OK; `check:naming` is the known macOS failure. Typecheck clean and lint 0 errors
for page-builder-core, cms-components, page-builder-admin, mod-cms, mod-catalog, mod-blog,
mod-newsletter, mod-i18n, admin, storefront and backend. **Stored pages:** the local reference
page rendered offline with the R17 build gives the same HTML for its stored tree and for the tree
after the editor's `resolveAllData` (its images' URLs carried into `link`, their source recorded),
and that HTML is byte-identical to R16's. No demo seeder writes an affected prop (the consent
seeders write `cms.Text` with `html`, the conformance fixture `cms.Heading`). Docs: `cms/index.md`
(*The settings panel*, the video's and carousel items' corners, labels), `blog/index.md` (number of
posts and category on the Data tab, rounded corners), `catalog.md` (grid gap and equal heights),
Polish mirrored, cache entries rewritten with `hashSourceBody()`; `contracts/blocks.md` § R17,
`data-model.md` §4 (R17). Changesets `163-page-builder-switches-and-shared-field-labels.md`,
`163-page-builder-links-for-image-icon-logo-bar-map.md`,
`163-page-builder-alignment-gap-weight-per-breakpoint.md`,
`163-page-builder-settings-shown-where-they-apply.md`. No new dependency.

### R18. Safe URLs in every link, an inherited colour (owner, 2026-10-27)

RED counts are from the first run of each new test against the pre-R18 code.

- [X] T221 [US1] Safe URLs in the R17 links (owner decision): `blockLinkTarget` resolves every kind
  through `resolveLinkHref`, so a URL in `cms.Image`, `cms.Icons`, `cms.AnnouncementBar`, each
  `cms.LogoStrip` item and `cms.Map` markers passes `isSafeLinkUrl` like every other link — an
  unsafe one (`javascript:`, `data:`, `vbscript:`, `//host`) renders the content unlinked, stored as
  `href` or as a `url` link alike; a safe one is byte-identical. **Consequence of the shared rule:**
  a scheme-less relative path (`contact.html`) and a bare `#fragment` typed as a URL are refused too
  (the rule, and the contract's `linkValueSchema`, accept only `https:`, `http:`, `mailto:`, `tel:`
  and root-relative `/…`; an in-page target is the **In-page anchor** kind). **Audit:** `cms.Social`
  wrote each profile URL as typed — fixed (`profileHref`: an unsafe URL is the item's missing URL,
  the block's existing `href="#"`); `cms.Button`, `CarouselImage`, `LinkTile` and rich-text links
  already go through the rule; outside the page builder, the storefront mega menu writes a menu
  button's `url` as stored (`buttonUrlSchema` accepts any string) — reported, not changed (another
  module). `markerPopup` (`Map.tsx`) is exported for its test.
  **Result:** **RED first:** `block-links.test.tsx` "an unsafe URL renders no link" RED 45/50 (40
  block cases, 5 map cases; the 5 safe-URL and the map's safe case green from the start, guards);
  "cms.Social: an unsafe profile URL is no URL" RED 4/8 (safe and empty cases green, guards). T212's
  `contact.html` case deliberately changed to `/contact.html`; the "scheme-less relative path or
  bare fragment is refused" case was written after the change and first ran green.
- [X] T222 [US1] An inherited colour: `createColorField({ label, inherit: true })` shows
  `currentColor` / `inherit` as an empty box with the **Inherited (text color)** placeholder, the row
  marked `data-pb-color-inherited` and a half-filled `currentColor` swatch over the picker; picking a
  colour sets it, **Inherit** (and an emptied box) writes `currentColor`. `cms.Icons` **Color** and
  `cms.Social` **Icon color** use it. **Decision:** the stored default stays `currentColor` — an
  unset colour renders the `#15202b` fallback of blocks stored before T216, so unset cannot mean
  "inherit" without changing stored pages. Other colour fields: a stored `currentColor` / `inherit`
  reads as inherited (`isInheritedColor`, `colorFieldDisplayValue`), an emptied box stores nothing as
  before, and the `transparent` placeholder is translated. New `core` keys
  `pageBuilder.fieldText.color.inherited|inherit|inheritFor|transparent` (en + pl).
  **Result:** **RED first:** `page-builder-core` `color-field-inherit.test.tsx` RED 6/7 (the
  "does not inherit" case green, a guard); `cms-components` `editor/inherited-color.test.tsx` RED 2/3
  (the other-field case green, a guard).

**R18 verification (2026-10-27):** packages built (`--filter "./packages/**" --filter
"!@endora-commerce/cli"`) exit 0, `dist/cms-components.css` rebuilt and kept. Tests: contracts 58 /
1257; page-builder-core 33 / 232; cms-components 73 / 1781; mod-cms 27 / 316; mod-i18n 1 / 6; admin
whole suite 358 / 3645; storefront whole suite 161 / 1691 (`page-builder-admin` has no suite of its
own; the admin suite covers it). Typecheck clean and lint 0 problems for page-builder-core,
cms-components, mod-cms, mod-i18n. Checks: `check:block-names` findings=0, `check:class-vocabulary`
findings=0, `check:docs-translations` findings=0, `check:module-docs` findings=0,
`check:release-intent` violations=0, `check:bundle-pairing` findings=0,
`check:default-language-prose` violations=0, `check:test-ownership` findings=0, `i18n:hardcoded`
findings=219 regressions=0, `check:language` OK. **Stored pages:** the local reference page rendered
offline with the R18 build gives the same HTML for its stored tree and after `resolveAllData`, and
that HTML is byte-identical to R17's (its links are all root-relative). Docs: `cms/index.md` (*The
settings panel*: safe URLs, inherited colour), Polish mirrored, cache entry rewritten with
`hashSourceBody()`; `contracts/blocks.md` § R18. Changesets
`163-page-builder-safe-urls-in-every-link.md`, `163-page-builder-inherited-color.md`; the R17 links
changeset no longer says a URL is written as typed. No new dependency.

## Phase 14: Gate — rebase, seed, measurements, CI

**Goal**: everything a pull request runs, on the tip after the final rebase, plus the feature's
own measurements (SC-002, SC-005, SC-005a, SC-006, SC-007).

- [ ] T102 Final rebase onto `origin/master` (back up the branch first), then re-run T001.
  Regenerate and confirm that nothing moves: `pnpm install --frozen-lockfile`,
  `pnpm run build:packages`, `pnpm --filter backend run composer:generate`,
  `pnpm --filter backend run manifests:generate`, `pnpm install --lockfile-only`, and
  `git status --porcelain`, which must print nothing.
- [X] T103 Grep the residue (AGENTS.md traps 2 and 3):
  - `git grep -n -E "cms\.ImageSlider|ButtonLinkFields|CatalogBlockData|catalog-block-data"`, plus
    `cms\.NewsletterSignup` only if T076 recorded decision (b). The three tests that must name the
    removed block are allowed hits: `backend/test/integration/cms/removed-block-placeholder.test.ts`,
    `storefront/test/ssr/block-degradation.test.tsx` and
    `backend/test/unit/cms/frozen-block-renames-codomain.test.ts`,
    plus for `catalog-block-data` the deprecated compatibility re-export
    `packages/cms-components/src/utils/catalog-block-data.ts` (kept so instance storefronts copied
    from an earlier CLI keep building; coordinator ruling 2026-10-23), the CHANGELOGs and the
    0.105.0 note in `docs/docs/upgrading-an-instance.md` (history),
    must print only `frozen-block-renames.ts`, old migrations and this spec directory;
  - `git grep -n -i -E "<reference domain>|<reference brand words>"`, with the terms held in
    `local/reference-pages/README.md`, must print nothing (standing rule 11);
  - re-run `backend/test/unit/kernel/module-removal.test.ts`.
  **Result (2026-10-23, pre-commit run):** reference-site leak grep over tracked and untracked files
  (excluding `local/`): **0 hits**. Residue grep: every hit is an allowed one. These are the three
  tests that must name the removed block; the deprecated `utils/catalog-block-data.ts` re-export;
  the CHANGELOGs and the 0.105.0 upgrade note; this spec directory; `specs/151-page-builder-translate/data-model.md`
  (history); and the cms docs pages (EN, PL, translation cache) that document the removal and the
  re-export on purpose. `ButtonLinkFields` has no hit. `module-removal.test.ts` re-runs in T106.
  To repeat after the final rebase (T102).
- [X] T104 **RED → green** `backend/test/integration/cms/seeded-content-renders.test.ts` `[PG]`. On
  a database prepared by `setup` plus the demo seed, every row of `cms_blocks`, `cms_pages` and
  `cms_templates` resolves through the storefront by-slug or by-code routes. Every node type in
  them is a declared block name. The two consent blocks render their text (FR-041, SC-007). Then
  run the sequence itself on a scratch database: `pnpm --filter backend run db:reset` with
  `DATABASE_URL` pointed at a throwaway database, never the developer's working database.
  **Result (2026-10-23):** the test reads its population from the database (every row of the three tables, with its channel bindings) on the standard harness clone (`setupBackendServer({seed: 'none'})`; the `us1-catalog` seed writes no CMS content), so a seeder added later is judged without editing it. Six cases: the population holds both consent blocks (non-vacuous guard); every node in every language tree is a block name some `REGISTERED_MANIFESTS` entry declares; every block resolves by code and every page by slug on each bound channel in each declared language (id and language checked); every template resolves as the embed of a per-run `pb163_…` page (`cms.InsertTemplate`, deleted in `afterAll`), since no storefront route serves a template alone; and both consent blocks render their text in `en-US` and `pl-PL` through `resolveTextContent` (what `cms.Text`'s published render prints, and what the storefront's `NewsletterConsent`/`CookieConsentMessage` render), with no markup left. **No natural RED:** the seeded content already conformed, so the file passed on its first run (6/6). Its ability to fail was shown by a temporary mutation, reverted: `cms.Text` removed from the declared set and one expected sentence changed turned exactly the two matching cases red (`expected [ …(4) ] to deeply equal []`; `expected 'We use cookies for analytics (Google …' to contain 'We use cookies for marketing'`). On the harness the population is the two boot-seeded blocks: `cms_pages` and `cms_templates` are empty, so those two cases pass over nothing there (the template-embed path is written but not exercised by any seeded row). **Scratch run:** database `b2b_scratch163` created in this checkout's postgres container; `pnpm --filter backend run db:reset` with `DATABASE_URL=postgresql://b2b:b2b@localhost:25432/b2b_scratch163`, `REDIS_URL` on Redis db 9 (empty before, flushed after) and `MEILISEARCH_URL` pointed at an unreachable port, so neither the working database nor the dev search index was touched: exit 0, demo seeded. **Finding:** `setup` plus `demo seed` leave **zero** rows in all three tables, because both consent blocks are boot-time seeds (`newsletter` and `google_analytics` route registration via `cmsBlockSeedPort`), and no migration, install hook or demo module writes CMS content. After one backend boot against the scratch database (port 3963, `BACKEND_ROLE=api`), a scratch script (query + the storefront routes over HTTP) read `cms_blocks=2 cms_pages=0 cms_templates=0`, every node declared (97 declared names), and both blocks resolving on both demo channels (`pl_retail`, `pl_b2b_vip`) in both languages with their text (`We use cookies for analytics (Google Analytics). …`, `Tak, chcę otrzymywać newsletter …`): `ALL OK`. Scratch server stopped, database dropped, Redis db 9 flushed.
- [ ] T105 Measurements on a page rebuilt locally from the blocks: one audience landing page of
  about eight sections, built by a script under `local/reference-pages/`, not committed. Record
  the following under this task:
  - Lighthouse mobile (quickstart §7) and a scripted interaction run: open a tab, advance a
    carousel, expand an accordion, focus the sign-up. LCP ≤ 2.5 s, CLS ≤ 0.1 and INP < 200 ms are
    **all required** (SC-005a, Principle VII). If INP fails, stop and decide islands for static
    blocks with the owner before merge.
  - axe in the light and dark schemes: 0 serious violations.
  - JavaScript disabled: all text readable.
  - 320 px: no horizontal scroll.
  - A side-by-side review at 375, 768 and 1440 px against the reference, counting matched
    sections against total (SC-002, target ≥ 90%), with the deviations named. Name no site in the
    record.
  - The time someone who did not build the page needs to rebuild it with presets, measured with
    a stopwatch (SC-003, target under 45 minutes).
- [X] T106 Local cheap checks:
  - `check:release-intent -- --since origin/master`;
  - `node backend/scripts/dco-signoff.ts origin/master HEAD`;
  - `check:error-translations`;
  - `check:port-dependencies`;
  - `check:module-boundary`;
  - `check:block-names`;
  - `check:action-route-permissions`;
  - `check:docs-translations`;
  - `check:module-docs`;
  - `pnpm --filter storefront run check:themes`, after a storefront build on the fork.
  **Result (2026-10-23, uncommitted working tree on base `b816c1d55` = `origin/master`; HEAD has no commit of its own):**
  - `check:release-intent -- --since origin/master`: `contained=yes changed=0 violations=0`. It measures **commits only** and the branch has none, so this says nothing about 163; T101's snapshot-commit run (`changed=386 changesets-added=16 … violations=0`) stands until T107 re-runs it on the pushed tip. Default mode: `changesets=141 C1=0 C2=0 C3=0 C4=0 violations=0`.
  - `dco-signoff.ts origin/master HEAD`: exit 2, *"the range origin/master..HEAD holds no commit"*. Same reason: commits only; owed to T107's `dco` job.
  - `check:error-translations` `codes=358 violations=0 ledgered=50 stale=0`; `check:port-dependencies` `violations=0`; `check:module-boundary` `violations=0 ledgered=8 stale=0`; `check:block-names` `declared=97 rendered=97 findings=0`; `check:action-route-permissions` `findings=2 violations=0 ledgered=2 stale=0`; `check:docs-translations` `sources=166 findings=0`; `check:module-docs` `findings=0`; `check:class-vocabulary` `findings=0`; `i18n:hardcoded` `findings=222 regressions=0 drained=0`; `check:language` OK. For the new T104 file also `check:harness-teardown`, `check:shared-table-wipes` (`files over baseline=0`), `check:test-ownership` (`findings=0`), `check:fixture-substitution` (`violations=0`): all exit 0.
  - `test/unit/kernel/module-removal.test.ts`: 8/8.
  - `pnpm run build:packages`: **`@endora-commerce/cli` fails** with `ENOENT … storefront/components/CatalogBlockData.tsx`: `write-storefront-reference.mjs` enumerates the storefront with `git ls-files`, which reads the index, and the T067 rename (`CatalogBlockData.tsx` → `BlockData.tsx`) is not staged. An artefact of the uncommitted tree, not a code defect: with a temporary index that holds the working tree (`GIT_INDEX_FILE`, real index untouched) the CLI builds (`storefront-reference: 558 files, 2 omitted`). Every other package built (77). It will pass once the work is committed (T102/T107).
  - `test:unit:fast`: 17 files failed (146 tests), 343 passed. 16 of them fail identically (same per-file counts, 145 tests) on a pristine `origin/master` worktree: `ci/dockerfile-workspace-supply`, `ci/docs-publication-guard`, `packages/package-entity-lookup`, `packages/package-schema`, `scripts/check-action-route-permissions`, `scripts/check-diacritic-folds`, `scripts/check-inventory`, `scripts/check-lock-claims`, `scripts/check-nul-bytes`, `scripts/check-read-size`, `scripts/migration-scaffold-roots`, `scripts/module-package-artefacts`, `scripts/moved-module-tree`, `scripts/package-schema-acceptance`, `scripts/read-size`, `scripts/shell-checks` (shell tooling, `du -b`, `/private/var` paths: local-only). The 17th, `tenancy/classification-check` (*"@endora-commerce/mod-invoices: package read 5 entity class(es), repository read 4"*), was a stale `packages/modules/invoices/dist` (`invoice-template.entity.js` left over from before master's `f2769d7c3` deleted its source; `tsc` does not clean). It is not caused by 163. After `rm -rf` of that gitignored `dist` and a rebuild, 9/9. **None caused by 163.**
  - `pnpm --filter '!backend' run test`: every workspace green (admin 354 files/3541 tests, storefront 161/1690, cms-components 51/539, page-builder-core 27/182, contracts 57/1238, mod-cms 27/297, mod-blog 2/22, mod-newsletter 7/57, mod-catalog 11/107, the rest green) **except `packages/cli`** (3 files, 10 tests): `install-wizard-tty` ×4 = util-linux `script` missing on macOS (local-only); `new-storefront` ×4 and `non-interactive-guarantee` ×2 = the same unstaged-rename `ENOENT` as the CLI build. Re-run in a scratch worktree with the working tree applied and staged in **its** index: 74/75 green. The one left, *"blocks:generate runs clean in the copy"*, gets empty stdout with exit 0. `generate-blocks.mjs`'s `import.meta.url === pathToFileURL(argv[1])` guard does not match under macOS's `/var` → `/private/var` symlink, so `main` never runs. That is the known local-only path issue, and neither the script nor the test is changed by 163.
  - Typecheck + lint, filtered, exit 0 for every touched workspace: `backend`, `admin`, `storefront`, `docs`, `admin-kit`, `cms-components`, `contracts`, `page-builder-core`, `page-builder-admin`, `mod-i18n`, `mod-blog`, `mod-catalog`, `mod-cms`, `mod-newsletter`, `mod-settings`.
  - `pnpm --filter storefront run build` (49 s, runs `check:themes` itself): exit 0, `[theme-registry] ok: findings=0`; it left the storefront's git status unchanged. Afterwards `packages/cms-components/dist/cms-components.css` was restored with `git checkout --`.
  - Owed to T107 (need a commit): `release-intent --since` and `dco` on real commits, the CLI build and CLI tests on a committed tree.
- [ ] T107 Push the branch to the fork and open a draft pull request. Record the result of every
  CI job on the pushed tip: `quality`, `quality:static`, `test:backend:unit`, `test:frontend`,
  `release:changeset`, `pack-gate`, `boot-gate`, `build:docs` and `dco`. Then run the
  service-backed set on the fork with a `ci-pg-files.txt` listing every `[PG]` file this feature
  adds or changes:
  - `test/contract/cms/{brand-tokens,anchors,page-tree,storefront-page-by-slug,page-builder-translation,page-builder-translation-nested}.contract.test.ts`;
  - `test/contract/blog/posts-list.contract.test.ts`;
  - `test/contract/settings/shop-info.contract.test.ts`;
  - `test/contract/admin_users/permission-inventory.test.ts`;
  - `test/contract/catalog/category-content.test.ts`;
  - `test/integration/cms/{migration,removed-block-placeholder,seeded-content-renders}.test.ts`
    and the cms off-state file;
  - `test/integration/blog/off-state.test.ts` (new) and `test/integration/newsletter/off-state.test.ts`;
  - `test/integration/newsletter/cms-block-subscribe.test.ts`;
  - `test/contract/kernel/openapi-baseline.test.ts`.

  A red job or file is fixed on the feature branch with a new signed commit.
- [ ] T108 Record T102–T107 in this file (tip and base hashes, CI results, measurements) as a
  `tasks.md`-only commit. The pull request body follows `.github/pull_request_template.md` in
  English and lists the owner rulings: the five spec clarifications and plan Q1–Q3.

---

## Dependencies and order

- **Setup (Phase 1) → Foundational (Phase 2) → everything.**
- **US1 (Phase 3)**, in the order 3a → 3b → 3c. Phases 3d, 3e and 3f follow 3b; 3e and 3f also
  need 3d.
- **US2 (Phase 4)** needs 3d and 3f.
- **US3 (Phase 5)** needs 3d and 3f, and is independent of US2.
- **US4 (Phase 6)** needs 3d and 3f.
- **US5 (Phase 7)** needs 3f, and 7b needs T014.
- **US6 (Phase 8)** needs 3d, 3f and US4's T052 (the slider options).
- **US7 (Phase 9)** needs 3d and 3f.
- **US8 (Phase 10)** needs only Phase 2, and can start right after it.
- **US9 (Phase 11)** needs US8's T078 (the migration).
- **US10 (Phase 12)** needs 3d and US2/US3, because Hero and Statement exist.
- **Polish (Phase 13)** needs every story it documents or labels.
- **Gate (Phase 14)** comes last.

Once 3f has landed, US2, US3, US4, US5 and US7 can run in parallel worktrees. They touch
disjoint component files, but they share `cms/src/manifest.ts`, `component-types.ts`,
`src/index.ts`, `cms-components.css`, `block-declarations.test.ts` and the i18n bundles. Merge
those files serially, one phase at a time. US8 can run in parallel with everything after
Phase 2.

## Parallel examples

- **Phase 2**: T005, T006, T009, T011, T013 and T015 are independent RED tests, so write them
  together, then T007, T010, T012, T014 and T016.
- **Phase 3a**: T017 and T018 together, then T019 → T020 → T021 → T022.
- **Phase 5**: T045, T046 and T048 together, then T047 and T049.
- **Phase 8**: T064 alongside T066, T068 and T072, since they touch different packages.
- **Phase 13b**: T097, T098 and T099 together.

## Implementation strategy

1. **MVP is US1** (Phases 1–3): brand tokens, section settings, schemes, anchors, headings and
   buttons. It is demonstrable on its own (quickstart §1–§2), and it changes no page that does not
   use it (standing rule 9).
2. **Then US2 + US3.** The hero and the compositions make most reference sections reproducible.
3. **Then US4–US6**: carousels, nested panels, dynamic listings.
4. **Then US7–US10**: newsletter, breadcrumbs, metadata, motion.
5. **Polish and Gate.**

Each step ends with a commit on the branch and can be reviewed on its own.

## Requirement → test

| Requirement | Test(s) |
| --- | --- |
| FR-000 | T009, T030, T034, T035, T096 |
| FR-001 | T005 (`normalizeAnchor`), T036, T037, T038 (anchor link) |
| FR-002 | T023 (scheme rebinding), T030, T035 |
| FR-003 | T030, T032 |
| FR-004 | T030, T032 |
| FR-005 | T030 (padding-only spacing), T091 |
| FR-006 | T006, T017, T023, T026 |
| FR-006a | T017 (403, one audit entry, revalidation), T018, T019 |
| FR-006b | T006, T017 (`warnings`), T028 |
| FR-006c | T023 (fonts), T028 (asset picker) |
| FR-007 | T038 |
| FR-008 | T013, T038, T012 (`InlineRich`) |
| FR-009 | T005, T011, T038 |
| FR-010 | T011 (`Picture`), T030 |
| FR-011 | T042 |
| FR-012 | T030, T042 (reduced motion, breakpoint video) |
| FR-013 | T045 |
| FR-014–FR-016 | T046 |
| FR-017, FR-018 | T048 |
| FR-019 | T051 |
| FR-020 | T053 |
| FR-021 | T053 and quickstart §4 step 2 (asset replace) |
| FR-022 | T051 (SSR items, a11y) |
| FR-023, FR-024 | T058, T060 |
| FR-025 | T061 |
| FR-026 | T064, T066, T068, T069 (incl. new blog off-state) |
| FR-027 | T070, T071 |
| FR-028 | T072 |
| FR-029 | T073, T075, T077 |
| FR-030, FR-030a | T079, T082 |
| FR-031 | T079, T082 |
| FR-032 | T079 |
| FR-033 | T083, T085 |
| FR-034 (amended Q1) | T083 (`languages`), T085 (`alternateLocale`) |
| FR-035 | T087, T088 |
| FR-036, FR-036a | T089, T011 (lazy and priority), T051 (CSS per view) |
| FR-037 | T089 |
| FR-038 | T027 (preview tokens), every block test rendering through the shared component, the SSR floor |
| FR-039 | T094, T095 (owning-module bundles) |
| FR-040 | T103 (grep), standing rule 11 |
| FR-041 | T041, T104 |
| FR-041a | T055, T056 |
| Plan § *Extend, don't narrow* | option-parity test cases in T034, T038, T042, T048, T053 and T076 (a); default-look cases added to T024 |
| FR-042 | T092 |
| SC-001, SC-002 | T105 (rebuild and side-by-side record) |
| SC-003 | T105 (timed rebuild with presets, recorded) |
| SC-004 | T024, T026, quickstart §1 |
| SC-005, SC-005a | T105 (LCP, CLS and INP all gating), T051, T089 |
| SC-006 | T105 (axe) |
| SC-007 | T104 |

## R19A — text & content blocks

Gaps found while rebuilding the local reference pages (coordinator brief R19, area A). Every new
option is optional; unset renders today's markup byte for byte (each block's "unset" case in
`text-and-content-options.test.tsx`). RED counts are from the first run of each new test file
against the pre-R19A code: `text-and-content-options.test.tsx` **RED 29/42** (13 green from the
start: the unset guards, the Hero token gap, the Hero media-above unset case and T239, see
below); `rich-text-size-and-markers.test.tsx` **RED 8/11** (green: the lists stored before, an
unknown marker, the unset prose).

- [X] T223 [US3] A block text's own size, weight, line height and colour (`text-style.ts`,
  `textStyleAttrs`, `lineHeightField`): one value inline, values per breakpoint as
  `cmsc-pb-ts-size|weight|leading` + `--pb-ts-<name>(-md|-lg)` (every tier written, Default tiers
  carry the block's own value), rules at the end of `cms-components.css`. Covered through
  T224–T236.
  **R23:** Superseded in part by R23 T435: a token size carries its own line height, weight and tracking; a line height only with Custom px; the added weights are one value.
- [X] T224 [US3] `cms.FeatureList` item text: `bodySize`/`bodySizePx`, `bodyWeight`,
  `bodyLineHeight`, `bodyColor` (today: 0.9 rem / 1.45 / muted).
  **R23:** Superseded in part by R23 T435/T436: `bodyWeight` is one value, `bodyColor` removed.
- [X] T225 [US3] `cms.FeatureList`: `titleLineHeight`; `iconSpacePx`, `titleSpacePx` per
  breakpoint (fallbacks 8 / 4 px); `iconPosition: 'beside'` (icon beside the title, title and text
  hanging beside it, `data-icon-position`).
  **R23:** Superseded in part by R23 T437: `iconSpacePx` / `titleSpacePx` replaced by `innerSpace`.
- [X] T226 [US3] Hanging indent after a leading inline icon: `InlineRich` `hangingIcon`
  (`.cmsc-hang`), `cms.Heading` `hangingIcon` (switch) + `hangingIconGapPx`. **Decision:** opt-in
  on the heading (unset keeps the stored markup); a feature list's icon uses T225's `beside`.
  **R23:** Superseded in part by R23 T439: `hangingIconGapPx` removed (the indent keeps 0.35 em).
- [X] T227 [US2] `cms.Hero`: subheading and statement `…Weight`, `…LineHeight`, `…MaxWidth(Px)`;
  body `bodySize(Px)` (Default 16 px), `bodyWeight`, `bodyLineHeight`, `bodyMaxWidth(Px)`.
  **R23:** Superseded in part by R23 T435: the weights are one value, line heights only with Custom px.
- [X] T228 [US2] `cms.Hero` `gaps`: Custom (px) with `gapsPx` per breakpoint (before: a non-token
  value was ignored, read as `m`). **Decision:** supported rather than rejected; a stored
  `gaps: {px: n}` (an ad-hoc shape) still reads as `m`, unchanged.
- [X] T229 [US2] `cms.Hero` `mediaSpace`/`mediaSpacePx` with image or video media above the
  content (`--cmsc-hero-media-space`, 0 fallback); shown only then.
- [X] T230 [US2] Bug: the social-proof image's 40 px lost to `.cmsc-picture > img`; a
  higher-specificity rule (`.cmsc-pb-hero__proof > .cmsc-pb-hero__proof-image > img`).
- [X] T231 [US3] `cms.Statement`: over a background image `minHeight`/`minHeightPx` per breakpoint
  (`default` = 60vh, `--cmsc-statement-min-h`); `headingLineHeight`; supporting text
  `bodySize(Px)`, `bodyWeight`, `bodyLineHeight`, `bodyColor`.
- [X] T232 [US3] `cms.Text`: `text` is the inline rich-text field (bold, italic, links, emphasis,
  canvas editing). **Decision:** inline rich text (the Heading's pattern, a stored string read as
  one paragraph) rather than a weight option, which `cms.Text` already had (`fontWeight` per
  breakpoint); a stored string renders as before until edited; translatable `text` →
  `format: 'tiptap'`.
- [X] T233 [US3] Rich text: `textSize` mark (type token class `cmsc-fs--<token>` or `font-size`
  px 8–200, sanitizer keeps it on `<span>`), bullet `listStyle` `chevron` / `none` beside `check`;
  toolbar **Text size** and **List marker** (core `pageBuilder.fieldText.*`, en + pl);
  `cms.RichContent` `textSize(Px)` per breakpoint. Server (DOM-free) and editor markup agree (the
  DOM's trailing `;` normalised by the sanitizer, as T119/T175).
  **R23:** Superseded in part by R23 T442: the toolbar offers token sizes only (a stored px mark still renders).
- [X] T234 [US3] Gradient emphasis: `box-decoration-break: slice` — one gradient across a wrapped
  run. **Visible change** for wrapped gradient runs already on pages (one-line runs unchanged);
  own changeset.
- [X] T235 [US3] `cms.Stats`: `labelSize(Px)`, `labelWeight`, `labelColor`; beside an image
  `imageSpan`, `figuresSpan`, `figuresOffset` (12-column grid from 768 px, mirrored for the end
  side) and `figuresAlign` (`start` / `end` / `spread`).
  **R23:** Superseded in part by R23 T436/T438: `labelColor` removed; the spans behind a `layout` preset and `layoutAdvanced`.
- [X] T236 [US6] `cms.LinkList`: `titleSize(Px)`, `titleWeight` for the row titles.
  **R23:** Superseded in part by R23 T435: `titleWeight` is one value.
- [X] T237 [US3] `cms.CtaCard`: `cardRadius` (Default 12 px, or a radius token) and `imageInset`
  (`none`, `custom` + `imageInsetPx`). **Decision:** no Custom px radius — T208 ("Custom … (px)")
  and T210 (two corner fields each "X – rounded corners") cannot both hold for a radius px field;
  `none` covers the square card. The test case was rewritten to tokens after the RED run.
- [X] T238 [US3] `cms.MediaText` `sideBySide: 'desktop'` (stacked up to 1023 px,
  `data-side-by-side`).
- [X] T239 [US3] `cms.Row` row gap per breakpoint: **already supported** (`rowGap` is responsive,
  `--pb-row-gap(-md|-lg)`; a single stored value applies everywhere). No code change; the test was
  green from the start and now holds it.

Also: the option-parity, fallback-parity and panel-consistency tests stay green;
`panel-consistency.test.ts` T211 pairs extended with the new size/weight pairs; every new
responsive field declared in `responsiveFields` (index and manifest); labels en + pl in the `cms`
bundle; docs `cms/index.md` § *Text sizes, line heights and spacing in blocks*, Polish mirrored,
cache entry rehashed with `hashSourceBody()`; contracts/blocks.md § R19A, data-model.md § 4;
changesets `163-r19a-*` (six).

## R19B — carousels, buttons, tiles, image cards, newsletter form

Gaps found while rebuilding the local reference pages (carousel controls, buttons, download
cards, image cards and the sign-up form). Task IDs T240–T259 are this area's. Widening only;
contracts/blocks.md § "R19B" holds the shapes. RED notes are what the new test files reported
before the implementation.

- [X] T240 Carousel dots follow the colour scheme (dark: the active dot is the scheme's text
  colour over faint dots) and take `controls.dotColor` / `activeDotColor`
  (`carousel/carousel-controls-look.test.tsx`; RED: 10 of 13 failed — no `--pb-dot-*`, no
  scheme variables, no fields).
  **R23:** Superseded in part by R23 T448: `dotColor` / `activeDotColor` removed (the scheme colours stay).
- [X] T241 A solid arrow's glyph colour, `controls.arrowGlyphColor` (`--pb-arrow-glyph`, both
  solid rules; same test file).
- [X] T242 Arrows and dots hidden per breakpoint, `controls.hideArrowsOn` / `hideDotsOn`; a row
  left empty there is removed (same test file).
- [X] T243 Arrows "in the header" with no heading: the shell already rendered a controls-only
  header (probe), but the controls sat at its start; they now stand at its end (same test file).
  In the editor arrows are never drawn on the canvas, as before.
- [X] T244 The product listings' footer button alignment, `footerButtonAlign`
  (`catalog/product-listing-footer.test.tsx`; RED: 2 of 3 failed).
- [X] T245 `cms.Button`'s outline fill: today's scheme-filled outline is intentional (the
  `secondary` look it replaced, `.cmsc-pb-button`), so it stays; `transparentOutline` switches it
  off per button (`button-look.test.tsx`; RED: 6 of 8 failed).
- [X] T246 `cms.Button` icon-only size per breakpoint (`iconSizePx`, the icon scaled) and
  `borderColor` (same test file).
  **R23:** Superseded by R23 T447: `iconSizePx` removed (the button size applies).
- [X] T247 `cms.DownloadTile` look: scheme, background, border, corners, padding and title size per
  breakpoint, the type badge (`download-tile-look.test.tsx`; RED: 6 of 8 failed). The tile was
  already one link and equal-height in a carousel row.
  **R23:** Superseded in part by R23 T437/T444: `paddingPx` replaced by `cardPadding`, a `titleSize` select added.
- [X] T248 `cms.DownloadTile` hover image in full under a gradient and the round icon-button link
  pinned to the bottom end, size per breakpoint and ring colour (same test file).
  **R23:** Superseded in part by R23 T444: the icon button size and ring colour removed.
- [X] T249 `cms.CarouselImage` read-more label in a corner of its own (`moreLabel*`, translatable)
  (`image-caption-look.test.tsx`; RED: 7 of 10 failed for T249–T251;
  `cms/block-declarations.test.ts` RED: `moreLabel` not extracted until declared).
  **R23:** Superseded in part by R23 T445: the label size option removed.
- [X] T250 `cms.CarouselImage` caption padding per breakpoint, `captionPaddingPx` (same test file).
  **R23:** Superseded by R23 T445: `captionPaddingPx` removed.
- [X] T251 `cms.Image` caption placement, size and alignment per breakpoint, weight and colour
  (same test file).
  **R23:** Superseded in part by R23 T446: caption weight and colour removed, a `captionSize` select added.
- [X] T252 `newsletter.Signup` layout: the button inside the field (rounded or pill), topic
  columns, a visually hidden e-mail label (`newsletter-signup-layout.test.tsx`; RED: 4 of 5
  failed). `cms.NewsletterSignup` shares no code with it and is unchanged.
- [X] T253 Carousel controls inside each split slide (`controlsPlacement: 'slide'`, per
  breakpoint), with a fallback row for carousels of other items
  (`carousel/carousel-slide-controls.test.tsx`; RED: 4 of 5 failed). Not offered on free-content
  slides (a controls block would be needed) nor on the product and post listings.
- [X] T254 Responsive-tab registry and manifests (`index.ts`, `cms/src/manifest.ts`
  `responsiveFields`, `translatable` for `moreLabel`); `panel-consistency.test.ts`,
  `option-parity.test.ts` and `ContentSlider.test.tsx` widened deliberately (a superset of the
  placements; the dots' fields with dots).
- [X] T255 Labels en + pl in the `cms`, `catalog`, `blog` and `newsletter` bundles; the admin's
  field-label walk (`page-builder-field-i18n.test.ts`) shows the new settings.
- [X] T256 Docs: `cms` module page § "Carousel controls, buttons, download tiles and image cards:
  look options", `newsletter` page's sign-up table; Polish mirrors and translation cache.
- [X] T257 contracts/blocks.md § "R19B", data-model.md §4 note, changesets `163-r19b-*`, rebuilt
  `dist/cms-components.css`.
- [ ] T258 (reserved)
- [ ] T259 (reserved)

## R19C — Sections, layout frame, breadcrumbs, background art, publish freshness, brand tokens

Gaps found while rebuilding reference pages (2026-10-27): area C of R19. Every option is optional;
unset renders today's markup.

- [X] T260 [US1] `cms.Section.width` per breakpoint (`Responsive<SectionWidth>`, Responsive tab; a
  stored single width is read as it is). Published: one value when the tiers agree (today's
  markup), else `data-width="tiered"` with each tier's box (`--cmsc-section-box-w|m|o|mh`) and frame
  (`--cmsc-section-frame-max|px`), `-md`/`-lg` per tier; the content width applies at the tiers whose
  width admits one. Editor canvas: the previewed tier's width as one value. `resolveFields` shows
  `contentWidth`, `customMaxWidthPx` and `outsetPx` when any tier's width takes them. Manifest and
  `SECTION_RESPONSIVE_FIELDS` list `width` and `outsetPx`.
  **Result:** **RED first:** contracts `page-builder-props.test.ts` R19C RED 4/4;
  `section-width-outset.test.tsx` RED 13/15 (the two "unset writes nothing" cases green, guards);
  `SectionBlock.test.tsx` RED 2 (the Responsive-tab list deliberately changed, standing rule 13, and
  the new `resolveFields` case). The admin `sidebar-field-layout.test.tsx` expectations (the width on
  the main tab, four responsive fields) deliberately changed.
- [X] T261 [US1] Section **Background outset (px)** (`outsetPx`, 0–400 per breakpoint, with a
  contained or custom width): `data-outset` + `--cmsc-section-outset(-md|-lg)`; the box grows by
  `min(outset, (100vw - width) / 2)` per side, the side padding by as much. Covered by T260's RED.
  **R23:** Superseded by R23 T449: `cms.Section.outsetPx` removed (the Column outset, T265, stays).
- [X] T262 [US1] A `custom` width wider than the page container widens the section, centred, up to
  `100vw - 2 * gutter` (`--cmsc-section-w`); it used to be capped silently. At or below the
  container's content width the computed box is unchanged (markup unchanged everywhere). Stylesheet
  case in `section-width-outset.test.tsx` (RED with T260).
- [X] T263 [US1] Where the mobile art stops: `desktopFrom?: 'tablet' | 'desktop'` on
  `ResponsiveImage` and `SectionBackground` (unset = `tablet`, 768 px). `Picture` /
  `pictureMobileMedia`; section tile and video pair `data-desktop-from="desktop"` + stylesheet
  (768–1023 px keeps the mobile tile and video); `useBreakpointVideo(ref, selector, { mobileMedia })`.
  Admin: **Mobile image shown on** (image field) and **Mobile image or video shown on** (background
  field), only with a mobile image/video, the default stored as nothing; `core` keys
  `pageBuilder.imageField.desktopFrom*`, `pageBuilder.fieldText.section.desktopFrom*` (en + pl).
  **Result:** **RED first:** `art-direction-tier.test.tsx` RED 5/6 (the unset case green, a guard);
  `use-breakpoint-video.test.tsx` new case RED; `section-field.test.tsx` new case RED; admin
  `button-image-fields.test.tsx` RED 1/2 (verified by re-running against the field without the
  control; the "only with a mobile image" case green, a guard).
- [X] T264 [US3] `cms.BackgroundPanel.textBoxTransparent` (switch, after the text placement):
  `data-text-box="transparent"`, the text box paints no background. **Result:** **RED first:**
  `BackgroundPanel.test.tsx` RED 2/2.
- [X] T265 [US1] `cms.Column.outsetPx` (**Background outset (px)**, Responsive tab): cell
  `data-pb-outset` + `--pb-col-outset(-md|-lg)` (editor: the tier's as the base); the box widens with
  negative side margins, its content layer padded back. **Result:** **RED first:**
  `Column.test.tsx` R19C RED 3/4 (the unset case green, a guard).
- [X] T266 [US1] Box margins and padding per breakpoint: **already supported** — the shared spacing
  fields carry the responsive metadata and every block offering them lists them in
  `responsiveFields`. Guard test `box-spacing-responsive.test.tsx` (green from the start; it counts
  the blocks it walks so it cannot pass empty). Documented in `cms/index.md`.
- [X] T267 [US8] Breadcrumb band: on `muted`/`dark` the trail has no bottom margin
  (`PAINTED_TRAIL_CLASS`, `mb-0`) and the band pads itself (`pb-[16px]`), so no light strip opens
  before a dark first section. Light keeps the trail's `mb-[16px]`. **Result:** **RED first:**
  `breadcrumbs.test.tsx` painted-band case RED (the light case green, a guard).
- [X] T268 [US1] Container token audit: the brand's `layout.containerMaxPx` (`--cmsb-container`,
  1360 by default) already sizes the CMS page container, every Section width rule and the Row
  breakouts. The one CMS-page hard-coding was the breadcrumb wrapper (`max-w-[1360px] px-[24px]`),
  now `max-w-[var(--cmsb-container,1360px)] px-[var(--cmsb-gutter,24px)]`. The storefront chrome
  (header, megamenu, catalog, cart, account pages) still hard-codes `max-w-[1360px]` — outside
  this area, reported. **Result:** RED with T267's file (container case).
- [X] T269 [US8] Polish storefront copy with its diacritics: `nav.home` "Strona główna" and 48 other
  folded `pl-PL` strings (skip link, catalogue, stock, notify, search, pagination, checkout success
  and failure, payment retry, order cancel, coupon, address, quote request success). `MESSAGES` is
  exported for the test. **Result:** **RED first:** `messages-pl-diacritics.test.ts` RED 2/2 against
  the previous catalogue; `success-panel.test.tsx` and `rfq-success-panel.test.tsx` asserted the
  folded spelling and were deliberately changed.
- [X] T270 [US8] Crumb label: every crumb is the page **name** (`resolveTrail` no longer reads the
  meta title), as the current page's crumb always was. Data-model §5 updated. **Result:** the
  contract test `page-tree.contract.test.ts` case deliberately changed (standing rule 13) — **not
  run**: it needs Postgres, and no test database was reachable from this worktree.
  **Status (R23 T468): run green 2026-10-29** on the test Postgres (`dev:infra:test`, port 5441): `page-tree.contract.test.ts`, `page-nested-url.contract.test.ts`, `migration.test.ts` — 3 files, 36 / 36.
- [X] T271 [US8] Publish freshness. **Cause:** the CMS write revalidates the storefront's tags
  fire-and-forget, and a refused call was silent: `backend/.env.example` and
  `storefront/.env.example` shipped *different* `REVALIDATE_SECRET` values, so a checkout set up from
  them gets 401 on every revalidation and serves the cached render until the 60 s window lapses (then
  once more stale-while-revalidate) — the 5–40 s observed. Probed on the running dev storefront: the
  storefront example secret answers 200, the backend example secret 401. **Fix:** the backend example
  takes the storefront's value with a comment; `StorefrontRevalidator` logs a non-2xx answer (401
  named as a secret mismatch) and times out after `timeoutMs` (3000 ms); the CMS write dispatches its
  change in an EventBus scope and the subscriber returns the revalidation, so a save or publish
  answers once the tags are dropped. **Result:** **RED first:** platform
  `storefront-revalidator.test.ts` RED 2/2; mod-cms `cms-content-invalidator.test.ts` and
  `storefront-revalidation.test.ts` RED 1 each. Whether the local backend `.env` really holds a
  different secret was not read (out of bounds for this worktree): check that both `.env` files
  carry the same `REVALIDATE_SECRET` and restart.

**R19C verification (2026-10-27):** packages built; `dist/cms-components.css` rebuilt and kept.
Tests: contracts 67 / 1393; page-builder-core 33 / 233; cms-components 76 / 1814; mod-cms 27 / 318;
platform `src/http` 22 / 162 (sandbox off: its server tests listen on a port); admin whole suite
387 / 3886 + 1 failure in `crm/assignment.test.tsx` that passes alone (10 / 10, untouched area,
load-dependent); storefront whole suite 167 / 1771. Typecheck clean for contracts,
page-builder-core, cms-components, page-builder-admin, mod-cms, platform, mod-i18n, admin,
storefront, backend; lint 0 errors (warnings pre-existing, none in touched files). Checks:
`check:block-names`, `check:class-vocabulary`, `check:docs-translations`, `check:module-docs`,
`check:block-renderers`, `check:bundle-pairing`, `check:test-ownership` findings=0;
`check:default-language-prose` violations=0; `i18n:hardcoded` regressions=0; `check:release-intent`
violations=0; `check:language` OK. Docs: `cms/index.md` (Section width and outset, mobile art,
column outset, box spacing, panel text box, breadcrumbs, storefront cache), `cms/brand.md` (Layout),
Polish mirrored, cache entries rewritten with `hashSourceBody()`. Changesets `163-r19c-*.md` (six).
Not run: the backend contract/integration suites (no Postgres for tests here).

## R19D — hierarchical CMS page URLs

Opt-in per page: `parentPathInUrl` (off by default) serves a page at its parent's public path
plus its own slug; the path is computed on read per channel. Spec FR-030 amended; data-model
§1.1, §5.1, §6; contracts §2.

- [x] T280 [R19D] `cmsPagePublicPaths` + `CMS_PAGE_PATH_MAX_LEVELS` in `packages/contracts/src/cms.ts` — one rule for backend, admin and storefront (flat by default, parent path when opted in, flat on loop / > 8 levels / parent not in channel). Test: `packages/contracts/src/cms-page-path.test.ts` (RED 9/9 before the code).
- [x] T281 [R19D] Contracts: `parentPathInUrl` on summary/detail/create/patch; optional `path` on the resolved page, its trail crumbs and the by-channel index entry; `CmsContentChange.addressesMoved`.
- [X] T282 [R19D] Backend: `page-paths.ts` (load a channel's tree, paths, duplicates, addresses); `StorefrontResolver` resolves by whole path then flat slug, answers `path`, trail `path`, index `path`; `CmsPageService` writes `parent_path_in_url` in the Commands, refuses a duplicate path with `409 CMS_SLUG_CONFLICT` inside the Command (nothing written, nothing audited), records `parentPathInUrl` in the audit state, invalidates old and new paths. Tests: `page-paths.test.ts`, `cms-content-invalidator.test.ts` (RED 2 before the code), contract `backend/test/contract/cms/page-nested-url.contract.test.ts` (written, not run — no test Postgres), `page-tree.contract.test.ts` extended with crumb `path`.
  **Status (R23 T468): run green 2026-10-29** on the test Postgres (`dev:infra:test`, port 5441): `page-tree.contract.test.ts`, `page-nested-url.contract.test.ts`, `migration.test.ts` — 3 files, 36 / 36.
- [x] T283 [R19D] Page Builder links of kind `page` rendered at the target's path: `rewritePageLinkSlugs` in `content-tree-walker.ts`, applied by the resolver to the page tree and inlined embeds. Test: `page-link-paths.test.ts` (RED 3/3 before the code).
- [X] T284 [R19D] Migration `20261027T165458_cms_page_parent_path_in_url.ts` (`parent_path_in_url boolean not null default false`), entity `CmsPage.parentPathInUrl`, registry regenerated. Test: case added to `backend/test/integration/cms/migration.test.ts` (not run — no test Postgres).
  **Status (R23 T468): run green 2026-10-29** on the test Postgres (`dev:infra:test`, port 5441): `page-tree.contract.test.ts`, `page-nested-url.contract.test.ts`, `migration.test.ts` — 3 files, 36 / 36.
- [x] T285 [R19D] Storefront `(content)/[...slug]`: 308 from a nested page's flat slug to its path, breadcrumb hrefs from crumb `path`, canonical and `og:url` from the path, home-page check by path or flat slug; sitemap entries at `path`. Tests: `storefront/test/seo/cms-nested-path.test.tsx` (RED 4/5), `sitemap-cms.test.ts` case (RED).
- [x] T286 [R19D] Admin page editor: "Include the parent page's path in the address" checkbox under the parent picker; the public address preview follows the rule (ancestors read up the opted-in chain). en + pl strings; `parentHelp` reworded. Test: `admin/test/modules/cms/cms-editors-settings-panel.test.tsx` (RED 2 before the code).
- [x] T287 [R19D] Docs: `cms` module page *Nested page addresses* + API rows, PL mirror, translation cache rehashed.
- [x] T288 [R19D] Changeset `.changeset/163-r19d-nested-page-urls.md`.
- [ ] T289 [R19D] Follow-ups not done here: `seo`'s own sitemap generator and `megamenu` CMS-page links still build `/<slug>` from `CmsPageRecord` (they reach nested pages through the 308); no redirect from a nested page's *old* path after its parent moves (no redirects facility exists).

## R20E — fixes and embedded-button, hero, tile options

Defects and gaps found while rebuilding the local reference pages after R19 (area E). Task IDs
T290–T309. Widening only (plan § *Extend, don't narrow*): every new option is optional, unset
renders today's markup (each new test file has an "unset" case); contracts/blocks.md § "R20E",
data-model.md §3.2 and §4 note. RED counts are the first run of each new or extended test against
the pre-R20E code.

- [X] T290 [US4] Bug: `cms.DownloadTile` `titleSizePx` per breakpoint ignored from 768 px — the
  `-md`/`-lg` rules preceded the base `.cmsc-pb-download-tile__title` rule of equal specificity;
  the tier rules now follow it. Audit: a generic stylesheet-order test
  (`stylesheet-breakpoint-order.test.ts`: for every rule in a min-width tier reading a `-md`/`-lg`
  custom property, no later rule of the same selector, unconditional or in a lower tier, sets that
  property or its shorthand) found no other case. **RED 1/3** (the parser guard and the synthetic
  case green).
- [X] T291 [US1] Bug: a Column's `outsetPx` replaced the box's own side margins at every
  breakpoint, also at a 0 outset. The outset is now the cell's negative side margins (a grid item
  stretched, `max-width: none`); the box is `width: auto` and keeps its margins on top of the
  outset. `Column.test.tsx`: the stylesheet case deliberately changed (standing rule 13) and one new
  case — **RED 2**.
- [X] T292 [US6] Bug: a `cms.CarouselImage` read-more label overlapped a caption on the same edge
  on a narrow card. Such a caption gets `cmsc-pb-carousel-image--more-clear-top|bottom` and sits
  above the label's line (`--cmsc-more-clear-inset` + `--cmsc-more-clear-line`, per breakpoint) — a
  CSS-only lift, robust at any card width. **Visible change** for cards with both on one edge (own
  changeset).
- [X] T293 [US3] Bug: `cms.Image` with the caption below at the base breakpoint and beside from a
  wider one, with a set width, kept the figure at the image's width there. Such a figure is
  `cmsc-pb-image__figure--tiered` (`--pb-img-fig-w`, the media wrapped in `.cmsc-pb-image__media`):
  the image width below, image plus caption column beside. New `captionMinWidthPx`,
  `captionMaxWidthPx` per breakpoint. **Decision:** a caption's measure has its own range (0 / 40 to
  1200 px), not the text measure's 160–2000 px — `panel-consistency.test.ts` deliberately changed
  (standing rule 13) with a case of its own for caption measures.
- [X] T294 [US3] Bug: an inline heading holding only blank text or hard breaks rendered an empty
  element (`cms.MediaText` `<h3>`). `isEmptyInline` (shared, now also the Hero's) treats them as
  empty; the published `cms.Heading` keeps its box but writes no heading for an empty text. Not
  changed here (another area's file): `cms.FeatureList`'s item title renders without an
  emptiness check.
- [X] T295 [US3] Bug: React's "key spread into JSX" warning — `MediaTextMediaFrame` passed
  `{ key, … }` spread into `<video>`; the key is now passed directly. A grep found no other place.
- [X] T296 [US2] `ButtonSpec` gains `transparentOutline`, `iconSizePx`, `borderColor`,
  `iconOnlyShape` (`circle` / `pill`) and `iconOnlyWidthPx` (contracts `buttonSpecSchema`, RED 1;
  `embedded-button-look.test.tsx` **RED 8/10**, the "unset" and "the block's own option wins"
  cases green). Fields: `BUTTON_LOOK_FIELDS` (shared, translated once in `core`:
  `pageBuilder.sharedFields.button*`) on every embedded button (`BUTTON_SPEC_OBJECT_FIELDS`, the
  admin's `createButtonListField` / `createButtonSpecField`). Pill: `cmsc-btn--icon-pill`,
  `--pb-btn-width(-md|-lg)`, 1.15 × height without a width.
  **R23:** Superseded in part by R23 T447: `iconSizePx` and `iconOnlyWidthPx` removed.
- [X] T297 [US2] One code path: `ButtonView` merges the spec's look under the block's own;
  `cms.Button` keeps its R19B block-level look (its `button` object omits the look fields,
  `createButtonSpecField({ look: false })`) and gains `iconOnlyShape` / `iconOnlyWidthPx`
  (Responsive tab). `specAtTier` resolves the size and width to the previewed tier.
- [X] T298 [US2] `cms.Hero` `titleLineHeight` per breakpoint and `eyebrowColor`, `titleColor`,
  `subheadingColor`, `statementColor`, `bodyColor` (`hero-text-options.test.tsx` **RED 8/9**, the
  unset case green).
  **R23:** Superseded in part by R23 T436: the per-text colours removed (`eyebrowColor` stays).
- [X] T299 [US2] `cms.Hero` eyebrow as a label: `eyebrowSizePx`, `eyebrowWeight`,
  `eyebrowLineHeight` per breakpoint, `eyebrowUppercase` (switch, on by default; off =
  `cmsc-pb-hero__eyebrow--plain`). **Decision:** the space after it is its item's in `order`
  (exists since T193), no new field.
  **R23:** Superseded in part by R23 T435/T436: `eyebrowWeight` removed, an `eyebrowSize` select added.
- [X] T300 [US2] `cms.Hero` social-proof caption: `proofCaptionPlacement` (`beside` / `below` per
  breakpoint, `data-caption(-md|-lg)` on the proof row), `proofCaptionSizePx`,
  `proofCaptionMaxWidthPx` per breakpoint, `proofCaptionWeight`, `proofCaptionColor`. **Decision:**
  top-level props (the Responsive tab reads top-level fields), not inside `socialProof`.
  **R23:** Superseded in part by R23 T436: the caption size, weight and colour removed.
- [X] T301 [US4] `cms.DownloadTile` `minHeightPx` per breakpoint (`--pb-dl-min-h`, 180 px unset)
  (`download-tile-options.test.tsx` **RED 5/6**, the unset case green).
- [X] T302 [US4] `cms.DownloadTile` `subtitleSizePx` per breakpoint and `subtitleColor`.
  **R23:** Superseded by R23 T444.
- [X] T303 [US4] `cms.DownloadTile` `linkTo: 'link'` + `link` (the shared link field; the admin's
  picker): one link, no `download`, no type badge, `cmsc-pb-download-tile--page-link`, the icon
  button's `arrowRight`; a link leading nowhere renders nothing published and a warning in the
  preview. Label fallback "Learn more".
- [X] T304 Responsive registry (`index.ts`, `cms/src/manifest.ts` `responsiveFields`) for every
  new per-breakpoint field; labels en + pl in the `cms` bundle and the `core` bundle's shared
  button keys; the admin's field-label walk (`page-builder-field-i18n.test.ts`) green.
- [X] T305 Docs: `cms` module page § *Buttons in blocks, hero texts, download tiles and image
  captions: more options*, the Column outset and list marker paragraphs; Polish mirrored, cache
  entry rewritten with `hashSourceBody()`.
- [X] T306 contracts/blocks.md § "R20E", data-model.md §3.2 and §4 note, changesets `163-r20e-*`
  (six), rebuilt `dist/cms-components.css`.
- [X] T307 [US3] Rich-text list marker colour. **Decision:** the default stays as stored (check =
  brand primary, chevron = text colour) rather than following the text colour on a dark scheme,
  which would repaint stored dark sections; `cms.RichContent` `listMarkerColor` and `cms.Hero`
  `bodyListMarkerColor` set `--cmsc-list-marker`, read by both markers
  (`list-marker-color.test.tsx` **RED 3/3**). Not added to MediaText / FeatureList / CtaCard (another
  area's files); any block can adopt it by writing the one custom property.
- [X] T308 [US6] `cms.CarouselImage` `moreLabelColor`, `moreLabelIconColor`, `moreLabelWeight`
  (`r20e-fixes.test.tsx`, with T292–T295: **RED 10/13**, the three unset guards green).
  **R23:** Superseded by R23 T445.
- [X] T309 Verification (2026-10-28): see below.

**R20E verification:** packages built (`pnpm run build:packages`). Tests: cms-components 91 / 2018;
contracts 68 / 1403; page-builder-core 33 / 233; mod-cms 29 / 329; mod-i18n 1 / 6; storefront whole
suite 168 / 1777; admin whole suite 388 / 3885; backend `test/unit/cms` + `tailwind-sources` (unit config) 7 / 85.
Typecheck clean for contracts, page-builder-core, cms-components, page-builder-admin, mod-cms,
mod-i18n, admin, storefront; lint 0 errors (one pre-existing warning in
`page-builder-admin/src/chrome/CatalogPickers.tsx`, untouched). Checks: `check:block-names`,
`check:class-vocabulary`, `check:docs-translations`, `check:module-docs`, `check:block-renderers`,
`check:bundle-pairing`, `check:test-ownership` findings=0; `check:default-language-prose`
violations=0; `i18n:hardcoded` regressions=0; `check:release-intent` violations=0 (a first run
flagged the word "margin" in a changeset as a commercial term; reworded); `check:language` OK.
Not run: the backend contract/integration suites (no test Postgres here).

## R20F — carousel-split, layout and type-scale options

Gaps found while rebuilding reference pages (2026-10-28): layout and spacing of the split slide,
the carousel controls, media and text, the background panel, the feature list, the
call-to-action card, stats, link list and accordion, and a type scale per breakpoint. Every
option is optional; unset renders today's markup (contracts/blocks.md § "R20F").

**RED first (2026-10-28):** `cms-components` `split-layout-and-block-spacing.test.tsx` RED 33/44
(the 11 green from the start are the "unset: today's markup" guards and the "off, today" client
case); `brand/brand-css.test.ts` R20F cases RED 2/4 (the "unset or 1" and "refused factor"
byte-identity guards green from the start). The contracts `cms-brand.test.ts` R20F case and the
admin `brand-page.test.tsx` case were written before the code but first run after it (green);
not separately observed RED.

- [X] T310 [US4] `cms.CarouselSplit` layout: `sideBySide` (`data-side-by-side="desktop"`),
  `mediaSpan` / `textSpan` / `textOffset` (`--columns`, `--cmsc-split-media-col|text-col`, 12-column
  grid from 768 px, mirrored for media at the end), `mediaCornerRadius` (shared "Rounded corners").
  Layout fields after the content (`mediaSide` moved there), style after layout.
- [X] T311 [US4] `cms.CarouselSplit` title: `titleSize` / `titleSizePx`, `titleWeight`,
  `titleLineHeight` (per breakpoint, `textStyleAttrs`), `titleHangingIcon` +
  `titleHangingIconGapPx` (R19A T226's hanging indent; `--cmsc-hang-gap(-md|-lg)` on the title).
  **R23:** Superseded in part by R23 T435: `titleWeight` is one value.
- [X] T312 [US4] `cms.CarouselSplit` text: `bodySize` / `bodySizePx`, `bodyWeight`,
  `bodyLineHeight` per breakpoint. `resolveFields` added (Custom px on Custom, the icon space with
  the indent on; field objects passed through unchanged). Panel-consistency weight pairs extended.
  **R23:** Superseded in part by R23 T435: `bodyWeight` is one value.
- [X] T313 [US4] Carousel controls alignment (`carousel-parts`, all three carousels):
  `controlsAlign: 'dots-start'` (root `--ctl(-md|-lg)-dots-start`, dots `order: -1` +
  `margin-inline-end: auto`; tiers with another value reset it). A set `controlsAlign` also aligns
  the row inside a split slide (`__controls--al-*`, every tier written); unset keeps today's start.
  Option-parity / ContentSlider tests deliberately extended with `dots-start` (standing rule 13).
- [X] T314 [US4] `controls.arrowsWhenFit` (shown with arrows): when every slide fits the controls
  stay, both arrows `disabled`, the dots `hidden` (`.cmsc-pb-carousel__dots[hidden]` keeps the
  box); `disabledArrowLook` offered and applied on a looping carousel too. Shell
  `keepArrowsWhenFit`.
- [X] T315 [US3] `cms.MediaText`: `headingSpacePx`, `bodySpacePx`, `stackedGapPx` (per breakpoint,
  root classes + `--cmsc-mt-*`), `bodySize` / `bodySizePx`, `bodyLineHeight`,
  `rows[].verticalAlign` (`'inherit'` / unset = the block's). Touched only `Row`, `MediaTextBody`,
  the fields and `resolveFields` (not `MediaTextMediaFrame`).
  **R23:** Superseded by R23 T437: `innerSpace` and `stackedGap`.
- [X] T316 [US3] `cms.BackgroundPanel`: `mobileLayout: 'overlay'` (`data-mobile-layout`, one grid
  cell below 768 px, the text at the top or bottom by `mobileTextPosition`), `textBoxMarginPx`,
  `textBoxPaddingPx` (per breakpoint).
  **R23:** Superseded in part by R23 T449: `textBoxMarginPx` / `textBoxPaddingPx` removed.
- [X] T317 [US3] `cms.FeatureList`: `rowGapPx`, `listLineHeight`, `bodySpacePx` (per breakpoint),
  `titleLetterSpacing` (em).
  **R23:** Superseded in part by R23 T435/T437: `bodySpacePx` and `titleLetterSpacing` removed.
- [X] T318 [US3] `cms.CtaCard`: `paddingPx` (per breakpoint; the image inset measures from it),
  `imageColumns` (per breakpoint, columns of 12 from the tablet, with an image only).
  **R23:** Superseded in part by R23 T437/T440: `paddingPx` replaced by `cardPadding`, the columns behind a `layout` preset.
- [X] T319 [US3] `cms.Stats.labelLineHeight` (per breakpoint).
- [X] T320 [US8] `cms.LinkList.dividerAfterLast` (with `divider` on).
- [X] T321 [US8] `cms.Accordion.icon: 'chevron-circle'` + `iconCircleColor`. Option-parity and
  Accordion tests deliberately extended with the new value; `iconCircleColor` sits after the icon
  size (the T179 order test).
  **R23:** Superseded by R23 T441: `chevron-circle` reads as `chevron`.
- [X] T322 [US1] Brand `tierScale` (`tablet`, `smallDesktop`, 0.5–2, optional) in
  `cms-brand.ts`; `brandTokensToCss` writes a 768–1023.98 px block (mobile px × factor) before the
  desktop block and a 1024–1279.98 px block (desktop px × factor) after it, for every type size and
  spacing step; gutter and container unscaled; unset or 1 byte-identical. Blocks' own Custom px are
  not scaled. `/cms/brand` Layout card: two factor fields (empty = 1, nothing stored).
- [X] T323 i18n en + pl: `cms` (block fields, brand screen), `catalog` and `blog` (the shared
  carousel fields); the admin field-label walk shows the conditional fields (`SHOWING` extended).
- [X] T324 Docs: `cms/index.md` § "Split slides, carousel controls and block spacing",
  `cms/brand.md` (Layout, Tokens as CSS variables); Polish mirrors; translation cache rehashed with
  `hashSourceBody()`. contracts/blocks.md § "R20F", data-model §2 and §4; changesets `163-r20f-*`
  (four); `dist/cms-components.css` rebuilt.
- [ ] T325 (reserved) Follow-ups not done: `cms.Stats` keeps its own 12-column helper (not shared
  with the split slide's); the rich-text size mark stays single-valued (per-breakpoint text size
  is the block-level `bodySize` on MediaText and CarouselSplit).
- [ ] T326–T329 (reserved)

## R21G — fixes and block options

A bug and options found while rebuilding reference pages (2026-10-28): the hero's social-proof
caption below the image, column layouts and stacking breakpoints on media-and-text, the
call-to-action card and stats, the split slide's text indent and spacing, and text options on
several blocks. Every option is optional; unset renders today's markup (contracts/blocks.md §
"R21G").

**RED first (2026-10-28):** `cms-components` `r21g-fixes-and-options.test.tsx` **RED 20/32** (the
12 green from the start are the "unset: today's markup" guards and the "no indent without a
hanging icon title" case). Two R20 assertions deliberately changed (standing rule 13): the proof
caption's below rule (`hero-text-options.test.tsx`, now `order: 2` beside the flex basis) and the
call-to-action card's desktop inset rule (`split-layout-and-block-spacing.test.tsx`, now reading
the inset per breakpoint). The admin field-label walk's `SHOWING` extended (a mobile image, the
list's Custom size, a social-proof caption).

- [X] T330 [US2] Bug: `cms.Hero` with `proofCaptionPlacement: 'below'` and a
  `proofCaptionMaxWidthPx` kept the caption beside the image whenever image and measure fit the
  row — the caption's `max-width` capped the `flex-basis: 100%` meant to break the line. Fix: a
  zero-height full-width `::before` break between the image and the caption (`order` 0 / 1 / 2),
  the row gap moved to the caption's top margin (12 px, as before); `'beside'` at a wider tier
  undoes it. CSS only; the measure still applies.
- [X] T331 [US2] `cms.Hero.proofCaptionLineHeight` (per breakpoint).
  **R23:** Superseded by R23 T436.
- [X] T332 [US3] `cms.MediaText` `mediaSpan` / `textSpan` / `textOffset` on a 12-column grid from
  the side-by-side tier, both sides written so alternating rows mirror; the helper shared with
  `cms.CarouselSplit` (`twelve-columns.ts`, output unchanged).
  **R23:** Superseded in part by R23 T438: the spans behind `layoutAdvanced` (`split` stays the preset).
- [X] T333 [US3] `cms.MediaText` `listMarkerColor`, `bodyWeight`, `headingLineHeight` (per
  breakpoint where it applies).
  **R23:** Superseded in part by R23 T435: `bodyWeight` is one value.
- [X] T334 [US3] `cms.CtaCard` `mobileImagePosition`, `sideBySide`, `imageInsetPx` per breakpoint
  (stored number unchanged), `bodySize` / `bodySizePx`, `listSize` / `listSizePx`. **Decision:**
  a list text size of its own rather than one size for text and list (they differ on the
  reference pages); a list weight not added (not asked).
  **R23:** Superseded in part by R23 T440: `listSize` removed (the list follows `bodySize`), `imageInsetPx` one value.
- [X] T335 [US3] `cms.Stats.sideBySide`.
- [X] T336 [US4] `cms.CarouselSplit` `bodyIndent: 'title'` (subgrid of the text column; only for
  a hanging title led by an icon), `stackedGapPx`, `titleSpacePx`, `controlsSpacePx`.
  **Decision:** the indent is the body's only; buttons and controls keep the column's full width.
- [X] T337 [US3] `cms.Image.desktopFrom` (R19C helper) and `cms.Heading` `textMaxWidth` /
  `textMaxWidthPx`.
- [X] T338 [US3] `cms.RichContent.listLineHeight`, `cms.Accordion.titleLineHeight`,
  `newsletter.Signup` `buttonHeightPx` / `buttonTextSizePx` / `buttonWeight`, product listings'
  `leadSize` / `leadSizePx` / `leadWeight` / `leadColor` (through the shared header's `lead` hook,
  `carousel-parts.tsx` untouched), `cms.DownloadTile.titleWeight`. Labels en + pl in the `cms`,
  `catalog` and `newsletter` bundles; docs § "Stacking breakpoints, column layouts and more text
  options" with its Polish mirror and the translation cache rehashed (`hashSourceBody()`);
  changesets `163-r21g-*`; `dist/cms-components.css` rebuilt.
  **R23:** Superseded in part by R23 T435: the line heights only with Custom px.
- [ ] T339 (not done) A brand bold weight (`fonts.boldWeight`): inline bold has no rule of its own
  in the stylesheet (the browser's `bolder`), so a token needs a new stylesheet rule over every
  rich and inline text, a contract change, the brand CSS and a `/cms/brand` control — not trivial,
  and the brand files are another area's in this round. Left for a later round.
- [ ] T340–T349 (reserved)

**R21G verification (2026-10-28):** packages built. Tests: cms-components 93 / 2099 (with
`r21g-fixes-and-options.test.tsx` 32 / 32); mod-cms 29 / 329; mod-catalog 12 / 110; mod-newsletter
6 / 7 files green, `smtp-provider.test.ts` not runnable here (it binds a local SMTP server, refused
by the sandbox; the file is untouched); admin whole suite 3889 / 3890 — the one failure,
`crm/OpportunitiesList.more-filters.test.tsx`, timed out under the full run and passes alone
(10 / 10), unrelated; storefront whole suite 168 / 1777; backend `test/unit/cms` 6 / 72 and
`tailwind-sources` 13 / 13 (unit config). Typecheck clean for cms-components, mod-cms,
mod-catalog, mod-newsletter, admin, storefront; lint 0 errors (pre-existing warnings only).
Checks: `check:module-docs`, `check:docs-translations`, `check:bundle-pairing`,
`check:block-names`, `check:block-renderers`, `check:class-vocabulary`, `check:test-ownership`
findings=0; `check:default-language-prose` violations=0; `i18n:hardcoded` regressions=0;
`check:release-intent` violations=0; `check:language` OK.

## R21H — breakpoint tiers, breadcrumbs over hero, carousel tiers

Gaps found while rebuilding reference pages (2026-10-28): a per-breakpoint type token losing its
line height, the tier scale's range and a fluid desktop scale, buttons in the scale, the frame per
tier, a carousel small-desktop tier and breadcrumbs over the first section. Task IDs T350–T369.
Every option is optional; unset renders today's markup and today's brand CSS (contracts/blocks.md
§ "R21H"; data-model §1.1, §2, §4, §5).

- [X] T350 [US1] Bug: a text sized by a different type token per breakpoint kept the first
  tier's line height, weight and tracking (`cmsc-t--<token>` of one tier). One helper,
  `tokenTierStyle` (`typography.ts`), used by `sizedTextProps` (carousel header heading, section
  heading, item texts), `HeroText` and `cms.Heading`: `cmsc-pb-text-token` +
  `--pb-text-lh|w|ls(-md|-lg)` from each tier's token (a Custom px tier reads the class token);
  the rule sits before the weight and line-height classes. **RED first:**
  `r21h-tiers.test.tsx` T350 cases RED 4/5 (the "one token" guard green).
  `MediaText.test.tsx` feature-title class expectation deliberately changed (standing rule 13).
- [X] T351 [US1] Brand `tierScale.smallDesktopUntilPx` (1024–3840, unset 1279), `fluidDesktop`,
  `fluidUntilPx` (else `layout.containerMaxPx`): `clamp(px × factor, px × 100 / end vw, px)` from
  the small-desktop end. **RED first:** `brand-css.test.ts` R21H RED 4/5 (the byte-identity guard
  green); contracts `cms-brand.test.ts` R21H RED 1/1.
  **R23:** Superseded in part by R23 T432: `smallDesktopUntilPx` removed (`fluidDesktop`, `fluidUntilPx` stay).
- [X] T352 [US1] `tierScale.buttons`: `--cmsb-btn-h-s|m|l` in the tablet, small-desktop and fluid
  blocks. Covered by T351's RED.
- [X] T353 [US1] `layout.gutterTabletPx`, `gutterSmallDesktopPx`, `containerSmallDesktopPx`
  (tablet / small-desktop blocks). Covered by T351's RED. Brand screen fields (Layout card;
  `brand-page.test.tsx` R21H case RED: missing labels).
  **R23:** Superseded by R23 T432.
- [X] T354 [US4] Carousel small-desktop tier: `slidesPerViewSmallDesktop`, `gapSmallDesktopPx`
  (dedicated props; `Responsive<T>` keeps three tiers) → `--pb-spv-sd` / `--pb-gap-sd`, the
  stylesheet's `1024–1279.98px` rule, the brand's moved range (`:root .cmsc-pb-carousel`).
  **RED first:** `r21h-tiers.test.tsx` T354 cases RED 3/5 (the unset and fade guards green).
  **R23:** Superseded by R23 T434.
- [X] T355 [US8] `breadcrumbsOverlay` per page: migration
  `20261028T090524_cms_page_breadcrumbs_overlay` (registry regenerated), entity, service (create,
  patch, detail, audit state), resolver (`breadcrumbs.overlay: true` only when on), contracts,
  admin page editor checkbox, storefront zero-height overlay layer. **RED first:** contracts
  `cms-breadcrumbs-overlay.test.ts` RED 3/3; storefront `breadcrumbs.test.tsx` RED 1/3 (the
  "off/absent" and "hidden" guards green); admin `cms-editors-settings-panel.test.tsx` RED 1
  (observed by re-running against the previous `PageEditor.tsx`). Written, **not run** (no test
  Postgres): `page-tree.contract.test.ts` R21H case, `migration.test.ts` column case.
  **Status (R23 T468): run green 2026-10-29** on the test Postgres (`dev:infra:test`, port 5441): `page-tree.contract.test.ts`, `page-nested-url.contract.test.ts`, `migration.test.ts` — 3 files, 36 / 36.
- [X] T356 i18n en + pl: `cms` (brand screen, page editor, carousel fields), `catalog`, `blog`
  (carousel fields). Docs: `cms/index.md` (breadcrumbs over the first section, § "Small desktops:
  carousels and type sizes per breakpoint", API rows), `cms/brand.md` (Layout, Tokens as CSS
  variables); Polish mirrored; cache rehashed with `hashSourceBody()`.
- [X] T357 contracts/blocks.md § "R21H", data-model, storefront-and-admin-api §2, changesets
  `163-r21h-*` (four), rebuilt `dist/cms-components.css`.
- [ ] T358 (reserved) Follow-ups not done: block-level Custom px values (a block's own sizes and
  spaces) have no small-desktop value and are not scaled by the tier scale (only brand tokens
  are); the editor's preview has no small-desktop viewport; the container is per tier, not fluid.
- [ ] T359–T369 (reserved)

## R22I — grid, alignment and block-option fixes

Gaps found while rebuilding reference pages (2026-10-28): the 12-column layouts' gap and anchor,
a Row's vertical alignment, a call-to-action card's list columns, and line height, weight, size and
icon options. Task IDs T370–T389. Every option is optional; unset renders today's markup
(contracts/blocks.md § "R22I"; data-model §4). **RED first:** `r22i-grid-and-options.test.tsx`
RED 20 / 33 against stub exports (`tierLeading`, `rowVerticalAlign`; the 13 "unset" guards green),
`LatestPosts.test.tsx` R22I case RED 1 / 19.

- [X] T370 [US3] Bug: the inner 12-column grids (`cms.Stats` with an image's columns,
  `cms.MediaText`, `cms.CarouselSplit`) took the page's side gutter as their column gap, so a brand
  gutter per tier (R21H `gutterSmallDesktopPx`) widened them. They read
  `--cmsc-grid-gap(-md|-lg)` → `--cmsb-grid-gap` → `--cmsb-gutter` (the Row's `.cmsc-pb-gap`
  fallback too); new `columnGapPx` (per breakpoint) on the three. **Decision:** the default keeps
  today's gutter; `--cmsb-grid-gap` is a hook the brand CSS does not write yet (brand files were
  another area's this round). `r21g-fixes-and-options.test.tsx` T332 stylesheet expectation
  deliberately changed (standing rule 13).
- [X] T371 [US3] `columnsAnchor` (`'media' | 'start' | 'end'`) on `cms.MediaText` and
  `cms.CarouselSplit` (`twelveColumns`): a media-at-the-end pair from column 1.
- [X] T372 [US3] Bug: a call-to-action card's two-column list turned on at 768 px although
  `sideBySide: 'desktop'` kept the card stacked; it now follows the card's side-by-side tier (CSS).
- [X] T373 [US1] Bug: a Row's `verticalAlign` had no effect on published pages — every Column
  carried `cmsc:self-stretch`, which beat the Row's `align-items`. Removed; a stored `'center'` is
  read as `'middle'` (`rowVerticalAlign`, render and editor). Default rows stretch as before.
- [X] T374 [US3] `cms.CtaCard` `headingSpacePx`, `bodyWeight`, `textMaxWidth` / `textMaxWidthPx`.
  **R23:** Superseded in part by R23 T437/T435: `headingSpacePx` replaced by `headingSpace`, `bodyWeight` one value.
- [X] T375 [US3] `cms.Stats` `valueLineHeight` through the new `tierLeading` helper (a tier below
  the first set keeps the size token's line height).
  **R23:** Superseded in part by R23 T435: the line height only with Custom px.
- [X] T376 [US3] `cms.MediaText` `featureBodySize` / `featureBodySizePx`, `featureBodyWeight`,
  `featureBodyColor`.
  **R23:** Superseded in part by R23 T435/T436: `featureBodyColor` removed, the weight one value.
- [X] T377 [US3] `cms.RichContent` `textWeight`, `listWeight`.
  **R23:** Superseded in part by R23 T442: `listWeight` removed, `textWeight` one value.
- [X] T378 [US3] `cms.FeatureList` `iconPosition` per breakpoint and `items[].span` (desktop, 12
  tracks). `titleWeight` was already per breakpoint (guard test; its type corrected).
- [X] T379 [US4] Carousel header `headingLineHeight` (`CAROUSEL_HEADER_FIELDS`: ContentSlider,
  ProductSlider, ProductGrid, LatestPosts), `cms.LinkList` `titleLineHeight`, `blog.LatestPosts`
  `leadWeight`.
  **R23:** Superseded in part by R23 T435: the line height only with Custom px.
- [X] T380 [US6] `newsletter.Signup` `topicLabelSizePx`, `buttonIcon` (icon catalog; the
  sign-up's button is not a `ButtonSpec`).
  **R23:** Superseded in part by R23 T443: `topicLabelSizePx` removed.
- [X] T381 [US3] `cms.Testimonial` `quoteSize` / `quoteSizePx`.
- [X] T382 [US4] `cms.DownloadTile` `iconButtonIcon`; the icon catalog gains `cloudDownload`.
- [X] T383 i18n en + pl in the `cms`, `catalog`, `blog` and `newsletter` bundles; manifests' and
  the default config's `responsiveFields`; the admin label walk shows the new conditional fields.
  Docs: `cms/index.md` § "Column gaps, column anchors, row alignment and more options", Polish
  mirror, cache rehashed (`hashSourceBody()`); contracts/blocks.md § "R22I", data-model; changesets
  `163-r22i-*` (four); rebuilt `dist/cms-components.css`.
- [X] T384 (done on the merged branch as R22K's T410) The brand CSS writing `--cmsb-grid-gap` (the
  base tier's gutter in the tablet / small-desktop blocks when a per-tier gutter is set), so the
  default gap stops following a per-tier gutter without a block option.
  **R23:** Superseded by R23 T433.
- [ ] T385–T389 (reserved)

**R22I verification (2026-10-28):** packages built. Tests: cms-components 95 / 2148 (with
`r22i-grid-and-options.test.tsx` 33 / 33); mod-cms 29 / 329; mod-catalog 12 / 110; mod-blog 2 / 22;
mod-newsletter 7 / 57; admin whole suite 388 / 3892; storefront whole suite 168 / 1780; backend
`test/unit/cms` and `tailwind-sources` 7 / 85 (unit config). Typecheck clean for cms-components,
mod-cms, mod-catalog, mod-blog, mod-newsletter, admin, storefront; lint 0 errors. Checks:
`check:block-names`, `check:class-vocabulary`, `check:docs-translations`, `check:module-docs`,
`check:block-renderers`, `check:bundle-pairing`, `check:test-ownership` findings=0;
`check:default-language-prose` violations=0; `i18n:hardcoded` regressions=0;
`check:release-intent` violations=0; `manifests:check` up to date; `check:language` OK.

## R22J — fluid frame, block px scaling, button labels, breadcrumbs

Gaps found while rebuilding reference pages (2026-10-28): the frame does not grow with the fluid
type, a block's own px values ignore the tier scale, button labels do not scale, the painted
breadcrumb trail uses the link colour, the band cannot be made compact, and a type style has one
letter spacing for every breakpoint. Task IDs T390–T409. Brand opt-in flags; unset, the brand CSS is
today's byte for byte (contracts/blocks.md § "R22J"; data-model §2).

- [X] T390 [US1] Brand `layout.fluidContainer`: in the fluid block `--cmsb-container` =
  `clamp(<containerSmallDesktopPx, else container × factor>px, <container × 100 / until>vw,
  <container>px)`; `--cmsb-gutter` the same from a narrower `gutterSmallDesktopPx`. Needs the fluid
  range (`fluidDesktop`, factor below 1). **RED first:** `brand-css.test.ts` R22J RED 4/5 (the
  byte-identity guard green); contracts `cms-brand.test.ts` R22J RED 1/1.
  **R23:** Superseded by R23 T432.
- [X] T391 [US1] `blockPx(n)` (`components/block-px.ts`): `calc(n * var(--cmsb-px, 1px))`, `0px`
  for zero. **Decision (stored shape and markup):** nothing stored changes; the wrapping is
  unconditional (a block renders without the brand; threading a render-context flag through every
  helper was rejected), so a **set** Custom px value changes form in the markup while its computed
  value is identical when `--cmsb-px` is unset. Unset options still write nothing; a caller's code
  default (section default spacing, fallback px) stays literal. The helper was written before its
  own unit case (that case was never RED); the block cases below were.
  **R23:** Superseded by R23 T431.
- [X] T392 [US1] Brand `tierScale.blockPx`: `--cmsb-px` (`<factor>px`; fluid
  `clamp(<factor>px, <100 / until>vw, 1px)`) in the tablet, small-desktop and fluid blocks. Emitters
  routed through `blockPx`: `pxCss` / `tierVars` / `pxTierOption`, `responsivePxVars`,
  `textStyleAttrs`, `section-parts` (`gapCss`, Custom sizes), `cms.Heading`, `cms.Hero`, Section
  frame / group (editor `{px}` spacing, overlap, max width, outset; `tieredVars` no longer parses
  CSS back to numbers), `cms.Spacer`, `cms.Statement`, `text-max-width`, `ButtonView` (icon-only
  size, pill width), `CarouselShell` gap, `cms.Image` width (local `scaledWidthVars` replaces
  `buildResponsiveNumberVars`), `cms.Accordion` icon, `CmsProductCard`, `CarouselImage` padding,
  `LogoStrip`, `cms.Map`. Not covered: list in contracts/blocks.md § "R22J" (notably `cms.Row` /
  `cms.Column` own gaps, max width, outset — another agent's area in this round — and the core
  box-spacing helpers). **RED first:** `r22j-block-px.test.tsx` RED 6/8 (the `blockPx` unit case
  and the "nothing set" guard green). `fallback-parity.test.tsx`: `resolveVars` computes the
  scaled-pixel product as a browser does (named change, standing rule 13), plus an R22J case
  (button label 14 → 12.6 px, spacer 40 → 36 px under the variables; written after the code, not
  seen RED). **Named changes (rule 13), expectation form only (`Npx` →
  `calc(N * var(--cmsb-px, 1px))` where the block writes a set Custom px):** `Accordion`,
  `CarouselImage`, `CmsProductCard`, `ContentSlider`, `FeatureList`, `Heading`, `Hero`,
  `LatestPosts`, `LinkTile`, `MediaText`, `Section`, `SectionBlock`, `SectionGroup`, `Stats`,
  `Tabs`, `button-look`, `carousel/CarouselShell`, `download-tile-look`, `download-tile-options`,
  `embedded-button-look`, `hero-text-options`, `image-caption-look`, `r20e-fixes`,
  `r21g-fixes-and-options`, `r21h-tiers`, `rich-text-size-and-markers`, `section-width-outset`,
  `split-layout-and-block-spacing`, `text-and-content-options`, `text-max-width`,
  `text-weight-and-measure` (`.test.ts(x)`, 95 assertions on one run before the rewrite).
  **R23:** Superseded by R23 T431.
- [X] T393 [US1] Brand `tierScale.buttonLabels` (separate from `buttons`, so stored brands keep
  their output): `--cmsb-btn-px` per tier; `.cmsc-btn` labels `calc(14|13|16 * var(--cmsb-btn-px,
  1px))`, the icon (`1.15em`) follows. **RED first:** in T390's brand-css RED and
  `r22j-block-px.test.tsx`' stylesheet case.
  **R23:** Superseded by R23 T431.
- [X] T394 [US8] Bug: on a painted trail (muted, dark; band or overlay) the links took the scheme's
  link colour and the current page the muted text. Now links `--cmsb-fg-muted` (hover `--cmsb-fg`),
  current page `--cmsb-fg` (`storefront/components/Breadcrumbs.tsx`); light unchanged. **RED
  first:** storefront `breadcrumbs.test.tsx` R22J colour case RED (the light guard green).
- [X] T395 [US8] Brand `layout.breadcrumbsPaddingYPx` (integer 0–64): the painted band's
  `padding-top` / `padding-bottom` inline, replacing `pt-[24px] pb-[16px] max-md:pt-[16px]`
  (`app/(content)/[...slug]/page.tsx`, read from `getServerContext().brandTokens`). **Decision:**
  brand-level (no migration, one band look per site); light trail and overlay keep their spacing.
  **RED first:** `breadcrumbs.test.tsx` R22J band case RED (the "unset" guard green).
  **R23:** Superseded by R23 T432.
- [X] T396 [US1] `typeScale.<token>.trackingMobileEm` (−0.1–0.2): the token's `-ls` below 1024 px,
  `trackingEm` from 1024 px. Covered by T390's RED.
  **R23:** Superseded by R23 T432.
- [X] T397 Brand screen: Layout card switches **Scale button label sizes…**, **Scale blocks' own px
  values…**, **Grow the page container and side margins…** (shown with the fluid sizes), field
  **Breadcrumb band padding above and below (px)**; type scale column **Letter spacing below
  desktop (em)** (`FactorField` gains `labelHidden`). **RED first:** admin `brand-page.test.tsx`
  R22J case RED 1/1 (missing field).
  **R23:** Superseded by R23 T432.
- [X] T398 i18n en + pl (`cms`: 5 keys). Docs: `cms/brand.md` (Typography, Layout, Tokens as CSS
  variables), `cms/index.md` (breadcrumb colours and band padding); Polish mirrored; cache rehashed
  with `hashSourceBody()`.
- [X] T399 contracts/blocks.md § "R22J", data-model §2, changesets `163-r22j-*` (five; the
  storefront-only colour fix needs none), rebuilt `dist/cms-components.css`.
- [ ] T400 (partly done on the merged branch as R22K's T411: Row gaps, max width and Column outset)
  Follow-ups not done: route `cms.Row` / `cms.Column` gaps, max width and
  outset and the core `buildResponsive*` box spacing through `blockPx` once this round's grid work
  is merged (they always write their defaults, so the change there is a markup change for unset
  blocks too); the editor preview has no small-desktop or fluid viewport to show the scaling.
  **R23:** Superseded by R23 T431 (no block px scaling).
- [ ] T401–T409 (reserved)

**R22J verification (2026-10-28):** packages built. Tests: cms-components 95 / 2129 (with
`r22j-block-px.test.tsx` 8 / 8, `brand-css.test.ts` 35 / 35, `fallback-parity.test.tsx` 128 / 128);
contracts 69 / 1409; mod-cms 29 / 329; mod-catalog 12 / 110; mod-blog 2 / 22; admin whole suite
388 / 3893; storefront whole suite 168 / 1784; backend `test/unit/cms` + `tailwind-sources` 7 / 85
(unit config). Typecheck clean for contracts, cms-components, mod-cms, admin, storefront; lint 0
errors (storefront: 17 pre-existing warnings in files not touched). Checks: `check:module-docs`,
`check:docs-translations`, `check:bundle-pairing`, `check:block-names`, `check:block-renderers`,
`check:class-vocabulary`, `check:test-ownership` findings=0; `check:default-language-prose`
violations=0; `i18n:hardcoded` regressions=0; `check:release-intent` violations=0;
`check:language` OK.

## R22K — merge follow-ups

Follow-ups left by R22I (T384) and R22J (T400), done on the merged branch. Task IDs T410–T414.

- [X] T410 [US1] (= R22I's T384) The brand CSS writes `--cmsb-grid-gap` wherever a tier has a gutter
  of its own, so the 12-column layouts (and the Row's fallback) keep the base tier's gutter as their
  column gap: in the tablet block with `layout.gutterTabletPx` (`gutterMobilePx ?? 24` px), in the
  small-desktop block with `layout.gutterSmallDesktopPx` (`gutterDesktopPx ?? gutterMobilePx ?? 24`
  px) and in the fluid block beside a fluid gutter (`layout.fluidContainer`, the desktop gutter).
  No per-tier gutter: the brand CSS is today's byte for byte. **RED first:** `brand-css.test.ts`
  R22K block RED 3/4 (the "unset" guard green); the R21H frame-per-tier expectations now include
  the grid gap.
  **R23:** Superseded by R23 T433.
- [X] T411 [US1] (= R22J's T400, part) The px values R22I added and the Row's and Column's own px
  through `blockPx`. Audit: every R22I emitter already goes through the shared helpers R22J routed —
  `columnGapPx` (`tierVars` + `pxCss`, `cms.Stats`, `cms.MediaText`, `cms.CarouselSplit`),
  `headingSpacePx` and `topicLabelSizePx` (`pxTierOption`), `textMaxWidthPx` (`textMaxWidthAttrs`),
  `featureBodySizePx`, `quoteSizePx`, `bodyWeight`/`textWeight`/`titleLineHeight` (`textStyleAttrs`)
  — so they needed no change (R22I's tests now assert the calc form). New `scaledNumberVars` in
  `block-px.ts` (`buildResponsiveNumberVars` with a stored value against the scaled pixel, an
  unstored default literal): `cms.Row` `gap`, `rowGap` and `customMaxWidthPx` (published and the
  editor's inner max width); `cms.Column` `outsetPx` through `blockPx`. Not routed: the Row's
  `minHeight` (a height, like the button heights) and the core `buildResponsive*` /
  `spacingToCss` box padding and margins (they always write their defaults; routing them would
  change unset markup). A Row with no stored gap keeps today's markup; a stored gap (the editor's
  default 24 is stored) is now `calc(24 * var(--cmsb-px, 1px))` — 24 px wherever `--cmsb-px` is
  unset. **RED first:** `r22k-row-column-px.test.tsx` RED 5/6 (the unset Row green); the R19C
  outset and T239 row-gap expectations moved to the calc form.
  **R23:** Superseded by R23 T431.
- [ ] T412–T414 (reserved)

**R22K verification (2026-10-28, merged branch `r22-merge`):** packages built; `composer:generate`,
`manifests:generate` and `pnpm install --lockfile-only` changed nothing. `pnpm -r run typecheck` and
`pnpm -r run lint` exit 0. `pnpm --no-bail --filter '!backend' run test`: every workspace green
except `packages/cli` 5 / 1012 (the known macOS terminal and scaffold cases); cms-components
97 / 2173, admin 388 / 3893, storefront 168 / 1784, contracts 69 / 1409, mod-cms 29 / 329.
Backend `test:unit:fast` 16 files / 145 tests failing, the same file set as the earlier baseline
(spawned-script and package-artefact cases). Every `quality.yml` check exit 0 (`check:naming` is the
known macOS refusal), `check:language` OK, `check:release-intent -- --since 0e33ca93f`
violations=0. Offline render of a stored marketing page, r21 against r22: identical once each
`calc(N * var(--cmsb-px, 1px))` reads N px and the 25 Columns' removed `cmsc:self-stretch` (R22I
T373) are discounted.

## R23 — simplification of the R19–R22 options

R19–R22 added about 200 block and brand options, many of them only to match a measured page to the
pixel. Owner decision (2026-10-28): **pixel-matching options removed**; every structural capability
and every bug fix stays. Nothing of R19–R22 was released, so there is no migration: a removed block
prop is ignored data, a removed brand key is stripped on parse. Everything stored before R19 renders
as before. Data-model §7 and contracts/blocks.md § "R23" hold the lists. Task IDs T430–T469.

- [X] T430 Decisions (owner, binding): (1) a type-token size carries its own line height, weight
  and tracking; a line height is shown and applied only with a Custom px size; the R19–R22 weights
  are one value (stored per-breakpoint: desktop, else base); per-text colours fold into the block's
  text colour plus an accent; (2) no carousel small-desktop tier; (3) 12-column layouts get a
  `layout` preset, the raw numbers behind `layoutAdvanced`, which wins when on; (4) the drops
  listed in T431–T449. Kept: `tierScale.tablet` / `smallDesktop`, `fluidDesktop` / `fluidUntilPx`,
  `tierScale.buttons`, `breadcrumbsOverlay`, nested URLs, every structural option and bug fix.
- [X] T431 [US1] No block px scaling: R22J's `blockPx` / `block-px.ts` / `--cmsb-px`,
  `buttonLabels` / `--cmsb-btn-px` and R22K's Row/Column scaled vars reverted to literal px (calc
  expectations back to px; `r22j-block-px.test.tsx`, `r22k-row-column-px.test.tsx` deleted).
- [X] T432 [US1] Brand drops: `tierScale.smallDesktopUntilPx` (the tier ends at 1279 px),
  `layout.gutterTabletPx` / `gutterSmallDesktopPx` / `containerSmallDesktopPx`, `fluidContainer`,
  `breadcrumbsPaddingYPx` (the storefront band keeps its classes; T394's trail colours stay),
  `typeScale.<token>.trackingMobileEm`. Brand screen Layout card: 9 controls → 5. **Test:**
  contracts `cms-brand.test.ts` R23 "stripped on parse", `brand-css.test.ts` R23 stale keys write
  nothing, admin `brand-page.test.tsx`, storefront `breadcrumbs.test.tsx` (stored padding ignored).
- [X] T433 [US1] No `--cmsb-grid-gap`: the grids read `var(--cmsc-grid-gap…, var(--cmsb-gutter,
  24px))` (R22K T410 reverted).
- [X] T434 [US4] No carousel small-desktop tier (`slidesPerViewSmallDesktop`, `gapSmallDesktopPx`,
  the `-sd` rule). **Test:** `r21h-tiers.test.tsx` R23 T434 cases (stored values ignored).
- [X] T435 [US3] One typography rule in `text-style.ts`: `textStyleAttrs` writes a token size's
  `--cmsb-t-<token>-lh|-w|-ls` (new `cmsc-pb-ts-tracking` class); a line height only at a Custom
  tier (`customOnlyLeading`, `customLeadingAttrs`, `sizeUsesCustom`); `singleWeight` reads a stored
  per-breakpoint weight as desktop, else base. Line-height fields shown only with a Custom size.
  Pre-R19 per-breakpoint weights (R17) unchanged. **RED first:** `text-style.test.ts` (12 tests).
- [X] T436 [US2] `cms.Hero`: per-text colours (`titleColor`, `subheadingColor`, `statementColor`,
  `bodyColor`), `bodyListMarkerColor`, `eyebrowWeight` and the proof caption's size, weight, line
  height and colour removed; `eyebrowSize` select added (a stored px without a size reads as
  Custom). Also `cms.Statement.bodyColor`, `cms.FeatureList.bodyColor`,
  `cms.MediaText.featureBodyColor`, `cms.Stats.labelColor` removed.
- [X] T437 [US3] Spacing steps (`space-token.ts`, `BlockSpace`): `innerSpace` (FeatureList,
  MediaText, CarouselSplit), `stackedGap` (MediaText, CarouselSplit), `cardPadding` (CtaCard,
  DownloadTile), `headingSpace` (CtaCard) replace the per-element px.
- [X] T438 [US3] 12-column presets (`twelve-columns.ts`: `LAYOUT_PRESETS`, `layoutPresetField`,
  `LAYOUT_ADVANCED_FIELD`, `usesAdvancedLayout`, `chosenSpans`) on `cms.CarouselSplit`, `cms.Stats`;
  `cms.MediaText` keeps `split` and gains `layoutAdvanced`; `resolveData` stores the switch on for
  stored raw numbers. **RED first:** `twelve-columns.test.ts` (7 tests). Render cases
  `r23-layout-presets.test.tsx` (10 tests, written after the implementation).
- [X] T439 [US3] `cms.Heading.hangingIconGapPx`, `cms.CarouselSplit.titleHangingIconGapPx` removed.
- [X] T440 [US3] `cms.CtaCard`: `layout` (two-track presets) + `layoutAdvanced`, `cardPadding`,
  `headingSpace`; `listSize` / `listSizePx` removed (the list follows `bodySize`);
  `imageInsetPx` one value.
- [X] T441 [US8] `cms.Accordion`: `chevron-circle` and `iconCircleColor` removed; a stored
  `chevron-circle` renders as `chevron`.
- [X] T442 [US3] Rich text: the size mark's Custom px removed from the toolbar
  (`isSettableTextSize`; a stored px mark still renders and sanitises); `cms.RichContent.listWeight`
  removed, `textWeight` one value.
- [X] T443 [US6] `newsletter.Signup`: `buttonHeightPx`, `buttonTextSizePx`, `buttonWeight`,
  `topicLabelSizePx` removed (`responsiveFields` now empty).
- [X] T444 [US4] `cms.DownloadTile`: `titleSize` select and `cardPadding` added;
  `iconButtonSizePx`, `iconButtonBorderColor`, `subtitleSizePx`, `subtitleColor` removed;
  `minHeightPx` one value.
- [X] T445 [US6] `cms.CarouselImage`: read-more label size, colours, weight and
  `captionPaddingPx` removed (the label is 14 px / semibold).
- [X] T446 [US3] `cms.Image`: `captionSize` select added; `captionWeight`, `captionColor`,
  `captionMinWidthPx` removed.
- [X] T447 [US2] `cms.Button` / `ButtonSpec`: `iconSizePx`, `iconOnlyWidthPx` removed (contracts
  schema strips them); a pill is 1.15 × its height in CSS.
- [X] T448 [US4] Carousel `controls.dotColor` / `activeDotColor` removed (the scheme colours stay).
- [X] T449 [US1] `cms.Section.outsetPx` and `cms.BackgroundPanel` `textBoxMarginPx` /
  `textBoxPaddingPx` removed (the Column outset stays).
- [X] T450 Responsive registry (`index.ts`) and the manifests' `responsiveFields` (cms, catalog,
  blog, newsletter); option-parity and panel-consistency updated (`SINGLE_WEIGHT_PAIRS`).
- [X] T451 i18n en + pl: `cms` −110 / +140 keys, `catalog` and `blog` −4, `newsletter` −11, core
  `_i18n` −2; the admin's label-walk test (`page-builder-field-i18n.test.ts`) green.
- [X] T452 Docs: `cms/index.md` and `cms/brand.md`, the PL mirrors, translation cache rehashed.
- [X] T453 contracts/blocks.md § "R23", data-model §2, §3.2, §3.4, §4 note and §7; earlier tasks
  annotated "R23: superseded".
- [X] T454 Changesets: the unreleased `163-r19*`…`163-r22*` describe only what remains — eight
  deleted (`r21h-carousel-small-desktop`, the five `r22j-*`, the two `r22k-*`), 22 edited; one
  added, `163-r23-type-rule-layout-presets-spacing-steps`.
- [X] T455 Pre-R19 parity: `option-parity.test.ts` and `fallback-parity.test.tsx` green; offline
  render (`renderToString` + `puck.Render`) of every block at its pre-R19 defaults (47 blocks) and
  of a page stored before R19, each stored and after `resolveAllData`, with the `0e33ca93f` build
  against this one: 91 of 96 renders byte-identical. The five others carry only two earlier bug
  fixes R23 keeps — R22I T373 (a Column no longer forces `cmsc:self-stretch`; Row, Column) and
  R21H T350 (a heading with a different type token on desktop gets the tier's line height, weight
  and tracking; one tag of 1556 on the stored page). Nothing in the difference comes from R23.
- [X] T456 Verification (2026-10-28): packages built; `composer:generate`, `manifests:generate`
  and `pnpm install --lockfile-only` changed nothing. `pnpm -r run typecheck` and `pnpm -r run lint`
  exit 0. `pnpm --no-bail --filter '!backend' run test`: every workspace green except
  `packages/cli` 5 / 1012 (the known macOS terminal and scaffold cases) and two stale R19 assertions
  the run found, fixed and re-run green — cms-components `fallback-parity.test.tsx` (the dot colour
  chain without `--pb-dot-*`, 126 / 126) and admin `sidebar-field-layout.test.tsx` (no Section
  `outsetPx`, 9 / 9); cms-components 98 files / 2169 tests, admin 388 / 3892, storefront
  168 / 1784, contracts 1409, mod-cms 329. Backend `test:unit:fast` 16 files / 145 tests failing,
  the known file set (spawned-script and package-artefact cases). Every `quality.yml` check exit 0
  (`check:naming` is the known macOS refusal), `check:language` OK,
  `check:release-intent -- --since 0e33ca93f` exit 0.
- [X] T466 T270, T282, T284, T355: their contract and migration tests are marked "written, not
  run" — the test Postgres (`dev:infra:test`, port 5441) was not up; not started here.
- [X] T467 Hero `order[].spacePx` (and `spaceAfter[].spacePx`) stored per breakpoint rendered as 0 px —
  `spaceAfterCss` read a number only. RED: `Hero.test.tsx` "a Custom space stored per breakpoint
  is read per breakpoint, not as 0 px" (received `0px`, expected `12px`); fixed by reading the
  value through `resolveResponsive`, as the block's other px fields are. The editor still writes
  one number.
- [X] T468 T270, T282, T284, T355 run on the test Postgres: 3 files, 36 / 36 green; re-ticked.
- [ ] T457–T465, T469 (reserved)

**R23 option counts** (`defaultPageBuilderConfig`, r22-merge → R23): declared top-level fields
975 → 933, with nested object and array fields 1615 → 1541; fields a new block shows in the editor
(its `resolveFields` over the default props) 790 → 735. Brand: 9 stored keys removed; the screen's
Layout card 9 controls → 5, the type scale table one column fewer.

## R24 — name, slug and description per language (issue #521)

Owner decisions (2026-10-29): the page's own fields stay the default and a language overrides
any of them (empty = inherited); a language is addressed as a product is (`?lang=` outside the
channel default, 308 to the served language's address, `hreflang`, a sitemap entry per language);
documented here as a round of 163. Spec FR-034 amended, FR-034a; data-model §1.1, §5.2.

- [X] T470 [R24] Contracts: `cmsPageTranslationSchema` / `cmsPageTranslationsSchema` on summary,
  detail, create and patch; `cmsLocalizedPage`; `cmsPageUrl`; `url` and `alternates` on the
  resolved page and the index entry. Test: `packages/contracts/src/cms-page-translations.test.ts`
  (RED 12/13 before the code).
- [X] T471 [R24] Migration `20261029T131218_cms_page_translations.ts` (`translations jsonb not null
  default '{}'`), entity `CmsPage.translations`, registry regenerated. Test: case in
  `backend/test/integration/cms/migration.test.ts`.
- [X] T472 [R24] `page-paths.ts`: `languageSlug`, `channelLanguages`, `channelPaths(…, language)`;
  `duplicatePath`, `addressesOf`, `anyNested` over the channel-slug tree and every language's.
  Test: `page-paths.test.ts` (RED 7 before the code).
- [X] T473 [R24] `CmsPageService`: writes `translations` (blank fields dropped) in the create and
  update Commands, refuses an undeclared language (400) and a duplicate language address (409)
  inside the Command, checks every language slug against the reserved segments, records
  `translations` in the audit state, searches the list by it, invalidates every language address
  of the subtree. `StorefrontResolver`: resolution order of data-model §5.2, served-language
  `path`, `url`, `alternates`, `name`, trail and `page` links; the index's `url` and `alternates`
  per servable language. Test: contract `backend/test/contract/cms/page-translations.contract.test.ts`
  (13 / 13 on the test Postgres); `test/contract/cms` + `test/integration/cms` 40 files, 499 / 499.
- [X] T474 [R24] Admin page editor: *Language version* card (name, slug, description, meta per
  language; placeholders show the inherited value; the address preview per language; a language
  slug follows its name until edited); its tabs and the canvas tabs switch one language. Fixes on
  the way: the meta fields were read from `en-US` whatever the page's languages, and a save sent
  the active language's meta only, which replaced every other language's on the server. en + pl
  strings. Test: `admin/test/modules/cms/cms-editors-settings-panel.test.tsx` (RED 3 before the
  code; the R19D case now sees the address in both cards).
- [X] T475 [R24] Storefront `(content)/[...slug]`: `?lang=` passed as the page's language override
  (`requestedLanguage` moved to `lib/i18n/requested-language.ts`), 308 to `url`, canonical `url`,
  `hreflang` alternates, content marked with its language (WCAG 3.1.2); sitemap entry per language
  URL with alternates. Tests: `storefront/test/seo/cms-language-urls.test.tsx` (RED 5/6),
  `sitemap-cms.test.ts` R24 case (RED), `catalog/pdp-redirect.test.ts` Q-M7 guard extended to the
  CMS page.
- [X] T476 [R24] Docs: `cms` module page *Name, slug and description per language*, sharing
  metadata and API rows; PL mirror; translation cache rehashed.
- [X] T477 [R24] Changeset `.changeset/163-r24-cms-page-translations.md`.
- [ ] T478 [R24] Follow-ups not done here: `seo`'s sitemap generator and meta-tag rule, and
  `megamenu` CMS-page links, read `CmsPageRecord` (no translations) and build `/<slug>` — they
  reach a translated page through the redirect; the AI translation of a canvas does not translate
  the page's name or description; no redirect from a language slug after it changes.
