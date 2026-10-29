'use client';

import { FieldLabel } from '@puckeditor/core';
import type { ReactElement, ReactNode } from 'react';

/**
 * Puck does not render `field.label` for custom fields — wrap controls explicitly.
 *
 * `el` is Puck's own: a `<label>` (the default) for a field with **one**
 * control, a `<div>` for a composite one. A `<label>` around several controls
 * names only the first of them, forwards every click on its text to it, and
 * may not contain the controls' own `<label>`s (feature 163, T115).
 */
export function PuckFieldLabel({
  label,
  readOnly,
  el,
  children,
}: {
  label: string;
  readOnly?: boolean;
  el?: 'label' | 'div';
  children: ReactNode;
}): ReactElement {
  return (
    <FieldLabel label={label} {...(el !== undefined ? { el } : {})} {...(readOnly === true ? { readOnly: true } : {})}>
      {children}
    </FieldLabel>
  );
}
