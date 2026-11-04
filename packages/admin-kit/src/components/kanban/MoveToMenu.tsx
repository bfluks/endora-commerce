import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { Button } from '../../ui/button.js';
import { useTranslation } from '../../i18n/useTranslation.js';

/** A lane a card can be moved to: a status, by its code, as the board names and colours it. */
export interface MoveToMenuTarget {
  code: string;
  name: string;
  /** `#rrggbb`. */
  color: string;
}

export interface MoveToMenuProps {
  /** The card's title — part of the control's accessible name, so two cards' menus differ. */
  title: string;
  /** The lanes the card may move to from where it is, in board order. */
  targets: readonly MoveToMenuTarget[];
  /** A move of this card is in flight. */
  busy: boolean;
  onMove: (statusCode: string) => void;
}

/**
 * A card's **"Move to…" menu** — the way to move a card on a `KanbanBoard`
 * with one press and no drag. Promoted from CRM by
 * `specs/165-task-management/` research R-11 when the Task board became its
 * second consumer (Constitution IX); the targets are generic and the words are
 * the core bundle's (`kanban.moveTo.*`).
 *
 * WCAG 2.2 SC 2.5.7 (Dragging Movements, AA) asks that anything dragging does
 * can be done with a single pointer without dragging; the board's keyboard drag
 * does not answer that. This does, and it is not a fallback: it lists exactly
 * the statuses the card may be dropped on and calls the same move.
 *
 * It is a disclosure — a button that reveals a short list of buttons inside the
 * card — rather than a floating menu: the list is in the page flow, so it is
 * never clipped by a lane that scrolls, needs no positioning, and every target
 * is a full-width button a finger can hit. The kit's `RowActionMenu` was the
 * alternative; its trigger is a fixed 32 px icon with no visible label.
 */
export function MoveToMenu(props: MoveToMenuProps): ReactNode {
  const { title, targets, busy, onMove } = props;
  const t = useTranslation('core');
  const listId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const label = t('kanban.moveTo.label', { title });

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Escape' || !open) return;
    event.stopPropagation();
    setOpen(false);
    triggerRef.current?.focus();
  };

  return (
    // `data-kanban-no-drag`: a press anywhere in here is a press on the menu,
    // never the start of a drag.
    <div data-kanban-no-drag="" className="pt-1" onKeyDown={onKeyDown}>
      <Button
        ref={triggerRef}
        type="button"
        variant="outline"
        size="sm"
        className="min-h-11 w-full justify-between sm:min-h-8"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={label}
        aria-busy={busy}
        disabled={busy}
        onClick={(): void => setOpen((previous) => !previous)}
      >
        {t('kanban.moveTo.action')}
        <ChevronDown
          aria-hidden="true"
          className={
            open
              ? 'size-4 rotate-180 transition-transform motion-reduce:transition-none'
              : 'size-4 transition-transform motion-reduce:transition-none'
          }
        />
      </Button>
      {open ? (
        <div id={listId} role="group" aria-label={label} className="mt-1 flex flex-col gap-1">
          {targets.map((target) => (
            <Button
              key={target.code}
              type="button"
              variant="ghost"
              size="sm"
              className="min-h-11 w-full justify-start sm:min-h-8"
              disabled={busy}
              onClick={(): void => {
                setOpen(false);
                onMove(target.code);
              }}
            >
              <span
                aria-hidden="true"
                className="size-2.5 shrink-0 rounded-full border border-black/10"
                style={{ backgroundColor: target.color }}
              />
              {target.name}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
