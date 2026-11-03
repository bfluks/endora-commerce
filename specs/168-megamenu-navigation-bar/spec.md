# Feature Specification: Megamenu navigation bar — tabs, columns, category trees and audiences

**Feature Branch**: `feat/522-megamenu-navigation` (spec directory `specs/168-megamenu-navigation-bar/`)
**Created**: 2026-10-29
**Status**: Planned — planning amendments marked *(Planning amendment)*
**Input**: GitHub issue #522 (*Megamenu*, empty body) and the owner's brief (in Polish): the
megamenu is very limited; a link to a CMS page looks exactly like a link to a category; the
menu must be able to grow **horizontally**, because today everything goes under *Wszystkie
kategorie*. The owner accepted the stage-1 proposal (tabs with a presentation, column
groups, category trees from the catalogue, kind-specific rendering, labels inherited from
the target, hard-coded chrome removed) and added **audience visibility** from stage 2.

The module is `megamenu` (`packages/modules/megamenu/`, feature 015). It is extended, not
replaced.

## Vocabulary

| Term | Meaning |
| --- | --- |
| **Menu** | One megamenu configuration, bound to one or more (sales channel × language) scopes. |
| **Item** | A node of the menu tree. Each has a **kind** (what it points at) and, at the top level, a **presentation** (how it opens). |
| **Tab** | A top-level item. Tabs form the horizontal **navigation bar** of the storefront header. |
| **Presentation** | How a tab behaves: `link` (plain link, no panel), `dropdown` (narrow list under the tab), `mega` (full-width panel of columns) or `catalog` (the departments → subcategories panel shown today under *Wszystkie kategorie*). |
| **Alignment** | Whether a tab sits at the start (left) or the end (right) of the bar. |
| **Group** | An item of kind `group`: a heading without a link. In a `mega` panel each group is a **column**. |
| **Category tree** | An item of kind `category-tree`: a live expansion of the catalogue's category tree from a chosen root, to a chosen depth. |
| **Promo slot** | The side area of a `mega` or `catalog` panel, filled by a `cms-block-embed` or `asset` child. |
| **Audience** | Who may see an item: everyone, guests only, signed-in customers only, or customers of chosen **customer groups**. |
| **Effective customer group** | The one group a signed-in customer belongs to: their own account's group, else their organisation's (`effectiveCustomerGroupId`, feature 040 R6 / D-287). |

## Current state (what this feature replaces)

- The storefront header renders a single hard-coded *Wszystkie kategorie* trigger
  (`storefront/components/Megamenu/CategoriesMega.tsx`). Every top-level item becomes a row
  of its *Działy* column and every child a link in three columns; deeper levels are not shown.
- Every item is rendered as a plain text link whatever its kind; an `asset` or a
  `cms-block-embed` item has no URL and links to `/catalog`.
- *Wszystkie kategorie*, *Działy*, *Przeglądaj … →*, the Quick Order promo inside the panel
  and the Quick Order button at the end of the bar are hard-coded Polish.
- `storefront/components/Megamenu/Megamenu.tsx` and `MegamenuPanel.tsx` render one trigger
  per top-level item, but nothing mounts them.
- Categories are added one `category-link` at a time; a new category never appears in the
  menu by itself, and every label is typed per language even when the target already has a
  translated name.

## Clarifications

### Session 2026-10-29 (owner)

- Q: Does the category tree from the catalogue belong to this feature? → A: **Yes.**
- Q: Should *Wszystkie kategorie* stay the first tab of the default menu? → A: **Yes — and
  backward compatibility is not a goal.** Stored menus need not be migrated into the new
  shape and the megamenu contract may break; the default menu is re-created in the new shape.
- Q: Which stage-2 capability comes into this feature? → A: **Audience visibility.**

### Assumptions (proposed by the author, open to the owner's correction)

- **A-1** Audience choices are *everyone*, *guests only*, *signed-in only* and *customer
  groups* (any of the chosen groups). An organisation allow-list is out of scope: a group is
  the operator's existing tool for addressing a set of buyers.
- **A-2** An audience applies to an item at any level, and hiding an item hides its subtree.
  A child cannot widen what its parent restricts.
- **A-3** A `category-tree` is never a tab: it expands under a tab, so a catalogue change can
  never add or remove tabs from the bar by itself.
- **A-4** Badges, scheduling, promo cards, live preview and menu locations (footer, top bar)
  stay in later features.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — A horizontal navigation bar of tabs (Priority: P1)

An operator builds the storefront's main navigation as a row of tabs: *Wszystkie kategorie*
opening the catalogue panel, *Usługi* opening a panel of columns, *Dla firm* opening a short
list, *O nas* as a plain link, and *Quick Order* as a primary button at the end of the bar.

**Why this priority**: it is the issue. Without it every entry lands under one trigger and a
CMS page cannot be placed in the navigation as a first-class entry.

**Independent Test**: create a menu with one tab of each presentation and an end-aligned
button, bind and activate it, and load the storefront home page on a desktop viewport.

**Acceptance Scenarios**:

1. **Given** an active menu with tabs *Wszystkie kategorie* (`catalog`), *Usługi* (`mega`),
   *Dla firm* (`dropdown`) and *O nas* (`link`), **When** a visitor loads any page, **Then**
   the bar shows the four tabs in that order, and only *O nas* navigates on click without
   opening a panel.
2. **Given** a `button` tab aligned to the end with variant `primary`, **When** the bar
   renders, **Then** it sits at the end of the bar in the primary style, and the header has
   no other Quick Order button.
3. **Given** a visitor hovering *Usługi*, **When** the pointer moves diagonally across
   *Dla firm* into the panel, **Then** the *Usługi* panel stays open (hover intent).
4. **Given** keyboard focus on a tab with a panel, **When** the visitor presses Enter or
   Space, **Then** the panel opens with `aria-expanded="true"`; **When** they press Escape,
   **Then** it closes and focus returns to the tab.
5. **Given** more tabs than fit the bar's width, **When** the bar renders, **Then** the tabs
   that do not fit move into a trailing *More* tab rather than wrapping or being clipped.
6. **Given** a fresh installation with demo data, **When** the storefront loads, **Then** the
   default menu has *Wszystkie kategorie* as its first tab, presenting `catalog`.

---

### User Story 2 — Each kind of item looks like what it is (Priority: P1)

Inside a panel, a category link, a CMS page link with a description, a button, an image and
an embedded CMS block each render as themselves, and a `mega` panel is laid out in the
columns the operator defined.

**Why this priority**: the owner's first complaint — a CMS page link looks exactly like a
category link — is a rendering defect that the tabs alone do not fix.

**Independent Test**: build a `mega` tab with two groups of mixed links, one button and one
CMS block child; check the panel's columns and each item's rendering.

**Acceptance Scenarios**:

1. **Given** a `mega` tab with groups *Doradztwo* and *Wdrożenia*, each holding links,
   **When** the panel opens, **Then** it shows two columns headed by the group names, and
   each group heading is text, not a link.
2. **Given** a link item with a description, **When** it renders in a `mega` or `dropdown`
   panel, **Then** the description shows below the label.
3. **Given** a `button` child, **When** it renders, **Then** it shows as a button in its
   variant, not as a text link.
4. **Given** a `cms-block-embed` child of a `mega` or `catalog` tab, **When** the panel
   opens, **Then** the block renders in the promo slot on its declared side, and the panel
   has no other promo.
5. **Given** an `asset` child of kind `image`, **When** the panel renders, **Then** it shows
   as an image, and no item renders with a link to `/catalog` it does not declare.
6. **Given** a `catalog` tab, **When** a visitor rests on a department, **Then** its
   subcategories show as column headings with their own children listed under them (three
   levels), and the department's *All …* link points at the department itself.

---

### User Story 3 — Categories come from the catalogue (Priority: P2)

An operator adds one *category tree* item under *Wszystkie kategorie*, choosing the whole
catalogue and a depth of 3. Categories added, renamed, reordered or deactivated in the
catalogue appear in the menu that way without touching the menu.

**Why this priority**: it removes the manual upkeep that makes a large catalogue impossible
to keep in the menu, but the bar and rendering stand without it.

**Independent Test**: add a `category-tree` item, then create, rename and deactivate a
category, and read the resolved menu after each change.

**Acceptance Scenarios**:

1. **Given** a `category-tree` item with no root and depth 2, **When** the menu resolves,
   **Then** it expands to every live top-level category and their live children, ordered by
   the catalogue's sort order, each labelled with the category's name in the menu's language
   and linked to its storefront URL.
2. **Given** a `category-tree` rooted at *Narzędzia* with depth 1, **When** the menu
   resolves, **Then** it expands to *Narzędzia*'s live children only, not to *Narzędzia*.
3. **Given** a category deactivated or deleted in the catalogue, **When** the menu next
   resolves, **Then** the category and its subtree are gone from the menu.
4. **Given** a new category created under an expanded root, **When** the menu next resolves
   after the catalogue change, **Then** it appears without a menu edit.
5. **Given** a `category-tree` item placed as a tab, **When** the operator saves, **Then**
   the save is refused with a clear error.

---

### User Story 4 — Labels inherit from what they point at (Priority: P2)

An operator adds a link to a CMS page or a category and leaves its label empty; the menu
shows the target's own name in each language. Typing a label overrides it.

**Why this priority**: it halves the work of building a multilingual menu and keeps menu
labels in step with renamed targets.

**Independent Test**: add a `cms-page-link` with no label to a page that has a name per
language (feature 163 R24), and read the resolved menu in both languages.

**Acceptance Scenarios**:

1. **Given** a `cms-page-link` with no label for `pl-PL`, **When** the menu resolves in
   `pl-PL`, **Then** the label is the page's name in `pl-PL`.
2. **Given** a `category-link` with no label, **When** the menu resolves, **Then** the label
   is the category's name in the menu's language, else in the channel's default language.
3. **Given** a typed label, **When** the target is renamed, **Then** the menu keeps the typed
   label.
4. **Given** an `external-link`, `button` or `group` with no label in any language, **When**
   the operator saves, **Then** the save is refused, because there is nothing to inherit.
5. **Given** a `cms-page-link` to a page with its own slug in the menu's language, **When**
   the menu resolves, **Then** the link points at the page's address in that language.

---

### User Story 5 — Items for chosen audiences (Priority: P2)

An operator adds a *Moje cenniki* tab visible only to signed-in customers, a *Strefa
partnera* tab visible only to the *Dystrybutorzy* customer group, and a *Załóż konto* link
visible only to guests.

**Why this priority**: the owner chose it from stage 2; navigation that differs by buyer is
routine in B2B, and today the only workaround is a second channel.

**Independent Test**: create the three items, then load the storefront as a guest, as a
signed-in customer outside the group, and as a customer of the group.

**Acceptance Scenarios**:

1. **Given** an item for *signed-in only*, **When** a guest loads the page, **Then** the item
   and its subtree are absent from the bar, the panels and the mobile drawer.
2. **Given** an item for *guests only*, **When** a signed-in customer loads the page,
   **Then** the item is absent.
3. **Given** an item for customer groups *Dystrybutorzy*, **When** a customer whose effective
   customer group is *Dystrybutorzy* loads the page, **Then** the item is present; **When** a
   customer of another group, or of none, loads it, **Then** it is absent.
4. **Given** a hidden item, **When** the storefront API answers a visitor who may not see
   it, **Then** the answer contains nothing of it: no label, no URL, no audience rule.
5. **Given** a guest and a group customer requesting the menu one after the other, **When**
   each response is served, **Then** neither receives the menu resolved for the other.
6. **Given** a customer group deleted while an item still names it, **When** the menu
   resolves, **Then** the item is visible to the remaining named groups, or to nobody when
   none remains.

---

### User Story 6 — The same menu on mobile and in every language (Priority: P2)

On a phone, the drawer lists the tabs at its root, drills into a tab's panel, and shows the
same groups, category trees and audiences as desktop; every piece of chrome text is
translated.

**Why this priority**: the bar is desktop-only; without parity a mobile visitor sees a
different menu from the one the operator built.

**Independent Test**: load the storefront on a narrow viewport in `pl-PL` and `en-US`.

**Acceptance Scenarios**:

1. **Given** the menu of User Story 1, **When** the drawer opens, **Then** its root lists the
   tabs; a `link` tab navigates, and every other tab drills into its children.
2. **Given** a drilled-into `mega` tab, **When** it renders, **Then** groups show as section
   headings with their links under them.
3. **Given** the storefront in `en-US`, **When** the bar, the panels and the drawer render,
   **Then** no Polish chrome text remains (*More*, *All …*, *Back*, *Close*).

---

### Edge Cases

- A `link` tab with children: the save is refused, so a tab never hides children no visitor
  can reach.
- A `dropdown` tab with grandchildren: shown as one level; the editor warns that deeper
  levels are not displayed.
- A tab whose every child is hidden from the visitor, or whose category tree expands to
  nothing: the tab is dropped, unless it has its own link, in which case it renders as a link.
- A menu where every tab is hidden from the visitor: the bar renders empty, with no
  placeholder trigger.
- Two `cms-block-embed` children on the same side: the first by position fills the slot, and
  the editor warns about the second.
- A `category-tree` whose root is deactivated: it expands to nothing.
- `catalog` module off: `category-link` and `category-tree` items are dropped (fail closed).
- Depth: a `category-tree` depth of 1–3. The tree's total depth keeps feature 015's
  non-blocking warning past 4 levels.

## Requirements *(mandatory)*

### Functional Requirements

**Tabs and presentation**

- **FR-001** Every top-level item MUST have a presentation: `link`, `dropdown`, `mega` or
  `catalog`; and an alignment: `start` (default) or `end`. Items below the top level MUST
  NOT carry either.
- **FR-002** A tab MAY be of kind `category-link`, `cms-page-link`, `external-link`, `button`
  or `group`. A tab of kind `asset`, `cms-block-embed` or `category-tree` MUST be refused.
- **FR-003** A `link` tab MUST have a target URL and no children; otherwise the save MUST be
  refused.
- **FR-004** The storefront header MUST render the active menu's tabs as one horizontal bar,
  start-aligned tabs first and end-aligned tabs last, each group in position order, and MUST
  render no navigation entry the menu does not contain.
- **FR-005** A `link` tab MUST navigate. Any other tab MUST open its panel on hover (with
  hover intent), on click and on Enter or Space. Escape and leaving MUST close it.
- **FR-005a** *(Owner review, 2026-10-29)* A `category-link`, `cms-page-link` or
  `external-link` tab with a panel MAY follow its own link on click (`clickNavigates`); it then
  renders as its link plus a separate panel toggle, and the panel also opens on hover. Any other
  tab, and any item below the top level, MUST be refused with it.
- **FR-006** When the tabs do not fit the bar's width, the ones that do not fit MUST move into
  a trailing *More* tab, in their order.

**Panels and kinds**

- **FR-007** A `dropdown` panel MUST list the tab's children as one level; a `group` child
  renders as a section heading.
- **FR-008** A `mega` panel MUST render each `group` child as a column headed by its label,
  with that group's children under it; non-group link children MUST be collected into one
  leading column; `cms-block-embed` and `asset` children MUST fill the promo slot.
- **FR-009** A `catalog` panel MUST render the tab's children as departments; the active
  department's children as column headings; their children as links under each heading;
  and — when the active department is a category — an *All in …* link to it. *(Owner review:
  an *All in …* link to a page or an external link said nothing; in the editor the presentation
  is named neutrally, *Panel with side list*, because the layout suits any long list.)* `cms-block-embed` and `asset` children MUST
  fill the promo slot.
- **FR-010** Each item MUST render according to its kind: links as links (with their icon
  and, where the presentation shows it, their description), `button` as a button in its
  variant, `group` as unlinked heading text, `asset` as the image or video,
  `cms-block-embed` as the rendered block. No item MUST link anywhere it does not declare.
- **FR-011** No navigation text, promo or button MUST be hard-coded in the storefront header
  or panels; chrome text MUST come from the storefront's translations in every supported
  language.

**Category trees**

- **FR-012** A `category-tree` item MUST declare a root category (or none, meaning the whole
  catalogue) and a depth from 1 to 3.
- **FR-013** On resolution, a `category-tree` MUST be replaced by the root's live descendants
  to its depth, in the catalogue's sort order, labelled with each category's name in the
  menu's language (else the channel default's, else any name it has — *implementation ruling:*
  the demo catalogue names its categories in English only, and a missing translation must not
  hide a live branch), and linked to each category's storefront URL.
  A category that is inactive or deleted MUST be absent, with its subtree.
- **FR-014** A catalogue change MUST reach the resolved menu no later than the menu's cache
  lifetime, without a menu edit.

**Labels**

- **FR-015** The label of a `category-link`, `cms-page-link` or `category-tree` item MAY be
  empty in any language; an empty label MUST resolve to the target's name in that language,
  falling back to the channel's default language. A `cms-page-link` MUST use the page's
  localised name and address (feature 163 R24, `cmsLocalizedPage` / `cmsPageUrl`).
- **FR-016** An `external-link`, `button` or `group` MUST have a label in at least one language;
  the save MUST be refused otherwise. *(Implementation ruling: "every bound language" would refuse
  a menu that is still being bound; resolution falls back to the channel default as before.)*

**Audiences**

- **FR-017** Every item MUST have an audience: `everyone` (default), `guests`, `signed_in`, or
  `customer_groups` with one or more customer group ids.
- **FR-018** The storefront resolution MUST omit, with its subtree, every item whose audience
  does not include the requesting visitor: `guests` includes only an unidentified visitor;
  `signed_in` only a signed-in customer; `customer_groups` only a signed-in customer whose
  effective customer group is one of the named groups.
- **FR-019** A response MUST NOT reveal an omitted item in any form, and the platform MUST
  NOT serve a menu resolved for one audience to a visitor of another (backend cache, HTTP
  caching, storefront data cache).
- **FR-020** A `customer_groups` audience naming groups that no longer exist MUST count the
  remaining ones only, and MUST hide the item when none remains. *(Planning amendment: the
  modules owning customer groups and organisations are non-deactivatable, so no off-state
  applies.)*
- **FR-021** The admin editor MUST let an operator choose an item's audience, picking customer
  groups from the existing groups, and MUST show the audience in the item tree.

**Admin editor**

- **FR-022** The editor MUST show presentation and alignment for tabs only, offer only the
  kinds allowed at an item's level, and show inherited labels as placeholders.
- **FR-023** The editor MUST configure a `category-tree` by choosing a root (or the whole
  catalogue) and a depth.
- **FR-024** Validation errors MUST name the item and the rule, using stable error codes for
  each refusal in FR-002, FR-003, FR-012 and FR-016.
- **FR-025** Every menu write MUST run as an audited Command Bus write (Principle XIII), with
  the presentation, alignment and audience in the audited state. *(Planning amendment: no
  megamenu write ran a Command before this feature — plan R-7.)*

**Mobile**

- **FR-026** The mobile drawer MUST list the visitor's visible tabs at its root, navigate on a
  `link` tab, and drill into any other tab, rendering groups as section headings and
  expanded category trees as levels.

**Default menu and compatibility**

- **FR-027** The demo composition MUST create the default menu in the new shape: a first tab
  *Wszystkie kategorie* presenting `catalog` with a `category-tree` of the whole catalogue,
  and an end-aligned primary `button` *Quick Order*.
- **FR-028** Backward compatibility of stored menus and of the megamenu wire contract is not
  required (owner, 2026-10-29); the change MUST be declared as breaking in its changeset.
- **FR-029** The unmounted `Megamenu.tsx` / `MegamenuPanel.tsx` and the single-trigger
  `CategoriesMega.tsx` MUST be replaced by one bar implementation, leaving no second renderer.

### Key Entities

- **MegamenuItem** (extended) — gains `presentation` and `alignment` (tabs only), an
  `audience`, and the kinds `group` and `category-tree`. Labels become optional for kinds
  with a target name.
- **Customer group** (read only, owned by `customer_accounts`) — named by an item's audience.
- **Category** (read only, owned by `catalog`) — the source of a `category-tree`'s expansion.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001** An operator can add a CMS page as its own tab of the bar in under a minute,
  without touching *Wszystkie kategorie*.
- **SC-002** The storefront header contains no navigation text, link or button that is not
  read from the active menu or the storefront translations (verified by test).
- **SC-003** A category created in the catalogue appears under a `category-tree` with zero
  menu edits, within the menu's cache lifetime.
- **SC-004** For each of the three audience cases of User Story 5, the storefront API answer
  contains none of the items the visitor may not see (verified by contract test).
- **SC-005** The bar and its panels are fully operable by keyboard alone, and pass the axe
  checks already run for storefront components.
- **SC-006** Resolving a menu with a whole-catalogue tree of depth 3 adds no more than one
  catalogue read per resolution, however many categories it expands to.

## Out of scope

- Badges, highlighting, scheduling (visible from–to) and promo cards (stage 2, apart from
  audiences).
- An organisation allow-list as an audience (A-1).
- Live preview in the editor.
- Menu locations other than the header — footer and top bar (stage 3).
- The `seo` module's and `megamenu`'s other `/<slug>` follow-ups from feature 163 T478,
  except that a `cms-page-link` follows FR-015.

## Amendments

Rulings made while implementing, each recorded where it applies above or here:

- **CMS page links follow the channel (Principle XII).** A `cms-page-link` resolves through
  `cms`' `findStorefrontLinks`, which answers only pages the channel serves; a link to a page
  outside the channel is dropped, where it used to render `/<slug>` and 404 on follow.
- **Viewers.** Only a signed-in *customer* is a signed-in viewer; an API key or an admin reading
  the storefront API sees what a guest sees.
- **Cache key.** The Redis prefix moved from `megamenu:v1:` to `megamenu:v2:`, because an entry
  now holds the audienced tree; `settings`' cache flush names the new prefix.
- **Mobile drawer chrome.** The drawer's hard-coded Quick Order promo is removed with the rest of
  the hard-coded chrome (FR-011); Quick Order is a tab.
- **Demo catalogue.** `catalog`'s demo categories carry Polish names, so the demo's category tree
  reads in Polish; they used to be typed a second time as the demo menu's labels.
- **Storefront tests** follow the storefront's convention — server markup and pure functions
  (`fitTabs`) — rather than adding a DOM testing library; the panel's open/close interaction is
  exercised on a running storefront.
