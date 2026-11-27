# Implementation Plan: Custom-field value carry-over between Quote Requests, Orders and Sales Opportunities

**Branch**: `feat/162-custom-fields-value-carry` (number assigned when the spec enters the branch) |
**Date**: 2026-10-19 | **Spec**: [spec.md](./spec.md) (clarified 2026-10-16; issue #287)
**Input**: the spec above, owner rulings **C4 (a)** — the target keeps an existing value — and
**C5 (c)** — refuse at configuration, and at conversion skip with a history entry.
**Builds on**: `specs/157-custom-fields-list-filters/` (issue #286, "the filters feature") for the
definition editor, and `specs/155-catalog-order-constraints/` for the placement code it hooks into.
Both must have merged before this branch starts (research R-18).

## Summary

An operator marks a Quote Request, Order or Sales Opportunity custom field "Carry value to …" for
the other two types of that trio (Order → Quote Request excepted). When a record is created from,
or joins, a record of the other type, each enabled same-key value is copied into an **empty**
target field; an incompatible target is skipped and the skip recorded on the target. The approach,
with evidence and rejected alternatives in [research.md](./research.md):

- **The option is a definition attribute, `carryTo`** (R-1): one `jsonb` array column owned by
  `custom_fields`; which pairs exist is a registry marker `carryTargets` (R-2).
- **One compatibility rule in `contracts`** (R-3): `assessCustomFieldCarry` — same value type, no
  widening, select/multiselect option subset, no `internal` → `customer`. The server refuses with
  it at configuration time (R-4, minted `CUSTOM_FIELD_CARRY_INCOMPATIBLE` with tokens); the admin
  computes the "incompatible" mark and the drift warnings with it.
- **`custom_fields` computes, hosts write** (R-5, R-6): a new port `customFieldCarryPort.plan`
  returns the merged target bag, the carried keys and the skipped keys with reasons. It writes
  nothing. The module that owns the **target** calls it with its own current bag and persists the
  result inside its own write.
- **Quote Request → Order**: inside placement's transaction, on feat/155's vouched-source
  assessment (R-7). A skip becomes an author-less, internal, non-notifying **system note** in the
  Order's comments — `order_comments.system_note jsonb` (R-8).
- **Order / Quote Request → Opportunity**: inside CRM's existing `crm.opportunity.create` and
  `crm.opportunity.link_add` Commands; the skip is part of that audit entry, which is what the
  Opportunity's history shows (R-9, R-11).
- **Opportunity → Order / Quote Request**: CRM pushes the Opportunity's values to a receiver port
  the document's owner publishes, **after** the origin link is made, so the link's rule decides the
  carry; the owner runs its own Command and records skips (R-10). The actor is the system — owner
  ruling 2026-10-19 (Q1).
- **Off-state and tenancy** are inherited from the seams (R-12, R-13): an absent owner's types,
  options and carries are hidden, inert and retained; every carry stays inside one Organization.
- **Admin**: carry toggles in the filters feature's `DefinitionBehaviourFields`, a *Carries to*
  column with an *Incompatible* mark, and confirmation before a change that breaks an enabled carry
  (R-14). Renderers for the three history entries.

No new runtime dependency. Three migrations (`custom_fields`, `orders`, `quote_requests`). One
minted error code. Three new ports. No new route, permission, setting, cache or queue.

## Technical Context

**Language/Version**: TypeScript 5.x `strict`, Node.js ≥ 22.17, ESM
**Primary Dependencies**: Fastify, MikroORM (PostgreSQL), Zod (backend); React 19 + Vite through
`@endora-commerce/admin-kit` (admin) — **no new runtime or dev dependency**
**Storage**: PostgreSQL — `custom_field_definitions.carry_to jsonb not null default '[]'`
(`custom_fields`), `order_comments.system_note jsonb null` (`orders`), `qre_event_type_check`
widened by `'custom-field-carry-skipped'` (`quote_requests`); host value columns unchanged
**Testing**: Vitest — co-located `contracts` and module unit tests; `backend/test/{contract,integration}`
for routes, placement, CRM subscribers, receiver ports, off states and audience; `admin/test/modules`
for the page, the order detail and the two histories, every render in `<StrictMode>`
**Target Platform**: Linux server (backend) and the admin SPA in evergreen browsers
**Project Type**: web application — monorepo with `backend/`, `admin/`, `packages/`
**Performance Goals**: one cached definitions read per entity type per conversion (two types per
pair); no query per key; nothing added to a list read
**Constraints**: carry-over never fails a checkout or a create (FR-010, SC-002); never overwrites
(FR-009, SC-003); never crosses an Organization (FR-012); never makes an `internal` value
customer-visible (FR-011, SC-005); writes only through the target's own write (FR-013, XIII, XIV);
`crm` / `quote_requests` off ⇒ nothing offered, nothing carried, nothing recorded, nothing replayed
(FR-005, FR-014)
**Scale/Scope**: 1 + 1 columns, 1 check constraint, 1 pure rule, 3 ports (1 compute, 2 receivers),
1 error code with 6 tokens, 0 routes, 5 conversion paths in 3 host modules, 4 admin screens changed,
~30 `custom_fields` keys and ~12 keys in each of `orders`, `quote_requests`, `crm` × 2 languages,
4 module docs + 1 architecture page × 2 languages; **10 phases, 64 tasks**

## Constitution Check

*GATE: passed before Phase 0; re-checked after Phase 1 design — same verdict.*

| Principle | Verdict | How the design meets it |
| --- | --- | --- |
| **I. Modular architecture (NN)** | Pass | `custom_fields` owns the column, the registry marker, the rule's server use, the carry port and the error code; `orders`, `quote_requests` and `crm` each own their write, their skip record and their migration. Cross-module traffic is ports only: `orders` reads the Quote Request through `QuoteRequestReadPort` (existing); `crm` reads documents through `OrderReadPort` / `QuoteRequestReadPort` (existing) and pushes to `orderCustomFieldCarryPort` / `quoteRequestCustomFieldCarryPort` (new); everyone computes through `customFieldCarryPort` (new). All resolved with `lazyPort<T>` and a contract type. No table of another module is read. |
| **II. API-first** | Pass | Every shape — `carryTo`, `carryTargets`, the rule, the plan, the receiver port, the system-note shape, the QR event type — is in `packages/contracts/` with its test before any service uses it ([contracts/carry-api.md](./contracts/carry-api.md)). Additive on the wire; `CustomFieldDefinitionRecord.carryTo` is a required in-process member swept in Phase 1. |
| **III. TDD (NN)** | Pass | Every implementation task in [tasks.md](./tasks.md) follows the RED test it turns green; § *Requirement → test* maps every FR and SC, including the off-state tests for `crm` and `quote_requests`. |
| **IV. YAGNI, minimal dependencies** | Pass | No dependency. No pair table, no dry-run endpoint, no new history store for Orders beyond one nullable column, no setting, no queue, no back-fill. |
| **V. TypeScript everywhere** | Pass | Zod at the definition boundary; ports and the system note as typed contracts. |
| **VI. Naming (NN)** | Pass | Columns snake_case (`carry_to`, `system_note`); JSON camelCase (`carryTo`, `carryTargets`, `systemNote`); event type kebab-case like its siblings (`custom-field-carry-skipped`); Command actions dot-namespaced (`order.custom_fields.carry`, `quote_request.custom_fields.carry`); port names camelCase literals; migration class tails begin with the owning module's segment (`migration:new`). |
| **VII. SEO, performance** | N/A | Storefront untouched. |
| **VIII. English (NN)** | Pass | Code, comments, specs, docs in English; Polish only in bundles and the Polish docs tree. |
| **IX. UI reuse** | Pass | The filters feature's editor block, kit `ModalDialog`, `Checkbox`, `Badge`, `Alert`; no new kit component. |
| **X. Queue consumers** | N/A | Nothing asynchronous is added; CRM's existing subscriber path carries US2/US3. |
| **XI. Tenant isolation (NN)** | Pass | No tenant-scoped entity added. Every pair is one Organization: placement's vouching, CRM's join and origin checks, and both receiver ports re-checking `organizationId` and answering `not-found` for a mismatch (indistinguishable from absence). Cross-tenant tests in Phases 4–6. |
| **XII. Sales-channel scoping (NN)** | N/A | No channel-scoped read is added. |
| **XIII. Command Bus auditing (NN)** | Pass | Option toggles run in the existing definition Commands (`snapshotDefinition` gains `carryTo`). Carried values are written inside the write that establishes the relationship: placement's transaction (placement is not a Command today; impersonated placement's audit gains `carriedCustomFieldKeys`; the spec accepts no new audit trail for buyer checkout), CRM's create/link Commands, and the two new receiver Commands. No hand-placed audit call is added. |
| **XIV. Entity-agnostic extensibility** | Pass | `carryTo` is a generic definition capability; the pairs are registry data; `custom_fields` never writes a host row — it validates and returns a bag, the hosts persist and audit (the principle's "host owns its data" clause). `no-entity-capability-logic.test.ts` stays green. |
| **XV. Untouched core / overlay** | N/A | No overlay. |
| **XVI. Command palette** | Pass | No new surface: `/custom-fields`, the order detail, the Quote Request detail and the Opportunity detail keep their entries. |
| **XVII. Operator-toggleable modules (NN)** | Pass | Options naming `opportunity` / `quote_request` are hidden and inert while `crm` / `quote_requests` is off, retained through saves, and effective on return (R-12); no carry and no record while off, no replay after. `crm`'s new edge to `quote_requests` is a `degrades-without` entry decided by `isPresent()`. Proved by extended `crm` and `quote_requests` off-state tests and `entity-owner-presence.test.ts`. |

**Admin permission manifest** — no new code (FR-017). `check:action-route-permissions` unaffected.
**Command palette** — no new action. **Settings module** — nothing configurable is introduced.
**Redis cache invalidation** — no new cache: every definition Command already fans out
`publishInvalidate(entityType)`, and the carry port reads through that cache.
**i18n** — every new string in `en` + `pl`; persisted entries ship key + params + English fallback
(`specs/conventions/module-i18n.md`).

## Owner questions (answered by owner ruling 2026-10-19 — every recommendation accepted; spec.md § Clarifications, Session 2026-10-19)

| # | Question | Recommendation (planned) |
| --- | --- | --- |
| Q1 | Values carried from a Sales Opportunity into an Order or Quote Request created from it are written **after** the link is made, by the system (the link itself is a system action). FR-013 says "operator for admin creation". Accept *system* attribution? | **Accept.** Honouring "operator" literally needs `orders` and `quote_requests` to read CRM's `origin` and depend on `crm`, which both modules deliberately avoid (R-10). |
| Q2 | Does an operator **manually linking** an existing Order or Quote Request to an Opportunity (*Links* tab) count as "joining" (FR-008, A-6)? | **No carry on manual links.** FR-008 lists creation, joining from a quote, and origin linking. |
| Q3 | SC-004 "exactly one history entry per skipped carry": one entry per conversion naming every skipped key, or one entry per key? | **One entry per conversion**, each skipped key named once. |
| Q4 | The spec says Order → Quote Request has no conversion; a buyer's *clone to quote* exists. Keep the pair out? | **Keep it out** (spec as written). Adding it later is one registry entry plus one call in the clone path. |
| Q5 | Should the Quote Request's skip entry stay admin-only? | **Yes** — it names keys of possibly `internal` fields. |

## Security

No threat model was requested for this feature; the design choices that carry a security property,
each with a test:

- **Audience (SC-005)** — refused at configuration (R-4), skipped at conversion after drift (R-5);
  a test per target type proves an `internal` source value never reaches a buyer or API-key reply.
- **System-note leakage (SC-006)** — `isCustomerVisible = false` **and** `listForCustomer` filters
  `systemNote: null`; no notification path is reachable from a system note; no API-key route lists
  comments.
- **QR skip entry** — admin-only event type (Q5).
- **Tenant** — receivers answer `not-found` for another Organization's record; CRM's joins and
  origin links already refuse cross-Organization parents.
- **Key handling** — prototype-free lookups in the port and the admin helper (`constructor` is a
  valid key); keys rendered as text, truncated to 64 characters.
- **No new permission** — a reader of the order detail sees the skipped keys of its own fields,
  no wider than the full value bag the admin detail already serves.

## Project Structure

### Documentation (this feature)

```text
specs/162-custom-fields-value-carry/
├── spec.md
├── plan.md                    # this file
├── research.md                # R-1 … R-18
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── carry-api.md           # attribute, rule, error code, ports, system note, QR event
│   └── admin-surfaces.md      # toggles, column, warnings, three history renderers
└── tasks.md
```

### Source code — every file this feature touches (for overlap judgement)

```text
packages/contracts/src/
├── custom-fields.ts                     # carryTo, carryTargets, assessCustomFieldCarry, CustomFieldCarryPort, receiver port
├── custom-fields.carry.test.ts          # NEW
├── orders.ts, orders.test.ts            # orderCommentSystemNoteSchema, orderCommentSchema.systemNote
├── quote-requests.ts                    # rfqEventTypeSchema + custom-field-carry-skipped, history DTO
└── errors.ts                            # + CUSTOM_FIELD_CARRY_INCOMPATIBLE

packages/modules/custom_fields/
├── src/migrations/<stamp>_custom_fields_definition_carry_to.ts      # NEW (scaffolded)
├── src/backend/entities/custom-field-definition.entity.ts            # + carryTo
├── src/backend/services/custom-field-registry.ts (+ .test.ts)        # + carryTargets
├── src/backend/services/custom-field-definition-apply.ts             # carryTo create/update, CustomFieldDefinitionError carry_incompatible
├── src/backend/services/custom-field-definition.service.ts           # retention merge on update
├── src/backend/services/custom-field-value.service.ts                # export coerce / isEmpty (no behaviour change)
├── src/backend/services/custom-field-carry.service.ts (+ .test.ts)   # NEW — the port
├── src/backend/services/custom-field-read-port.ts                    # record carryTo
├── src/backend/commands/definition-commands.ts                       # snapshot + carry refusal
├── src/backend/routes.admin.ts, index.ts                             # serialize, entity-types, toHttp, providePort
├── src/admin/components/DefinitionBehaviourFields.tsx, DefinitionEditorDialog.tsx, DefinitionOptionsEditor.tsx  # (filters feature) additive props
├── src/admin/pages/CustomFieldsPage.tsx                              # column, mark, audience/delete confirmation
├── src/admin/lib/carry-drift.ts                                      # NEW
├── src/admin/api/custom-fields-client.ts
├── src/manifest.ts                                                   # errorCodes
├── i18n/{en,pl}.json
└── docs/custom_fields.md                                             # (filters feature) + carry section

packages/modules/orders/
├── src/migrations/<stamp>_orders_order_comment_system_note.ts        # NEW
├── src/backend/entities/order-comment.entity.ts                      # + systemNote
├── src/backend/services/order-comment-service.ts                     # listForCustomer filter
├── src/backend/services/order-service.ts                             # placement carry (feat/155's assessment)
├── src/backend/services/order-custom-field-carry-receiver.ts         # NEW — receiver Command
├── src/backend/order-carry-note.ts                                   # NEW — system-note builder shared by placement and receiver
├── src/backend/routes.ts                                             # serializeComment + systemNote
├── src/backend/index.ts                                              # lazyPort, providePort
├── src/manifest.ts                                                   # dependencies (custom_fields) only if check:port-dependencies asks
├── src/admin/pages/OrderDetail.tsx
├── i18n/{en,pl}.json
└── docs/orders.md

packages/modules/quote_requests/
├── src/migrations/<stamp>_quote_requests_quote_request_event_carry_skipped.ts  # NEW
├── src/backend/entities/quote-request-event.entity.ts               # event type
├── src/backend/services/quote-request-custom-field-carry-receiver.ts # NEW — receiver Command
├── src/backend/services/customer-projection.ts                      # ADMIN_ONLY_EVENT_TYPES
├── src/backend/services/history/history-projection.ts               # new case
├── src/backend/index.ts                                             # lazyPort, providePort
├── src/admin/pages/RfqHistory.tsx
├── i18n/{en,pl}.json
└── docs/quote_requests.md

packages/modules/crm/
├── src/backend/services/opportunity-custom-field-carry.ts           # NEW — plan → after member
├── src/backend/services/opportunity-service.ts                      # AutomaticOpportunityInput.carry, createForDocument, #createCommand after
├── src/backend/services/opportunity-link-service.ts                 # AutomaticLink.carry, link_add Command
├── src/backend/services/opportunity-auto-create-service.ts          # pass document values
├── src/backend/services/opportunity-origin-link-service.ts          # push on `linked`
├── src/backend/index.ts                                             # lazyPort ×3
├── src/manifest.ts                                                  # nonBindingDependencies + quoteRequestCustomFieldCarryPort
├── src/admin/components/OpportunityHistory.tsx, src/admin/lib/history-fields.ts
├── i18n/{en,pl}.json
└── docs/crm.md

backend/
├── src/db/migrations-registry.generated.ts                         # regenerated
├── test/fixtures/error-code-routing/reference-ledgers.ts           # + MINTED entry
├── test/integration/custom_fields/{carry-options,carry-port,carry-audience,entity-owner-presence}.test.ts
├── test/integration/orders/{place-order-custom-field-carry,custom-field-carry-receiver}.test.ts   # NEW
├── test/contract/orders/comments.test.ts                           # extended
├── test/integration/quote_requests/{custom-field-carry-receiver,off-state}.test.ts
└── test/integration/crm/{custom-field-carry-into-opportunity,custom-field-carry-from-opportunity,off-state}.test.ts

admin/test/modules/
├── custom_fields/{CustomFieldsPage.carry,CustomFieldsPage.carry-drift,carry-drift}.test.tsx      # NEW
├── orders/OrderDetail.system-note.test.tsx                                                       # NEW
├── quote_requests/RfqDetail.history.test.tsx                                                     # extended
└── crm/history.test.tsx                                                                          # extended

docs/docs/architecture/custom-fields.md; docs/i18n/pl/docusaurus-plugin-content-docs/current/{architecture/custom-fields,modules/{custom_fields,orders,quote_requests,crm}}.md;
docs/translation-cache/pl/*.json
.changeset/162-*.md                                                  # one per meaning
```

**Not touched**: `carts`, `catalog`, `returns`, `quick_order`, `shopping_lists`, `assets_library`,
the storefront, `packages/admin-kit`, `packages/platform`.

**Structure Decision**: the existing layout; nothing beside a module's `src/manifest.ts`.

## Migrations

Three, scaffolded — never numbered by hand; planned by ownership and dependency:

| Module | Scaffold | Content | Depends on |
| --- | --- | --- | --- |
| `custom_fields` | `pnpm --filter backend run migration:new -- --module custom_fields --name definition_carry_to` | add `carry_to jsonb not null default '[]'` | the filters feature's `list_filter` migration (same table, independent column — order between them is irrelevant) |
| `orders` | `pnpm --filter backend run migration:new -- --module orders --name order_comment_system_note` | add `system_note jsonb null`; `down` deletes system-note rows, then drops | nothing outside `orders` |
| `quote_requests` | `pnpm --filter backend run migration:new -- --module quote_requests --name quote_request_event_carry_skipped` | widen `qre_event_type_check` by `'custom-field-carry-skipped'` | the `pdf_sent` widening (its `BEFORE` list includes `'pdf-sent'`) |

Each lands with `composer:generate` and the regenerated registry in the same commit.

## Phasing

Ten phases, each ≤ 10 tasks, each one builder spawn, each independently committable. **[admin UI]**
phases may go to `endora-commerce-designer` for copy, layout and focus review.

| # | Phase | Kind | Story | Tasks |
| --- | --- | --- | --- | --- |
| 1 | Drift check, worktree, contracts, minted error code | backend (shared) | all | 8 |
| 2 | `custom_fields`: `carryTo`, configuration refusal, retention, the carry port | backend | US4, all | 9 |
| 3 | Orders: the system note and Quote Request → Order at placement | backend | US1 | 7 |
| 4 | CRM: Order / Quote Request → Opportunity | backend | US2 | 5 |
| 5 | Receivers and Opportunity → Order / Quote Request | backend | US3 | 8 |
| 6 | Off-state, audience and visibility proofs | backend | all | 5 |
| 7 | `/custom-fields`: toggles, column, drift warnings | admin UI | US4 | 6 |
| 8 | History renderers: Order note, Quote Request, Opportunity | admin UI | US1–US3 | 7 |
| 9 | Documentation, en + pl | docs | all | 4 |
| 10 | Gate: final rebase, local cheap checks, fork CI, service-backed run | gate | all | 5 |

Dependencies: 1 → all; 2 → 3, 4, 5, 7; 3 → 5 (system-note builder); 4 → 5 (CRM services);
3, 4, 5 → 6; 2 → 7; 3, 4, 5 → 8; 6, 7, 8 → 9 → 10. Phases 3 and 4 are independent once 2 has
landed; so are 7 and 8 once their backend phases have.

## Risks

| Risk | Mitigation |
| --- | --- |
| feat/155 changes the placement region after this plan | Phase 1's drift check greps for `QuoteRequestSourceAssessment` and stops if absent; tasks cite symbols, not lines |
| The filters feature changes its editor seam | Phase 1 greps for `DefinitionBehaviourFields` and `listFilter`; Phase 7 keeps every change additive; research R-14 states the fallback |
| A hand-built `CustomFieldDefinitionRecord` / entity-type fake breaks on the new required members | Phase 1 sweep (`grep -rn "listFilter:"` — the filters feature added that member to exactly these fakes) |
| A host runs `validateAndMerge` on the carried bag and a required unrelated field fails creation | Contract §4.1 and research R-5 forbid it; Phase 3 and 4 tests include an empty required unrelated target field |
| A system note reaches the buyer | Two filters (visibility + `systemNote: null`); SC-006 test on the customer comments route and the storefront order detail |
| The QR receiver is called while `quote_requests` is off | `isPresent()` before the call (`crm-quote-requests.ts` pattern), `check:port-catches`, off-state test |
| `orders` lacks `custom_fields` in `dependencies` | Phase 3 runs `check:port-dependencies`; add the dependency only if it reports, and say why |
| A derived artefact goes stale (migrations registry, error-code ledger, `ADMIN_ONLY_EVENT_TYPES`, CRM history keys test, docs sidebar, Polish docs cache, lockfile) | Regenerated in the task that changes its input; Phase 10 confirms `git status` clean after `composer:generate` / `manifests:generate` |
| Contract and integration suites do not run in merge-request pipelines (D-198) | Each phase runs its own `[PG]` files locally; Phase 10 runs every server-bound file the feature adds or changes on the fork's service-backed CI |

## Complexity Tracking

| Addition | Why needed | Simpler alternative rejected because |
| --- | --- | --- |
| A new port `customFieldCarryPort` | Five conversions in three hosts must apply one rule (type, audience, per-value validity, fill-empty) | Host-written copies triplicate the rule; widening `CustomFieldValuePort` breaks every stub (D-97.3) (R-5) |
| Two receiver ports (`orderCustomFieldCarryPort`, `quoteRequestCustomFieldCarryPort`) | Opportunity → document values must be written by the document's owner after CRM's link decides the claim | Owner modules pulling from CRM adds reverse edges and makes them read `origin` (R-10) |
| A pure rule function in `contracts` | Server refusal, table mark and editor warnings must agree | A dry-run endpoint or a per-definition server status costs a route or N×M work and still needs the rule client-side (R-3) |
| `order_comments.system_note` | FR-010a requires an author-less internal system note with translatable content | A frozen English `body` cannot be translated; a separate table splits one thread (R-8) |

No runtime dependency is added.

## Constitution Check — post-design

Re-evaluated after research, data model and contracts: **PASS**. No principle is violated; four
complexity entries are justified above. The five owner questions (Q1–Q5) are answered
by owner ruling 2026-10-19, each accepting the planned recommendation; T023 and T033 assert the
Q2 and Q1 rulings.

## Handoff to `endora-commerce-dev`

- **Start condition**: feat/155 (catalog-order-constraints) **and** the filters feature have merged
  to `origin/master`, or this branch stacks on the filters branch by explicit decision. Phase 1's
  T000 checks both and stops otherwise.
- Work the phases of [tasks.md](./tasks.md) in order in a `git worktree` (`AGENTS.md` § *Commands*);
  commit each phase on its own with `git commit -s`, conventional English messages, no AI trailer.
  Phases 7–8 may go to `endora-commerce-designer`.
- Read first: [research.md](./research.md) R-5, R-7, R-8, R-10, R-12;
  [contracts/carry-api.md](./contracts/carry-api.md); [contracts/admin-surfaces.md](./contracts/admin-surfaces.md).
- Binding: `custom_fields` writes no host row; hosts never call `validateAndMerge` on a carried
  bag; no `catch` around a port; the QR receiver is reached only behind `isPresent()`; system notes
  are invisible to buyers by two filters.
- After editing a package, rebuild it before a test that imports it.
- Each phase verifies **only its own new or changed tests plus its `[PG]` files**, locally; the
  heavy suites (whole-workspace typecheck/lint, `test:backend:unit`, `test:frontend`, pack, boot,
  docs build, every server-bound file) run on the fork's CI in Phase 10.
