'use client';

import type { PuckComponent } from '@puckeditor/core';
import { useMemo, type CSSProperties } from 'react';
import { usePreviewBreakpointTier } from '@endora-commerce/page-builder-core/client';
import type { RichContentProps } from '../schema/component-types.js';
import { BoxStyled } from './box-styles.js';
import { RICH_CONTENT_PROSE_CLASS, resolveRichContentHtml } from './rich-content-shared.js';
import { textMaxWidthAttrs } from './text-max-width.js';
import { sizeUsesCustom, textStyleAttrs } from './text-style.js';
import { lineHeightCss, tierVars } from './tier-vars.js';
import { colorValueToCss } from '../utils/color-value.js';

/** Today's prose size (`.cmsc-pb-rich-content`), read by a breakpoint left on Default (R19A). */
const PROSE_TODAY = { size: 'var(--cmsb-t-body-size, 16px)', lineHeight: 'var(--cmsb-t-body-lh, 1.65)' };

/**
 * The prose wrapper's class and style: the shared prose class, plus the
 * measure when one is set (T134) and — R19A (T233) — the text size per
 * breakpoint when one is chosen.
 */
function proseAttrs(props: RichContentProps, tier: Parameters<typeof textMaxWidthAttrs>[1]) {
  const measure = textMaxWidthAttrs(props, tier);
  // R22I (T377): and the text's weight (R23 T435: one value; the lists follow it).
  const text = textStyleAttrs({ size: props.textSize, sizePx: props.textSizePx, weight: props.textWeight }, tier, PROSE_TODAY);
  // R21G (T338): the lists' line height per breakpoint, where chosen — R23 (T435): with a Custom px text size only.
  const listLeading = sizeUsesCustom(props.textSize) ? tierVars<number>('cmsc-rc-list-lh', props.listLineHeight, tier, lineHeightCss) : {};
  const leadingClass = Object.keys(listLeading).length > 0 ? ['cmsc-pb-rich-content--list-leading'] : [];
  const className = [RICH_CONTENT_PROSE_CLASS, ...(measure ? [measure.className] : []), ...text.classes, ...leadingClass].join(' ');
  // R20E (T307): the check and chevron markers' own colour; unset, today's.
  const marker = colorValueToCss(props.listMarkerColor);
  const style = { ...(measure?.style ?? {}), ...text.style, ...(marker ? { '--cmsc-list-marker': marker } : {}), ...listLeading };
  return Object.keys(style).length > 0 ? { className, style: style as CSSProperties } : { className };
}

export const RichContentPublishedRender: PuckComponent<RichContentProps> = (props) => {
  const safeHtml = useMemo(() => resolveRichContentHtml(props), [props]);

  if (!safeHtml) {
    const { content: _content, html: _html, puck: _puck, ...box } = props;
    return <BoxStyled {...box}>{null}</BoxStyled>;
  }

  const { content: _content, html: _html, puck: _puck, ...box } = props;

  return (
    <BoxStyled {...box}>
      <div {...proseAttrs(props, null)} dangerouslySetInnerHTML={{ __html: safeHtml }} />
    </BoxStyled>
  );
};

export const RichContentEditingPreviewRender: PuckComponent<RichContentProps> = (props) => {
  const tier = usePreviewBreakpointTier();
  const safeHtml = useMemo(() => resolveRichContentHtml(props), [props]);
  const { content: _content, html: _html, puck: _puck, ...box } = props;

  return (
    <BoxStyled previewTier={tier} {...box}>
      <div {...proseAttrs(props, tier)} dangerouslySetInnerHTML={{ __html: safeHtml || '<p></p>' }} />
    </BoxStyled>
  );
};
