'use client';

import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { FieldLabel, type CustomField } from '@puckeditor/core';
import {
  PB_FIELD_INPUT_CLASS,
  PB_FIELD_LABEL_CLASS,
  ResponsiveTiers,
  ASPECT_TOKENS,
  FOCAL_TOKENS,
  isAspectToken,
  isResponsiveProp,
  normalizeResponsive,
  type FocalToken,
  type Responsive,
  type ResponsiveImage,
} from '@endora-commerce/page-builder-core';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { AssetModalFieldControl } from './AssetPickers.js';

/**
 * The `ResponsiveImage` field (`specs/163-page-builder-marketing-pages/`
 * research R-9, data-model §3.3): a desktop image and an optional mobile image,
 * each from a URL or the asset library, the alternative text, an aspect ratio
 * per breakpoint (a preset or a custom `w:h`), the fit and the focal point.
 * `Picture` in `cms-components` renders what it writes.
 */

/** The page builder's field input class (feature 163, T116: Puck's own class name went stale in 0.23). */
const inputClassName = PB_FIELD_INPUT_CLASS;

/** `''` in a tier select means "inherit from the tier below"; `custom` reveals the `w:h` input. */
const INHERIT = '';
const CUSTOM = 'custom';

const FOCAL_LABEL_KEYS: Record<FocalToken, string> = {
  center: 'pageBuilder.imageField.position.center',
  top: 'pageBuilder.imageField.position.top',
  bottom: 'pageBuilder.imageField.position.bottom',
  left: 'pageBuilder.imageField.position.left',
  right: 'pageBuilder.imageField.position.right',
};

type Tier = 'base' | 'tablet' | 'desktop';

const TIER_LABEL_KEYS: Record<Tier, string> = {
  base: 'pageBuilder.imageField.ratio',
  tablet: 'pageBuilder.imageField.ratioTablet',
  desktop: 'pageBuilder.imageField.ratioDesktop',
};

function Labelled({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className={PB_FIELD_LABEL_CLASS}>{label}</span>
      {children}
    </label>
  );
}

/**
 * R17 (T214): the source an image is edited with — the stored one; with none,
 * the URL when it has one (a stored image renders by URL then), else the
 * library, where a new image starts.
 */
export function responsiveImageSource(image: Partial<ResponsiveImage>): 'url' | 'library' {
  if (image.imageSource === 'url' || image.imageSource === 'library') return image.imageSource;
  const filled = (value: unknown): boolean => typeof value === 'string' && value.trim() !== '';
  return filled(image.src) || filled(image.mobileSrc) ? 'url' : 'library';
}

/** Drop the keys whose value is `undefined` or `''`, so the stored object holds only what was set. */
function compact(image: Partial<ResponsiveImage>): ResponsiveImage {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(image)) {
    if (value !== undefined && value !== '') out[key] = value;
  }
  return { imageSource: responsiveImageSource(image), alt: '', ...out } as ResponsiveImage;
}

function RatioControl({
  tier,
  value,
  onChange,
  readOnly,
  defaultRatio = 'auto',
  allowAuto = true,
}: {
  tier: Tier;
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  readOnly?: boolean | undefined;
  /** What the base shows until a value is set. */
  defaultRatio?: string;
  /** Whether `auto` (the medium's own ratio) is offered; a video frame has none. */
  allowAuto?: boolean;
}): ReactElement {
  // The breakpoint switch above it shows the label once (T116); the select
  // keeps the breakpoint's full name as its accessible name.
  const t = useTranslation('core');
  const tokens = allowAuto ? ASPECT_TOKENS : ASPECT_TOKENS.filter((token) => token !== 'auto');
  const isPreset = value === undefined || (ASPECT_TOKENS as readonly string[]).includes(value);
  const [customOpen, setCustomOpen] = useState(!isPreset);
  const [draft, setDraft] = useState(isPreset ? '' : (value ?? ''));

  useEffect(() => {
    if (value !== undefined && !(ASPECT_TOKENS as readonly string[]).includes(value)) {
      setCustomOpen(true);
      setDraft(value);
    }
  }, [value]);

  const selected = customOpen ? CUSTOM : (value ?? (tier === 'base' ? defaultRatio : INHERIT));

  return (
    <div className="space-y-1">
      <select
        aria-label={t(TIER_LABEL_KEYS[tier])}
        className={inputClassName}
        disabled={readOnly === true}
        value={selected}
        onChange={(e): void => {
          const next = e.target.value;
          if (next === CUSTOM) {
            setCustomOpen(true);
            return;
          }
          setCustomOpen(false);
          onChange(next === INHERIT ? undefined : next);
        }}
      >
        {tier !== 'base' ? <option value={INHERIT}>{t('pageBuilder.imageField.ratio.inherit')}</option> : null}
        {tokens.map((token) => (
          <option key={token} value={token}>
            {token === 'auto' ? t('pageBuilder.imageField.ratio.auto') : token}
          </option>
        ))}
        <option value={CUSTOM}>{t('pageBuilder.imageField.ratio.custom')}</option>
      </select>
      {customOpen ? (
        <Labelled label={t('pageBuilder.imageField.customRatio')}>
          <input
            type="text"
            className={inputClassName}
            readOnly={readOnly === true}
            value={draft}
            onChange={(e): void => {
              const next = e.target.value.trim();
              setDraft(next);
              if (isAspectToken(next)) onChange(next);
            }}
          />
        </Labelled>
      ) : null}
    </div>
  );
}

/** The ratio's three tiers, written back as a plain value when only the base is set. */
function writeRatio(tiers: Record<Tier, string | undefined>): Responsive<string> | undefined {
  const { base, tablet, desktop } = tiers;
  if (base === undefined && tablet === undefined && desktop === undefined) return undefined;
  if (tablet === undefined && desktop === undefined) return base;
  return {
    base: base ?? 'auto',
    ...(tablet !== undefined ? { tablet } : {}),
    ...(desktop !== undefined ? { desktop } : {}),
  };
}

function readRatio(ratio: Responsive<string> | undefined): Record<Tier, string | undefined> {
  if (ratio === undefined) return { base: undefined, tablet: undefined, desktop: undefined };
  // A value stored without `base` (T170) leaves the base unset: it shows the default ratio.
  if (isResponsiveProp<string>(ratio)) return { base: ratio.base, tablet: ratio.tablet, desktop: ratio.desktop };
  const responsive = normalizeResponsive<string>(ratio as Responsive<string>, 'auto');
  return { base: responsive.base, tablet: responsive.tablet, desktop: responsive.desktop };
}

export interface ResponsiveRatioControlProps {
  value: Responsive<string> | undefined;
  onChange: (value: Responsive<string> | undefined) => void;
  readOnly?: boolean | undefined;
  /** The control's label; the image field's "Aspect ratio" when not given. */
  label?: string;
  /** What the base shows until a value is set (`auto` for an image). */
  defaultRatio?: string;
  /** Whether `auto` is offered; a video frame has no ratio of its own. */
  allowAuto?: boolean;
}

/**
 * An aspect ratio per breakpoint inside a composite field — the image
 * field's, and since T126 a video frame's (the hero's media, a media-and-text
 * video). A nested value keeps the in-field Mobile / Tablet / Desktop switch
 * (T118): Puck gives a field one tab, so it cannot sit on the Responsive tab.
 */
export function ResponsiveRatioControl({
  value,
  onChange,
  readOnly,
  label,
  defaultRatio = 'auto',
  allowAuto = true,
}: ResponsiveRatioControlProps): ReactElement {
  const t = useTranslation('core');
  const ratio = readRatio(value);
  return (
    <ResponsiveTiers
      label={label ?? t('pageBuilder.imageField.ratio')}
      isSet={(tier): boolean => tier !== 'base' && ratio[tier] !== undefined}
      renderTier={(tier): ReactNode => (
        <RatioControl
          tier={tier}
          value={ratio[tier]}
          readOnly={readOnly}
          defaultRatio={defaultRatio}
          allowAuto={allowAuto}
          onChange={(next): void => onChange(writeRatio({ ...ratio, [tier]: next }))}
        />
      )}
    />
  );
}

function ImageSourceInputs({
  source,
  url,
  assetId,
  urlLabel,
  assetLabel,
  onUrl,
  onAsset,
  readOnly,
}: {
  source: 'url' | 'library';
  url: string;
  assetId: string;
  urlLabel: string;
  assetLabel: string;
  onUrl: (url: string) => void;
  onAsset: (assetId: string) => void;
  readOnly?: boolean | undefined;
}): ReactElement {
  const t = useTranslation('core');
  if (source === 'library') {
    return (
      <AssetModalFieldControl
        value={assetId}
        label={assetLabel}
        acceptMimePrefix="image/"
        modalTitle={t('pageBuilder.imageField.selectImage')}
        {...(readOnly === true ? { readOnly: true } : {})}
        onChange={onAsset}
      />
    );
  }
  return (
    <Labelled label={urlLabel}>
      <input
        type="text"
        className={inputClassName}
        readOnly={readOnly === true}
        value={url}
        placeholder={t('pageBuilder.linkField.urlPlaceholder')}
        onChange={(e): void => onUrl(e.target.value)}
      />
    </Labelled>
  );
}

export interface ResponsiveImageControlProps {
  value: Partial<ResponsiveImage> | undefined;
  onChange: (value: ResponsiveImage) => void;
  readOnly?: boolean | undefined;
}

export function ResponsiveImageControl({ value, onChange, readOnly }: ResponsiveImageControlProps): ReactElement {
  const t = useTranslation('core');
  const image: Partial<ResponsiveImage> = value ?? {};
  const source = responsiveImageSource(image);

  const update = (patch: Partial<ResponsiveImage>): void => onChange(compact({ ...image, ...patch }));

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <Labelled label={t('pageBuilder.imageField.source')}>
        <select
          className={inputClassName}
          disabled={readOnly === true}
          value={source}
          onChange={(e): void => update({ imageSource: e.target.value as 'url' | 'library' })}
        >
          <option value="library">{t('pageBuilder.imageField.source.library')}</option>
          <option value="url">{t('pageBuilder.imageField.source.url')}</option>
        </select>
      </Labelled>
      <ImageSourceInputs
        source={source}
        url={image.src ?? ''}
        assetId={image.assetId ?? ''}
        urlLabel={t('pageBuilder.imageField.imageUrl')}
        assetLabel={t('pageBuilder.imageField.image')}
        readOnly={readOnly}
        onUrl={(src): void => update({ src })}
        onAsset={(assetId): void => update({ assetId })}
      />
      <ImageSourceInputs
        source={source}
        url={image.mobileSrc ?? ''}
        assetId={image.mobileAssetId ?? ''}
        urlLabel={t('pageBuilder.imageField.mobileImageUrl')}
        assetLabel={t('pageBuilder.imageField.mobileImage')}
        readOnly={readOnly}
        onUrl={(mobileSrc): void => update({ mobileSrc })}
        onAsset={(mobileAssetId): void => update({ mobileAssetId })}
      />
      <Labelled label={t('pageBuilder.imageField.alt')}>
        <input
          type="text"
          className={inputClassName}
          readOnly={readOnly === true}
          value={image.alt ?? ''}
          onChange={(e): void => update({ alt: e.target.value })}
        />
      </Labelled>
      <ResponsiveRatioControl value={image.ratio} readOnly={readOnly} onChange={(written): void => update({ ratio: written })} />
      <Labelled label={t('pageBuilder.imageField.fit')}>
        <select
          className={inputClassName}
          disabled={readOnly === true}
          value={image.fit ?? 'cover'}
          onChange={(e): void => update({ fit: e.target.value as 'cover' | 'contain' })}
        >
          <option value="cover">{t('pageBuilder.imageField.fit.cover')}</option>
          <option value="contain">{t('pageBuilder.imageField.fit.contain')}</option>
        </select>
      </Labelled>
      <Labelled label={t('pageBuilder.imageField.position')}>
        <select
          className={inputClassName}
          disabled={readOnly === true}
          value={image.position ?? 'center'}
          onChange={(e): void => update({ position: e.target.value as FocalToken })}
        >
          {FOCAL_TOKENS.map((token) => (
            <option key={token} value={token}>
              {t(FOCAL_LABEL_KEYS[token])}
            </option>
          ))}
        </select>
      </Labelled>
    </div>
  );
}

/** A Puck field holding one `ResponsiveImage`. */
export function createResponsiveImageField(options?: { label?: string }): CustomField<Partial<ResponsiveImage> | undefined> {
  const fallbackLabel = options?.label ?? 'Image';
  return {
    type: 'custom',
    label: fallbackLabel,
    render: ({ value, onChange, readOnly, field }): ReactElement => (
      <FieldLabel label={field.label ?? fallbackLabel} el="div" {...(readOnly === true ? { readOnly: true } : {})}>
        <div role="group" aria-label={field.label ?? fallbackLabel} className="min-w-0">
          <ResponsiveImageControl value={value} onChange={onChange} readOnly={readOnly} />
        </div>
      </FieldLabel>
    ),
  };
}
