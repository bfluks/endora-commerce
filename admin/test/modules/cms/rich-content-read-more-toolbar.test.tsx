import { describe, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { RichContentEditorField } from '@endora-commerce/cms-components';
import { renderWithI18n } from '../../helpers/render-with-i18n';

/**
 * Feature 163, T173 (R11) — the rich-text toolbar sets a read-more passage's
 * summary position (start, center, end) and whether its hidden text shows
 * above the summary. Both controls are off outside a passage, and their labels
 * are the page builder's field text (English here, Polish in the admin's `pl`).
 */

const PASSAGE = {
  type: 'doc',
  content: [
    {
      type: 'readMore',
      attrs: { open: false, summaryStyle: 'chevron' },
      content: [
        { type: 'readMoreSummary', content: [{ type: 'text', text: 'Read more' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Hidden text' }] },
      ],
    },
  ],
};

function renderEditor(value: unknown, onChange = vi.fn()) {
  renderWithI18n(
    <StrictMode>
      <RichContentEditorField value={value as never} onChange={onChange} />
    </StrictMode>,
  );
  return onChange;
}

function readMoreAttrs(onChange: ReturnType<typeof vi.fn>): Record<string, unknown> {
  expect(onChange).toHaveBeenCalled();
  const doc = onChange.mock.calls.at(-1)?.[0] as { content: Array<{ type: string; attrs?: Record<string, unknown> }> };
  return doc.content.find((node) => node.type === 'readMore')?.attrs ?? {};
}

describe('rich-text toolbar — read-more position and reveal above (T173)', () => {
  it('sets the summary position and the reveal above on the passage around the caret', async () => {
    const onChange = renderEditor(PASSAGE);
    const position = (await screen.findByRole('combobox', { name: 'Read more position' })) as HTMLSelectElement;
    await waitFor(() => expect(position.disabled).toBe(false));
    expect(Array.from(position.options).map((option) => [option.value, option.textContent])).toEqual([
      ['start', 'Start'],
      ['center', 'Center'],
      ['end', 'End'],
    ]);
    expect(position.value).toBe('start');

    act(() => {
      fireEvent.change(position, { target: { value: 'center' } });
    });
    expect(readMoreAttrs(onChange)).toMatchObject({ summaryStyle: 'chevron', chevronPosition: 'center', revealAbove: false });

    const reveal = screen.getByRole('button', { name: 'Show the revealed text above the summary' });
    expect(reveal.getAttribute('aria-pressed')).toBe('false');
    act(() => {
      fireEvent.click(reveal);
    });
    expect(readMoreAttrs(onChange)).toMatchObject({ chevronPosition: 'center', revealAbove: true });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Show the revealed text above the summary' }).getAttribute('aria-pressed')).toBe('true'));
  });

  it('leaves both off outside a passage', async () => {
    renderEditor({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Plain' }] }] });
    const position = (await screen.findByRole('combobox', { name: 'Read more position' })) as HTMLSelectElement;
    expect(position.disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Show the revealed text above the summary' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
