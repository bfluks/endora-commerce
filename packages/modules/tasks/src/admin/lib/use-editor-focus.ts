import { useCallback, useEffect, useRef, type RefObject } from 'react';

/** What a keyboard user can land on inside an inline editor, in document order. */
const FOCUSABLE = [
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[contenteditable="true"]',
  'button:not([disabled])',
  'a[href]',
].join(', ');

export interface EditorFocus {
  /** The button that opens the editor; focus returns to it when the editor closes. */
  openerRef: RefObject<HTMLButtonElement | null>;
  /** The editor's container; its first control takes focus when it opens. */
  editorRef: RefObject<HTMLDivElement | null>;
  /**
   * Send focus to the opener at the next render where it is there and enabled —
   * for a change that unmounts the focused control without closing the editor
   * (a *Remove* that makes the opener's sibling disappear).
   */
  returnFocus: () => void;
}

/**
 * Focus for an inline editor that replaces, or sits beside, the button that
 * opened it (`specs/165-task-management/` T092; WCAG 2.2 SC 2.4.3 Focus Order).
 *
 * Opening moves focus to the editor's first control; closing — by *Cancel* or
 * after a save — returns it to the opener, so focus never falls back to the
 * page's start when the control that held it unmounts. The move waits for a
 * render where its target is enabled: a save disables the opener while it is
 * in flight.
 */
export function useEditorFocus(open: boolean): EditorFocus {
  const openerRef = useRef<HTMLButtonElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const was = useRef(open);
  const pending = useRef<'editor' | 'opener' | null>(null);

  // Every render: the target may become enabled on a render `open` did not cause.
  useEffect(() => {
    if (was.current !== open) {
      was.current = open;
      pending.current = open ? 'editor' : 'opener';
    }
    if (pending.current === 'editor') {
      const first = editorRef.current?.querySelector<HTMLElement>(FOCUSABLE);
      if (first) {
        first.focus();
        pending.current = null;
      }
    } else if (pending.current === 'opener') {
      const opener = openerRef.current;
      if (opener === null) pending.current = null;
      else if (!opener.disabled) {
        opener.focus();
        pending.current = null;
      }
    }
  });

  const returnFocus = useCallback((): void => {
    pending.current = 'opener';
  }, []);

  return { openerRef, editorRef, returnFocus };
}
