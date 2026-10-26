import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react';
import { useFocusTrap } from '../hooks/useFocusTrap.js';

/**
 * A modal dialog: a titled panel over a scrim that holds focus until it is
 * closed.
 *
 * Promoted from `crm` by feature 147 (`specs/147-saved-views/research.md` R-2)
 * once a second consumer — the saved-views dialogs — wanted it. It carries what
 * a hand-drawn scrim and panel leave out: an accessible name
 * (`aria-labelledby`), a focus trap (the kit's `useFocusTrap`, which also
 * returns focus to the control that opened the dialog), Escape to close, and a
 * `busy` state that makes both Escape and the scrim inert while a request is in
 * flight.
 */
export interface ModalDialogProps {
  /** Rendered as the `<h2>` that names the dialog. */
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** The action row, right-aligned under the content. */
  footer?: ReactNode;
  /** While `true` Escape and the scrim do not close the dialog (a save in flight). */
  busy?: boolean;
  /** Focused on open instead of the first focusable element. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /**
   * Focused after the dialog unmounts instead of the opener. Read when the
   * dialog closes, so a ref still `null` at that moment falls back to the opener.
   */
  finalFocusRef?: RefObject<HTMLElement | null>;
  /**
   * The id of the element that describes the dialog — its warning or its
   * question — set as the panel's `aria-describedby`, so a screen reader reads
   * it with the title when focus enters the dialog. Left off when absent; pass
   * it only while the element it names is rendered.
   */
  'aria-describedby'?: string;
  /**
   * The panel's width class, replacing the default `max-w-lg` — for a dialog that
   * holds a form rather than a sentence (e.g. `max-w-2xl`).
   */
  widthClassName?: string;
  /**
   * Whether a press on the scrim closes the dialog (default `true`). A dialog
   * holding unsaved input passes `false`, so a stray click does not discard it;
   * Escape and its own buttons still close it.
   */
  dismissOnScrim?: boolean;
}

export function ModalDialog(props: ModalDialogProps): ReactNode {
  const {
    title,
    onClose,
    children,
    footer,
    busy = false,
    initialFocusRef,
    finalFocusRef,
    'aria-describedby': describedBy,
    widthClassName = 'max-w-lg',
    dismissOnScrim = true,
  } = props;
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, true, { initialFocusRef, finalFocusRef });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return (): void => document.removeEventListener('keydown', onKeyDown);
  }, [busy, onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(event): void => {
        if (event.target === event.currentTarget && !busy && dismissOnScrim) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={describedBy}
        aria-busy={busy}
        className={`max-h-full w-full ${widthClassName} overflow-y-auto rounded-lg bg-background p-6 shadow-lg`}
      >
        <h2 id={titleId} className="mb-4 text-lg font-semibold">
          {title}
        </h2>
        {children}
        {footer ? <div className="mt-6 flex flex-wrap justify-end gap-2">{footer}</div> : null}
      </div>
    </div>
  );
}
