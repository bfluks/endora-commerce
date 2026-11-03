import type { Data, PuckAction } from '@puckeditor/core';
import { extractRootContent, isPuckItem, toPuckItemArray, type PuckItem } from './outline-data.js';

/** Parent component id from a Puck zone compound id (`{parentId}:{slotName}`). */
export function zoneParentId(zone: string): string {
  return zone.split(':')[0] ?? zone;
}

/** Slot prop name from a Puck zone compound id. */
export function zoneSlotName(zone: string): string {
  const parts = zone.split(':');
  return parts.length > 1 ? parts.slice(1).join(':') : 'content';
}

function findItemById(data: Data, id: string): PuckItem | null {
  const visit = (items: PuckItem[]): PuckItem | null => {
    for (const item of items) {
      if (item.props.id === id) return item;
      for (const value of Object.values(item.props)) {
        const nested = toPuckItemArray(value);
        if (nested.length > 0) {
          const found = visit(nested);
          if (found) return found;
        }
      }
    }
    return null;
  };

  const root = visit(toPuckItemArray(data.content));
  if (root) return root;

  const zones = data.zones ?? {};
  for (const zoneItems of Object.values(zones)) {
    const found = visit(toPuckItemArray(zoneItems));
    if (found) return found;
  }

  return null;
}

/** Resolve the parent component type for a zone, or `'root'` for the page root. */
export function getZoneParentComponentType(zone: string, data: Data): string {
  const parentId = zoneParentId(zone);
  if (parentId === 'root') return 'root';
  const parent = findItemById(data, parentId);
  return parent?.type ?? 'unknown';
}

/** True when the zone is a Row's `content` slot (valid Column parent). */
export function isRowContentZone(zone: string, data: Data): boolean {
  const parent = getZoneParentComponentType(zone, data);
  return (parent === 'cms.Row' || parent === 'transactional_emails.EmailRow') && zoneSlotName(zone) === 'content';
}

/** True when the zone is a Column's `content` slot. */
export function isColumnContentZone(zone: string, data: Data): boolean {
  const parent = getZoneParentComponentType(zone, data);
  return (parent === 'cms.Column' || parent === 'transactional_emails.EmailColumn') && zoneSlotName(zone) === 'content';
}

/**
 * What a Carousel's (`cms.ContentSlider`'s) `slides` slot holds: free-content
 * slides and the four item blocks of `specs/163-page-builder-marketing-pages/`
 * (research R-12). A `cms.Row` dropped there is wrapped into a `cms.Slide` by
 * the page builder's `onAction` handler.
 */
export const CAROUSEL_SLIDE_TYPES: readonly string[] = [
  'cms.Slide',
  'cms.CarouselImage',
  'cms.CarouselSplit',
  'cms.LinkTile',
  'cms.DownloadTile',
];

function isCarouselSlideType(type: string | null | undefined): boolean {
  return typeof type === 'string' && CAROUSEL_SLIDE_TYPES.includes(type);
}

/** True when the zone is a Content slider's `slides` slot. */
export function isContentSliderSlidesZone(zone: string, data: Data): boolean {
  return getZoneParentComponentType(zone, data) === 'cms.ContentSlider' && zoneSlotName(zone) === 'slides';
}

/**
 * Blocks that stand only at the top level of a page: `cms.Section`, the one
 * block carrying section settings (`specs/163-page-builder-marketing-pages/`
 * FR-000, plan § *Owner ruling 2026-10-23*), and `cms.SectionGroup`, the
 * container of Sections (T158, plan § *Owner ruling 2026-10-26*). Every slot
 * refuses them too; this guard catches a drop the slot's own
 * `allow`/`disallow` would not. The one exception is a Section in a group's
 * slot ({@link SECTION_GROUP_TYPE}).
 */
export const ROOT_ONLY_TYPES: readonly string[] = ['cms.Section', 'cms.SectionGroup'];

/** The container of Sections (T158): its `content` slot holds {@link SECTION_GROUP_CHILD_TYPES} and nothing else. */
export const SECTION_GROUP_TYPE = 'cms.SectionGroup';

/** What a Section group's slot holds: Sections only. */
export const SECTION_GROUP_CHILD_TYPES: readonly string[] = ['cms.Section'];

function isRootOnlyType(type: string | null | undefined): boolean {
  return typeof type === 'string' && ROOT_ONLY_TYPES.includes(type);
}

/** True when the zone is the page's own content list (`root:default-zone`, or a legacy root zone). */
export function isRootZone(zone: string): boolean {
  return zoneParentId(zone) === 'root';
}

/** True when the zone is a Section group's `content` slot. */
export function isSectionGroupContentZone(zone: string, data: Data): boolean {
  return getZoneParentComponentType(zone, data) === SECTION_GROUP_TYPE && zoneSlotName(zone) === 'content';
}

/**
 * Whether a block of `type` may not stand in `zone` because of where it
 * belongs: a root-only block outside the root (a Section inside a group's
 * slot excepted), or anything but a Section in a group's slot.
 */
function isMisplacedSectionLevel(type: string | null | undefined, zone: string, data: Data): boolean {
  if (isSectionGroupContentZone(zone, data)) {
    return !(typeof type === 'string' && SECTION_GROUP_CHILD_TYPES.includes(type));
  }
  return isRootOnlyType(type) && !isRootZone(zone);
}

export type PuckItemSelector = { zone?: string; index: number };

/** Content slider id when the item is a slide or nested inside a slide. */
export function resolveContentSliderIdForItem(
  itemId: string,
  getSelectorForId: (id: string) => PuckItemSelector | undefined,
  getItemById: (id: string) => PuckItem | undefined,
): string | null {
  const selector = getSelectorForId(itemId);
  if (!selector?.zone) return null;

  if (selector.zone.endsWith(':slides')) {
    const sliderId = zoneParentId(selector.zone);
    const slider = getItemById(sliderId);
    return slider?.type === 'cms.ContentSlider' ? sliderId : null;
  }

  if (selector.zone.endsWith(':content')) {
    const parentId = zoneParentId(selector.zone);
    const parent = getItemById(parentId);
    if (parent?.type !== 'cms.Slide') return null;
    const slideSelector = getSelectorForId(parentId);
    if (!slideSelector?.zone?.endsWith(':slides')) return null;
    const sliderId = zoneParentId(slideSelector.zone);
    const slider = getItemById(sliderId);
    return slider?.type === 'cms.ContentSlider' ? sliderId : null;
  }

  return null;
}

/** Slide index in a content slider's `slides` zone, or null when unrelated. */
export function resolveContentSliderSlideIndex(
  itemId: string,
  sliderId: string,
  getSelectorForId: (id: string) => PuckItemSelector | undefined,
  getItemById: (id: string) => PuckItem | undefined,
): number | null {
  const slidesZone = `${sliderId}:slides`;
  const selector = getSelectorForId(itemId);
  if (!selector?.zone) return null;

  if (selector.zone === slidesZone) {
    return selector.index;
  }

  if (selector.zone.endsWith(':content')) {
    const parentId = zoneParentId(selector.zone);
    const parent = getItemById(parentId);
    if (parent?.type !== 'cms.Slide') return null;
    const slideSelector = getSelectorForId(parentId);
    if (slideSelector?.zone !== slidesZone) return null;
    return slideSelector.index;
  }

  return null;
}

export function getZoneItems(data: Data, zone: string): PuckItem[] {
  const fromZone = toPuckItemArray(data.zones?.[zone]);
  if (fromZone.length > 0) return fromZone;
  if (zone.startsWith('root:')) return extractRootContent(data);
  return [];
}

/** Count items in a Puck slot/dropzone from persisted editor data, with live DOM fallback. */
export function getSlotZoneItemCount(data: Data, zone: string): number {
  const fromData = getZoneItems(data, zone);
  if (fromData.length > 0) return fromData.length;

  if (typeof document !== 'undefined') {
    const preview = document.querySelector('[data-puck-preview]');
    const roots: ParentNode[] = [];
    const iframe = preview?.querySelector('iframe');
    if (iframe?.contentDocument) roots.push(iframe.contentDocument);
    if (preview) roots.push(preview);
    roots.push(document);

    for (const root of roots) {
      const dropzone = root.querySelector(`[data-puck-dropzone="${CSS.escape(zone)}"]`);
      if (dropzone) return dropzone.children.length;
    }
  }

  return 0;
}

/**
 * @deprecated Puck's public API does not expose live zone indexes — use {@link getSlotZoneItemCount}.
 */
export function readPuckZoneIndexes(
  _getPuck: () => { appState: { data: Data } },
): { zones?: Record<string, { contentIds?: string[] }> } | undefined {
  return undefined;
}

function getItemTypeAtZoneIndex(data: Data, zone: string, index: number): string | null {
  const items = getZoneItems(data, zone);
  if (items.length > 0) return items[index]?.type ?? null;
  // A slot zone (`{parentId}:{slotName}`) lives in its parent's props, not in `data.zones` (T158).
  if (isRootZone(zone)) return null;
  const parent = findItemById(data, zoneParentId(zone));
  return toPuckItemArray(parent?.props[zoneSlotName(zone)])[index]?.type ?? null;
}

/**
 * Returns true when a Puck action should be reverted — Column may only live in a
 * Row `content` slot, a Carousel's slides are its item blocks, a root-only
 * block (`cms.Section`, `cms.SectionGroup`) may only be inserted or moved into
 * the page's own list — a Section into a group's slot too — and a group's slot
 * holds Sections only (T158).
 */
export function shouldRevertPuckAction(
  action: PuckAction,
  data: Data,
  prevData?: Data,
): boolean {
  const sourceData = prevData ?? data;

  if (action.type === 'insert') {
    if (isMisplacedSectionLevel(action.componentType, action.destinationZone, data)) {
      return true;
    }
    if (
      (action.componentType === 'cms.Column' || action.componentType === 'transactional_emails.EmailColumn') &&
      !isRowContentZone(action.destinationZone, data)
    ) {
      return true;
    }
    if (
      isContentSliderSlidesZone(action.destinationZone, data) &&
      !isCarouselSlideType(action.componentType) &&
      // Row is wrapped into a Slide in the page-builder onAction handler.
      action.componentType !== 'cms.Row'
    ) {
      return true;
    }
    return false;
  }

  if (action.type === 'move') {
    const type = getItemTypeAtZoneIndex(sourceData, action.sourceZone, action.sourceIndex);
    if (isMisplacedSectionLevel(type, action.destinationZone, data)) {
      return true;
    }
    if (
      (type === 'cms.Column' || type === 'transactional_emails.EmailColumn') &&
      !isRowContentZone(action.destinationZone, data)
    ) {
      return true;
    }
    if (
      isContentSliderSlidesZone(action.destinationZone, data) &&
      !isCarouselSlideType(type)
    ) {
      return true;
    }
    return false;
  }

  if (action.type === 'reorder') {
    const type = getItemTypeAtZoneIndex(sourceData, action.destinationZone, action.sourceIndex);
    if (
      (type === 'cms.Column' || type === 'transactional_emails.EmailColumn') &&
      !isRowContentZone(action.destinationZone, data)
    ) {
      return true;
    }
    if (
      isContentSliderSlidesZone(action.destinationZone, data) &&
      !isCarouselSlideType(type)
    ) {
      return true;
    }
    return false;
  }

  return false;
}

function visitItemsForColumnPlacement(items: unknown, parentType: string | null): boolean {
  for (const item of toPuckItemArray(items)) {
    if (
      (item.type === 'cms.Column' || item.type === 'transactional_emails.EmailColumn') &&
      parentType !== 'cms.Row' &&
      parentType !== 'transactional_emails.EmailRow'
    ) {
      return true;
    }

    for (const [key, value] of Object.entries(item.props)) {
      if (!Array.isArray(value)) continue;
      const childParent =
        (item.type === 'cms.Row' || item.type === 'transactional_emails.EmailRow') && key === 'content'
          ? item.type
          : (item.type === 'cms.Column' || item.type === 'transactional_emails.EmailColumn') && key === 'content'
            ? item.type
            : item.type;
      if (visitItemsForColumnPlacement(value, childParent)) {
        return true;
      }
    }
  }

  return false;
}

/** True when any Column sits outside a Row `content` slot (e.g. dropped on page root). */
export function hasInvalidColumnPlacement(data: Data): boolean {
  if (visitItemsForColumnPlacement(data.content, 'root')) {
    return true;
  }

  const zones = data.zones ?? {};
  for (const [zone, zoneItems] of Object.entries(zones)) {
    const parentType = getZoneParentComponentType(zone, data);
    const slotParent =
      (parentType === 'cms.Row' || parentType === 'transactional_emails.EmailRow') && zoneSlotName(zone) === 'content'
        ? parentType
        : parentType;
    if (visitItemsForColumnPlacement(zoneItems, slotParent === 'root' ? 'root' : slotParent)) {
      return true;
    }
  }

  return false;
}

export function isColumnItem(value: unknown): value is PuckItem {
  return isPuckItem(value) && value.type === 'cms.Column';
}
