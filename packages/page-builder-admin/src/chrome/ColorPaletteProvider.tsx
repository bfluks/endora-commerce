import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { CmsColorPaletteEntry, PutCmsColorPaletteRequest } from '@endora-commerce/contracts';
import { PageBuilderImagePickerProvider, type BrandColorRole } from '@endora-commerce/page-builder-core';
import { ColorPaletteProvider as PbColorPaletteProvider } from '@endora-commerce/page-builder-core/client';
import { getPageBuilderColorPalette, putPageBuilderColorPalette } from './cms-page-builder-api.js';
import { ColorPaletteModal } from './ColorPaletteModal.js';
import { AdminImagePicker } from './AssetPickers.js';
import { PageBuilderFieldText } from './FieldTextProvider.js';

export function PageBuilderColorPaletteProvider({
  initialEntries,
  brandColors,
  children,
}: {
  initialEntries: CmsColorPaletteEntry[];
  /**
   * Feature 163, T040 — offer the brand colour roles (`token:<role>`) first,
   * with these effective colours where known. Leave unset where colours are
   * rendered without the brand stylesheet (the e-mail builder).
   */
  brandColors?: Partial<Record<BrandColorRole, string>>;
  children: ReactNode;
}): ReactNode {
  const [entries, setEntries] = useState<CmsColorPaletteEntry[]>(initialEntries);
  const [modalOpen, setModalOpen] = useState(false);
  const [pickHandler, setPickHandler] = useState<((hex: string) => void) | null>(null);

  useEffect(() => {
    setEntries(initialEntries);
  }, [initialEntries]);

  const refreshPalette = useCallback(async (): Promise<void> => {
    setEntries(await getPageBuilderColorPalette());
  }, []);

  const savePalette = useCallback(async (next: CmsColorPaletteEntry[]): Promise<void> => {
    const body: PutCmsColorPaletteRequest = { entries: next };
    const result = await putPageBuilderColorPalette(body);
    setEntries(result.entries);
  }, []);

  const openPalette = useCallback((onSelect: (hex: string) => void): void => {
    setPickHandler(() => onSelect);
    setModalOpen(true);
  }, []);

  const brandRoles = brandColors !== undefined;
  const contextValue = useMemo(
    () => ({
      entries,
      brandRoles,
      openPalette,
      refreshPalette,
      savePalette,
    }),
    [entries, brandRoles, openPalette, refreshPalette, savePalette],
  );

  return (
    <PbColorPaletteProvider value={contextValue}>
      {/* Feature 163, T116 — the field controls' own copy, in the admin's language;
          T195 — the asset library as the image picker of the rich text's image dialog. */}
      <PageBuilderFieldText>
        <PageBuilderImagePickerProvider picker={AdminImagePicker}>{children}</PageBuilderImagePickerProvider>
      </PageBuilderFieldText>
      <ColorPaletteModal
        open={modalOpen}
        entries={entries}
        pickMode={pickHandler !== null}
        brandColors={brandColors}
        onClose={(): void => {
          setModalOpen(false);
          setPickHandler(null);
        }}
        onPick={(hex): void => {
          pickHandler?.(hex);
          setModalOpen(false);
          setPickHandler(null);
        }}
        onSave={savePalette}
      />
    </PbColorPaletteProvider>
  );
}
