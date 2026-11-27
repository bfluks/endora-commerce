# Feature Specification: Asset visibility follows the records that reference it

**Feature Branch**: `166-asset-reference-visibility`
**Created**: 2026-10-29
**Status**: Draft
**Input**: GitHub issue #513, owner ruling option A (2026-10-29): "a per-reference visibility hook in the Asset library, answered by the owning module, so the library hides or redacts assets whose referencing records the reader cannot see."

## Background

Files attached to a Task, a Project or a Sales Opportunity are stored in the shared **Asset library**.

The library lets any administrator who may read the library do three things:
- list such a file;
- download it;
- see which records use it.

It does this whatever their access to those records. So an administrator who cannot see the file through its owning record can still see it through the library:
- someone else's private Task or draft;
- a Project they are not a member of;
- a Sales Opportunity not assigned to them.

The library also names the record, for example "Task T-0042". That reveals the record exists, which the owning module deliberately hides.

Today the library already asks every module that uses assets one question: "which of your records use these assets?" The library uses the answer only to refuse deleting an asset that is in use.

This feature adds a second question to the same mechanism: "may this reader see these records?" The library then hides what the reader may not see.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Files of records I cannot see stay hidden in the library (Priority: P1)

An administrator browses the Asset library, searches it, or picks a file from it while editing something else, for example a product's gallery or a Task's attachments. A file that is used only by records they may not see does not appear. Opening it by its address answers exactly as for a file that does not exist. So does asking for its download link, or acting on it in any way.

**Why this priority**: this is the leak issue #513 reports. Files attached to private, draft or restricted records can contain confidential material.

**Independent Test**: as admin A, attach a file to a private Task. As admin B, who may read Tasks and the library but not that Task, check that the file is absent in each of these places, and answers "not found" everywhere:
- the library list and search;
- the shared file picker;
- the file's detail and download link;
- every change B tries on it.

**Acceptance Scenarios**:

1. **Given** a file used only by A's private Task, **When** B lists or searches the library, **Then** the file is not in the results, and the totals and counts B sees do not include it.
2. **Given** the same file, **When** B opens its detail, requests its download link, renames it, moves it, replaces it, changes its visibility, creates a public link to it, or deletes or restores it, **Then** each answer is the same "not found" B gets for a file that never existed.
3. **Given** the same file, **When** A opens the library, **Then** A sees and uses the file as before.
4. **Given** a holder of the "see private tasks" permission, **When** they open the library, **Then** they see the file, because they may see that private Task.
5. **Given** a file attached to a Project, **When** an administrator who is not a member of that Project, and so cannot see it, browses the library, **Then** the file is hidden from them in the same way.
6. **Given** a file attached to a Sales Opportunity, **When** an administrator whose Organization reach excludes the Opportunity's Organization browses the library, **Then** the file is hidden from them.
7. **Given** B knows the file's identifier, **When** B tries to attach it to a Task, Project or Opportunity B may change, **Then** the attempt is refused as for a file that does not exist.

---

### User Story 2 - Shared files and files uploaded straight to the library keep working (Priority: P1)

Many files are not attached to a restricted record: product images, CMS and blog media, and files uploaded straight to the library. Other files are used by several records at once. Administrators keep seeing these exactly as today. A file stays visible as long as the reader may see at least one record that uses it.

**Why this priority**: hiding must not break the library for everyday content work. Product, CMS, blog and menu content has no per-reader restrictions today.

**Independent Test**:
- Check that product images, CMS media and a file uploaded straight to the library stay visible to every library reader.
- Check that a file attached both to a Task B can see and to one B cannot see is visible to B.

**Acceptance Scenarios**:

1. **Given** a file uploaded straight to the library and used by nothing, **When** any administrator who may read the library browses it, **Then** the file is visible, as today.
2. **Given** a product image, a CMS or blog image, or a menu image, **When** a library reader browses the library, **Then** it is visible, as today.
3. **Given** a file used by a private Task of A and by a product, **When** B browses the library, **Then** the file is visible, because the product is visible to B.
4. **Given** a file used by two Tasks, one B may see and one B may not, **When** B browses the library, **Then** the file is visible to B.

---

### User Story 3 - The "used by" list shows only what I may see (Priority: P1)

A file's detail lists the records that use it. A reader sees only the records they may see. Records they may not see are not named and not counted. Nothing in the answer lets the reader tell that a hidden record exists.

**Why this priority**: today the record's number and existence leak through this list even when the file itself is legitimately visible.

**Independent Test**: for a file used by a product and by a private Task of A, check that B's detail lists the product only, while A's lists both.

**Acceptance Scenarios**:

1. **Given** a file used by a product and by A's private Task, **When** B opens its detail, **Then** only the product is listed.
2. **Given** the same file, **When** A opens its detail, **Then** both the product and the Task are listed.

---

### User Story 4 - Deleting a file in use is still refused (Priority: P2)

Refusing to delete a file that is in use protects other people's records from losing their files. It keeps counting **every** record that uses the file, including those the deleting administrator cannot see.

**Why this priority**: data integrity must not weaken because of the new hiding. It is P2 only because today's behaviour already provides it; the feature must not break it.

**Independent Test**: as B, try to delete a file used by a product B can see and by A's private Task. The deletion is refused, and the refusal names only what B may see.

**Acceptance Scenarios**:

1. **Given** a file used by a product and by A's private Task, **When** B deletes it, **Then** the deletion is refused.
2. **Given** the same refusal, **When** B reads it, **Then** it names the product only. It neither counts nor names the Task.
3. **Given** a file used only by records B cannot see, **When** B tries to delete it by its identifier, **Then** B gets "not found", as in User Story 1.

---

### User Story 5 - Switching a module off does not expose or destroy its files (Priority: P2)

When the module owning restricted records is switched off, its files neither become visible to everybody nor get lost. The modules concerned are Tasks, Projects and CRM. When the module is switched back on, everything is as before.

**Why this priority**: switching a module off is non-destructive and reversible (Constitution XVII). It must not open a back door to the files it was protecting.

**Independent Test**:
1. Attach a file to A's private Task.
2. Switch Tasks off.
3. As B, browse the library, see the hiding rule below, and try to delete the file.
4. Switch Tasks back on and check that nothing changed.

**Acceptance Scenarios**:

1. **Given** Tasks is switched off, **When** an administrator browses the library, **Then** the files used only by Tasks are hidden from them (FR-009), unless they hold the platform wildcard (FR-010).
2. **Given** Tasks is switched off, **When** anyone tries to delete a file used by a Task, **Then** the deletion is still refused (today's behaviour, kept).
3. **Given** Tasks is switched back on, **When** A and B browse the library, **Then** each sees exactly what they saw before it was switched off.

---

### Edge Cases

- **A file stops being used by its only hidden record**, for example the Task is deleted or the attachment removed. It becomes a file used by nothing and is visible to library readers again, like any other file not in use.
- **Assets already made public with a public link.** A public link is the owner's deliberate act of publishing. It keeps working for anyone holding it, and this feature does not revoke it. The asset itself stays hidden from library readers who may not see its records.
- **The reader may see the record but not its module's screens.** Visibility is decided by the owning module, by the same rule its own screens use. A module whose records have no reader-specific restrictions (catalog, CMS, blog, menus) answers "visible" for every library reader, as today.
- **The library's own folders** never reveal hidden files: folder counts and folder listings follow the same filtering. Deleting a folder moves the files the deleting reader cannot see into its parent folder, so for that reader the folder behaves as empty. *(Amendment R-10.)*
- **Bulk actions** (move many) touch only the files the reader may see. A file id the reader may not see is skipped exactly like a missing id, which is today's behaviour for missing ids; the hidden file is never touched. *(Amendment R-9.)*
- **Storage counts.** The two operational counts on the storage page stay library-wide. They are numbers, not files, and they reveal no record. The list itself returns no total. *(Amendment R-12.)*
- **The platform wildcard and drafts.** Under FR-010 the wildcard holder sees in the library the attachments of other people's draft Tasks, although Tasks shows a draft only to its Creator. This follows from the owner's ruling Q2 = A; it is noted, not changed.
- **An owner that is not part of the deployment at all** reports no references, so its former files count as used by nothing (FR-009a). This differs from a switched-off owner, which still reports them (FR-009). The plan must confirm that the reference mechanism behaves this way for a module that is unavailable on the platform.
- **Removing the files of a module switched off for good:** see FR-009a. While the module is merely switched off, its files cannot be deleted by anyone, which is the price of reversibility.
- **System and background work**, such as storage checks, migrations, version cleanup and the deletion guard, is not a reader. It sees every asset.

## Requirements *(mandatory)*

### Functional Requirements

**Visibility rule**

- **FR-001**: A reader may see an asset when at least one of these holds:
  - (a) no record of a reader-restricted kind uses it: it is used by nothing, or only by records whose owning module declares no reader-specific restriction;
  - (b) the reader may see at least one record that uses it.
- **FR-002**: Whether a reader may see a given record is decided only by the module that owns the record, with the same rule its own screens use:
  - **Tasks:** private and draft Tasks, and the visibility of the record a Task belongs to.
  - **Projects:** membership.
  - **CRM:** an Opportunity is visible to holders of `crm:read` whose Organization reach includes its Organization. CRM has no "assigned to me only" visibility; that is a list filter. *(Amendment from planning, R-15 / F-18, acknowledged 2026-10-29.)*
- **FR-003**: Each module that uses assets declares, through the existing asset-reference mechanism, whether its references are reader-restricted.
  - If they are, the module answers "which of these records may this reader see" for many records at once.
  - Modules with no reader-specific restriction (catalog, CMS, blog, menus, and any other present today) declare that they are not restricted, and their references never hide an asset.

**Where it applies**

- **FR-004**: For a reader who may not see an asset, the asset is absent from:
  - the library list and search;
  - folder listings and the reader-facing folder counts (the permalink count and the folder-not-empty message);
  - the shared file picker used by other screens;
  - the asset's detail, download link and preview.
- **FR-005**: Every action on an asset by its identifier answers exactly as for a non-existent asset when the reader may not see the asset:
  - rename;
  - move, including bulk move;
  - replace, and restore of a previous version;
  - change of visibility;
  - creating or removing a public link;
  - delete and restore.
- **FR-006**: Attaching an existing library asset to any record — a Task, Project or Opportunity, and equally a record of a module without reader restrictions, such as a product, a category, a blog entry or a menu item — is refused as for a non-existent asset when the reader may not see the asset, and creates no reference. *(Amendment from review T055: the rule was written for the three restricted owners only; linking a hidden asset to an unrestricted record would make it visible to every reader through FR-001 b.)*
- **FR-007**: An asset's "used by" list contains only the references whose record the reader may see. Hidden references are neither named nor counted.

**Deletion protection**

- **FR-008**: The in-use check before deleting an asset counts every reference, whoever asks and whatever their visibility. A refusal names only the references the requesting reader may see.

**Owner module off or absent**

- **FR-009**: When the module owning reader-restricted references is **switched off** by the operator, it is still installed, its records still exist, and it still reports which assets they use. Assets used only by its records are then **hidden from every library reader** (fail closed). The only exception is the override in FR-010. Deletion protection still counts those references, so nobody can delete them while the module is off, the override holder included. Switching the module off must stay reversible without losing files (Constitution XVII). *(Owner ruling Q1 = A, 2026-10-29.)*
- **FR-009a**: There are two ways to remove such files for good:
  - switch the module back on and remove the records or attachments that use them, after which they are ordinary unused files;
  - remove the module from the deployment's composed module set: uninstall it and remove its package, or build the instance without it. A module that is not composed reports no references, so its former files are treated as used by nothing: visible to library readers and deletable.

  The second is a deployment decision, not an operator toggle. A module only disabled on the platform axis, or soft-uninstalled, is still composed and still reports its references, so its files stay hidden and protected exactly as under FR-009. *(Amendment from planning, R-14 / F-22, acknowledged by the owner 2026-10-29.)*

**Overrides and non-readers**

- **FR-010**: An administrator holding the platform wildcard permission (`*`, the Platform administrator) sees and acts on every asset, regardless of the records using it, including while an owning module is switched off. No new permission is introduced. Deletion protection (FR-008) still applies to them. *(Owner ruling Q2 = A, 2026-10-29.)*
- **FR-011**: System work that runs without a reader always sees every asset: storage checks, background jobs, migrations and the deletion guard.

**Not leaking existence**

- **FR-012**: No answer to a reader distinguishes "this asset exists but you may not see it" from "this asset does not exist". This covers status codes, error codes, messages, totals, folder counts and timing differences detectable in normal use.
- **FR-013**: The visibility of records is never weakened by this feature: a reader who may see a record keeps seeing its files as today.

**Performance**

- **FR-014**: Listing a page of assets asks each owning module once per page, for all of the page's references together, never once per asset.

### Key Entities

- **Asset**: a file in the library, with its visibility (private or public) and folder.
- **Asset reference**: "record R of kind K uses asset X", reported by the module that owns R.
- **Reference kind**: a type of use, such as a Task attachment, a Project attachment, an Opportunity attachment, a product image or a CMS embed. Each kind belongs to one module and is either reader-restricted or not.
- **Reader**: the administrator making the request, with their permissions.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For each reader-restricted kind (Task, Project and Opportunity attachments), a reader who may not see the record gets the same "not found" answer as for a non-existent asset. The test is every library surface and action listed in FR-004 to FR-006, 100% of them.
- **SC-002**: For every non-restricted kind (product, category, CMS, blog and menu images) and for assets used by nothing, every library reader sees the same results as before the feature: the same items, counts and actions.
- **SC-003**: The in-use deletion refusal still fires for 100% of assets used by any record, including records the deleting reader cannot see.
- **SC-004**: A library page of 50 assets, each used by up to 3 records of different kinds, loads in under 1 second for a reader with restricted visibility. *(Owner ruling 2026-10-30: the earlier clause "no more than 20% slower than today's page" is dropped. Measured at 1.3–1.9× a 280–500 ms baseline, the 20% margin was only 60–100 ms; the ratio is recorded by the benchmark, not gated.)*
- **SC-005**: Switching any owning module off and on again changes neither which assets each reader sees nor whether any asset can be deleted.

## Assumptions

- The rule is by **record visibility**, not by the reader's permission to open the owning module's screens. A reader without Tasks access sees no Task, so files used only by Tasks are hidden from them. This follows from FR-002, because a reader who may not read Tasks may see no Task.
- Public links already created stay valid (Edge Cases). Revoking them is out of scope.
- The storefront is unaffected: it serves only public assets through their public addresses, and those do not change.
- Catalog, CMS, blog and menu records have no reader-specific visibility today. If one gains it later, its module declares its references restricted and answers the question. No library change is needed.
- Uploading a new file straight to the library is unchanged.
- Uploading a file as a Task, Project or Opportunity attachment already goes through that record's own rules.
