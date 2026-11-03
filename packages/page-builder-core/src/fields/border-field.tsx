'use client';

import { memo, useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import type { Field } from '@puckeditor/core';
import {
  DEFAULT_BORDER,
  normalizeBorder,
  type BorderSide,
  type BorderStyle,
  type BorderValue,
} from '../types/box-styles.js';
import { PB_RESPONSIVE_METADATA, hasResponsiveOverride, settingsScopeToTier, type ResponsiveProp } from '../types/responsive.js';
import {
  ScopedFieldHint,
  ScopedInheritedNote,
  ScopedResetLink,
  readScopedValue,
  responsiveBaseSeed,
  writeScopedValue,
} from './scoped-field.js';
import { getStoredScope } from '../editor/settings-scope-store.js';
import { useComponentScope } from '../editor/use-component-scope.js';
import { usePageBuilderPuck } from '../editor/use-page-builder-puck.js';
import { PuckFieldLabel } from './puck-field-label.js';
import { NativeColorInput } from './native-color-input.js';
import { PB_FIELD_INPUT_CLASS, PB_FIELD_LABEL_CLASS } from './field-classes.js';
import { useFieldText, type PageBuilderFieldTextKey } from './field-text.js';
import { ToggleSwitch } from './toggle-field.js';

const inputClassName = PB_FIELD_INPUT_CLASS;

const BORDER_STYLES: { label: PageBuilderFieldTextKey; value: BorderStyle }[] = [
  { label: 'border.style.solid', value: 'solid' },
  { label: 'border.style.dashed', value: 'dashed' },
  { label: 'border.style.dotted', value: 'dotted' },
];

type Side = 'top' | 'right' | 'bottom' | 'left';

/**
 * One border's width, style and colour (R17, T202): each control under a small
 * visible label and named for assistive technology — with the side, when the
 * sides are edited one by one.
 */
function SideEditor({
  side,
  sideKey,
  onChange,
  readOnly,
}: {
  side: BorderSide;
  sideKey?: Side;
  onChange: (next: BorderSide) => void;
  readOnly?: boolean;
}): ReactElement {
  const text = useFieldText();
  const name = (control: PageBuilderFieldTextKey): string =>
    sideKey ? text('side.control', { side: text(`side.${sideKey}`), control: text(control) }) : text(control);
  return (
    <div className="grid grid-cols-3 gap-2">
      <div className="flex min-w-0 flex-col gap-1">
        <span className={PB_FIELD_LABEL_CLASS} aria-hidden="true">{text('border.width')}</span>
        <input
          type="number"
          className={inputClassName}
          min={0}
          max={20}
          step={1}
          aria-label={name('border.width')}
          readOnly={readOnly}
          value={side.width}
          onChange={(e): void => {
            const parsed = Number(e.target.value);
            if (!Number.isNaN(parsed)) onChange({ ...side, width: Math.max(0, parsed) });
          }}
        />
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <span className={PB_FIELD_LABEL_CLASS} aria-hidden="true">{text('border.style')}</span>
        <select
          className={inputClassName}
          aria-label={name('border.style')}
          disabled={readOnly}
          value={side.style}
          onChange={(e): void => onChange({ ...side, style: e.target.value as BorderStyle })}
        >
          {BORDER_STYLES.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {text(opt.label)}
            </option>
          ))}
        </select>
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <span className={PB_FIELD_LABEL_CLASS} aria-hidden="true">{text('border.color')}</span>
        <NativeColorInput
          className="h-9 w-full cursor-pointer rounded border border-border p-0.5"
          ariaLabel={name('border.color')}
          readOnly={readOnly}
          value={side.color.startsWith('#') ? side.color : '#d9e0e7'}
          onCommit={(hex): void => onChange({ ...side, color: hex })}
        />
      </div>
    </div>
  );
}

function BorderEditor({
  value,
  onChange,
  readOnly,
}: {
  value: BorderValue;
  onChange: (next: BorderValue) => void;
  readOnly?: boolean;
}): ReactElement {
  const text = useFieldText();
  const border = normalizeBorder(value);
  const showBorder = border.mode !== 'none';

  const uniform =
    border.mode === 'uniform'
      ? border
      : { mode: 'uniform' as const, width: 1, style: 'solid' as BorderStyle, color: '#d9e0e7' };

  return (
    <div className="space-y-2">
      <ToggleSwitch
        size="sm"
        label={text('border.show')}
        checked={showBorder}
        readOnly={readOnly === true}
        onChange={(next): void => onChange(next ? uniform : { mode: 'none' })}
      />
      {showBorder ? (
        <>
          <div className="flex gap-2 text-sm">
            <label className="flex items-center gap-1">
              <input
                type="radio"
                checked={border.mode === 'uniform'}
                disabled={readOnly}
                onChange={(): void => onChange(uniform)}
              />
              {text('spacing.uniform')}
            </label>
            <label className="flex items-center gap-1">
              <input
                type="radio"
                checked={border.mode === 'sides'}
                disabled={readOnly}
                onChange={(): void => {
                  const side: BorderSide = {
                    width: uniform.width,
                    style: uniform.style,
                    color: uniform.color,
                  };
                  onChange({ mode: 'sides', top: side, right: side, bottom: side, left: side });
                }}
              />
              {text('spacing.sides')}
            </label>
          </div>
          {border.mode === 'uniform' ? (
            <SideEditor
              side={{ width: border.width, style: border.style, color: border.color }}
              onChange={(side): void => {
                if (side.width <= 0) {
                  onChange({ mode: 'none' });
                  return;
                }
                onChange({ mode: 'uniform', width: side.width, style: side.style, color: side.color });
              }}
              {...(readOnly === true ? { readOnly: true } : {})}
            />
          ) : (
            <div className="space-y-2">
              {(['top', 'right', 'bottom', 'left'] as const).map((key) => (
                <div key={key} className="space-y-1">
                  <p className="m-0 text-xs font-semibold">{text(`side.${key}`)}</p>
                  <SideEditor
                    side={border[key]}
                    sideKey={key}
                    onChange={(side): void => onChange({ ...border, [key]: side })}
                    {...(readOnly === true ? { readOnly: true } : {})}
                  />
                </div>
              ))}
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}

const ResponsiveBorderControl = memo(function ResponsiveBorderControl({
  value,
  onChange,
  readOnly,
}: {
  value: unknown;
  onChange: (value: unknown) => void;
  readOnly?: boolean;
}): ReactElement {
  const componentId = usePageBuilderPuck((s) => s.selectedItem?.props.id as string | undefined);
  const componentIdRef = useRef(componentId);
  componentIdRef.current = componentId;
  const scope = useComponentScope(componentId);
  const fallback = responsiveBaseSeed(value, DEFAULT_BORDER) as BorderValue;
  const tier = settingsScopeToTier(scope);
  const inherited = scope !== 'base' && !hasResponsiveOverride(value, tier);

  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const scoped = readScopedValue(value, scope, fallback);
  const [local, setLocal] = useState<BorderValue>(normalizeBorder(scoped as BorderValue));

  useEffect(() => {
    setLocal(normalizeBorder(readScopedValue(value, scope, fallback) as BorderValue));
  }, [value, scope, fallback]);

  const commit = useCallback(
    (next: BorderValue) => {
      setLocal(next);
      const activeScope = getStoredScope(componentIdRef.current);
      const activeFallback = responsiveBaseSeed(valueRef.current, DEFAULT_BORDER) as BorderValue;
      onChangeRef.current(writeScopedValue(valueRef.current, activeScope, next, activeFallback));
    },
    [setLocal],
  );

  return (
    <div className="space-y-1">
      <ScopedFieldHint value={value} scope={scope} fallback={fallback} />
      <ScopedResetLink
        value={value}
        scope={scope}
        fallback={fallback}
        onChange={onChange}
        {...(readOnly === true ? { readOnly: true } : {})}
      />
      <BorderEditor
        value={local}
        onChange={commit}
        {...(readOnly === true ? { readOnly: true } : {})}
      />
      {inherited ? (
        <ScopedInheritedNote />
      ) : null}
    </div>
  );
});

export function createBorderField(): Field<
  BorderValue | ResponsiveProp<BorderValue> | undefined,
  Record<string, unknown>
> {
  return {
    type: 'custom',
    label: 'Border',
    metadata: PB_RESPONSIVE_METADATA,
    render: ({ value, onChange, readOnly, field }): ReactElement => (
      <PuckFieldLabel label={field.label ?? 'Border'} el="div" {...(readOnly === true ? { readOnly: true } : {})}>
        <ResponsiveBorderControl
          value={value ?? DEFAULT_BORDER}
          onChange={(next) => onChange(next as BorderValue | ResponsiveProp<BorderValue>)}
          {...(readOnly === true ? { readOnly: true } : {})}
        />
      </PuckFieldLabel>
    ),
  };
}
