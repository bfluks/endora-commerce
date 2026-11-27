// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToString } from 'react-dom/server';
import { Render, type ComponentConfig, type Config, type Data, type Fields } from '@puckeditor/core';
import { describe, expect, it, vi } from 'vitest';
import { defaultPageBuilderConfig } from '../index.js';
import { CmsRenderProvider } from './render-context.js';

vi.hoisted(() => {
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
});

/**
 * `specs/163-page-builder-marketing-pages/` R19B (T252) — `newsletter.Signup`
 * layout options (plan § *Extend, don't narrow*: unset is today's labelled
 * field, the button beside it, the topics in one wrapping row).
 *
 * - **The button inside the field**: the input and the button share one box,
 *   rounded or a pill; the form still posts the same fields.
 * - **Topics in columns** (1–4), a grid of the checkboxes.
 * - **A visually hidden e-mail label**: still the input's `<label>`, so its
 *   accessible name is unchanged (WCAG 1.3.1, 4.1.2).
 *
 * `cms.NewsletterSignup` (the external endpoint's form) shares no code with
 * this block, so it is not changed.
 */

const config = defaultPageBuilderConfig as Config;
const block = config.components['newsletter.Signup'] as ComponentConfig;
const defaults = (block.defaultProps ?? {}) as Record<string, unknown>;
const TOPICS = [
  { label: 'Architects', tagCode: 'architects' },
  { label: 'Designers', tagCode: 'designers' },
  { label: 'Installers', tagCode: 'installers' },
  { label: 'Distributors', tagCode: 'distributors' },
];

function html(props: Record<string, unknown> = {}): string {
  const content = [{ type: 'newsletter.Signup', props: { ...defaults, id: 'signup-1', topics: TOPICS, ...props } }] as Data['content'];
  return renderToString(
    <CmsRenderProvider embeds={{ blocks: {}, templates: {} }} location={{ path: '/academy', query: {} }}>
      <Render config={config} data={{ root: { props: {} }, content }} />
    </CmsRenderProvider>,
  );
}

function dom(props: Record<string, unknown> = {}): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html(props);
  return host;
}

const sheet = (): string =>
  readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../styles/cms-components.css'), 'utf8').replace(/\s+/g, ' ');

describe('newsletter.Signup layout options (T252)', () => {
  it('unset (and every option at its default) renders today’s markup', () => {
    const today = html();
    expect(html({ buttonPlacement: 'beside', fieldShape: 'rounded', hideEmailLabel: false, topicsColumns: undefined })).toBe(today);
    expect(today).not.toContain('cmsc-pb-signup__control');
  });

  it('the button inside the field: input and button in one box, a pill on request', () => {
    const host = dom({ buttonPlacement: 'inside', fieldShape: 'pill' });
    const root = host.querySelector('.cmsc-pb-signup')!;
    expect(root.className).toContain('cmsc-pb-signup--button-inside');
    expect(root.className).toContain('cmsc-pb-signup--pill');
    const control = host.querySelector('.cmsc-pb-signup__control')!;
    expect(control.querySelector('input[type="email"][name="email"]')).not.toBeNull();
    expect(control.querySelector('button[type="submit"]')?.textContent).toBe(String(defaults['buttonLabel']));
    // One submit button in the form, inside the box.
    expect(host.querySelectorAll('button[type="submit"]')).toHaveLength(1);
    const css = sheet();
    expect(css).toContain('.cmsc-pb-signup__control { display: flex; align-items: center;');
    expect(css).toContain('.cmsc-pb-signup--pill :is(.cmsc-pb-signup__control, .cmsc-pb-signup__input, .cmsc-pb-signup__button) { border-radius: 999px; }');
  });

  it('a visually hidden e-mail label stays the input’s label', () => {
    const host = dom({ hideEmailLabel: true });
    const input = host.querySelector<HTMLInputElement>('input[type="email"]')!;
    const label = host.querySelector(`label[for="${input.id}"]`)!;
    expect(label.className).toContain('cmsc-sr-only');
    expect(label.textContent).toBe(String(defaults['emailLabel']));
  });

  it('topics in a grid of columns', () => {
    const fieldset = dom({ topicsColumns: 2 }).querySelector('fieldset.cmsc-pb-signup__topics')!;
    expect(fieldset.className).toContain('cmsc-pb-signup__topics--columns');
    expect(fieldset.getAttribute('style')).toContain('--pb-topic-cols:2');
    expect(dom({ topicsColumns: 9 }).querySelector('fieldset')!.getAttribute('style')).toContain('--pb-topic-cols:4');
    expect(sheet()).toContain('.cmsc-pb-signup__topics--columns { display: grid; grid-template-columns: repeat(var(--pb-topic-cols, 2), minmax(0, 1fr)); }');
  });

  it('the fields are offered, the shape with the button inside and the columns with topics', async () => {
    const keys = async (props: Record<string, unknown>): Promise<string[]> => {
      const fields = block.fields as Fields;
      return Object.keys(
        await block.resolveFields!(
          { props: { ...defaults, ...props } } as never,
          { fields, lastFields: fields, changed: {}, lastData: null, metadata: {}, appState: {}, parent: null } as never,
        ),
      );
    };
    const plain = await keys({});
    expect(plain).toEqual(expect.arrayContaining(['buttonPlacement', 'hideEmailLabel']));
    expect(plain).not.toContain('fieldShape');
    expect(plain).not.toContain('topicsColumns');
    expect(await keys({ buttonPlacement: 'inside', topics: TOPICS })).toEqual(expect.arrayContaining(['fieldShape', 'topicsColumns']));
  });
});
