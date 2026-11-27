'use client';

import { useCallback, type ReactElement, type ReactNode } from 'react';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import {
  PageBuilderFieldTextProvider,
  type PageBuilderFieldTextKey,
} from '@endora-commerce/page-builder-core';

/** The bundle key a field-control text key is read under, in the `core` scope. */
export function pageBuilderFieldTextBundleKey(key: PageBuilderFieldTextKey): string {
  return `pageBuilder.fieldText.${key}`;
}

/**
 * Translates the page builder's own field controls — the section settings,
 * the colour field, the per-breakpoint switch, the group chrome
 * (`specs/163-page-builder-marketing-pages/` FR-039, T116) — from the `core`
 * bundle (`_i18n`), where every key of `PAGE_BUILDER_FIELD_TEXT` sits under
 * `pageBuilder.fieldText.`. A key the bundle lacks keeps the package's English.
 *
 * `PageBuilderColorPaletteProvider` mounts it, so the page editor and the
 * e-mail editor, the two hosts of those controls, both get it.
 */
export function PageBuilderFieldText({ children }: { children: ReactNode }): ReactElement {
  const t = useTranslation('core');
  const resolve = useCallback(
    (key: PageBuilderFieldTextKey): string | undefined => {
      const bundleKey = pageBuilderFieldTextBundleKey(key);
      const value = t(bundleKey);
      // A missing key resolves to the `core.<key>` placeholder.
      return value === `core.${bundleKey}` ? undefined : value;
    },
    [t],
  );
  return <PageBuilderFieldTextProvider resolve={resolve}>{children}</PageBuilderFieldTextProvider>;
}
