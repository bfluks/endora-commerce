// @vitest-environment jsdom
import { Render, type Config, type Data } from '@puckeditor/core';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { defaultPageBuilderConfig } from '../index.js';
import { buttonWidthClasses } from './button-full-width.js';

// Puck's drag-and-drop layer observes element sizes when it is imported; jsdom has no ResizeObserver.
vi.hoisted(() => {
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
});

/**
 * `specs/163-page-builder-marketing-pages/` T168 (R10): a button spans the
 * full width per breakpoint — `cms.Button.fullWidth` (top level, Responsive
 * tab) and each button list's block-level `buttonsFullWidth`; never a value
 * inside the nested `ButtonSpec`. Unset writes nothing: today's markup.
 */

const config = defaultPageBuilderConfig as Config;
const BUTTON = { label: 'Start', link: { kind: 'url', href: '/start' }, style: 'primary', fill: 'solid', size: 'medium' };

function render(type: string, props: Record<string, unknown>): string {
  const defaults = (config.components[type]?.defaultProps ?? {}) as Record<string, unknown>;
  const data: Data = { root: { props: {} }, content: [{ type, props: { ...defaults, id: `${type}-1`, ...props } }] as Data['content'] };
  return renderToString(<Render config={config} data={data} />);
}

function classesOf(html: string, selector: string): string[] {
  const host = document.createElement('div');
  host.innerHTML = html;
  const element = host.querySelector(selector);
  if (!element) throw new Error(`no ${selector} in ${html}`);
  return [...element.classList];
}

describe('buttonWidthClasses (T168)', () => {
  it('writes nothing unset or fit-the-label everywhere', () => {
    for (const value of [undefined, 'auto', { base: 'auto' }, { base: 'auto', tablet: 'auto', desktop: 'auto' }]) {
      expect(buttonWidthClasses(value as never, null, 'cmsc-btn')).toEqual([]);
    }
  });

  it('on the page: the phone\'s width, and a class where the tablet or the desktop changes it', () => {
    expect(buttonWidthClasses('full', null, 'cmsc-btn')).toEqual(['cmsc-btn--full']);
    expect(buttonWidthClasses({ base: 'full' }, null, 'cmsc-btn')).toEqual(['cmsc-btn--full']);
    expect(buttonWidthClasses({ base: 'full', tablet: 'auto' }, null, 'cmsc-btn')).toEqual(['cmsc-btn--full', 'cmsc-btn--md-auto']);
    expect(buttonWidthClasses({ base: 'auto', desktop: 'full' }, null, 'cmsc-btn-list')).toEqual(['cmsc-btn-list--lg-full']);
    expect(buttonWidthClasses({ base: 'full', tablet: 'auto', desktop: 'full' }, null, 'x')).toEqual(['x--full', 'x--md-auto', 'x--lg-full']);
  });

  it('in the editor canvas: the previewed breakpoint\'s width only', () => {
    const value = { base: 'full', tablet: 'auto' } as const;
    expect(buttonWidthClasses(value, 'mobile', 'cmsc-btn')).toEqual(['cmsc-btn--full']);
    expect(buttonWidthClasses(value, 'tablet', 'cmsc-btn')).toEqual([]);
    expect(buttonWidthClasses(value, 'desktop', 'cmsc-btn')).toEqual([]);
    expect(buttonWidthClasses({ base: 'auto', desktop: 'full' }, 'desktop', 'cmsc-btn')).toEqual(['cmsc-btn--full']);
  });

  it('ignores an unknown value', () => {
    expect(buttonWidthClasses('wide' as never, null, 'cmsc-btn')).toEqual([]);
    expect(buttonWidthClasses({ base: 'wide' } as never, null, 'cmsc-btn')).toEqual([]);
  });
});

describe('cms.Button full width per breakpoint (T168)', () => {
  it('unset renders today\'s markup', () => {
    const html = render('cms.Button', { button: BUTTON });
    expect(render('cms.Button', { button: BUTTON, fullWidth: { base: 'auto' } })).toBe(html);
    expect(html).not.toContain('--full');
  });

  it('a full width on the phone only marks the button, and its wrappers span the row', () => {
    const html = render('cms.Button', { button: BUTTON, fullWidth: { base: 'full', tablet: 'auto' } });
    expect(classesOf(html, '.cmsc-btn')).toEqual(expect.arrayContaining(['cmsc-btn--full', 'cmsc-btn--md-auto', 'cmsc-pb-button']));
  });
});

describe('button lists: the block-level full width (T168)', () => {
  const cases = [
    ['cms.Hero', { buttons: [BUTTON, BUTTON] }, '.cmsc-pb-hero__actions'],
    ['cms.MediaText', { buttons: [BUTTON] }, '.cmsc-pb-media-text__actions'],
    ['cms.CtaCard', { buttons: [BUTTON] }, '.cmsc-pb-cta-card__actions'],
    ['cms.BackgroundPanel', { buttons: [BUTTON] }, '.cmsc-pb-panel__actions'],
    ['cms.CarouselSplit', { buttons: [BUTTON] }, '.cmsc-pb-carousel-split__actions'],
  ] as const;

  it.each(cases)('%s unset keeps today\'s list', (type, props, selector) => {
    const html = render(type, props);
    expect(classesOf(html, selector).some((name) => name.startsWith('cmsc-btn-list'))).toBe(false);
    expect(render(type, { ...props, buttonsFullWidth: { base: 'auto' } })).toBe(html);
  });

  it.each(cases)('%s marks its list with the width per breakpoint; the buttons themselves are unchanged', (type, props, selector) => {
    const html = render(type, { ...props, buttonsFullWidth: { base: 'full', desktop: 'auto' } });
    expect(classesOf(html, selector)).toEqual(expect.arrayContaining(['cmsc-btn-list--full', 'cmsc-btn-list--lg-auto']));
    expect(classesOf(html, `${selector} .cmsc-btn`)).not.toContain('cmsc-btn--full');
  });
});
