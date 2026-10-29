import type { Data } from '@puckeditor/core';
import { describe, expect, it } from 'vitest';
import { CAROUSEL_SLIDE_TYPES, shouldRevertPuckAction } from './puck-action-guards.js';

/**
 * `specs/163-page-builder-marketing-pages/` T054, research R-12 — the
 * Carousel's `slides` take the four item blocks beside `cms.Slide`: inserting,
 * moving or reordering one there is kept, anything else is still reverted.
 * (`puck-action-guards.test.ts` holds the cases that predate them, unchanged.)
 */

const sliderId = 'slider-1';
const zone = `${sliderId}:slides`;

function sliderData(slides: Array<{ type: string; props: Record<string, unknown> }> = []): Data {
  return {
    root: { props: {} },
    content: [{ type: 'cms.ContentSlider', props: { id: sliderId, slides } }],
    zones: { [zone]: slides },
  } as Data;
}

describe('the Carousel slides zone (T054)', () => {
  it('lists the slide kinds: free content and the four item blocks', () => {
    expect([...CAROUSEL_SLIDE_TYPES]).toEqual([
      'cms.Slide',
      'cms.CarouselImage',
      'cms.CarouselSplit',
      'cms.LinkTile',
      'cms.DownloadTile',
    ]);
  });

  it('keeps an inserted item block and still reverts any other block', () => {
    for (const componentType of CAROUSEL_SLIDE_TYPES) {
      expect(
        shouldRevertPuckAction({ type: 'insert', componentType, destinationIndex: 0, destinationZone: zone }, sliderData()),
        componentType,
      ).toBe(false);
    }
    expect(
      shouldRevertPuckAction({ type: 'insert', componentType: 'cms.Heading', destinationIndex: 0, destinationZone: zone }, sliderData()),
    ).toBe(true);
  });

  it('keeps an item block moved or reordered within the slides', () => {
    const data = sliderData([
      { type: 'cms.CarouselImage', props: { id: 'image-1' } },
      { type: 'cms.DownloadTile', props: { id: 'download-1' } },
    ]);
    expect(
      shouldRevertPuckAction({ type: 'reorder', sourceIndex: 1, destinationIndex: 0, destinationZone: zone }, data),
    ).toBe(false);
    expect(
      shouldRevertPuckAction(
        { type: 'move', sourceIndex: 0, sourceZone: zone, destinationIndex: 1, destinationZone: zone },
        data,
      ),
    ).toBe(false);
  });
});
