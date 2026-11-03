import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TagChips, TagMultiSelect, type TagOption } from '@endora-commerce/admin-kit/components';
import { renderWithI18n } from '../helpers/render-with-i18n';

/**
 * The tag controls, promoted from CRM into the kit
 * (`specs/165-task-management/` research R-10, T040): CRM and Tasks each keep
 * their own tag list behind their own endpoint, so **where the options come
 * from is a prop** (`loadTags`) and the kit knows neither module. The chosen
 * tags come back in the list's own order, whatever the order of the clicks; an
 * empty list says there are none and a list that could not be read says that.
 */

const CORE: Record<string, string> = JSON.parse(
  readFileSync(resolve(process.cwd(), '../packages/modules/_i18n/i18n/en.json'), 'utf8'),
) as Record<string, string>;

function core(key: string): string {
  const template = CORE[key];
  if (template === undefined) throw new Error(`the shipped core bundle has no key "${key}"`);
  return template;
}

const INSTALL: TagOption = { id: '00000000-0000-4000-8000-0000000000a1', name: 'Installation', color: '#0ea5e9' };
const URGENT: TagOption = { id: '00000000-0000-4000-8000-0000000000a2', name: 'Urgent', color: '#dc2626' };

const loadTags = vi.fn<() => Promise<readonly TagOption[]>>();

beforeEach(() => {
  loadTags.mockReset();
  loadTags.mockResolvedValue([INSTALL, URGENT]);
});

describe('TagChips', () => {
  it('lists each tag as a chip in its own colour, and nothing for none', () => {
    const { container, rerender } = renderWithI18n(<TagChips tags={[INSTALL, URGENT]} />, { core: CORE });
    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual(['Installation', 'Urgent']);
    expect(container.innerHTML).toMatch(/#0ea5e9|rgb\(14, 165, 233\)/);
    rerender(<TagChips tags={[]} />);
    expect(screen.queryByRole('list')).toBeNull();
  });
});

describe('TagMultiSelect — options from the caller', () => {
  it('offers the tags the loader answers, and returns the choice in the list’s order', async () => {
    const onChange = vi.fn();
    renderWithI18n(<TagMultiSelect ariaLabel="Tags" selected={[]} onChange={onChange} loadTags={loadTags} />, {
      core: CORE,
    });
    const trigger = await screen.findByRole('button', { name: /Tags/ });
    await waitFor(() => expect(trigger).not.toBeDisabled());
    expect(loadTags).toHaveBeenCalledTimes(1);
    await userEvent.click(trigger);
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Urgent' }));
    expect(onChange).toHaveBeenLastCalledWith([URGENT.id]);
  });

  it('keeps the list order for a selection made in the other order', async () => {
    const onChange = vi.fn();
    renderWithI18n(
      <TagMultiSelect ariaLabel="Tags" selected={[URGENT.id]} onChange={onChange} loadTags={loadTags} />,
      { core: CORE },
    );
    const trigger = await screen.findByRole('button', { name: /Tags/ });
    await waitFor(() => expect(trigger).not.toBeDisabled());
    await userEvent.click(trigger);
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Installation' }));
    expect(onChange).toHaveBeenLastCalledWith([INSTALL.id, URGENT.id]);
  });

  it('is disabled and says so when no tag is defined', async () => {
    loadTags.mockResolvedValue([]);
    renderWithI18n(<TagMultiSelect ariaLabel="Tags" selected={[]} onChange={vi.fn()} loadTags={loadTags} />, {
      core: CORE,
    });
    const trigger = await screen.findByRole('button', { name: /Tags/ });
    await waitFor(() => expect(trigger).toHaveTextContent(core('tags.picker.none')));
    expect(trigger).toBeDisabled();
  });

  it('takes its name from a visible label by id, with no second copy in aria-label (165 T092)', async () => {
    renderWithI18n(
      <>
        <span id="tags-label">Tags</span>
        <TagMultiSelect ariaLabelledBy="tags-label" selected={[]} onChange={vi.fn()} loadTags={loadTags} />
      </>,
      { core: CORE },
    );
    const trigger = await screen.findByRole('button', { name: 'Tags' });
    expect(trigger).toHaveAttribute('aria-labelledby', 'tags-label');
    expect(trigger).not.toHaveAttribute('aria-label');
  });

  it('says the list could not be read when the loader fails', async () => {
    loadTags.mockRejectedValue(new Error('boom'));
    renderWithI18n(<TagMultiSelect ariaLabel="Tags" selected={[]} onChange={vi.fn()} loadTags={loadTags} />, {
      core: CORE,
    });
    expect((await screen.findByRole('alert')).textContent).toBe(core('tags.picker.loadError'));
  });
});
