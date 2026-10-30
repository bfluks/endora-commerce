import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MoveToMenu, type MoveToMenuTarget } from '@endora-commerce/admin-kit/components';
import { renderWithI18n } from '../helpers/render-with-i18n';

/**
 * The *Move to…* menu of a board card, promoted from CRM into the kit
 * (`specs/165-task-management/` research R-11, T054): the one-press,
 * no-drag way to move a card that WCAG 2.2 SC 2.5.7 asks for. Its targets are
 * generic `{code, name, color}` — a CRM status and a Task status alike — and
 * the kit knows neither module; its words are the core bundle's.
 */

const CORE: Record<string, string> = JSON.parse(
  readFileSync(resolve(process.cwd(), '../packages/modules/_i18n/i18n/en.json'), 'utf8'),
) as Record<string, string>;

const TARGETS: MoveToMenuTarget[] = [
  { code: 'in_progress', name: 'In progress', color: '#f59e0b' },
  { code: 'done', name: 'Done', color: '#10b981' },
];

describe('MoveToMenu (kit)', () => {
  it('names itself after the card, opens by keyboard, lists the targets and moves to the one chosen', async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    renderWithI18n(<MoveToMenu title="Install the gate" targets={TARGETS} busy={false} onMove={onMove} />, {
      core: CORE,
    });
    const trigger = screen.getByRole('button', { name: 'Move to… — Install the gate' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveTextContent('Move to…');

    trigger.focus();
    await user.keyboard('{Enter}');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const group = screen.getByRole('group', { name: 'Move to… — Install the gate' });
    expect(group).toBeInTheDocument();

    await user.tab();
    expect(screen.getByRole('button', { name: 'In progress' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Done' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onMove).toHaveBeenCalledWith('done');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes on Escape and gives the focus back to the trigger', async () => {
    const user = userEvent.setup();
    renderWithI18n(<MoveToMenu title="Card" targets={TARGETS} busy={false} onMove={vi.fn()} />, { core: CORE });
    const trigger = screen.getByRole('button', { name: 'Move to… — Card' });
    await user.click(trigger);
    await user.tab();
    await user.keyboard('{Escape}');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveFocus();
    expect(screen.queryByRole('button', { name: 'Done' })).toBeNull();
  });

  it('is disabled while a move of the card is in flight', () => {
    renderWithI18n(<MoveToMenu title="Card" targets={TARGETS} busy onMove={vi.fn()} />, { core: CORE });
    const trigger = screen.getByRole('button', { name: 'Move to… — Card' });
    expect(trigger).toBeDisabled();
    expect(trigger).toHaveAttribute('aria-busy', 'true');
  });
});
