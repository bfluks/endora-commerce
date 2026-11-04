'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactElement } from 'react';
import { ActionBar } from '@puckeditor/core';
import { Plus } from 'lucide-react';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { CAROUSEL_SLIDE_TYPES } from '@endora-commerce/page-builder-core/editor';

/**
 * Feature 163, T054 — the Carousel's "Add slide" (`specs/163-page-builder-marketing-pages/`
 * research R-12). The item blocks sit in the hidden drawer, insertable only
 * into a Carousel's slides, so the action bar is where an editor picks the
 * kind: free content, an image, a split slide, a link tile or a download tile.
 *
 * A menu button: Enter, Space or a click opens it with the first kind focused;
 * the arrow keys move through the kinds; Escape or a click outside closes it
 * and returns focus to the button.
 */

const KIND_KEYS: Record<string, string> = {
  'cms.Slide': 'pageBuilder.carousel.addSlide.slide',
  'cms.CarouselImage': 'pageBuilder.carousel.addSlide.image',
  'cms.CarouselSplit': 'pageBuilder.carousel.addSlide.split',
  'cms.LinkTile': 'pageBuilder.carousel.addSlide.linkTile',
  'cms.DownloadTile': 'pageBuilder.carousel.addSlide.downloadTile',
};

export function CarouselAddSlideMenu({ onAdd }: { onAdd: (componentType: string) => void }): ReactElement {
  const t = useTranslation('cms');
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = `${useId()}-menu`;
  const label = t('pageBuilder.carousel.addSlide.label');

  const items = (): HTMLButtonElement[] =>
    Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);

  const close = (returnFocus: boolean): void => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return undefined;
    items()[0]?.focus();
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node | null;
      if (target && (menuRef.current?.contains(target) || triggerRef.current?.contains(target))) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return (): void => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const list = items();
    const index = list.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      list[(index + 1) % list.length]?.focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      list[(index - 1 + list.length) % list.length]?.focus();
    } else if (event.key === 'Home') {
      event.preventDefault();
      list[0]?.focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      list[list.length - 1]?.focus();
    } else if (event.key === 'Tab') {
      close(false);
    }
  };

  return (
    <span className="relative inline-flex">
      <ActionBar.Action
        ref={triggerRef}
        label={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={(): void => setOpen((value) => !value)}
      >
        <Plus size={16} />
      </ActionBar.Action>
      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={label}
          className="absolute left-0 top-full z-50 mt-1 flex min-w-40 flex-col rounded-md border bg-background p-1 text-foreground shadow-md"
          onKeyDown={onMenuKeyDown}
        >
          {CAROUSEL_SLIDE_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className="rounded px-3 py-2 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
              onClick={(): void => {
                onAdd(type);
                close(true);
              }}
            >
              {t(KIND_KEYS[type] ?? type)}
            </button>
          ))}
        </div>
      ) : null}
    </span>
  );
}
