import type { ComponentData } from '@puckeditor/core';
import { plainTextToInlineRichText, type ButtonSpec } from '@endora-commerce/page-builder-core';
import { ContentSlider } from '../components/ContentSlider.js';
import { CtaCard } from '../components/CtaCard.js';
import { DownloadTile } from '../components/DownloadTile.js';
import { FeatureList } from '../components/FeatureList.js';
import { Hero } from '../components/Hero.js';
import { MediaText } from '../components/MediaText.js';
import { Section } from '../components/SectionBlock.js';
import { plainTextToDoc } from '../components/section-parts.js';
import { Statement } from '../components/Statement.js';

/**
 * Section presets (`specs/163-page-builder-marketing-pages/` FR-042, research
 * R-22): six ready-made sections an editor inserts from the block drawer and
 * then edits. Code-side, so they are versioned with the blocks they build; the
 * tree literals name declared blocks, which `check:block-names` reads.
 *
 * Each preset is one top-level `cms.Section` holding its block (plan § *Owner
 * ruling 2026-10-23*: the section settings — anchor, scheme, background,
 * spacing, width — live on the Section), with the Section's neutral defaults.
 *
 * A builder takes the editor's translator for `cms`' `presets.*` keys, so the
 * placeholder copy is in the admin's language. The copy is generic on purpose
 * (FR-040): it describes the pattern, never a site or an industry.
 */

/** `cms`' translator, scoped to the admin's language. */
export type PresetTranslate = (key: string) => string;

export type SectionPresetId = 'hero' | 'mediaText' | 'ctaCard' | 'downloads' | 'featureGrid' | 'statement';

export interface SectionPreset {
  id: SectionPresetId;
  /** `cms` keys of the preset's name and one-line description in the panel. */
  labelKey: string;
  descriptionKey: string;
  /** A fresh tree, with new ids, every call. */
  build: (t: PresetTranslate) => ComponentData;
}

function newId(type: string): string {
  return `${type}-${crypto.randomUUID()}`;
}

function button(label: string, style: ButtonSpec['style'], fill: ButtonSpec['fill']): ButtonSpec {
  return { label, link: { kind: 'url', href: '/' }, style, fill, size: 'medium' };
}

function defaults(config: { defaultProps?: unknown }): Record<string, unknown> {
  return { ...((config.defaultProps as Record<string, unknown> | undefined) ?? {}) };
}

/** The preset's block inside a fresh `cms.Section`; `settings` are the Section's own props (T117), where they differ from its defaults. */
function inSection(block: ComponentData, settings?: Record<string, unknown>): ComponentData {
  return {
    type: 'cms.Section',
    props: {
      ...defaults(Section),
      id: newId('cms.Section'),
      ...settings,
      content: [block],
    },
  };
}

function heroPreset(t: PresetTranslate): ComponentData {
  // The hero has its own height and inner spacing, so its Section adds none.
  return inSection({
    type: 'cms.Hero',
    props: {
      ...defaults(Hero),
      id: newId('cms.Hero'),
      eyebrow: t('presets.hero.eyebrow'),
      title: plainTextToInlineRichText(t('presets.hero.title')),
      body: plainTextToDoc(t('presets.hero.body')),
      buttons: [
        button(t('presets.hero.primaryButton'), 'primary', 'solid'),
        button(t('presets.hero.secondaryButton'), 'primary', 'outline'),
      ],
    },
  }, { spaceTop: 'none', spaceBottom: 'none' });
}

function mediaTextPreset(t: PresetTranslate): ComponentData {
  return inSection({
    type: 'cms.MediaText',
    props: {
      ...defaults(MediaText),
      id: newId('cms.MediaText'),
      heading: plainTextToInlineRichText(t('presets.mediaText.heading')),
      body: plainTextToDoc(t('presets.mediaText.body')),
      buttons: [button(t('presets.mediaText.button'), 'primary', 'solid')],
    },
  });
}

function ctaCardPreset(t: PresetTranslate): ComponentData {
  return inSection({
    type: 'cms.CtaCard',
    props: {
      ...defaults(CtaCard),
      id: newId('cms.CtaCard'),
      heading: plainTextToInlineRichText(t('presets.ctaCard.heading')),
      body: plainTextToDoc(t('presets.ctaCard.body')),
      buttons: [button(t('presets.ctaCard.button'), 'primary', 'solid')],
    },
  });
}

function downloadTile(t: PresetTranslate, n: 1 | 2 | 3): ComponentData {
  return {
    type: 'cms.DownloadTile',
    props: {
      ...defaults(DownloadTile),
      id: newId('cms.DownloadTile'),
      title: t(`presets.downloads.file${n}.title`),
      subtitle: t(`presets.downloads.file${n}.subtitle`),
      linkLabel: t('presets.downloads.linkLabel'),
    },
  };
}

function downloadsPreset(t: PresetTranslate): ComponentData {
  return inSection({
    type: 'cms.ContentSlider',
    props: {
      ...defaults(ContentSlider),
      id: newId('cms.ContentSlider'),
      header: { heading: plainTextToInlineRichText(t('presets.downloads.heading')), lead: t('presets.downloads.lead') },
      slidesPerView: { base: 1.15, tablet: 2, desktop: 3 },
      slides: [downloadTile(t, 1), downloadTile(t, 2), downloadTile(t, 3)],
    },
  });
}

function featureGridPreset(t: PresetTranslate): ComponentData {
  const base = defaults(FeatureList);
  const icons = ((base['items'] as Array<{ icon?: string }> | undefined) ?? []).map((item) => item.icon);
  return inSection({
    type: 'cms.FeatureList',
    props: {
      ...base,
      id: newId('cms.FeatureList'),
      heading: plainTextToInlineRichText(t('presets.featureGrid.heading')),
      columns: { base: 1, tablet: 2, desktop: 3 },
      items: ([1, 2, 3] as const).map((n, index) => ({
        ...(icons[index] ? { icon: icons[index] } : {}),
        title: plainTextToInlineRichText(t(`presets.featureGrid.item${n}.title`)),
        body: plainTextToDoc(t(`presets.featureGrid.item${n}.body`)),
      })),
    },
  });
}

function statementPreset(t: PresetTranslate): ComponentData {
  return inSection({
    type: 'cms.Statement',
    props: {
      ...defaults(Statement),
      id: newId('cms.Statement'),
      heading: plainTextToInlineRichText(t('presets.statement.heading')),
      body: plainTextToDoc(t('presets.statement.body')),
    },
  });
}

export const SECTION_PRESETS: readonly SectionPreset[] = [
  { id: 'hero', labelKey: 'presets.hero.label', descriptionKey: 'presets.hero.description', build: heroPreset },
  {
    id: 'mediaText',
    labelKey: 'presets.mediaText.label',
    descriptionKey: 'presets.mediaText.description',
    build: mediaTextPreset,
  },
  { id: 'ctaCard', labelKey: 'presets.ctaCard.label', descriptionKey: 'presets.ctaCard.description', build: ctaCardPreset },
  {
    id: 'downloads',
    labelKey: 'presets.downloads.label',
    descriptionKey: 'presets.downloads.description',
    build: downloadsPreset,
  },
  {
    id: 'featureGrid',
    labelKey: 'presets.featureGrid.label',
    descriptionKey: 'presets.featureGrid.description',
    build: featureGridPreset,
  },
  {
    id: 'statement',
    labelKey: 'presets.statement.label',
    descriptionKey: 'presets.statement.description',
    build: statementPreset,
  },
];

/** Every block name a preset tree carries, root first, depth first through its slots. */
export function presetBlockNames(tree: ComponentData): string[] {
  const names = [tree.type];
  for (const value of Object.values(tree.props as Record<string, unknown>)) {
    if (!Array.isArray(value)) continue;
    for (const child of value) {
      if (child && typeof child === 'object' && typeof (child as ComponentData).type === 'string' && 'props' in child) {
        names.push(...presetBlockNames(child as ComponentData));
      }
    }
  }
  return names;
}
