'use client';

import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { CustomField } from '@puckeditor/core';
import { ASPECT_TOKENS, isAspectToken } from '@endora-commerce/contracts/page-builder-values';
import { useFieldText } from './field-text.js';
import { PB_FIELD_INPUT_CLASS } from './field-classes.js';
import { PuckFieldLabel } from './puck-field-label.js';
import { getStoredScope } from '../editor/settings-scope-store.js';
import { useComponentScope } from '../editor/use-component-scope.js';
import { usePageBuilderPuck } from '../editor/use-page-builder-puck.js';
import { PB_RESPONSIVE_METADATA, isResponsiveProp, type SettingsScope } from '../types/responsive.js';
import type { Responsive } from '../types/page-builder-props.js';

/**
 * An aspect ratio per breakpoint as a block's own top-level prop —
 * `specs/163-page-builder-marketing-pages/` T126 (`cms.Video.aspectRatio`),
 * T127 (`cms.Image.ratio`).
 *
 * A **responsive** field, as `createSectionSpaceField` is (T117): it carries
 * the responsive metadata, so the editor shows it on the Responsive tab, and
 * it edits the breakpoint that tab's scope switcher selects. A value is a
 * preset aspect token or **Custom**, a `w:h` of whole numbers from 1 to 100
 * (`isAspectToken`). Above the base, a first option inherits the breakpoint
 * below and says which ratio that is. A value with only its base is stored
 * plain; nothing is written until an edit.
 */

export type AspectRatioProp = string | Responsive<string>;

export interface AspectRatioFieldOptions {
  /** The field's label; the admin translates it from the block's bundle. */
  label: string;
  /** What the base shows until a value is set, and what a breakpoint set first seeds the base with. */
  defaultRatio: string;
  /** Whether `auto` (the medium's own ratio) is offered. An embed has none, so a video leaves it out. */
  allowAuto?: boolean;
}

const SCOPES: readonly SettingsScope[] = ['base', 'tablet', 'desktop'];
const CUSTOM = 'custom';

function readTier(value: AspectRatioProp | undefined, scope: SettingsScope): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (isResponsiveProp<string>(value)) return value[scope];
  return scope === 'base' ? (value as string) : undefined;
}

function inheritedAt(value: AspectRatioProp | undefined, scope: SettingsScope, fallback: string): string {
  for (let index = SCOPES.indexOf(scope) - 1; index >= 0; index -= 1) {
    const below = readTier(value, SCOPES[index]!);
    if (below !== undefined) return below;
  }
  return fallback;
}

function writeTier(
  value: AspectRatioProp | undefined,
  scope: SettingsScope,
  next: string | undefined,
  fallback: string,
): AspectRatioProp | undefined {
  const current: { base?: string; tablet?: string; desktop?: string } =
    value === undefined || value === null || value === ''
      ? {}
      : isResponsiveProp<string>(value)
        ? { ...value }
        : { base: value as string };
  if (next === undefined) delete current[scope];
  else current[scope] = next;
  if (current.base === undefined && (current.tablet !== undefined || current.desktop !== undefined)) current.base = fallback;
  if (current.base === undefined) return undefined;
  if (current.tablet === undefined && current.desktop === undefined) return current.base;
  return current as Responsive<string>;
}

function AspectRatioControl({
  label,
  value,
  onChange,
  readOnly,
  defaultRatio,
  allowAuto,
}: {
  label: string;
  value: AspectRatioProp | undefined;
  onChange: (value: AspectRatioProp | undefined) => void;
  readOnly?: boolean | undefined;
  defaultRatio: string;
  allowAuto: boolean;
}): ReactElement {
  const text = useFieldText();
  const componentId = usePageBuilderPuck((state) => state.selectedItem?.props.id as string | undefined);
  const scope = useComponentScope(componentId);
  // The scope is read again at write time: a change of scope between render and event is the user's latest choice.
  const componentIdRef = useRef(componentId);
  componentIdRef.current = componentId;

  const tokens = allowAuto ? ASPECT_TOKENS : ASPECT_TOKENS.filter((token) => token !== 'auto');
  const own = readTier(value, scope);
  const shown = own ?? (scope === 'base' ? defaultRatio : undefined);
  const isPreset = shown === undefined || (tokens as readonly string[]).includes(shown);
  const [customOpen, setCustomOpen] = useState(!isPreset);
  const [draft, setDraft] = useState(isPreset ? '' : (shown ?? ''));

  useEffect(() => {
    // A breakpoint change shows that breakpoint's own value.
    setCustomOpen(!isPreset);
    setDraft(isPreset ? '' : (shown ?? ''));
  }, [scope, isPreset, shown]);

  const inherited = scope === 'base' ? undefined : inheritedAt(value, scope, defaultRatio);
  const write = (next: string | undefined): void =>
    onChange(writeTier(value, getStoredScope(componentIdRef.current), next, defaultRatio));
  const labelOf = (token: string): string => (token === 'auto' ? text('ratio.auto') : token);
  const selected = customOpen ? CUSTOM : (shown ?? '');

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <select
        aria-label={label}
        className={PB_FIELD_INPUT_CLASS}
        disabled={readOnly === true}
        value={selected}
        onChange={(event): void => {
          const next = event.target.value;
          if (next === CUSTOM) {
            setCustomOpen(true);
            return;
          }
          setCustomOpen(false);
          write(next === '' ? undefined : next);
        }}
      >
        {inherited !== undefined ? (
          <option value="">{text('tier.inheritValue', { value: labelOf(inherited) })}</option>
        ) : null}
        {tokens.map((token) => (
          <option key={token} value={token}>
            {labelOf(token)}
          </option>
        ))}
        <option value={CUSTOM}>{text('ratio.custom')}</option>
      </select>
      {customOpen ? (
        <input
          type="text"
          aria-label={text('ratio.customValue', { label })}
          className={PB_FIELD_INPUT_CLASS}
          readOnly={readOnly === true}
          inputMode="numeric"
          placeholder="16:9"
          value={draft}
          onChange={(event): void => {
            const next = event.target.value.trim();
            setDraft(next);
            if (isAspectToken(next) && next !== 'auto') write(next);
          }}
        />
      ) : null}
    </div>
  );
}

export function createAspectRatioField({
  label,
  defaultRatio,
  allowAuto = true,
}: AspectRatioFieldOptions): CustomField<AspectRatioProp | undefined> {
  return {
    type: 'custom',
    label,
    metadata: PB_RESPONSIVE_METADATA,
    render: ({ field: handed, value, onChange, readOnly }): ReactElement => {
      const shown = handed.label ?? label;
      return (
        <PuckFieldLabel label={shown} el="div" {...(readOnly === true ? { readOnly: true } : {})}>
          <AspectRatioControl
            label={shown}
            value={value}
            onChange={(next): void => onChange(next)}
            readOnly={readOnly}
            defaultRatio={defaultRatio}
            allowAuto={allowAuto}
          />
        </PuckFieldLabel>
      );
    },
  };
}
