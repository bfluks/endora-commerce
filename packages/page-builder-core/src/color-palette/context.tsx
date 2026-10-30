'use client';

import { createContext, useContext, type ReactNode } from 'react';

export interface ColorPaletteEntry {
  id: string;
  name: string;
  hex: string;
}

export interface ColorPaletteContextValue {
  entries: ColorPaletteEntry[];
  /**
   * Feature 163, T040 — the palette offers the brand colour roles first and a
   * colour field may store `token:<role>` (research R-6). Off where colours are
   * rendered without the brand stylesheet (the e-mail builder).
   */
  brandRoles?: boolean;
  /** `onSelect` receives a `#rrggbb` value, or `token:<role>` when {@link brandRoles} is on. */
  openPalette: (onSelect: (hex: string) => void) => void;
  refreshPalette: () => Promise<void>;
  savePalette: (entries: ColorPaletteEntry[]) => Promise<void>;
}

const ColorPaletteContext = createContext<ColorPaletteContextValue | null>(null);

export function ColorPaletteProvider({
  value,
  children,
}: {
  value: ColorPaletteContextValue;
  children: ReactNode;
}): ReactNode {
  return <ColorPaletteContext.Provider value={value}>{children}</ColorPaletteContext.Provider>;
}

export function useColorPalette(): ColorPaletteContextValue | null {
  return useContext(ColorPaletteContext);
}
