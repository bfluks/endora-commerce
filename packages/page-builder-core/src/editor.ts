'use client';

/**
 * Puck's editor component, from **this** package's copy of `@puckeditor/core`
 * (`specs/152-compare-pdf-template/`). Every editor-side helper below reads
 * Puck's React context — the outline, the overlay, `usePageBuilderPuck` — so
 * the `<Puck>` they live under has to be the same copy. A module package whose
 * install resolves its own `@puckeditor/core` to a different peer variant
 * (a different `@types/react`, say) would otherwise mount a `<Puck>` those
 * helpers cannot see, and fail with "usePuck must be used inside <Puck>".
 * Types may still come from the module's own copy: they are erased.
 */
export { Puck } from '@puckeditor/core';

export { createPageBuilderEditorPlugin } from './editor/page-builder-plugin.js';
export {
  PUCK_LEGACY_DND,
  PUCK_LEGACY_VIEWPORTS,
  withPuckLegacySideBar,
} from './editor/puck-legacy-layout.js';
export { PageBuilderOutline } from './editor/page-builder-outline.js';
export { PageBuilderComponentOverlay } from './editor/page-builder-component-overlay.js';
export {
  SettingsScopeProvider,
  SettingsScopeSelector,
  useSettingsScope,
} from './editor/settings-scope-context.js';
export { formatOutlineLabel } from './editor/format-outline-label.js';
export { toPuckItemArray, isPuckItem, type PuckItem } from './editor/outline-data.js';
export { enhancePageBuilderComponent } from './editor/enhance-component-config.js';
export { usePageBuilderPuck } from './editor/use-page-builder-puck.js';
export { createHideOnField } from './fields/hide-on-field.js';
export { createEditorNameField } from './fields/editor-name-field.js';
export {
  getZoneItems,
  getSlotZoneItemCount,
  readPuckZoneIndexes,
  getZoneParentComponentType,
  isColumnContentZone,
  CAROUSEL_SLIDE_TYPES,
  ROOT_ONLY_TYPES,
  SECTION_GROUP_TYPE,
  SECTION_GROUP_CHILD_TYPES,
  isRootZone,
  isSectionGroupContentZone,
  isContentSliderSlidesZone,
  isRowContentZone,
  shouldRevertPuckAction,
  hasInvalidColumnPlacement,
  zoneParentId,
  zoneSlotName,
  resolveContentSliderIdForItem,
  resolveContentSliderSlideIndex,
} from './editor/puck-action-guards.js';
export { resolvePuckDndElement } from './editor/puck-dnd-element.js';
export {
  carouselEditorPageCount,
  clampEditorCarouselPage,
  clearEditorCarouselPreviewLock,
  EditorCarouselPreviewBridge,
  getEditorCarouselLastSeenSelectedId,
  getEditorCarouselPage,
  getEditorCarouselPreviewFrozenSelectedId,
  getEditorCarouselSlideCount,
  isEditorCarouselPreviewLocked,
  registerEditorCarouselPageWriter,
  rememberEditorCarouselSelectedId,
  setEditorCarouselPage,
  setEditorCarouselSlideCount,
  subscribeEditorCarouselPreview,
  useEditorCarouselPage,
} from './editor/editor-carousel-preview.js';
export {
  canOutlineDrop,
  outlineDropBeforeTarget,
  outlineSiblingCount,
  outlineStepReorder,
  outlineReorderAction,
  type OutlineDropPayload,
} from './editor/outline-dnd.js';
