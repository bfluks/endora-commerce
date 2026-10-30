import { readFileSync } from 'node:fs';
import { Render, type ComponentConfig, type Config } from '@puckeditor/core';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { withHideOn, type BreakpointTier, type HideOnProps, type SectionSettingsValue } from '@endora-commerce/page-builder-core';
import { CmsRenderProvider } from './render-context.js';
import { SectionFrame } from './Section.js';

/**
 * `specs/163-page-builder-marketing-pages/` R19C — `cms.Section`'s width per
 * breakpoint (T260) and a custom width wider than the page container (T262),
 * through `SectionFrame` at the top level of a page, rendered as the
 * storefront renders it (Puck's `<Render>`), and the editor canvas's tier.
 * R23 (T449) removed the background outset (T261): a stored one writes nothing.
 *
 * Unset — or a width stored as one value — renders today's markup: the option
 * parity half of every case below.
 */

type ProbeProps = HideOnProps & { section?: SectionSettingsValue; tier?: BreakpointTier };

const probe = withHideOn<ProbeProps>({
  fields: {},
  render: (props: ProbeProps) => (
    <SectionFrame settings={props.section} {...(props.tier ? { tier: props.tier } : {})}>
      <p>Body</p>
    </SectionFrame>
  ),
} as unknown as ComponentConfig<{ props: ProbeProps }>) as unknown as ComponentConfig;

const config: Config = { components: { Probe: probe } };

function render(section: SectionSettingsValue | undefined, tier?: BreakpointTier): string {
  return renderToString(
    <CmsRenderProvider embeds={{ blocks: {}, templates: {} }} mediaBaseUrl="https://api.example.com">
      <Render
        config={config}
        data={{
          root: { props: {} },
          content: [{ type: 'Probe', props: { id: 'probe-1', ...(section ? { section } : {}), ...(tier ? { tier } : {}) } }] as never,
        }}
      />
    </CmsRenderProvider>,
  );
}

function sectionTag(html: string): string {
  const match = /<section[^>]*>/.exec(html);
  if (!match) throw new Error(`no <section> in\n${html}`);
  return match[0];
}

const GUTTER = 'var(--pb-page-padding, var(--cmsb-gutter, 24px))';
const CONTAINER = 'var(--cmsb-container, 1360px)';

describe('Section — width per breakpoint (R19C, T260)', () => {
  it('a width stored as one value renders as before: its `data-width`, no tier variables', () => {
    for (const width of ['contained', 'bleed', 'full'] as const) {
      const tag = sectionTag(render({ width }));
      expect(tag).toContain(`data-width="${width}"`);
      expect(tag).not.toContain('--cmsc-section-box-w');
    }
  });

  it('a per-breakpoint width whose tiers all agree renders as that one width', () => {
    const tag = sectionTag(render({ width: { base: 'bleed' } }));
    expect(tag).toContain('data-width="bleed"');
    expect(tag).not.toContain('--cmsc-section-box-w');
    expect(sectionTag(render({ width: { base: 'contained', desktop: 'contained' } }))).toContain('data-width="contained"');
  });

  it('full bleed on phones, contained from the desktop: `data-width="tiered"` with each tier\'s box and frame', () => {
    const tag = sectionTag(render({ width: { base: 'bleed', desktop: 'contained' } }));
    expect(tag).toContain('data-width="tiered"');
    // Phones and tablets (the tablet inherits the phone): the viewport wide, the content to its edges.
    expect(tag).toContain('--cmsc-section-box-w:100vw');
    expect(tag).toContain('--cmsc-section-box-w-md:100vw');
    expect(tag).toContain('--cmsc-section-box-m:calc((100% - 100vw) / 2)');
    expect(tag).toContain('--cmsc-section-frame-max:none');
    expect(tag).toContain('--cmsc-section-frame-px:0px');
    // The desktop: in the page container.
    expect(tag).toContain('--cmsc-section-box-w-lg:100%');
    expect(tag).toContain('--cmsc-section-box-m-lg:calc((100% - 100%) / 2)');
    expect(tag).toContain(`--cmsc-section-frame-max-lg:${CONTAINER}`);
    expect(tag).toContain('--cmsc-section-frame-px-lg:0px');
  });

  it('`full` and `viewport` per tier hold the content in the container with the gutter; `viewport` is at least the screen tall', () => {
    const tag = sectionTag(render({ width: { base: 'full', desktop: 'viewport' } }));
    expect(tag).toContain(`--cmsc-section-box-w:calc(100% + 2 * ${GUTTER})`);
    expect(tag).toContain(`--cmsc-section-frame-px:${GUTTER}`);
    expect(tag).toContain('--cmsc-section-box-mh:auto');
    expect(tag).toContain('--cmsc-section-box-mh-lg:100svh');
    expect(tag).toContain(`--cmsc-section-frame-max-lg:${CONTAINER}`);
  });

  it('the content width applies at the tiers whose width admits one', () => {
    const tag = sectionTag(render({ width: { base: 'contained', desktop: 'bleed' }, contentWidth: 'contained' }));
    expect(tag).toContain('data-width="tiered"');
    expect(tag).not.toContain('data-content-width');
    expect(tag).toContain('--cmsc-section-frame-px:0px');
    expect(tag).toContain(`--cmsc-section-frame-max-lg:${CONTAINER}`);
    expect(tag).toContain(`--cmsc-section-frame-px-lg:${GUTTER}`);
  });

  it('a custom tier carries its max width, and may reach past the container up to the viewport less the gutters', () => {
    const tag = sectionTag(render({ width: { base: 'contained', desktop: 'custom' }, customMaxWidthPx: 1500 }));
    expect(tag).toContain(`--cmsc-section-box-w-lg:max(100%, min(1500px, 100vw - 2 * ${GUTTER}))`);
    expect(tag).toContain('--cmsc-section-frame-max-lg:1500px');
  });

  it('the editor canvas renders the previewed tier\'s width as one value', () => {
    const width = { base: 'bleed', desktop: 'contained' } as const;
    expect(sectionTag(render({ width }, 'desktop'))).toContain('data-width="contained"');
    expect(sectionTag(render({ width }, 'tablet'))).toContain('data-width="bleed"');
    expect(sectionTag(render({ width }, 'mobile' as BreakpointTier))).toContain('data-width="bleed"');
    expect(sectionTag(render({ width, contentWidth: 'wide' }, 'tablet'))).toContain('data-content-width="wide"');
    expect(sectionTag(render({ width, contentWidth: 'wide' }, 'desktop'))).not.toContain('data-content-width');
  });
});

describe('Section — the background outset (R19C T261) was removed (R23 T449)', () => {
  const stale = (section: Record<string, unknown>, tier?: BreakpointTier) => sectionTag(render(section as SectionSettingsValue, tier));

  it('a stored outset writes nothing: the markup is the one without it', () => {
    expect(stale({ outsetPx: { base: 0, desktop: 24 } })).toBe(sectionTag(render({})));
    expect(stale({ width: 'custom', customMaxWidthPx: 900, outsetPx: 24 })).toBe(sectionTag(render({ width: 'custom', customMaxWidthPx: 900 })));
    expect(stale({ outsetPx: 32 }, 'desktop')).toBe(sectionTag(render({}, 'desktop')));
  });

  it('a per-breakpoint width writes no outset part in its tiers', () => {
    const tag = stale({ width: { base: 'bleed', desktop: 'contained' }, outsetPx: 24 });
    expect(tag).not.toContain('data-outset');
    expect(tag).not.toContain('--cmsc-section-box-o');
  });
});

describe('Section — stylesheet (R19C, T260–T262)', () => {
  const css = readFileSync(new URL('../../styles/cms-components.css', import.meta.url), 'utf8');

  it('a custom width wider than the page container widens the section up to the viewport less the gutters', () => {
    expect(css).toContain(
      `--cmsc-section-w: max(100%, min(var(--cmsc-section-max, 1200px), 100vw - 2 * ${GUTTER}));`,
    );
    expect(css).toMatch(/\.cmsc-section\[data-width='custom'\] \{[^}]*width: var\(--cmsc-section-w, 100%\)/);
    expect(css).not.toContain('data-outset');
  });

  it('a tiered width reads its box and frame from the tier variables at each breakpoint', () => {
    expect(css).toMatch(/\.cmsc-section\[data-width='tiered'\] \{[^}]*width: var\(--cmsc-section-box-w\)/);
    expect(css).toContain('width: var(--cmsc-section-box-w-lg);');
    expect(css).toMatch(/\.cmsc-section\[data-width='tiered'\] > \.cmsc-section__frame \{[^}]*max-width: var\(--cmsc-section-frame-max\)/);
  });
});
