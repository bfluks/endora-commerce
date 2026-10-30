'use client';

import { useMemo, type ReactElement } from 'react';
import type { Field } from '@puckeditor/core';
import { createColorField } from './color-field.js';
import { normalizeBackground, type BackgroundKind, type BackgroundProp, type BackgroundValue, type MediaSourceKind } from '../types/background.js';
import { PB_FIELD_INPUT_CLASS, PB_FIELD_LABEL_CLASS } from './field-classes.js';
import { useFieldText, type PageBuilderFieldTextKey } from './field-text.js';

const inputClassName = PB_FIELD_INPUT_CLASS;

// R17 (T201): the words are the section background's field text, translated by the host.
const KIND_OPTIONS: { label: PageBuilderFieldTextKey; value: BackgroundKind }[] = [
  { label: 'section.background.none', value: 'none' },
  { label: 'section.background.solid', value: 'solid' },
  { label: 'section.background.gradient', value: 'gradient' },
  { label: 'section.background.image', value: 'image' },
  { label: 'section.background.video', value: 'video' },
];

// R17 (T214): the library first, as every image and video source of the page builder.
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

function mergeBackground(value: BackgroundValue | undefined, patch: Partial<BackgroundValue>): BackgroundValue {
  return { kind: 'none', ...value, ...patch };
}

function BackgroundFieldControl({
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
  const imageSource = shownSource(current.imageSource, current.imageUrl);
  const videoSource = shownSource(current.videoSource, current.videoUrl);

  const set = (patch: Partial<BackgroundValue>): void => onChange(mergeBackground(current, patch));

  return (
    <div className="flex flex-col gap-2">
      <label className={PB_FIELD_LABEL_CLASS}>{label}</label>
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
          <label className={PB_FIELD_LABEL_CLASS}>{text('section.gradientAngle')}</label>
          <input
            type="number"
            className={inputClassName}
            readOnly={readOnly === true}
            min={0}
            max={360}
            value={current.gradientAngle ?? 135}
            onChange={(e): void => set({ gradientAngle: Number(e.target.value) })}
          />
        </div>
      ) : null}

      {current.kind === 'image' ? (
        <div className="flex flex-col gap-2">
          <label className={PB_FIELD_LABEL_CLASS}>{text('section.imageSource')}</label>
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
          {imageSource === 'library' ? (
            <input
              className={inputClassName}
              readOnly={readOnly === true}
              value={current.imageAssetId ?? ''}
              aria-label={text('section.image')}
              onChange={(e): void => set({ imageAssetId: e.target.value })}
            />
          ) : (
            <input
              className={inputClassName}
              readOnly={readOnly === true}
              value={current.imageUrl ?? ''}
              aria-label={text('section.imageUrl')}
              onChange={(e): void => set({ imageUrl: e.target.value })}
            />
          )}
        </div>
      ) : null}

      {current.kind === 'video' ? (
        <div className="flex flex-col gap-2">
          <label className={PB_FIELD_LABEL_CLASS}>{text('section.videoSource')}</label>
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
          {videoSource === 'library' ? (
            <input
              className={inputClassName}
              readOnly={readOnly === true}
              value={current.videoAssetId ?? ''}
              aria-label={text('section.video')}
              onChange={(e): void => set({ videoAssetId: e.target.value })}
            />
          ) : (
            <input
              className={inputClassName}
              readOnly={readOnly === true}
              value={current.videoUrl ?? ''}
              aria-label={text('section.videoUrl')}
              onChange={(e): void => set({ videoUrl: e.target.value })}
            />
          )}
        </div>
      ) : null}
    </div>
  );
}

export function createBackgroundField(options: { label?: string } = {}): Field<BackgroundProp> {
  const label = options.label ?? 'Background';
  return {
    type: 'custom',
    label,
    render: ({ value, onChange, readOnly, field }): ReactElement => (
      <BackgroundFieldControl
        value={normalizeBackground(value)}
        onChange={(next): void => onChange(next)}
        {...(readOnly === true ? { readOnly: true } : {})}
        label={field.label ?? label}
      />
    ),
  };
}

export { BackgroundFieldControl };
