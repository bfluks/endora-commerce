import { StrictMode, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  SplitLineDialog,
  splitLineInto,
  type SplitLineDialogLabels,
} from '@endora-commerce/admin-kit/components';
import { expectNoAxeViolations } from '../helpers/axe';

/**
 * Feature 159 (research N-33) — *Split line*: move part of a line's quantity to
 * a new line of the same product, in the same group or another one. Domain-free
 * like the grouping editor: the caller makes the new line.
 */

const LABELS: SplitLineDialogLabels = {
  title: (c) => `Split line: ${c.name}`,
  quantity: 'Quantity to move',
  quantityHelp: (c) => `From ${c.min} to ${c.max}; ${c.remaining} stay on this line.`,
  quantityInvalid: (c) => `Enter a whole number from ${c.min} to ${c.max}, in steps of ${c.step}.`,
  target: 'Move to',
  confirm: 'Split',
  cancel: 'Cancel',
};

const TARGETS = [
  { key: 'g1', name: 'Ground floor' },
  { key: 'g2', name: 'First floor' },
  { key: null, name: 'Ungrouped' },
];

function renderDialog(props: Partial<Parameters<typeof SplitLineDialog>[0]> = {}): {
  onConfirm: ReturnType<typeof vi.fn>;
  onClose: ReturnType<typeof vi.fn>;
} {
  const onConfirm = vi.fn();
  const onClose = vi.fn();
  const ui: ReactElement = (
    <StrictMode>
      <SplitLineDialog
        lineName="Bolt"
        quantity={8}
        targets={TARGETS}
        defaultTargetKey="g1"
        labels={LABELS}
        onConfirm={onConfirm}
        onClose={onClose}
        {...props}
      />
    </StrictMode>
  );
  render(ui);
  return { onConfirm, onClose };
}

describe('SplitLineDialog', () => {
  it('is a named dialog that starts on half the quantity and the line’s own section', async () => {
    renderDialog();
    expect(screen.getByRole('dialog', { name: 'Split line: Bolt' })).toBeInTheDocument();
    expect(screen.getByLabelText('Quantity to move')).toHaveValue(4);
    expect(screen.getByLabelText('Move to')).toHaveValue('g1');
    expect(screen.getByText('From 1 to 7; 4 stay on this line.')).toBeInTheDocument();
    await expectNoAxeViolations(document.body);
  });

  it('confirms the quantity and the chosen section — Ungrouped is `null`', async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderDialog();
    const quantity = screen.getByLabelText('Quantity to move');
    await user.clear(quantity);
    await user.type(quantity, '3');
    await user.selectOptions(screen.getByLabelText('Move to'), 'Ungrouped');
    await user.click(screen.getByRole('button', { name: 'Split' }));
    expect(onConfirm).toHaveBeenCalledWith({ quantity: 3, targetKey: null });
  });

  it('refuses a quantity outside 1 … quantity − 1, or off the step, with a reason on the field', async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderDialog({ quantity: 12, step: 3 });
    const quantity = screen.getByLabelText('Quantity to move');
    // Half of 12, on the step of 3.
    expect(quantity).toHaveValue(6);
    for (const typed of ['0', '12', '4', '']) {
      await user.clear(quantity);
      if (typed !== '') await user.type(quantity, typed);
      expect(screen.getByRole('button', { name: 'Split' })).toBeDisabled();
      expect(quantity).toHaveAttribute('aria-invalid', 'true');
      expect(screen.getByText('Enter a whole number from 3 to 9, in steps of 3.')).toBeInTheDocument();
    }
    await user.clear(quantity);
    await user.type(quantity, '9');
    await user.click(screen.getByRole('button', { name: 'Split' }));
    expect(onConfirm).toHaveBeenCalledWith({ quantity: 9, targetKey: 'g1' });
  });

  it('confirms on Enter and closes on Escape and Cancel', async () => {
    const user = userEvent.setup();
    const { onConfirm, onClose } = renderDialog();
    await user.type(screen.getByLabelText('Quantity to move'), '{Enter}');
    expect(onConfirm).toHaveBeenCalledWith({ quantity: 4, targetKey: 'g1' });
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe('splitLineInto', () => {
  const lines = [
    { key: 'a', groupKey: 'g1', quantity: 8 },
    { key: 'b', groupKey: 'g1', quantity: 1 },
    { key: 'c', groupKey: null, quantity: 2 },
  ];
  const make = (source: (typeof lines)[number], quantity: number, groupKey: string | null) => ({
    key: 'new',
    groupKey,
    quantity,
    from: source.key,
  });
  const setQuantity = (line: (typeof lines)[number], quantity: number) => ({ ...line, quantity });
  const quantityOf = (line: (typeof lines)[number]) => line.quantity;

  it('in the same section, the new line follows the one it was split from', () => {
    expect(splitLineInto(lines, 'a', { quantity: 3, targetKey: 'g1' }, { make, setQuantity, quantityOf })).toEqual([
      { key: 'a', groupKey: 'g1', quantity: 5 },
      { key: 'new', groupKey: 'g1', quantity: 3, from: 'a' },
      lines[1],
      lines[2],
    ]);
  });

  it('into another section, the new line is that section’s last', () => {
    expect(splitLineInto(lines, 'a', { quantity: 3, targetKey: null }, { make, setQuantity, quantityOf })).toEqual([
      { key: 'a', groupKey: 'g1', quantity: 5 },
      lines[1],
      lines[2],
      { key: 'new', groupKey: null, quantity: 3, from: 'a' },
    ]);
  });

  it('an unknown line changes nothing', () => {
    expect(splitLineInto(lines, 'zzz', { quantity: 1, targetKey: null }, { make, setQuantity, quantityOf })).toBe(lines);
  });
});
