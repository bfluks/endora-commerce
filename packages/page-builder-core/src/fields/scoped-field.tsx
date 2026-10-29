import type { ReactElement } from 'react';
import {
  hasResponsiveOverride,
  isResponsiveProp,
  normalizeResponsive,
  resolveResponsive,
  settingsScopeToTier,
  type ResponsiveProp,
  type SettingsScope,
} from '../types/responsive.js';
import { PB_FIELD_HINT_CLASS } from './field-classes.js';
import { useFieldText } from './field-text.js';

function scopeKey(scope: SettingsScope): keyof ResponsiveProp<unknown> {
  if (scope === 'tablet') return 'tablet';
  if (scope === 'desktop') return 'desktop';
  return 'base';
}

export function responsiveBaseSeed<T>(value: T | ResponsiveProp<T> | undefined, fallback: T): T {
  // A value stored without `base` (T170) seeds with the fallback, what it reads as below its first breakpoint.
  if (isResponsiveProp(value)) return value.base ?? fallback;
  if (value !== undefined) return value as T;
  return fallback;
}

export function readScopedValue<T>(
  value: T | ResponsiveProp<T> | undefined,
  scope: SettingsScope,
  fallback: T,
): T {
  const tier = settingsScopeToTier(scope);
  return resolveResponsive(value, tier, responsiveBaseSeed(value, fallback));
}

export function writeScopedValue<T>(
  value: T | ResponsiveProp<T> | undefined,
  scope: SettingsScope,
  next: T,
  fallback: T,
): T | ResponsiveProp<T> {
  const key = scopeKey(scope);
  if (key === 'base') {
    if (isResponsiveProp(value)) {
      return { ...value, base: next };
    }
    return next;
  }

  const base = responsiveBaseSeed(value, fallback);
  const responsive: ResponsiveProp<T> = isResponsiveProp(value) ? { ...value, base: value.base ?? base } : { base };
  return { ...responsive, [key]: next };
}

export function clearScopedOverride<T>(
  value: T | ResponsiveProp<T> | undefined,
  scope: SettingsScope,
  fallback: T,
): T | ResponsiveProp<T> {
  if (scope === 'base') return normalizeResponsive(value, fallback);
  const responsive = normalizeResponsive(value, fallback);
  if (scope === 'tablet') {
    const { tablet: _removed, ...rest } = responsive;
    return rest;
  }
  const { desktop: _removed, ...rest } = responsive;
  return rest;
}

export function ScopedFieldHint<T>({
  value,
  scope,
  fallback,
}: {
  value: T | ResponsiveProp<T> | undefined;
  scope: SettingsScope;
  fallback: T;
}): ReactElement | null {
  if (scope === 'base') return null;
  const tier = settingsScopeToTier(scope);
  const responsive = normalizeResponsive(value, responsiveBaseSeed(value, fallback));
  if (hasResponsiveOverride(responsive, tier)) return null;
  const inherited = resolveResponsive(responsive, tier, responsiveBaseSeed(value, fallback));
  return <InheritedHint scope={scope} value={inherited} />;
}

/** "Applies: <value> (from Mobile)"; an object value (spacing, a border) is not printable, so only its origin is named. */
function InheritedHint({ scope, value }: { scope: SettingsScope; value: unknown }): ReactElement {
  const text = useFieldText();
  const from = text(scope === 'tablet' ? 'scope.from.tablet' : 'scope.from.desktop');
  const printable = value === null || typeof value !== 'object';
  return (
    <p className={`${PB_FIELD_HINT_CLASS} mb-1`}>
      {printable ? text('scope.applies', { value: String(value), from }) : text('scope.appliesFrom', { from })}
    </p>
  );
}

/** "Inherited value shown — change to override for this scope." */
export function ScopedInheritedNote(): ReactElement {
  const text = useFieldText();
  return <p className={PB_FIELD_HINT_CLASS}>{text('scope.inherited')}</p>;
}

function ResetLabel(): ReactElement {
  const text = useFieldText();
  return <>{text('scope.reset')}</>;
}

export function ScopedResetLink({
  value,
  scope,
  fallback,
  onChange,
  readOnly,
}: {
  value: unknown;
  scope: SettingsScope;
  fallback: unknown;
  onChange: (value: unknown) => void;
  readOnly?: boolean;
}): ReactElement | null {
  if (scope === 'base') return null;
  const tier = settingsScopeToTier(scope);
  if (!hasResponsiveOverride(value, tier)) return null;
  return (
    <button
      type="button"
      className={`${PB_FIELD_HINT_CLASS} mb-1 cursor-pointer border-0 bg-transparent p-0 underline`}
      disabled={readOnly}
      onClick={(): void => onChange(clearScopedOverride(value, scope, fallback))}
    >
      <ResetLabel />
    </button>
  );
}
