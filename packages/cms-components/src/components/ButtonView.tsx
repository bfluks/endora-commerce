'use client';

import type { CSSProperties, ReactNode } from 'react';
import {
  normalizeResponsive,
  type ButtonFill,
  type ButtonSpec,
  type ButtonStyle,
} from '@endora-commerce/page-builder-core';
import { colorValueToCss } from '../utils/color-value.js';
import { resolveLinkHref } from '../utils/link-href.js';
import { resolveCmsIcon } from './icon-catalog.js';
import { useCmsRenderAssets, useCmsRenderMediaBaseUrl } from './render-context.js';

/**
 * The style-and-fill classes of a button: the base tier's always, and a
 * `--md-` / `--lg-` class only where a responsive value changes at that tier,
 * as today's button does with its variant.
 */
function appearanceClasses(button: Pick<ButtonSpec, 'style' | 'fill'>): string[] {
  const style = normalizeResponsive<ButtonStyle>(button.style, 'primary');
  const fill = normalizeResponsive<ButtonFill>(button.fill, 'solid');
  const tablet = { style: style.tablet ?? style.base, fill: fill.tablet ?? fill.base };
  const desktop = { style: style.desktop ?? tablet.style, fill: fill.desktop ?? tablet.fill };

  const classes = [`cmsc-btn--${style.base}-${fill.base}`];
  if (tablet.style !== style.base || tablet.fill !== fill.base) {
    classes.push(`cmsc-btn--md-${tablet.style}-${tablet.fill}`);
  }
  if (desktop.style !== tablet.style || desktop.fill !== tablet.fill) {
    classes.push(`cmsc-btn--lg-${desktop.style}-${desktop.fill}`);
  }
  return classes;
}

/**
 * Today's per-button `backgroundColor` / `textColor` overrides: they replace the
 * style's colour and its label colour (and the hover colour, so an overridden
 * button keeps its colour under the pointer, as today's does).
 */
function overrideStyle(button: Pick<ButtonSpec, 'backgroundColor' | 'textColor'>): CSSProperties {
  const color = colorValueToCss(button.backgroundColor);
  const on = colorValueToCss(button.textColor);
  return {
    ...(color ? { '--cmsc-btn-c': color, '--cmsc-btn-c-hover': color } : {}),
    ...(on ? { '--cmsc-btn-on': on } : {}),
  } as CSSProperties;
}

export interface ButtonViewProps {
  button: ButtonSpec;
  className?: string;
}

/**
 * One `ButtonSpec` as a link styled by `cmsc-btn` (`specs/163-page-builder-marketing-pages/`
 * research R-11): `cmsc-btn--<style>-<fill>` and `cmsc-btn--<size>`, an icon from
 * the curated catalog before or after the label, and `iconPosition: 'only'` as a
 * round button whose accessible name is the label. A link that resolves to
 * nothing renders the same box with no link.
 */
export function ButtonView({ button, className }: ButtonViewProps): ReactNode {
  const assets = useCmsRenderAssets();
  const mediaBaseUrl = useCmsRenderMediaBaseUrl();
  const link = resolveLinkHref(button.link, { assets, mediaBaseUrl });
  const Icon = resolveCmsIcon(button.icon);
  const iconOnly = Icon !== null && button.iconPosition === 'only' && button.label.trim() !== '';
  const iconAtEnd = button.iconPosition === 'end' || button.iconPosition === undefined;

  const classes = [
    'cmsc-btn',
    ...appearanceClasses(button),
    `cmsc-btn--${button.size ?? 'medium'}`,
    iconOnly ? 'cmsc-btn--icon-only' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  const style = overrideStyle(button);
  const icon = Icon ? <Icon aria-hidden="true" className="cmsc-btn__icon" /> : null;

  const content = iconOnly ? (
    icon
  ) : (
    <>
      {icon && !iconAtEnd ? icon : null}
      <span className="cmsc-btn__label">{button.label}</span>
      {icon && iconAtEnd ? icon : null}
    </>
  );

  const common = {
    className: classes,
    ...(Object.keys(style).length > 0 ? { style } : {}),
    ...(iconOnly ? { 'aria-label': button.label } : {}),
  };

  if (!link) return <span {...common}>{content}</span>;
  return (
    <a
      href={link.href}
      {...(link.target ? { target: link.target } : {})}
      {...(link.rel ? { rel: link.rel } : {})}
      {...common}
    >
      {content}
    </a>
  );
}
