// @vitest-environment jsdom
import { renderToString } from 'react-dom/server';
import type { ComponentConfig, CustomField } from '@puckeditor/core';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { defaultPageBuilderConfig } from '../index.js';

vi.hoisted(() => {
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
});

/**
 * `specs/163-page-builder-marketing-pages/` R18 (T222) — a new `cms.Icons` /
 * `cms.Social` stores `currentColor` (T216: it follows the section's text);
 * its colour field shows that as "Inherited (text color)" and offers
 * **Inherit** once a colour is picked. Any other colour field is unchanged.
 */

function colorField(block: string, name = 'color'): CustomField<string | undefined> {
  return (defaultPageBuilderConfig.components[block] as ComponentConfig).fields?.[name] as CustomField<string | undefined>;
}

function markup(field: CustomField<string | undefined>, value: string | undefined): string {
  const render = field.render as unknown as (props: Record<string, unknown>) => ReactElement;
  return renderToString(render({ field, name: 'color', id: 'color', value, onChange: () => undefined }));
}

describe('an icon\'s colour inherits the text colour (R18, T222)', () => {
  it.each(['cms.Icons', 'cms.Social'])('%s: `currentColor` reads as inherited, a picked colour offers Inherit', (block) => {
    const field = colorField(block);
    const inherited = markup(field, 'currentColor');
    expect(inherited).toContain('placeholder="Inherited (text color)"');
    expect(inherited).not.toContain('value="currentColor"');
    expect(inherited).not.toContain('>Inherit<');
    expect(markup(field, '#1d4ed8')).toContain('>Inherit<');
  });

  it('another colour field keeps its empty state and offers no Inherit action', () => {
    const html = markup(colorField('cms.AnnouncementBar', 'backgroundColor'), '#1d4ed8');
    expect(html).not.toContain('>Inherit<');
    expect(markup(colorField('cms.AnnouncementBar', 'backgroundColor'), undefined)).toContain('placeholder="transparent"');
  });
});
