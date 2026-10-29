'use client';

import type { PuckComponent } from '@puckeditor/core';
import { useMemo, type CSSProperties } from 'react';
import { usePreviewBreakpointTier } from '@endora-commerce/page-builder-core/client';
import type { RichContentProps } from '../schema/component-types.js';
import { BoxStyled } from './box-styles.js';
import { RICH_CONTENT_PROSE_CLASS, resolveRichContentHtml } from './rich-content-shared.js';
import { textMaxWidthAttrs } from './text-max-width.js';

/** The prose wrapper's class and style: the shared prose class, plus the measure when one is set (T134). */
function proseAttrs(props: RichContentProps, tier: Parameters<typeof textMaxWidthAttrs>[1]) {
  const measure = textMaxWidthAttrs(props, tier);
  return measure
    ? { className: `${RICH_CONTENT_PROSE_CLASS} ${measure.className}`, style: measure.style as CSSProperties }
    : { className: RICH_CONTENT_PROSE_CLASS };
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
