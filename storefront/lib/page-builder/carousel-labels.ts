import type { CmsCarouselLabelText } from '@endora-commerce/cms-components/components/render-context';
import { tForLocale } from '../i18n/messages';

/**
 * The words a page-builder carousel speaks to assistive technology, in the
 * page's language (feature 163, T095). `cms-components` has no translation
 * layer; `CmsPageRenderer` hands these to the render context, and every
 * carousel on the page reads them. A language the catalogue does not carry
 * reads English, as `tForLocale` does.
 */
export function cmsCarouselLabels(language: string): CmsCarouselLabelText {
  const t = tForLocale(language);
  return {
    carousel: t('cms.carousel.label'),
    previous: t('cms.carousel.previous'),
    next: t('cms.carousel.next'),
    slide: t('cms.carousel.slide'),
    goToSlide: t('cms.carousel.goToSlide'),
    goToPage: t('cms.carousel.goToPage'),
    pause: t('cms.carousel.pause'),
    play: t('cms.carousel.play'),
    // Feature 163, T131: the filter bar.
    filter: t('cms.carousel.filter'),
    filterAll: t('cms.carousel.filterAll'),
    filterCount: t('cms.carousel.filterCount'),
  };
}
