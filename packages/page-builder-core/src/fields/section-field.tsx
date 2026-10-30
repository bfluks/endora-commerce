'use client';

import { useEffect, useRef, useState, type ComponentType, type ReactElement, type ReactNode } from 'react';
import type { CustomField } from '@puckeditor/core';
import { normalizeAnchor } from '@endora-commerce/contracts/page-builder-values';
import { createColorField } from './color-field.js';
import { useFieldText, type FieldText, type PageBuilderFieldTextKey } from './field-text.js';
import { FieldControlLabel } from './field-ui.js';
import { PB_FIELD_HINT_CLASS, PB_FIELD_INPUT_CLASS } from './field-classes.js';
import { PuckFieldLabel } from './puck-field-label.js';
import { ToggleSwitch } from './toggle-field.js';
import { getStoredScope } from '../editor/settings-scope-store.js';
import { useComponentScope } from '../editor/use-component-scope.js';
import { usePageBuilderPuck } from '../editor/use-page-builder-puck.js';
import { PB_RESPONSIVE_METADATA, isResponsiveProp, type SettingsScope } from '../types/responsive.js';
import {
  BACKGROUND_REPEATS,
  BACKGROUND_SIZE_PERCENT_MAX,
  BACKGROUND_SIZE_PX_MAX,
  DESKTOP_FROM_TIERS,
  type BackgroundRepeat,
  type BackgroundSizeKeyword,
  type BackgroundSizeValue,
  type Responsive,
  type RevealSetting,
  type SectionOverlay,
  type SpaceValue,
} from '../types/page-builder-props.js';
import {
  DEFAULT_SECTION_SPACE,
  SECTION_SPACE_FALLBACKS,
  SECTION_SPACE_TOKENS,
  isSpaceToken,
  normalizeSectionBackground,
  type SectionBackgroundValue,
} from '../types/section.js';

/**
 * The custom fields of `cms.Section`'s settings —
 * `specs/163-page-builder-marketing-pages/` research R-8, R-9, data-model
 * §3.4, T117.
 *
 * The settings are the block's own top-level props, one Puck field each, so
 * the editor places them as it places every block's fields: the responsive
 * ones (`spaceTop`, `spaceBottom`, and the plain select `contentPosition` the
 * block declares itself) on its **Responsive** tab, where they edit the
 * breakpoint its scope switcher selects, as `cms.Row`'s fields do; the others
 * (`scheme`, `background`, `width`, `customMaxWidthPx`, `anchor`, `reveal`) on
 * the main tab. The fields below are the ones a plain Puck field cannot be:
 * the composite background, the anchor normalised as it is typed, the reveal
 * with its desktop-only switch, and a spacing token with its Custom px.
 */

/** What the background field hands an asset input: one asset id, image or video. */
export interface SectionAssetInputProps {
  kind: 'image' | 'video';
  /** The control's accessible name. */
  label: string;
  id: string;
  value: string;
  onChange: (assetId: string) => void;
  readOnly?: boolean;
}

/**
 * The section background field. Beyond Puck's custom field it carries, for
 * its own render to read off the `field` Puck hands back:
 *
 * - `sectionBackground` — marks it, so a host finds it by the field, not by a
 *   block or prop name ({@link isSectionBackgroundField});
 * - `assetInput` — the control that picks an asset id. The default is a text
 *   box; the admin swaps in its asset picker (`PageBuilderEditor`).
 */
export type SectionBackgroundField = CustomField<SectionBackgroundValue | undefined> & {
  sectionBackground: true;
  assetInput?: ComponentType<SectionAssetInputProps>;
};

export function isSectionBackgroundField(field: unknown): field is SectionBackgroundField {
  return (
    typeof field === 'object' &&
    field !== null &&
    (field as { type?: unknown }).type === 'custom' &&
    (field as { sectionBackground?: unknown }).sectionBackground === true
  );
}

export interface SectionFieldOptions {
  /** The field's label; the admin translates it from the block's bundle. */
  label: string;
}

/** A spacing value as stored: a token or Custom px, plain or per breakpoint. */
export type SectionSpaceProp = SpaceValue | Responsive<SpaceValue>;

// ── Labels ───────────────────────────────────────────────────────────
//
// Every word is a `useFieldText` key (FR-039): the English lives in
// `field-text.tsx`, the admin answers in the `core` bundle. Each option's key
// is spelled out so the set can be checked against the bundles.

type Keys = Record<string, PageBuilderFieldTextKey>;

const KIND_KEYS: Keys = {
  none: 'section.background.none',
  solid: 'section.background.solid',
  gradient: 'section.background.gradient',
  image: 'section.background.image',
  video: 'section.background.video',
};
const SOURCE_KEYS: Keys = { url: 'section.source.url', library: 'section.source.library' };
const FOCAL_KEYS: Keys = {
  center: 'section.position.center',
  top: 'section.position.top',
  bottom: 'section.position.bottom',
  left: 'section.position.left',
  right: 'section.position.right',
};
const OVERLAY_KEYS: Keys = {
  none: 'section.overlay.none',
  solid: 'section.overlay.solid',
  gradient: 'section.overlay.gradient',
};
const DIRECTION_KEYS: Keys = {
  'to-top': 'section.overlayDirection.to-top',
  'to-bottom': 'section.overlayDirection.to-bottom',
  'to-left': 'section.overlayDirection.to-left',
  'to-right': 'section.overlayDirection.to-right',
};
const REVEAL_KEYS: Keys = { none: 'section.reveal.none', 'fade-up': 'section.reveal.fade-up' };
// T167: an image background's and the decorative layer's size and repeat.
const SIZE_KEYS: Keys = {
  cover: 'section.size.cover',
  contain: 'section.size.contain',
  auto: 'section.size.auto',
  px: 'section.size.px',
  percent: 'section.size.percent',
};
const REPEAT_KEYS: Keys = {
  'no-repeat': 'section.repeat.no-repeat',
  repeat: 'section.repeat.repeat',
  'repeat-x': 'section.repeat.repeat-x',
  'repeat-y': 'section.repeat.repeat-y',
};
// R19C (T263): where the mobile image or video gives way to the desktop one.
const DESKTOP_FROM_KEYS: Keys = {
  tablet: 'section.desktopFrom.tablet',
  desktop: 'section.desktopFrom.desktop',
};
const SIZE_OPTIONS = ['cover', 'contain', 'auto', 'px', 'percent'] as const;
const FOCAL_OPTIONS = ['center', 'top', 'bottom', 'left', 'right'] as const;

/** The size tokens are names of sizes, not words, and stay as they are; `none` and `custom` are words. */
function spaceLabels(text: FieldText): Record<string, string> {
  const labels: Record<string, string> = { none: text('section.space.none'), custom: text('section.space.custom') };
  for (const token of SECTION_SPACE_TOKENS) labels[token] ??= token.toUpperCase();
  return labels;
}

function labelsOf(keys: Keys, text: FieldText): Record<string, string> {
  return Object.fromEntries(Object.entries(keys).map(([value, key]) => [value, text(key)]));
}

const SOLID_COLOR_FIELD = createColorField({ label: 'Background colour' });
const GRADIENT_FROM_FIELD = createColorField({ label: 'Gradient from' });
const GRADIENT_TO_FIELD = createColorField({ label: 'Gradient to' });

/** A partial update in which a key set to `undefined` is removed. */
type Patch<T> = { [K in keyof T]?: T[K] | undefined };

function withoutUndefined<T extends object>(value: Patch<T>): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

// ── Small controls ───────────────────────────────────────────────────

/** A select, labelled above it or — under the field's own label — by its accessible name only. */
function Select({
  label,
  value,
  options,
  labels,
  onChange,
  readOnly,
  inheritLabel,
  hideLabel,
}: {
  label: string;
  value: string;
  options: readonly string[];
  labels: Record<string, string>;
  onChange: (value: string) => void;
  readOnly?: boolean | undefined;
  /** A first, empty option meaning "as the breakpoint below", with this text. */
  inheritLabel?: string | undefined;
  hideLabel?: boolean;
}): ReactElement {
  const select = (
    <select
      aria-label={label}
      className={PB_FIELD_INPUT_CLASS}
      disabled={readOnly === true}
      value={value}
      onChange={(event): void => onChange(event.target.value)}
    >
      {inheritLabel !== undefined ? <option value="">{inheritLabel}</option> : null}
      {options.map((option) => (
        <option key={option} value={option}>
          {labels[option] ?? option}
        </option>
      ))}
    </select>
  );
  return hideLabel ? select : <FieldControlLabel label={label}>{select}</FieldControlLabel>;
}

function NumberInput({
  label,
  value,
  onChange,
  readOnly,
  min = 0,
  max,
  hideLabel,
}: {
  label: string;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  readOnly?: boolean | undefined;
  min?: number;
  max?: number;
  hideLabel?: boolean;
}): ReactElement {
  const input = (
    <input
      aria-label={label}
      type="number"
      className={PB_FIELD_INPUT_CLASS}
      readOnly={readOnly === true}
      min={min}
      {...(max !== undefined ? { max } : {})}
      value={value ?? ''}
      onChange={(event): void => {
        const raw = event.target.value.trim();
        if (raw === '') return onChange(undefined);
        const parsed = Number(raw);
        if (Number.isFinite(parsed)) onChange(Math.max(min, max !== undefined ? Math.min(max, parsed) : parsed));
      }}
    />
  );
  return hideLabel ? input : <FieldControlLabel label={label}>{input}</FieldControlLabel>;
}

function TextInput({
  label,
  value,
  onChange,
  readOnly,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean | undefined;
}): ReactElement {
  return (
    <FieldControlLabel label={label}>
      <input
        aria-label={label}
        className={PB_FIELD_INPUT_CLASS}
        readOnly={readOnly === true}
        value={value}
        onChange={(event): void => onChange(event.target.value)}
      />
    </FieldControlLabel>
  );
}

function Checkbox({
  label,
  checked,
  onChange,
  readOnly,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  readOnly?: boolean | undefined;
}): ReactElement {
  // R17 (T204): the page builder's one true/false control, a switch; the whole row is its target (Fitts's Law).
  return <ToggleSwitch size="sm" label={label} checked={checked} readOnly={readOnly === true} onChange={onChange} />;
}

/** The controls that depend on the one above them, tied to it by a rule on their left (Uniform Connectedness). */
function Dependent({ children }: { children: ReactNode }): ReactElement {
  return (
    <div className="flex min-w-0 flex-col gap-3 border-0 border-l-2 border-solid border-[color:var(--puck-color-border,#dcdcdc)] pl-3">
      {children}
    </div>
  );
}

/** The default asset input: the asset id as text. The admin replaces it with its asset picker. */
function TextAssetInput({ label, id, value, onChange, readOnly }: SectionAssetInputProps): ReactElement {
  return (
    <TextInput
      label={label}
      value={value}
      onChange={(next): void => onChange(next.trim())}
      {...(readOnly === true ? { readOnly: true } : {})}
      key={id}
    />
  );
}

// ── Background size (T167) ───────────────────────────────────────────

type SizeKind = (typeof SIZE_OPTIONS)[number];

function sizeKind(value: BackgroundSizeValue | undefined): SizeKind {
  if (value === undefined || value === null) return 'cover';
  if (typeof value === 'string') return value;
  return 'px' in value ? 'px' : 'percent';
}

/**
 * A background size: `cover` (today's, stored as nothing), `contain`, the
 * natural size, or a width in px or %, with its number beside it.
 */
function BackgroundSizeControl({
  label,
  value,
  onChange,
  readOnly,
}: {
  label: string;
  value: BackgroundSizeValue | undefined;
  onChange: (value: BackgroundSizeValue | undefined) => void;
  readOnly?: boolean | undefined;
}): ReactElement {
  const text = useFieldText();
  const kind = sizeKind(value);
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <Select
        label={label}
        value={kind}
        options={SIZE_OPTIONS}
        labels={labelsOf(SIZE_KEYS, text)}
        onChange={(next): void => {
          if (next === 'px') return onChange({ px: 480 });
          if (next === 'percent') return onChange({ percent: 100 });
          onChange(next === 'cover' ? undefined : (next as BackgroundSizeKeyword));
        }}
        readOnly={readOnly}
      />
      {value !== undefined && typeof value === 'object' && 'px' in value ? (
        <NumberInput
          label={text('section.sizePx', { label })}
          value={value.px}
          min={1}
          max={BACKGROUND_SIZE_PX_MAX}
          onChange={(px): void => onChange({ px: Math.round(px ?? 1) || 1 })}
          readOnly={readOnly}
        />
      ) : null}
      {value !== undefined && typeof value === 'object' && 'percent' in value ? (
        <NumberInput
          label={text('section.sizePercent', { label })}
          value={value.percent}
          min={1}
          max={BACKGROUND_SIZE_PERCENT_MAX}
          onChange={(percent): void => onChange({ percent: percent ?? 100 })}
          readOnly={readOnly}
        />
      ) : null}
    </div>
  );
}

// ── Anchor ───────────────────────────────────────────────────────────

/** The anchor as typed, with its normalised form shown live and stored (R-8, edge case "anchor values"). */
function AnchorInput({
  label,
  value,
  onChange,
  readOnly,
}: {
  label: string;
  value: string | undefined;
  onChange: (anchor: string | undefined) => void;
  readOnly?: boolean | undefined;
}): ReactElement {
  const text = useFieldText();
  const [raw, setRaw] = useState(value ?? '');
  useEffect(() => {
    // Follow an outside change (undo, another editor), not our own write.
    setRaw((current) => (normalizeAnchor(current) === (value ?? '') ? current : (value ?? '')));
  }, [value]);
  const normalized = normalizeAnchor(raw);
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <input
        aria-label={label}
        className={PB_FIELD_INPUT_CLASS}
        readOnly={readOnly === true}
        value={raw}
        placeholder={text('section.anchorPlaceholder')}
        onChange={(event): void => {
          setRaw(event.target.value);
          const next = normalizeAnchor(event.target.value);
          onChange(next === '' ? undefined : next);
        }}
      />
      {normalized !== '' ? <span className={`${PB_FIELD_HINT_CLASS} break-all`}>{text('section.anchorHint', { anchor: normalized })}</span> : null}
    </div>
  );
}

// ── Spacing, per the editor's scope ──────────────────────────────────

const SCOPE_TIERS: readonly SettingsScope[] = ['base', 'tablet', 'desktop'];

function readTier(value: SectionSpaceProp | undefined, scope: SettingsScope): SpaceValue | undefined {
  if (value === undefined || value === null) return undefined;
  if (isResponsiveProp<SpaceValue>(value)) return value[scope];
  return scope === 'base' ? (value as SpaceValue) : undefined;
}

/** What `scope` shows when it sets nothing: the nearest breakpoint below it that does, else the default. */
function inheritedAt(value: SectionSpaceProp | undefined, scope: SettingsScope, fallback: SpaceValue): SpaceValue {
  for (let index = SCOPE_TIERS.indexOf(scope) - 1; index >= 0; index -= 1) {
    const below = readTier(value, SCOPE_TIERS[index]!);
    if (below !== undefined) return below;
  }
  return fallback;
}

/**
 * `value` with `scope` set to `next`, or cleared (`undefined`, a breakpoint
 * above the base going back to inheriting). A value with only its base is
 * stored plain; writing a higher breakpoint first seeds the base with the
 * default spacing, which is what the editor was showing.
 */
function writeTier(
  value: SectionSpaceProp | undefined,
  scope: SettingsScope,
  next: SpaceValue | undefined,
  fallback: SpaceValue,
): SectionSpaceProp | undefined {
  const current: { base?: SpaceValue; tablet?: SpaceValue; desktop?: SpaceValue } =
    value === undefined || value === null
      ? {}
      : isResponsiveProp<SpaceValue>(value)
        ? { ...value }
        : { base: value as SpaceValue };
  if (next === undefined) delete current[scope];
  else current[scope] = next;
  if (current.base === undefined && (current.tablet !== undefined || current.desktop !== undefined)) {
    current.base = fallback;
  }
  if (current.base === undefined) return undefined;
  if (current.tablet === undefined && current.desktop === undefined) return current.base;
  return current as Responsive<SpaceValue>;
}

function spaceText(value: SpaceValue, labels: Record<string, string>): string {
  return isSpaceToken(value) ? (labels[value] ?? value) : `${value.px} px`;
}

/** A token's own size at the breakpoint being edited — what Custom (px) starts from. */
function tokenPx(value: SpaceValue, scope: SettingsScope): number {
  if (!isSpaceToken(value)) return value.px;
  const [mobile, desktop] = SECTION_SPACE_FALLBACKS[value];
  return scope === 'desktop' ? desktop : mobile;
}

/**
 * One spacing control for the breakpoint the editor's scope switcher selects
 * (the Responsive tab's "Scope settings", shared by every responsive field of
 * the component): a token or Custom (px). Above the base, a first option
 * inherits the breakpoint below and says what that is.
 */
function SectionSpaceControl({
  label,
  value,
  onChange,
  readOnly,
  defaultValue,
}: {
  label: string;
  value: SectionSpaceProp | undefined;
  onChange: (value: SectionSpaceProp | undefined) => void;
  readOnly?: boolean | undefined;
  defaultValue: SpaceValue;
}): ReactElement {
  const text = useFieldText();
  const labels = spaceLabels(text);
  const componentId = usePageBuilderPuck((state) => state.selectedItem?.props.id as string | undefined);
  const scope = useComponentScope(componentId);
  // The scope is read again at write time: a change of scope between render and event is the user's latest choice.
  const componentIdRef = useRef(componentId);
  componentIdRef.current = componentId;

  const own = readTier(value, scope);
  const shown = own ?? (scope === 'base' ? defaultValue : undefined);
  const selectValue = shown === undefined ? '' : isSpaceToken(shown) ? shown : 'custom';
  const inherited = scope === 'base' ? undefined : inheritedAt(value, scope, defaultValue);
  const write = (next: SpaceValue | undefined): void =>
    onChange(writeTier(value, getStoredScope(componentIdRef.current), next, defaultValue));

  return (
    <div className="flex min-w-0 items-center gap-2">
      <div className="min-w-0 flex-1">
        <Select
          hideLabel
          label={label}
          value={selectValue}
          options={[...SECTION_SPACE_TOKENS, 'custom']}
          labels={labels}
          {...(inherited !== undefined ? { inheritLabel: text('tier.inheritValue', { value: spaceText(inherited, labels) }) } : {})}
          onChange={(next): void => {
            if (next === '') return write(undefined);
            if (next === 'custom') return write({ px: tokenPx(shown ?? inherited ?? defaultValue, scope) });
            write(next as SpaceValue);
          }}
          readOnly={readOnly}
        />
      </div>
      {selectValue === 'custom' && shown !== undefined && !isSpaceToken(shown) ? (
        <div className="w-20 shrink-0">
          <NumberInput
            hideLabel
            label={text('section.spacePx', { label })}
            value={shown.px}
            max={320}
            onChange={(px): void => write({ px: px ?? 0 })}
            readOnly={readOnly}
          />
        </div>
      ) : null}
    </div>
  );
}

// ── Background ───────────────────────────────────────────────────────

function SectionBackgroundControl({
  label,
  value,
  onChange,
  readOnly,
  assetInput,
  idPrefix,
}: {
  label: string;
  value: SectionBackgroundValue;
  onChange: (value: SectionBackgroundValue) => void;
  readOnly?: boolean | undefined;
  assetInput: ComponentType<SectionAssetInputProps>;
  idPrefix: string;
}): ReactElement {
  const text = useFieldText();
  const AssetInput = assetInput;
  const set = (patch: Patch<SectionBackgroundValue>): void => onChange(withoutUndefined({ ...value, ...patch }));
  const ro = readOnly === true ? { readOnly: true } : {};
  const asset = (kind: 'image' | 'video', assetLabel: string, key: keyof SectionBackgroundValue): ReactElement => (
    <AssetInput
      key={String(key)}
      kind={kind}
      label={assetLabel}
      id={`${idPrefix}-${String(key)}`}
      value={(value[key] as string | undefined) ?? ''}
      onChange={(assetId): void => set({ [key]: assetId === '' ? undefined : assetId } as Patch<SectionBackgroundValue>)}
      {...ro}
    />
  );
  const overlay: SectionOverlay = value.overlay ?? { kind: 'none', strength: 40 };
  const setOverlay = (patch: Patch<SectionOverlay>): void => {
    const next = { ...overlay, ...patch };
    set({ overlay: next.kind === 'none' ? undefined : withoutUndefined(next) });
  };
  const library = (source: 'imageSource' | 'videoSource'): boolean => value[source] === 'library';
  const sources = labelsOf(SOURCE_KEYS, text);
  // R19C (T263): with a mobile image or video, the tier the desktop one starts at; the default (tablet) is stored as nothing.
  const desktopFromSelect = (
    <Select
      label={text('section.desktopFrom')}
      value={value.desktopFrom === 'desktop' ? 'desktop' : 'tablet'}
      options={DESKTOP_FROM_TIERS}
      labels={labelsOf(DESKTOP_FROM_KEYS, text)}
      onChange={(tier): void => set({ desktopFrom: tier === 'desktop' ? 'desktop' : undefined })}
      readOnly={readOnly}
    />
  );

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {/* The kind is the field's first control; the field's label names it. */}
      <Select
        hideLabel
        label={label}
        value={value.kind}
        options={['none', 'solid', 'gradient', 'image', 'video']}
        labels={labelsOf(KIND_KEYS, text)}
        onChange={(kind): void => set({ kind: kind as SectionBackgroundValue['kind'] })}
        readOnly={readOnly}
      />

      {value.kind === 'solid' ? (
        <Dependent>
          <SOLID_COLOR_FIELD.render
            field={{ ...SOLID_COLOR_FIELD, label: text('section.backgroundColor') }}
            id={`${idPrefix}-color`}
            name="background.color"
            value={value.color ?? 'transparent'}
            onChange={(color): void => set({ color: color ?? undefined })}
            {...ro}
          />
        </Dependent>
      ) : null}

      {value.kind === 'gradient' ? (
        <Dependent>
          <GRADIENT_FROM_FIELD.render
            field={{ ...GRADIENT_FROM_FIELD, label: text('section.gradientFrom') }}
            id={`${idPrefix}-gradient-from`}
            name="background.gradientFrom"
            value={value.gradientFrom ?? '#ffffff'}
            onChange={(color): void => set({ gradientFrom: color ?? '#ffffff' })}
            {...ro}
          />
          <GRADIENT_TO_FIELD.render
            field={{ ...GRADIENT_TO_FIELD, label: text('section.gradientTo') }}
            id={`${idPrefix}-gradient-to`}
            name="background.gradientTo"
            value={value.gradientTo ?? '#334155'}
            onChange={(color): void => set({ gradientTo: color ?? '#334155' })}
            {...ro}
          />
          <NumberInput
            label={text('section.gradientAngle')}
            value={value.gradientAngle ?? 135}
            max={360}
            onChange={(angle): void => set({ gradientAngle: angle ?? 135 })}
            readOnly={readOnly}
          />
        </Dependent>
      ) : null}

      {value.kind === 'image' ? (
        <Dependent>
          <Select
            label={text('section.imageSource')}
            value={value.imageSource ?? 'url'}
            options={['url', 'library']}
            labels={sources}
            onChange={(source): void => set({ imageSource: source as 'url' | 'library' })}
            readOnly={readOnly}
          />
          {library('imageSource') ? (
            <>
              {asset('image', text('section.image'), 'imageAssetId')}
              {asset('image', text('section.mobileImage'), 'mobileImageAssetId')}
            </>
          ) : (
            <>
              <TextInput
                label={text('section.imageUrl')}
                value={value.imageUrl ?? ''}
                onChange={(url): void => set({ imageUrl: url || undefined })}
                readOnly={readOnly}
              />
              <TextInput
                label={text('section.mobileImageUrl')}
                value={value.mobileImageUrl ?? ''}
                onChange={(url): void => set({ mobileImageUrl: url || undefined })}
                readOnly={readOnly}
              />
            </>
          )}
          {value.mobileImageAssetId || value.mobileImageUrl ? desktopFromSelect : null}
          <Select
            label={text('section.imagePosition')}
            value={value.position ?? 'center'}
            options={FOCAL_OPTIONS}
            labels={labelsOf(FOCAL_KEYS, text)}
            onChange={(position): void => set({ position: position as SectionBackgroundValue['position'] })}
            readOnly={readOnly}
          />
          <BackgroundSizeControl
            label={text('section.imageSize')}
            value={value.size}
            onChange={(size): void => set({ size })}
            readOnly={readOnly}
          />
          <Select
            label={text('section.imageRepeat')}
            value={value.repeat ?? 'no-repeat'}
            options={BACKGROUND_REPEATS}
            labels={labelsOf(REPEAT_KEYS, text)}
            onChange={(repeat): void => set({ repeat: repeat === 'no-repeat' ? undefined : (repeat as BackgroundRepeat) })}
            readOnly={readOnly}
          />
        </Dependent>
      ) : null}

      {value.kind === 'video' ? (
        <Dependent>
          <Select
            label={text('section.videoSource')}
            value={value.videoSource ?? 'url'}
            options={['url', 'library']}
            labels={sources}
            onChange={(source): void => set({ videoSource: source as 'url' | 'library' })}
            readOnly={readOnly}
          />
          {library('videoSource') ? (
            asset('video', text('section.video'), 'videoAssetId')
          ) : (
            <TextInput
              label={text('section.videoUrl')}
              value={value.videoUrl ?? ''}
              onChange={(url): void => set({ videoUrl: url || undefined })}
              readOnly={readOnly}
            />
          )}
          {asset('video', text('section.mobileVideo'), 'mobileVideoAssetId')}
          {value.mobileVideoAssetId ? desktopFromSelect : null}
          {asset('image', text('section.posterImage'), 'videoPosterAssetId')}
        </Dependent>
      ) : null}

      {value.kind === 'image' || value.kind === 'video' ? (
        <Dependent>
          <Select
            label={text('section.overlay')}
            value={overlay.kind}
            options={['none', 'solid', 'gradient']}
            labels={labelsOf(OVERLAY_KEYS, text)}
            onChange={(kind): void => setOverlay({ kind: kind as SectionOverlay['kind'] })}
            readOnly={readOnly}
          />
          {overlay.kind === 'gradient' ? (
            <Select
              label={text('section.overlayDirection')}
              value={overlay.direction ?? 'to-top'}
              options={['to-top', 'to-bottom', 'to-left', 'to-right']}
              labels={labelsOf(DIRECTION_KEYS, text)}
              onChange={(direction): void => setOverlay({ direction: direction as SectionOverlay['direction'] })}
              readOnly={readOnly}
            />
          ) : null}
          {overlay.kind !== 'none' ? (
            <NumberInput
              label={text('section.overlayStrength')}
              value={overlay.strength}
              max={100}
              onChange={(strength): void => setOverlay({ strength: strength ?? 0 })}
              readOnly={readOnly}
            />
          ) : null}
        </Dependent>
      ) : null}

      <Checkbox
        label={text('section.decorative')}
        checked={value.decorative === true}
        onChange={(checked): void =>
          set(
            checked
              ? { decorative: true }
              : { decorative: undefined, decorativeSize: undefined, decorativeRepeat: undefined, decorativePosition: undefined },
          )
        }
        readOnly={readOnly}
      />
      {value.decorative === true ? (
        <Dependent>
          <BackgroundSizeControl
            label={text('section.decorativeSize')}
            value={value.decorativeSize}
            onChange={(decorativeSize): void => set({ decorativeSize })}
            readOnly={readOnly}
          />
          <Select
            label={text('section.decorativeRepeat')}
            value={value.decorativeRepeat ?? 'no-repeat'}
            options={BACKGROUND_REPEATS}
            labels={labelsOf(REPEAT_KEYS, text)}
            onChange={(repeat): void => set({ decorativeRepeat: repeat === 'no-repeat' ? undefined : (repeat as BackgroundRepeat) })}
            readOnly={readOnly}
          />
          <Select
            label={text('section.decorativePosition')}
            value={value.decorativePosition ?? 'top'}
            options={FOCAL_OPTIONS}
            labels={labelsOf(FOCAL_KEYS, text)}
            onChange={(position): void =>
              set({ decorativePosition: position === 'top' ? undefined : (position as SectionBackgroundValue['decorativePosition']) })
            }
            readOnly={readOnly}
          />
        </Dependent>
      ) : null}
    </div>
  );
}

// ── Reveal ───────────────────────────────────────────────────────────

/** None or fade-and-rise, optionally on desktop only (R-21: the word reveal is a block's own, on its text). */
function RevealControl({
  label,
  value,
  onChange,
  readOnly,
}: {
  label: string;
  value: RevealSetting | undefined;
  onChange: (value: RevealSetting | undefined) => void;
  readOnly?: boolean | undefined;
}): ReactElement {
  const text = useFieldText();
  const on = value !== undefined && value.effect !== 'none';
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <Select
        hideLabel
        label={label}
        value={on ? 'fade-up' : 'none'}
        options={['none', 'fade-up']}
        labels={labelsOf(REVEAL_KEYS, text)}
        onChange={(effect): void =>
          onChange(effect === 'none' ? undefined : { effect: 'fade-up', desktopOnly: value?.desktopOnly === true })
        }
        readOnly={readOnly}
      />
      {on ? (
        <Checkbox
          label={text('section.revealDesktopOnly')}
          checked={value?.desktopOnly === true}
          onChange={(checked): void => onChange({ effect: 'fade-up', desktopOnly: checked })}
          readOnly={readOnly}
        />
      ) : null}
    </div>
  );
}

// ── The fields ───────────────────────────────────────────────────────

/**
 * `background`: solid, gradient, image or video, with art direction, a poster,
 * a mobile video, an overlay, a focal point and the decorative backdrop (R-9).
 * Not responsive: the mobile image and video are its own keys. Writes nothing
 * until an edit, and nothing (`undefined`) when set back to none.
 */
export function createSectionBackgroundField({ label }: SectionFieldOptions): SectionBackgroundField {
  return {
    type: 'custom',
    label,
    sectionBackground: true,
    render: ({ field: handed, value, onChange, readOnly, id }): ReactElement => {
      const own = handed as SectionBackgroundField;
      const shown = own.label ?? label;
      return (
        <PuckFieldLabel label={shown} el="div" {...(readOnly === true ? { readOnly: true } : {})}>
          <SectionBackgroundControl
            label={shown}
            value={normalizeSectionBackground(value)}
            onChange={(background): void =>
              onChange(background.kind === 'none' && !background.decorative ? undefined : background)
            }
            readOnly={readOnly}
            assetInput={own.assetInput ?? TextAssetInput}
            idPrefix={`${id}-background`}
          />
        </PuckFieldLabel>
      );
    },
  };
}

/** `anchor`: normalised as it is typed, the normalised form shown and stored (R-8); empty is none. */
export function createSectionAnchorField({ label }: SectionFieldOptions): CustomField<string | undefined> {
  return {
    type: 'custom',
    label,
    render: ({ field: handed, value, onChange, readOnly }): ReactElement => {
      const shown = handed.label ?? label;
      return (
        <PuckFieldLabel label={shown} el="div" {...(readOnly === true ? { readOnly: true } : {})}>
          <AnchorInput label={shown} value={value} onChange={(anchor): void => onChange(anchor)} readOnly={readOnly} />
        </PuckFieldLabel>
      );
    },
  };
}

/** `reveal`: the section's entrance reveal (R-21). */
export function createSectionRevealField({ label }: SectionFieldOptions): CustomField<RevealSetting | undefined> {
  return {
    type: 'custom',
    label,
    render: ({ field: handed, value, onChange, readOnly }): ReactElement => {
      const shown = handed.label ?? label;
      return (
        <PuckFieldLabel label={shown} el="div" {...(readOnly === true ? { readOnly: true } : {})}>
          <RevealControl label={shown} value={value} onChange={(next): void => onChange(next)} readOnly={readOnly} />
        </PuckFieldLabel>
      );
    },
  };
}

/** `createSectionSpaceField`'s options: the label, and what shows until a value is set. */
export interface SectionSpaceFieldOptions extends SectionFieldOptions {
  /** Shown, inherited and seeded until a value is set; `'l'` (the section spacing) unless given — `'none'` for the overlap (T148). */
  defaultValue?: SpaceValue;
}

/**
 * `spaceTop` / `spaceBottom` (and `overlap`, T148): a spacing token or Custom (px), per breakpoint.
 * A **responsive** field: it carries the responsive metadata, so the editor
 * shows it on the Responsive tab, and it edits the breakpoint that tab's scope
 * switcher selects (`useComponentScope`), as every responsive field does.
 * The default (`'l'`, or `defaultValue`) shows until a value is set; nothing is written until an edit.
 */
export function createSectionSpaceField({
  label,
  defaultValue = DEFAULT_SECTION_SPACE,
}: SectionSpaceFieldOptions): CustomField<SectionSpaceProp | undefined> {
  return {
    type: 'custom',
    label,
    metadata: PB_RESPONSIVE_METADATA,
    render: ({ field: handed, value, onChange, readOnly }): ReactElement => {
      const shown = handed.label ?? label;
      return (
        <PuckFieldLabel label={shown} el="div" {...(readOnly === true ? { readOnly: true } : {})}>
          <SectionSpaceControl
            label={shown}
            value={value}
            onChange={(next): void => onChange(next)}
            readOnly={readOnly}
            defaultValue={defaultValue}
          />
        </PuckFieldLabel>
      );
    },
  };
}

/**
 * Whether a block whose `resolveFields` / `resolveData` received `parent` sits
 * at the top level of the page. Puck hands a block in the root zone the root
 * node itself (`{ type: 'root', props: { id: 'root' } }`) as its parent, and
 * `null` only where it resolves outside its store (`resolveAllData`).
 */
export function isTopLevelParent(parent: unknown): boolean {
  if (parent === null || parent === undefined) return true;
  return typeof parent === 'object' && (parent as { type?: unknown }).type === 'root';
}
