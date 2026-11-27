'use client';

import { useEffect, type ReactElement } from 'react';
import { ActionBar, useGetPuck } from '@puckeditor/core';
import { Minus } from 'lucide-react';
import { resolveResponsiveNumber } from '@endora-commerce/page-builder-core';
import { usePreviewBreakpointTier } from '@endora-commerce/page-builder-core/client';
import {
  carouselEditorPageCount,
  clearEditorCarouselPreviewLock,
  getEditorCarouselLastSeenSelectedId,
  getEditorCarouselPreviewFrozenSelectedId,
  getSlotZoneItemCount,
  isEditorCarouselPreviewLocked,
  rememberEditorCarouselSelectedId,
  resolveContentSliderSlideIndex,
  setEditorCarouselPage,
  usePageBuilderPuck,
} from '@endora-commerce/page-builder-core/editor';
import { CarouselAddSlideMenu } from './CarouselAddSlideMenu.js';
import { CarouselPreviewNav } from './CarouselPreviewNav.js';
import { QuickTooltip } from '@endora-commerce/page-builder-admin';
import { isPuckItemType, safeGetPuckData, safeGetPuckItem } from './puck-safe.js';

export function contentSliderSlidesZone(sliderId: string): string {
  return `${sliderId}:slides`;
}

/** Slides per editor page — as the carousel shell counts them: whole, and one under fade. */
function slidesPerViewFromProps(
  value: unknown,
  tier: 'mobile' | 'tablet' | 'desktop',
  effect?: unknown,
): number {
  if (effect === 'fade') return 1;
  return Math.max(1, Math.round(resolveResponsiveNumber(value as never, tier, 1)));
}

export function ContentSliderActionBarExtras({ sliderId }: { sliderId: string }): ReactElement | null {
  const dispatch = usePageBuilderPuck((s) => s.dispatch);
  const getItemById = usePageBuilderPuck((s) => s.getItemById);
  const data = usePageBuilderPuck((s) => safeGetPuckData(() => s.appState?.data));
  const selectedItem = usePageBuilderPuck((s) => s.selectedItem);
  const getSelectorForId = usePageBuilderPuck((s) => s.getSelectorForId);
  const getPuck = useGetPuck();
  const tier = usePreviewBreakpointTier();

  const zone = contentSliderSlidesZone(sliderId);
  const slider = safeGetPuckItem(getItemById, sliderId);
  const isActive = isPuckItemType(slider, 'cms.ContentSlider');
  const slideCount = isActive && data ? getSlotZoneItemCount(data, zone) : 0;
  const slidesPerView = isActive
    ? slidesPerViewFromProps(slider.props.slidesPerView, tier, slider.props.effect)
    : 1;

  useEffect(() => {
    if (!isActive) return;
    const selectedId = selectedItem?.props.id;
    const locked = isEditorCarouselPreviewLocked(sliderId);
    const frozenSelectedId = locked
      ? getEditorCarouselPreviewFrozenSelectedId(sliderId)
      : getEditorCarouselLastSeenSelectedId(sliderId);

    if (locked) {
      // Arrow/dot navigation owns the page. Remounts with the same selection must not snap back.
      if (typeof selectedId !== 'string' || selectedId === frozenSelectedId) return;

      const slideIndex = resolveContentSliderSlideIndex(
        selectedId,
        sliderId,
        getSelectorForId,
        getItemById,
      );
      if (slideIndex === null) {
        // Selection left the slider tree — keep preview page, just update freeze.
        rememberEditorCarouselSelectedId(sliderId, selectedId);
        return;
      }

      const pageCount = carouselEditorPageCount(slideCount, slidesPerView);
      const page = Math.min(
        pageCount - 1,
        Math.floor(slideIndex / Math.max(1, slidesPerView)),
      );
      clearEditorCarouselPreviewLock(sliderId);
      setEditorCarouselPage(sliderId, page, { lock: false, frozenSelectedId: selectedId });
      return;
    }

    // Unlocked: sync preview page when selection moves between slides.
    if (typeof selectedId !== 'string') return;
    if (selectedId === frozenSelectedId) return;

    const slideIndex = resolveContentSliderSlideIndex(
      selectedId,
      sliderId,
      getSelectorForId,
      getItemById,
    );
    if (slideIndex === null) {
      rememberEditorCarouselSelectedId(sliderId, selectedId);
      return;
    }

    const pageCount = carouselEditorPageCount(slideCount, slidesPerView);
    const page = Math.min(
      pageCount - 1,
      Math.floor(slideIndex / Math.max(1, slidesPerView)),
    );
    setEditorCarouselPage(sliderId, page, { lock: false, frozenSelectedId: selectedId });
  }, [isActive, selectedItem, getSelectorForId, getItemById, sliderId, slideCount, slidesPerView]);

  if (!isActive) return null;

  const goToPreviewPage = (page: number): void => {
    const selectedId = selectedItem?.props.id;
    setEditorCarouselPage(sliderId, page, {
      lock: true,
      frozenSelectedId: typeof selectedId === 'string' ? selectedId : null,
    });
  };

  // Feature 163 (T054): the kind is picked in the menu — free content or one of the item blocks.
  const addSlide = (componentType: string): void => {
    const freshData = safeGetPuckData(() => getPuck().appState.data);
    if (!freshData) return;
    const count = getSlotZoneItemCount(freshData, zone);
    dispatch({
      type: 'insert',
      componentType,
      destinationZone: zone,
      destinationIndex: count,
    });
  };

  const removeSlide = (): void => {
    const freshData = safeGetPuckData(() => getPuck().appState.data);
    if (!freshData) return;
    const count = getSlotZoneItemCount(freshData, zone);
    if (count === 0) return;

    const selectedId = selectedItem?.props.id;
    const selectedSelector =
      typeof selectedId === 'string' ? getSelectorForId(selectedId) : undefined;

    if (selectedSelector && selectedSelector.zone === zone) {
      dispatch({ type: 'remove', zone, index: selectedSelector.index });
      return;
    }

    dispatch({ type: 'remove', zone, index: count - 1 });
  };

  // Feature 163, T130: a grid shows every item, so it has no pages to step through.
  const grid = slider.props.layout === 'grid';

  return (
    <>
      {grid ? null : (
        <CarouselPreviewNav
          carouselId={sliderId}
          slideCount={slideCount}
          slidesPerView={slidesPerView}
          onNavigate={goToPreviewPage}
        />
      )}
      <CarouselAddSlideMenu onAdd={addSlide} />
      <QuickTooltip text="Remove slide">
        <ActionBar.Action label="Remove slide" onClick={removeSlide}>
          <Minus size={16} />
        </ActionBar.Action>
      </QuickTooltip>
    </>
  );
}
