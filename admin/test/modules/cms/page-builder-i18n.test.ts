import { describe, expect, it } from 'vitest';
import type { Config } from '@puckeditor/core';
import { applyPageBuilderTranslations } from '../../../../packages/modules/cms/src/admin/components/page-builder-i18n';

/**
 * Feature 096, T306 — **category titles are no longer this function's job.**
 *
 * A section's `titleKey` belongs to whichever module's declaration won the merge
 * (`contracts/block-definition.md` §1.1), so it is resolved in that module's
 * scope where the palette is derived. Translating it a second time in `cms`'
 * scope would either be a no-op or would overwrite the right answer with a
 * placeholder.
 */
describe('applyPageBuilderTranslations', () => {
  it('translates a component label through the legacy cms-scoped key', () => {
    const config = {
      components: {
        'cms.Row': { label: 'Row', fields: {}, defaultProps: {}, render: () => null },
      },
      categories: { layout: { title: 'Layout', components: ['cms.Row'] } },
    } as unknown as Config;

    const t = (key: string): string =>
      key === 'pageBuilder.components.cms.Row' ? 'Wiersz' : `cms.${key}`;

    const next = applyPageBuilderTranslations(config, t);
    expect(next.components?.['cms.Row']?.label).toBe('Wiersz');
    // Untouched — whatever the palette derivation resolved is what renders.
    expect(next.categories?.['layout']?.title).toBe('Layout');
  });

  it('prefers the declared label resolver over the legacy key', () => {
    // The declaring module's own `labelKey`, resolved in the declaring module's
    // scope. This is what makes `catalog.ProductGrid`'s label come out of
    // `catalog`'s bundle rather than out of `cms`'.
    const config = {
      components: {
        'catalog.ProductGrid': { label: 'Product grid', fields: {}, defaultProps: {}, render: () => null },
      },
    } as unknown as Config;

    const next = applyPageBuilderTranslations(
      config,
      (key) => `cms.${key}`,
      (name) => (name === 'catalog.ProductGrid' ? 'Siatka produktów' : undefined),
    );
    expect(next.components?.['catalog.ProductGrid']?.label).toBe('Siatka produktów');
  });

  it('keeps the English fallback when neither resolver has the key', () => {
    const config = {
      components: {
        'cms.Hero': { label: 'Hero / CTA banner', fields: {}, defaultProps: {}, render: () => null },
      },
      categories: {},
    } as unknown as Config;

    const next = applyPageBuilderTranslations(config, (key) => `cms.${key}`, () => undefined);
    expect(next.components?.['cms.Hero']?.label).toBe('Hero / CTA banner');
  });

  // Feature 163, T133: a list whose item is one choice (the hero's order of
  // elements) summarises each item by that choice's label, in the admin's language.
  it('summarises an item of a one-choice list by its translated option label', () => {
    const config = {
      components: {
        'cms.Hero': {
          label: 'Hero',
          fields: {
            order: {
              type: 'array',
              label: 'Order of elements',
              arrayFields: {
                element: {
                  type: 'select',
                  label: 'Element',
                  options: [
                    { label: 'Title', value: 'title' },
                    { label: 'Buttons', value: 'buttons' },
                  ],
                },
              },
              getItemSummary: (item: { element?: string }) => (item.element === 'title' ? 'Title' : 'Buttons'),
            },
          },
          defaultProps: {},
          render: () => null,
        },
      },
    } as unknown as Config;
    const labels: Record<string, string> = {
      'fields.order.fields.element.options.title': 'Tytuł',
      'fields.order.fields.element.options.buttons': 'Przyciski',
    };
    const next = applyPageBuilderTranslations(config, (key) => `cms.${key}`, () => undefined, (_name, key) => labels[key]);
    const order = (next.components?.['cms.Hero']?.fields as Record<string, { getItemSummary?: (item: unknown, index?: number) => string }>)[
      'order'
    ]!;
    expect(order.getItemSummary?.({ element: 'buttons' }, 0)).toBe('Przyciski');
    expect(order.getItemSummary?.({ element: 'title' }, 1)).toBe('Tytuł');
    // A value with no option falls back to the block's own summary.
    expect(order.getItemSummary?.({ element: 'other' }, 2)).toBe('Buttons');
  });

  // Feature 163, T145: a list of several fields that names its summary field
  // (`metadata.pageBuilder.summaryField`, the hero's space after an element) is summarised by
  // that select's translated option label too.
  it('summarises an item by the select its list names as the summary field', () => {
    const config = {
      components: {
        'cms.Hero': {
          label: 'Hero',
          fields: {
            spaceAfter: {
              type: 'array',
              label: 'Space after an element',
              metadata: { pageBuilder: { summaryField: 'element' } },
              arrayFields: {
                element: { type: 'select', label: 'Element', options: [{ label: 'Statement', value: 'statement' }] },
                space: { type: 'select', label: 'Space', options: [{ label: 'L', value: 'l' }] },
                spacePx: { type: 'number', label: 'Custom space (px)' },
              },
              getItemSummary: () => 'Statement',
            },
            other: {
              type: 'array',
              label: 'Other',
              arrayFields: {
                element: { type: 'select', label: 'Element', options: [{ label: 'Statement', value: 'statement' }] },
                note: { type: 'text', label: 'Note' },
              },
              getItemSummary: () => 'Own',
            },
          },
          defaultProps: {},
          render: () => null,
        },
      },
    } as unknown as Config;
    const labels: Record<string, string> = {
      'fields.spaceAfter.fields.element.options.statement': 'Wyróżnienie',
      'fields.other.fields.element.options.statement': 'Wyróżnienie',
    };
    const next = applyPageBuilderTranslations(config, (key) => `cms.${key}`, () => undefined, (_name, key) => labels[key]);
    const fields = next.components?.['cms.Hero']?.fields as Record<string, { getItemSummary?: (item: unknown, index?: number) => string }>;
    expect(fields['spaceAfter']!.getItemSummary?.({ element: 'statement', space: 'l' }, 0)).toBe('Wyróżnienie');
    // A list of several fields that names no summary field keeps the block's own summary.
    expect(fields['other']!.getItemSummary?.({ element: 'statement' }, 0)).toBe('Own');
  });

  // R17 (T200): a field the page builder owns is translated once, from the `core` bundle.
  describe('shared fields (R17, T200)', () => {
    const margin = { type: 'custom', label: 'Outer spacing', metadata: { pageBuilder: { responsive: true, sharedLabel: { key: 'margin', en: 'Outer spacing' } } }, render: () => null };
    const corners = {
      type: 'select',
      label: 'Rounded corners',
      metadata: { pageBuilder: { sharedLabel: { key: 'cornerRadius', en: 'Rounded corners' } } },
      options: [{ label: 'None', value: 'none' }, { label: 'Small', value: 'small' }],
    };
    const config = {
      components: {
        'cms.Image': {
          label: 'Image',
          fields: { margin, cornerRadius: corners, frame: { ...corners, label: 'Image – rounded corners' }, alt: { type: 'text', label: 'Alt text' } },
          resolveFields: (_data: unknown, params: { fields: Record<string, unknown> }) => params.fields,
          render: () => null,
        },
      },
    } as unknown as Config;
    const shared: Record<string, string> = {
      'margin.label': 'Odstęp zewnętrzny',
      'cornerRadius.label': 'Zaokrąglone narożniki',
      'cornerRadius.options.none': 'Brak',
      'cornerRadius.options.small': 'Małe',
    };
    const block: Record<string, string> = { 'fields.alt.label': 'Tekst alternatywny', 'fields.cornerRadius.options.small': 'Niewielkie' };
    const translated = applyPageBuilderTranslations(
      config,
      (key) => `cms.${key}`,
      () => undefined,
      (_name, key) => block[key],
      (key) => shared[key],
    );
    const fields = translated.components['cms.Image']!.fields as Record<string, { label?: string; options?: Array<{ label: string }> }>;

    it('reads the shared key after the block\'s own and before the English', () => {
      expect(fields['margin']?.label).toBe('Odstęp zewnętrzny');
      expect(fields['cornerRadius']?.label).toBe('Zaokrąglone narożniki');
      expect(fields['cornerRadius']?.options?.map((option) => option.label)).toEqual(['Brak', 'Niewielkie']);
      expect(fields['alt']?.label).toBe('Tekst alternatywny');
    });

    it('does not use the shared key for a shared field a block relabelled', () => {
      expect(fields['frame']?.label).toBe('Image – rounded corners');
    });

    it('hands back the same translated field object each time', async () => {
      const component = translated.components['cms.Image']!;
      const params = { fields: config.components['cms.Image']!.fields } as never;
      const first = (await component.resolveFields!({ props: {} } as never, params)) as Record<string, unknown>;
      const second = (await component.resolveFields!({ props: {} } as never, params)) as Record<string, unknown>;
      expect(first['margin']).toBe(second['margin']);
    });

    it('translates the options a custom field carries (the item open at first)', () => {
      const withCustom = applyPageBuilderTranslations(
        {
          components: {
            'cms.Accordion': {
              label: 'Accordion',
              fields: { defaultOpen: { type: 'custom', label: 'Item open at first', options: [{ label: 'None', value: 'none' }, { label: '1: FAQ', value: 0 }], render: () => null } },
              render: () => null,
            },
          },
        } as unknown as Config,
        (key) => `cms.${key}`,
        () => undefined,
        (_name, key) => ({ 'fields.defaultOpen.label': 'Element otwarty na początku', 'fields.defaultOpen.options.none': 'Żaden' })[key],
      );
      const field = (withCustom.components['cms.Accordion']!.fields as Record<string, { label?: string; options?: Array<{ label: string }> }>)['defaultOpen'];
      expect(field?.label).toBe('Element otwarty na początku');
      expect(field?.options?.map((option) => option.label)).toEqual(['Żaden', '1: FAQ']);
    });
  });
});
