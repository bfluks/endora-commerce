'use client';

import { createContext, useContext, type ComponentType, type ReactElement, type ReactNode } from 'react';

/**
 * The host's image picker, for the controls of this package and of
 * `cms-components` that cannot import the admin
 * (`specs/163-page-builder-marketing-pages/` T195: the rich text's image
 * dialog).
 *
 * A host that can pick from its asset library mounts a
 * {@link PageBuilderImagePickerProvider} with a component that shows its
 * picker and answers with the chosen image's address — absolute, as the
 * stored content uses it — and its alternative text when it has one. Without a
 * provider (the storefront, a test) {@link useImagePicker} answers `null` and
 * a control offers a URL only.
 */
export interface PickedImage {
  url: string;
  alt?: string;
}

export interface PageBuilderImagePickerProps {
  onPick: (image: PickedImage) => void;
  onClose: () => void;
}

export type PageBuilderImagePicker = ComponentType<PageBuilderImagePickerProps>;

const ImagePickerContext = createContext<PageBuilderImagePicker | null>(null);

export function PageBuilderImagePickerProvider({
  picker,
  children,
}: {
  picker: PageBuilderImagePicker;
  children: ReactNode;
}): ReactElement {
  return <ImagePickerContext.Provider value={picker}>{children}</ImagePickerContext.Provider>;
}

/** The host's image picker, or `null` where there is none. */
export function useImagePicker(): PageBuilderImagePicker | null {
  return useContext(ImagePickerContext);
}
