import type { ReactElement } from 'react';
import type { Field } from '@puckeditor/core';
import type { HideOn } from '../types/responsive.js';
import { PuckFieldLabel } from './puck-field-label.js';
import { useFieldText, type PageBuilderFieldTextKey } from './field-text.js';

// The breakpoint names are the per-breakpoint switch's (FR-039: translatable).
const HIDE_ON_OPTIONS: { key: keyof HideOn; label: PageBuilderFieldTextKey }[] = [
  { key: 'mobile', label: 'tier.base' },
  { key: 'tablet', label: 'tier.tablet' },
  { key: 'desktop', label: 'tier.desktop' },
];

function HideOnOption({ label }: { label: PageBuilderFieldTextKey }): ReactElement {
  const text = useFieldText();
  return <>{text(label)}</>;
}

export function createHideOnField(): Field<HideOn | undefined, Record<string, unknown>> {
  return {
    type: 'custom',
    label: 'Hide on',
    // R17 (T200): translated once, from the `core` bundle.
    metadata: { pageBuilder: { sharedLabel: { key: 'hideOn' as const, en: 'Hide on' } } },
    render: ({ value, onChange, readOnly, field }): ReactElement => {
      const hideOn = value ?? {};
      const toggle = (key: keyof HideOn): void => {
        const next = { ...hideOn, [key]: !hideOn[key] };
        if (!next.mobile && !next.tablet && !next.desktop) {
          onChange(undefined);
          return;
        }
        onChange(next);
      };

      return (
        <PuckFieldLabel label={field.label ?? 'Hide on'} el="div" {...(readOnly === true ? { readOnly: true } : {})}>
          <div className="flex flex-col gap-2" role="group" aria-label={field.label ?? 'Hide on'}>
            {HIDE_ON_OPTIONS.map(({ key, label }) => (
              <label key={key} className="flex min-h-6 cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  disabled={readOnly}
                  checked={hideOn[key] === true}
                  onChange={(): void => toggle(key)}
                />
                <HideOnOption label={label} />
              </label>
            ))}
          </div>
        </PuckFieldLabel>
      );
    },
  };
}
