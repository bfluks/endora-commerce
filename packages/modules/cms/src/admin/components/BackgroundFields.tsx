'use client';

import { useMemo, type ReactElement } from 'react';
import type { Field } from '@puckeditor/core';
import { FieldLabel } from '@puckeditor/core';
import {
  createColorField,
  useFieldText,
  withSharedFieldLabel,
  type PageBuilderFieldTextKey,
  type SectionAssetInputProps,
  type SectionBackgroundField,
} from '@endora-commerce/page-builder-core';
import type { BackgroundKind, BackgroundValue, MediaSourceKind } from '@endora-commerce/page-builder-core';
import { createImageAssetField, createImageUrlField, createVideoAssetField, inputClassName } from '@endora-commerce/page-builder-admin';

/**
 * R17 (T201): the words of this control are the page builder's own field text
 * (the section background's, `pageBuilder.fieldText.section.*` in the `core`
 * bundle), so they read in the admin's language like the section's do.
 */
const KIND_OPTIONS: { label: PageBuilderFieldTextKey; value: BackgroundKind }[] = [
  { label: 'section.background.none', value: 'none' },
  { label: 'section.background.solid', value: 'solid' },
  { label: 'section.background.gradient', value: 'gradient' },
  { label: 'section.background.image', value: 'image' },
  { label: 'section.background.video', value: 'video' },
];

/** R17 (T214): the library first, as every image and video source of the page builder. */
const SOURCE_OPTIONS: { label: PageBuilderFieldTextKey; value: MediaSourceKind }[] = [
  { label: 'section.source.library', value: 'library' },
  { label: 'section.source.url', value: 'url' },
];

/** The source shown: the stored one; with none, the URL when there is one (it renders by URL then), else the library. */
function shownSource(stored: MediaSourceKind | undefined, url: string | undefined): MediaSourceKind {
  if (stored === 'url' || stored === 'library') return stored;
  return typeof url === 'string' && url.trim() !== '' ? 'url' : 'library';
}

const SOLID_COLOR_FIELD = createColorField({ label: 'Color' });
const GRADIENT_FROM_FIELD = createColorField({ label: 'Gradient from' });
const GRADIENT_TO_FIELD = createColorField({ label: 'Gradient to' });
const IMAGE_URL_FIELD = createImageUrlField('Image URL');
const IMAGE_ASSET_FIELD = createImageAssetField('Image');
const VIDEO_URL_FIELD = createImageUrlField('Video URL');
const VIDEO_ASSET_FIELD = createVideoAssetField('Video');

function mergeBackground(value: BackgroundValue | undefined, patch: Partial<BackgroundValue>): BackgroundValue {
  return { kind: 'none', ...value, ...patch };
}

function AdminBackgroundFieldControl({
  value,
  onChange,
  readOnly,
  label,
}: {
  value: BackgroundValue | undefined;
  onChange: (value: BackgroundValue) => void;
  readOnly?: boolean;
  label: string;
}): ReactElement {
  const text = useFieldText();
  const current = useMemo(() => ({ kind: 'none' as const, ...value }), [value]);
  const set = (patch: Partial<BackgroundValue>): void => onChange(mergeBackground(current, patch));
  const imageSource = shownSource(current.imageSource, current.imageUrl);
  const videoSource = shownSource(current.videoSource, current.videoUrl);

  return (
    <FieldLabel label={label} {...(readOnly === true ? { readOnly: true } : {})}>
      <div className="flex flex-col gap-2">
        <select
          className={inputClassName}
          disabled={readOnly === true}
          value={current.kind}
          onChange={(e): void => set({ kind: e.target.value as BackgroundKind })}
        >
          {KIND_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {text(opt.label)}
            </option>
          ))}
        </select>

        {current.kind === 'solid' ? (
          <SOLID_COLOR_FIELD.render
            field={{ ...SOLID_COLOR_FIELD, label: text('section.backgroundColor') }}
            id="pb-bg-solid"
            name="background.color"
            value={current.color ?? 'transparent'}
            onChange={(color): void => set({ color: color ?? 'transparent' })}
            {...(readOnly === true ? { readOnly: true } : {})}
          />
        ) : null}

        {current.kind === 'gradient' ? (
          <div className="flex flex-col gap-2">
            <GRADIENT_FROM_FIELD.render
              field={{ ...GRADIENT_FROM_FIELD, label: text('section.gradientFrom') }}
              id="pb-bg-gradient-from"
              name="background.gradientFrom"
              value={current.gradientFrom ?? '#ffffff'}
              onChange={(color): void => set({ gradientFrom: color ?? '#ffffff' })}
              {...(readOnly === true ? { readOnly: true } : {})}
            />
            <GRADIENT_TO_FIELD.render
              field={{ ...GRADIENT_TO_FIELD, label: text('section.gradientTo') }}
              id="pb-bg-gradient-to"
              name="background.gradientTo"
              value={current.gradientTo ?? '#334155'}
              onChange={(color): void => set({ gradientTo: color ?? '#334155' })}
              {...(readOnly === true ? { readOnly: true } : {})}
            />
            <FieldLabel label={text('section.gradientAngle')} {...(readOnly === true ? { readOnly: true } : {})}>
              <input
                type="number"
                className={inputClassName}
                readOnly={readOnly === true}
                min={0}
                max={360}
                value={current.gradientAngle ?? 135}
                onChange={(e): void => set({ gradientAngle: Number(e.target.value) })}
              />
            </FieldLabel>
          </div>
        ) : null}

        {current.kind === 'image' ? (
          <div className="flex flex-col gap-2">
            <FieldLabel label={text('section.imageSource')} {...(readOnly === true ? { readOnly: true } : {})}>
              <select
                className={inputClassName}
                disabled={readOnly === true}
                value={imageSource}
                onChange={(e): void => set({ imageSource: e.target.value as MediaSourceKind })}
              >
                {SOURCE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {text(opt.label)}
                  </option>
                ))}
              </select>
            </FieldLabel>
            {imageSource === 'library' ? (
              <IMAGE_ASSET_FIELD.render
                field={{ ...IMAGE_ASSET_FIELD, label: text('section.image') }}
                id="pb-bg-image-asset"
                name="background.imageAssetId"
                value={current.imageAssetId ?? ''}
                onChange={(assetId): void => set({ imageAssetId: assetId })}
                {...(readOnly === true ? { readOnly: true } : {})}
              />
            ) : (
              <IMAGE_URL_FIELD.render
                field={{ ...IMAGE_URL_FIELD, label: text('section.imageUrl') }}
                id="pb-bg-image-url"
                name="background.imageUrl"
                value={current.imageUrl ?? ''}
                onChange={(url): void => set({ imageUrl: url })}
                {...(readOnly === true ? { readOnly: true } : {})}
              />
            )}
          </div>
        ) : null}

        {current.kind === 'video' ? (
          <div className="flex flex-col gap-2">
            <FieldLabel label={text('section.videoSource')} {...(readOnly === true ? { readOnly: true } : {})}>
              <select
                className={inputClassName}
                disabled={readOnly === true}
                value={videoSource}
                onChange={(e): void => set({ videoSource: e.target.value as MediaSourceKind })}
              >
                {SOURCE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {text(opt.label)}
                  </option>
                ))}
              </select>
            </FieldLabel>
            {videoSource === 'library' ? (
              <VIDEO_ASSET_FIELD.render
                field={{ ...VIDEO_ASSET_FIELD, label: text('section.video') }}
                id="pb-bg-video-asset"
                name="background.videoAssetId"
                value={current.videoAssetId ?? ''}
                onChange={(assetId): void => set({ videoAssetId: assetId })}
                {...(readOnly === true ? { readOnly: true } : {})}
              />
            ) : (
              <VIDEO_URL_FIELD.render
                field={{ ...VIDEO_URL_FIELD, label: text('section.videoUrl') }}
                id="pb-bg-video-url"
                name="background.videoUrl"
                value={current.videoUrl ?? ''}
                onChange={(url): void => set({ videoUrl: url })}
                {...(readOnly === true ? { readOnly: true } : {})}
              />
            )}
          </div>
        ) : null}
      </div>
    </FieldLabel>
  );
}

export function createAdminBackgroundField(): Field<BackgroundValue, Record<string, unknown>> {
  // R17 (T200): the shared "Background", translated once in the `core` bundle.
  return withSharedFieldLabel('background', {
    type: 'custom',
    label: 'Background',
    render: ({ value, onChange, readOnly, field }): ReactElement => (
      <AdminBackgroundFieldControl
        value={value}
        onChange={onChange}
        {...(readOnly === true ? { readOnly: true } : {})}
        label={field.label ?? 'Background'}
      />
    ),
  } as Field<BackgroundValue, Record<string, unknown>>);
}

const SECTION_IMAGE_ASSET_FIELDS = new Map<string, ReturnType<typeof createImageAssetField>>();
const SECTION_VIDEO_ASSET_FIELDS = new Map<string, ReturnType<typeof createVideoAssetField>>();

/** One field object per label, so a re-render does not hand Puck a new field. */
function sectionAssetField(kind: 'image' | 'video', label: string) {
  const cache = kind === 'image' ? SECTION_IMAGE_ASSET_FIELDS : SECTION_VIDEO_ASSET_FIELDS;
  let field = cache.get(label);
  if (!field) {
    field = kind === 'image' ? createImageAssetField(label) : createVideoAssetField(label);
    cache.set(label, field);
  }
  return field;
}

/**
 * The asset picker as the section background field's asset input
 * (`specs/163-page-builder-marketing-pages/` T033): every asset id a section
 * background stores — image, mobile image, video, mobile video, poster — is
 * picked from the asset library instead of typed.
 */
export function AdminSectionAssetInput({ kind, label, id, value, onChange, readOnly }: SectionAssetInputProps): ReactElement {
  const field = sectionAssetField(kind, label);
  return (
    <field.render
      field={field}
      id={id}
      name={id}
      value={value}
      onChange={(assetId): void => onChange(assetId ?? '')}
      {...(readOnly === true ? { readOnly: true } : {})}
    />
  );
}

/**
 * Gives a section background field the asset picker — keyed on the field, not
 * on a block name (T033); since the owner's ruling of 2026-10-23 only
 * `cms.Section` carries one, as its `background` prop (T117). The field's
 * label and render are kept.
 */
export function withAdminSectionAssetInput(field: SectionBackgroundField): SectionBackgroundField {
  return { ...field, assetInput: AdminSectionAssetInput };
}
