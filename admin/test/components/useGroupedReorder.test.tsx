import { StrictMode, useState, type ReactElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import {
  useGroupedReorder,
  type GroupedReorderLabels,
  type GroupedReorderModel,
} from '@endora-commerce/admin-kit/components';

/**
 * Feature 159, T017 — the multi-section sibling of `useReorderList`
 * (`specs/159-quote-request-item-groups/contracts/ui.md` §1.1).
 *
 * Lines move within and across sections by pointer, keyboard and the non-drag
 * calls; groups move among groups and never below the fixed (ungrouped)
 * section. Every move is asserted twice — the call the caller receives, and the
 * sentence the live region carries.
 */

const LABELS: GroupedReorderLabels = {
  itemGrabbed: (c) => `Grabbed ${c.name} in ${c.section}, ${c.index} of ${c.total}.`,
  itemMoved: (c) => `${c.name} moved to ${c.section}, ${c.index} of ${c.total}.`,
  itemDropped: (c) => `${c.name} dropped in ${c.section}, ${c.index} of ${c.total}.`,
  itemCancelled: (c) => `${c.name} back in ${c.section}, ${c.index} of ${c.total}.`,
  groupGrabbed: (c) => `Grabbed group ${c.name}, ${c.index} of ${c.total}.`,
  groupMoved: (c) => `Group ${c.name} moved to ${c.index} of ${c.total}.`,
  groupDropped: (c) => `Group ${c.name} dropped at ${c.index} of ${c.total}.`,
  groupCancelled: (c) => `Group ${c.name} back at ${c.index} of ${c.total}.`,
  atStart: (c) => `${c.name} is already first.`,
  atEnd: (c) => `${c.name} is already last.`,
  itemHandle: (c) => `Move line ${c.name}`,
  groupHandle: (c) => `Move group ${c.name}`,
};

const NAMES: Record<string, string> = {
  a: 'Bolt',
  b: 'Nut',
  c: 'Washer',
  d: 'Rod',
  g1: 'Ground floor',
  g2: 'First floor',
  u: 'Ungrouped',
};

/** Two groups and the fixed ungrouped section. */
const MODEL: GroupedReorderModel = {
  sections: [
    { key: 'g1', fixed: false, itemIds: ['a', 'b'] },
    { key: 'g2', fixed: false, itemIds: ['c'] },
    { key: 'u', fixed: true, itemIds: ['d'] },
  ],
};

function key(k: string, options: { altKey?: boolean } = {}) {
  return { key: k, altKey: options.altKey ?? false, preventDefault: vi.fn(), stopPropagation: vi.fn() };
}

function setup(options: { disabled?: boolean } = {}) {
  const onMoveItem = vi.fn<(id: string, section: string, index: number) => void>();
  const onMoveSection = vi.fn<(key: string, index: number) => void>();
  const view = renderHook(
    ({ model }: { model: GroupedReorderModel }) =>
      useGroupedReorder({
        model,
        getItemLabel: (id) => NAMES[id]!,
        getSectionLabel: (k) => NAMES[k]!,
        onMoveItem,
        onMoveSection,
        labels: LABELS,
        ...(options.disabled ? { disabled: true } : {}),
      }),
    { initialProps: { model: MODEL }, wrapper: ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode> },
  );
  return { ...view, onMoveItem, onMoveSection };
}

describe('useGroupedReorder — non-drag calls', () => {
  it('moves a line within its section and announces section, position and total', () => {
    const { result, onMoveItem } = setup();
    act(() => result.current.moveItemBy('a', 1));
    expect(onMoveItem).toHaveBeenCalledWith('a', 'g1', 1);
    expect(result.current.announcement).toBe('Bolt moved to Ground floor, 2 of 2.');
  });

  it('crosses a section boundary: past the last place into the next section’s first', () => {
    const { result, onMoveItem } = setup();
    act(() => result.current.moveItemBy('b', 1));
    expect(onMoveItem).toHaveBeenCalledWith('b', 'g2', 0);
    expect(result.current.announcement).toBe('Nut moved to First floor, 1 of 2.');
  });

  it('crosses upwards: before the first place into the previous section’s last', () => {
    const { result, onMoveItem } = setup();
    act(() => result.current.moveItemBy('d', -1));
    expect(onMoveItem).toHaveBeenCalledWith('d', 'g2', 1);
    expect(result.current.announcement).toBe('Rod moved to First floor, 2 of 2.');
  });

  it('refuses to move past either end and says so', () => {
    const { result, onMoveItem } = setup();
    act(() => result.current.moveItemBy('a', -1));
    expect(result.current.announcement).toBe('Bolt is already first.');
    act(() => result.current.moveItemBy('d', 1));
    expect(result.current.announcement).toBe('Rod is already last.');
    expect(onMoveItem).not.toHaveBeenCalled();
  });

  it('moves groups among groups only; the fixed section never moves and nothing goes below it', () => {
    const { result, onMoveSection } = setup();
    act(() => result.current.moveSectionBy('g1', 1));
    expect(onMoveSection).toHaveBeenCalledWith('g1', 1);
    expect(result.current.announcement).toBe('Group Ground floor moved to 2 of 2.');
    onMoveSection.mockClear();
    act(() => result.current.moveSectionBy('g2', 1));
    expect(onMoveSection).not.toHaveBeenCalled();
    expect(result.current.announcement).toBe('First floor is already last.');
    act(() => result.current.moveSectionBy('u', -1));
    expect(onMoveSection).not.toHaveBeenCalled();
  });

  it('moves a line to the end of a named section', () => {
    const { result, onMoveItem } = setup();
    act(() => result.current.moveItemTo('a', 'u'));
    expect(onMoveItem).toHaveBeenCalledWith('a', 'u', 1);
    expect(result.current.announcement).toBe('Bolt moved to Ungrouped, 2 of 2.');
  });

  it('does nothing and announces nothing when disabled', () => {
    const { result, onMoveItem, onMoveSection } = setup({ disabled: true });
    act(() => result.current.moveItemBy('a', 1));
    act(() => result.current.moveSectionBy('g1', 1));
    expect(onMoveItem).not.toHaveBeenCalled();
    expect(onMoveSection).not.toHaveBeenCalled();
    expect(result.current.announcement).toBe('');
    expect(result.current.getItemProps('a').draggable).toBe(false);
    expect(result.current.getSectionHandleProps('g1').draggable).toBe(false);
  });
});

describe('useGroupedReorder — keyboard', () => {
  it('lifts, moves across a boundary and drops a line, announcing each step', () => {
    const { result, onMoveItem, rerender } = setup();
    act(() => result.current.getItemHandleProps('b').onKeyDown(key(' ')));
    expect(result.current.announcement).toBe('Grabbed Nut in Ground floor, 2 of 2.');
    expect(result.current.getItemHandleProps('b')['aria-pressed']).toBe(true);
    act(() => result.current.getItemHandleProps('b').onKeyDown(key('ArrowDown')));
    expect(onMoveItem).toHaveBeenLastCalledWith('b', 'g2', 0);
    // The caller applies the move; the hook reads the new model.
    rerender({
      model: {
        sections: [
          { key: 'g1', fixed: false, itemIds: ['a'] },
          { key: 'g2', fixed: false, itemIds: ['b', 'c'] },
          { key: 'u', fixed: true, itemIds: ['d'] },
        ],
      },
    });
    act(() => result.current.getItemHandleProps('b').onKeyDown(key('Enter')));
    expect(result.current.announcement).toBe('Nut dropped in First floor, 1 of 2.');
    expect(result.current.getItemHandleProps('b')['aria-pressed']).toBe(false);
  });

  it('Escape puts a lifted line back where it was lifted from', () => {
    const { result, onMoveItem, rerender } = setup();
    act(() => result.current.getItemHandleProps('b').onKeyDown(key(' ')));
    act(() => result.current.getItemHandleProps('b').onKeyDown(key('ArrowDown')));
    rerender({
      model: {
        sections: [
          { key: 'g1', fixed: false, itemIds: ['a'] },
          { key: 'g2', fixed: false, itemIds: ['b', 'c'] },
          { key: 'u', fixed: true, itemIds: ['d'] },
        ],
      },
    });
    act(() => result.current.getItemHandleProps('b').onKeyDown(key('Escape')));
    expect(onMoveItem).toHaveBeenLastCalledWith('b', 'g1', 1);
    expect(result.current.announcement).toBe('Nut back in Ground floor, 2 of 2.');
  });

  it('Alt+arrow moves a line without lifting it', () => {
    const { result, onMoveItem } = setup();
    act(() => result.current.getItemHandleProps('a').onKeyDown(key('ArrowDown', { altKey: true })));
    expect(onMoveItem).toHaveBeenCalledWith('a', 'g1', 1);
  });

  it('lifts a group by its handle, moves it among groups and cancels back', () => {
    const { result, onMoveSection, rerender } = setup();
    act(() => result.current.getSectionHandleProps('g2').onKeyDown(key(' ')));
    expect(result.current.announcement).toBe('Grabbed group First floor, 2 of 2.');
    act(() => result.current.getSectionHandleProps('g2').onKeyDown(key('ArrowUp')));
    expect(onMoveSection).toHaveBeenLastCalledWith('g2', 0);
    rerender({
      model: {
        sections: [
          { key: 'g2', fixed: false, itemIds: ['c'] },
          { key: 'g1', fixed: false, itemIds: ['a', 'b'] },
          { key: 'u', fixed: true, itemIds: ['d'] },
        ],
      },
    });
    act(() => result.current.getSectionHandleProps('g2').onKeyDown(key('Escape')));
    expect(onMoveSection).toHaveBeenLastCalledWith('g2', 1);
    expect(result.current.announcement).toBe('Group First floor back at 2 of 2.');
  });

  it('names every handle', () => {
    const { result } = setup();
    expect(result.current.getItemHandleProps('a')['aria-label']).toBe('Move line Bolt');
    expect(result.current.getSectionHandleProps('g1')['aria-label']).toBe('Move group Ground floor');
  });
});

/** A tiny host rendering the model so pointer events have elements to land on. */
function Host(props: {
  onMoveItem: (id: string, section: string, index: number) => void;
  onMoveSection: (key: string, index: number) => void;
}): ReactElement {
  const [model] = useState(MODEL);
  const reorder = useGroupedReorder({
    model,
    getItemLabel: (id) => NAMES[id]!,
    getSectionLabel: (k) => NAMES[k]!,
    onMoveItem: props.onMoveItem,
    onMoveSection: props.onMoveSection,
    labels: LABELS,
  });
  return (
    <div>
      {model.sections.map((section) => (
        <section key={section.key} data-testid={`section-${section.key}`} {...reorder.getSectionProps(section.key)}>
          {section.fixed ? null : (
            <button data-testid={`handle-${section.key}`} {...reorder.getSectionHandleProps(section.key)} />
          )}
          {section.itemIds.map((id) => (
            <div key={id} data-testid={`item-${id}`} {...reorder.getItemProps(id)}>
              {NAMES[id]}
            </div>
          ))}
        </section>
      ))}
      <p role="status">{reorder.announcement}</p>
    </div>
  );
}

describe('useGroupedReorder — pointer', () => {
  function renderHost() {
    const onMoveItem = vi.fn<(id: string, section: string, index: number) => void>();
    const onMoveSection = vi.fn<(key: string, index: number) => void>();
    render(
      <StrictMode>
        <Host onMoveItem={onMoveItem} onMoveSection={onMoveSection} />
      </StrictMode>,
    );
    return { onMoveItem, onMoveSection };
  }

  it('a line dropped on a line is inserted before it, in that line’s section', () => {
    const { onMoveItem } = renderHost();
    fireEvent.dragStart(screen.getByTestId('item-d'));
    fireEvent.dragOver(screen.getByTestId('item-b'));
    fireEvent.drop(screen.getByTestId('item-b'));
    expect(onMoveItem).toHaveBeenCalledTimes(1);
    expect(onMoveItem).toHaveBeenCalledWith('d', 'g1', 1);
    expect(screen.getByRole('status')).toHaveTextContent('Rod moved to Ground floor, 2 of 3.');
  });

  it('within one section, dropping on a later line lands before it', () => {
    const { onMoveItem } = renderHost();
    fireEvent.dragStart(screen.getByTestId('item-a'));
    fireEvent.drop(screen.getByTestId('item-b'));
    // Before `b` once `a` is lifted out is where `a` already was: nothing moves.
    expect(onMoveItem).not.toHaveBeenCalled();
  });

  it('a line dropped on a section’s drop area is appended to it', () => {
    const { onMoveItem } = renderHost();
    fireEvent.dragStart(screen.getByTestId('item-a'));
    fireEvent.dragOver(screen.getByTestId('section-u'));
    fireEvent.drop(screen.getByTestId('section-u'));
    expect(onMoveItem).toHaveBeenCalledWith('a', 'u', 1);
  });

  it('a group dragged by its handle onto another group takes that group’s place; onto the fixed section, the last group place', () => {
    const { onMoveSection } = renderHost();
    fireEvent.dragStart(screen.getByTestId('handle-g2'));
    fireEvent.drop(screen.getByTestId('section-g1'));
    expect(onMoveSection).toHaveBeenLastCalledWith('g2', 0);
    fireEvent.dragStart(screen.getByTestId('handle-g1'));
    fireEvent.drop(screen.getByTestId('section-u'));
    expect(onMoveSection).toHaveBeenLastCalledWith('g1', 1);
  });
});
