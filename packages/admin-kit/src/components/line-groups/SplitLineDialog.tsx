import { useId, useRef, useState, type ReactNode } from 'react';
import { Button } from '../../ui/button.js';
import { Input } from '../../ui/input.js';
import { Label } from '../../ui/label.js';
import { Select } from '../../ui/select.js';
import { ModalDialog } from '../modal-dialog/ModalDialog.js';

/**
 * *Split line* (feature 159, research N-33) — move part of a line's quantity
 * to a new line of the same product, in the line's own group or another one,
 * so one product can sit on several lines of a grouped document.
 *
 * Domain-free, beside {@link LineGroupsEditor}: it asks for the quantity to
 * move (`step` … `quantity − step`, in whole multiples of `step`) and the
 * section to put the new line in, and answers both; the caller makes the line
 * ({@link splitLineInto}). Every string is a prop. The quantity field is
 * focused on open, Enter confirms and Escape cancels; an invalid entry is
 * marked on the field with its reason and disables the confirm button.
 */

export interface SplitLineDialogTarget {
  /** A group's key; `null` = the ungrouped section. */
  key: string | null;
  name: string;
}

export interface SplitLineDialogLabels {
  title: (context: { name: string }) => string;
  quantity: string;
  quantityHelp: (context: { min: number; max: number; remaining: number }) => string;
  quantityInvalid: (context: { min: number; max: number; step: number }) => string;
  target: string;
  confirm: string;
  cancel: string;
}

export interface SplitLineDialogProps {
  lineName: string;
  /** The line's current quantity; a line of fewer than `2 × step` cannot be split. */
  quantity: number;
  /** The quantity increment the line is ordered in (a packaging step); default 1. */
  step?: number;
  /** The sections, in display order. */
  targets: readonly SplitLineDialogTarget[];
  /** Preselected — the line's own section. */
  defaultTargetKey: string | null;
  labels: SplitLineDialogLabels;
  onConfirm: (split: { quantity: number; targetKey: string | null }) => void;
  onClose: () => void;
}

/** Whether a line of `quantity` can be split at all at this `step`. */
export function canSplitLine(quantity: number, step = 1): boolean {
  return Number.isInteger(quantity) && quantity >= 2 * Math.max(1, step);
}

const UNGROUPED_VALUE = '';

export function SplitLineDialog(props: SplitLineDialogProps): ReactNode {
  const { lineName, quantity, targets, defaultTargetKey, labels, onConfirm, onClose } = props;
  const step = Math.max(1, Math.trunc(props.step ?? 1));
  const min = step;
  const max = quantity - step;
  const initial = Math.max(min, Math.floor(quantity / 2 / step) * step);
  const [typed, setTyped] = useState(String(initial));
  const [target, setTarget] = useState(defaultTargetKey ?? UNGROUPED_VALUE);
  const quantityRef = useRef<HTMLInputElement>(null);
  const id = useId();

  const moved = typed.trim() === '' ? Number.NaN : Number(typed);
  const valid = Number.isInteger(moved) && moved >= min && moved <= max && moved % step === 0;

  const confirm = (): void => {
    if (!valid) return;
    onConfirm({ quantity: moved, targetKey: target === UNGROUPED_VALUE ? null : target });
  };

  return (
    <ModalDialog
      title={labels.title({ name: lineName })}
      onClose={onClose}
      initialFocusRef={quantityRef}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>
            {labels.cancel}
          </Button>
          <Button type="submit" form={`${id}-form`} disabled={!valid}>
            {labels.confirm}
          </Button>
        </>
      }
    >
      <form
        id={`${id}-form`}
        className="space-y-4"
        onSubmit={(event): void => {
          event.preventDefault();
          confirm();
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-quantity`}>{labels.quantity}</Label>
          <Input
            ref={quantityRef}
            id={`${id}-quantity`}
            type="number"
            inputMode="numeric"
            min={min}
            max={max}
            step={step}
            value={typed}
            aria-invalid={valid ? undefined : true}
            aria-describedby={`${id}-quantity-help`}
            onChange={(event): void => setTyped(event.target.value)}
            onKeyDown={(event): void => {
              // The confirm button sits in the dialog's footer, outside the
              // form, so Enter is answered here rather than by implicit submission.
              if (event.key === 'Enter') {
                event.preventDefault();
                confirm();
              }
            }}
            className="w-32 tabular-nums"
          />
          <p
            id={`${id}-quantity-help`}
            className={valid ? 'text-xs text-muted-foreground' : 'text-xs text-destructive'}
          >
            {valid
              ? labels.quantityHelp({ min, max, remaining: quantity - moved })
              : labels.quantityInvalid({ min, max, step })}
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-target`}>{labels.target}</Label>
          <Select id={`${id}-target`} value={target} onChange={(event): void => setTarget(event.target.value)}>
            {targets.map((option) => (
              <option key={option.key ?? UNGROUPED_VALUE} value={option.key ?? UNGROUPED_VALUE}>
                {option.name}
              </option>
            ))}
          </Select>
        </div>
      </form>
    </ModalDialog>
  );
}

/**
 * Apply a confirmed split to a display-ordered line list: the source line keeps
 * `quantity − moved`, and the new line (the caller's `make`) follows it in the
 * same section, or follows the target section's last line — appended when that
 * section is empty, so a caller sending lines in display order orders them by
 * section itself. An unknown key changes nothing.
 */
export function splitLineInto<TLine extends { key: string; groupKey: string | null }>(
  lines: readonly TLine[],
  key: string,
  split: { quantity: number; targetKey: string | null },
  ops: {
    quantityOf: (line: TLine) => number;
    setQuantity: (line: TLine, quantity: number) => TLine;
    make: (source: TLine, quantity: number, groupKey: string | null) => TLine;
  },
): readonly TLine[] {
  const index = lines.findIndex((line) => line.key === key);
  if (index < 0) return lines;
  const source = lines[index]!;
  const kept = ops.setQuantity(source, ops.quantityOf(source) - split.quantity);
  const made = ops.make(source, split.quantity, split.targetKey);
  const next = [...lines];
  next[index] = kept;
  if ((source.groupKey ?? null) === split.targetKey) {
    next.splice(index + 1, 0, made);
    return next;
  }
  const lastOfTarget = next.map((line) => line.groupKey ?? null).lastIndexOf(split.targetKey);
  if (lastOfTarget >= 0) next.splice(lastOfTarget + 1, 0, made);
  else next.push(made);
  return next;
}
