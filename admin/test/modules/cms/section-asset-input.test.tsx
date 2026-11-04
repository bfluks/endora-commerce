import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ComponentConfig } from '@puckeditor/core';
import { defaultPageBuilderConfig } from '@endora-commerce/cms-components';
import { isSectionBackgroundField, type SectionBackgroundField } from '@endora-commerce/page-builder-core';
import {
  AdminSectionAssetInput,
  withAdminSectionAssetInput,
} from '../../../../packages/modules/cms/src/admin/components/BackgroundFields';

/**
 * Feature 163, T033, T110, T117 — in the admin, the section background picks
 * its assets (image, mobile image, video, mobile video, poster) from the asset
 * library (`specs/163-page-builder-marketing-pages/` research R-9). Since the
 * owner's ruling of 2026-10-23 only `cms.Section` carries one, and since T117
 * it is the Section's own top-level `background` prop.
 *
 * The swap is keyed on the field, not on a block name or a prop name.
 * `mergeConfig` is module-private; the loop is asserted on the source, in the
 * idiom of `preview-brand-tokens.test.tsx`.
 */

const components = defaultPageBuilderConfig.components as Record<string, ComponentConfig>;
const carriers = Object.entries(components).flatMap(([name, config]) =>
  Object.entries(config.fields ?? {})
    .filter(([, field]) => isSectionBackgroundField(field))
    .map(([key]) => `${name}.${key}`),
);

describe('section asset input (T033, T117)', () => {
  // T158 (deliberately changed, standing rule 13): the Section group's background is the second carrier.
  it('the bundled config has exactly two fields to give it to: cms.Section\'s and cms.SectionGroup\'s background', () => {
    expect(carriers).toEqual(['cms.Section.background', 'cms.SectionGroup.background']);
  });

  it('swaps in the asset picker and keeps the field\'s render and label', () => {
    const background = components['cms.Section']!.fields!['background'] as SectionBackgroundField;
    const swapped = withAdminSectionAssetInput(background);
    expect(swapped.assetInput).toBe(AdminSectionAssetInput);
    expect(swapped.render).toBe(background.render);
    expect(swapped.label).toBe(background.label);
    expect(isSectionBackgroundField(swapped)).toBe(true);
  });

  it('PageBuilderEditor applies it to every section background field, not to a list of names', () => {
    const root = resolve(process.cwd(), '../packages/modules/cms/src/admin');
    const editor = readFileSync(resolve(root, 'components/PageBuilderEditor.tsx'), 'utf8');
    expect(editor).toMatch(/isSectionBackgroundField\(field\) \? withAdminSectionAssetInput\(field\) : field/);
    expect(editor).not.toMatch(/SECTION_FIELD_KEY/);
  });
});
