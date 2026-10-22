import { useCallback, useRef, useState } from 'react';

/**
 * Keyboard-, pointer- and touch-operable reordering across **sections** — the
 * multi-section sibling of `useReorderList` (feature 159, research R-21,
 * `specs/159-quote-request-item-groups/contracts/ui.md` §1.1).
 *
 * A model is an ordered list of sections, each holding item ids; at most one
 * is `fixed` (the ungrouped lines), which stays last and never moves. Items
 * move within a section and across section boundaries; non-fixed sections
 * (groups) move among themselves.
 *
 * The idiom is `useReorderList`'s, deliberately: native HTML5 pointer drag (no
 * dependency), the ARIA grab-mode keyboard map, non-drag calls for buttons and
 * menus, every move announced. **The hook owns no list** — the caller receives
 * `onMoveItem(id, sectionKey, index)` / `onMoveSection(key, index)` and applies
 * them to its own draft; the indexes are positions *after* the moved element
 * has been taken out. **All copy is a prop.**
 */

export interface GroupedReorderSection {
  readonly key: string;
  /** The fixed (ungrouped) section: last, never moved, nothing moves below it. */
  readonly fixed?: boolean;
  readonly itemIds: readonly string[];
}

export interface GroupedReorderModel {
  readonly sections: readonly GroupedReorderSection[];
}

/** An item's place, as read aloud: 1-based. */
export interface GroupedItemContext {
  name: string;
  section: string;
  index: number;
  total: number;
}

/** A group's place among the groups, as read aloud: 1-based. */
export interface GroupedSectionContext {
  name: string;
  index: number;
  total: number;
}

export interface GroupedReorderLabels {
  itemGrabbed: (context: GroupedItemContext) => string;
  itemMoved: (context: GroupedItemContext) => string;
  itemDropped: (context: GroupedItemContext) => string;
  itemCancelled: (context: GroupedItemContext) => string;
  groupGrabbed: (context: GroupedSectionContext) => string;
  groupMoved: (context: GroupedSectionContext) => string;
  groupDropped: (context: GroupedSectionContext) => string;
  groupCancelled: (context: GroupedSectionContext) => string;
  atStart: (context: { name: string }) => string;
  atEnd: (context: { name: string }) => string;
  /** `aria-label` of a line's drag handle. */
  itemHandle: (context: { name: string }) => string;
  /** `aria-label` of a group's drag handle. */
  groupHandle: (context: { name: string }) => string;
  /** `aria-roledescription` for a line. Defaults to `'sortable item'`. */
  roleDescription?: string;
}

export interface UseGroupedReorderOptions {
  model: GroupedReorderModel;
  getItemLabel: (id: string) => string;
  getSectionLabel: (key: string) => string;
  onMoveItem: (id: string, toSectionKey: string, toIndex: number) => void;
  /** Never called for a `fixed` section; `toIndex` counts groups only. */
  onMoveSection: (key: string, toIndex: number) => void;
  labels: GroupedReorderLabels;
  /** Turns every affordance off and announces nothing (read-only, saving). */
  disabled?: boolean;
  /** Id of the visually-hidden instructions paragraph, for `aria-describedby`. */
  instructionsId?: string;
}

/** The slice of a keyboard event the hook consumes. */
export interface GroupedReorderKeyboardEvent {
  key: string;
  altKey: boolean;
  preventDefault: () => void;
  stopPropagation: () => void;
}

interface DragEventLike {
  preventDefault: () => void;
  stopPropagation?: () => void;
  dataTransfer?: { effectAllowed?: string; setData?: (format: string, data: string) => void } | null;
}

export interface GroupedItemProps {
  draggable: boolean;
  'aria-roledescription': string;
  onDragStart: (event: DragEventLike) => void;
  onDragOver: (event: DragEventLike) => void;
  onDragLeave: () => void;
  onDrop: (event: DragEventLike) => void;
  onDragEnd: () => void;
}

export interface GroupedHandleProps {
  type: 'button';
  'aria-label': string;
  'aria-pressed': boolean;
  'aria-describedby': string | undefined;
  disabled: boolean;
  onKeyDown: (event: GroupedReorderKeyboardEvent) => void;
}

export interface GroupedSectionHandleProps extends GroupedHandleProps {
  draggable: boolean;
  onDragStart: (event: DragEventLike) => void;
  onDragEnd: () => void;
}

export interface GroupedSectionProps {
  onDragOver: (event: DragEventLike) => void;
  onDragLeave: () => void;
  onDrop: (event: DragEventLike) => void;
}

export interface UseGroupedReorderResult {
  /** The sentence the live region is currently carrying. */
  announcement: string;
  /** Lets the caller announce a sentence of its own through the same region. */
  announce: (message: string) => void;
  grabbedItemId: string | null;
  grabbedSectionKey: string | null;
  /** What a pointer drag is over: an item id, or `section:<key>`. */
  dropTarget: string | null;
  moveItemBy: (id: string, delta: -1 | 1) => void;
  /** To `index` of `sectionKey` (default: its end). */
  moveItemTo: (id: string, sectionKey: string, index?: number) => void;
  moveSectionBy: (key: string, delta: -1 | 1) => void;
  getItemProps: (id: string) => GroupedItemProps;
  getItemHandleProps: (id: string) => GroupedHandleProps;
  getSectionProps: (key: string) => GroupedSectionProps;
  getSectionHandleProps: (key: string) => GroupedSectionHandleProps;
}

type Grab =
  | { kind: 'item'; id: string; originSection: string; originIndex: number }
  | { kind: 'section'; key: string; originIndex: number };

type Drag = { kind: 'item'; id: string } | { kind: 'section'; key: string };

export function useGroupedReorder(options: UseGroupedReorderOptions): UseGroupedReorderResult {
  const { model, getItemLabel, getSectionLabel, onMoveItem, onMoveSection, labels, disabled = false } = options;
  const [announcement, setAnnouncement] = useState('');
  const [grab, setGrab] = useState<Grab | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  // A ref, not state: the drop handler of the same gesture must see it at once.
  const dragRef = useRef<Drag | null>(null);

  const sections = model.sections;
  const groups = sections.filter((section) => !section.fixed);

  const locate = useCallback(
    (id: string): { sectionIndex: number; index: number } | null => {
      for (const [sectionIndex, section] of sections.entries()) {
        const index = section.itemIds.indexOf(id);
        if (index >= 0) return { sectionIndex, index };
      }
      return null;
    },
    [sections],
  );

  /** The single item mutation every affordance funnels through. */
  const applyItemMove = useCallback(
    (id: string, sectionKey: string, index: number, announce: (c: GroupedItemContext) => string): boolean => {
      if (disabled) return false;
      const from = locate(id);
      const target = sections.find((section) => section.key === sectionKey);
      if (!from || !target) return false;
      const sameSection = sections[from.sectionIndex]!.key === sectionKey;
      if (sameSection && from.index === index) return false;
      const total = target.itemIds.length + (sameSection ? 0 : 1);
      onMoveItem(id, sectionKey, index);
      setAnnouncement(
        announce({ name: getItemLabel(id), section: getSectionLabel(sectionKey), index: index + 1, total }),
      );
      return true;
    },
    [disabled, locate, sections, onMoveItem, getItemLabel, getSectionLabel],
  );

  const moveItemBy = useCallback(
    (id: string, delta: -1 | 1, announce: (c: GroupedItemContext) => string = labels.itemMoved): void => {
      if (disabled) return;
      const from = locate(id);
      if (!from) return;
      const section = sections[from.sectionIndex]!;
      const name = getItemLabel(id);
      if (delta < 0) {
        if (from.index > 0) applyItemMove(id, section.key, from.index - 1, announce);
        else if (from.sectionIndex > 0) {
          const previous = sections[from.sectionIndex - 1]!;
          applyItemMove(id, previous.key, previous.itemIds.length, announce);
        } else setAnnouncement(labels.atStart({ name }));
        return;
      }
      if (from.index < section.itemIds.length - 1) applyItemMove(id, section.key, from.index + 1, announce);
      else if (from.sectionIndex < sections.length - 1) {
        applyItemMove(id, sections[from.sectionIndex + 1]!.key, 0, announce);
      } else setAnnouncement(labels.atEnd({ name }));
    },
    [disabled, locate, sections, getItemLabel, applyItemMove, labels],
  );

  const moveItemTo = useCallback(
    (id: string, sectionKey: string, index?: number): void => {
      const target = sections.find((section) => section.key === sectionKey);
      if (!target) return;
      const from = locate(id);
      const sameSection = from !== null && sections[from.sectionIndex]!.key === sectionKey;
      const end = target.itemIds.length - (sameSection ? 1 : 0);
      applyItemMove(id, sectionKey, Math.max(0, Math.min(index ?? end, end)), labels.itemMoved);
    },
    [sections, locate, applyItemMove, labels.itemMoved],
  );

  const applySectionMove = useCallback(
    (key: string, toIndex: number, announce: (c: GroupedSectionContext) => string): boolean => {
      if (disabled) return false;
      const from = groups.findIndex((group) => group.key === key);
      if (from < 0 || from === toIndex) return false;
      const name = getSectionLabel(key);
      if (toIndex < 0) {
        setAnnouncement(labels.atStart({ name }));
        return false;
      }
      if (toIndex > groups.length - 1) {
        setAnnouncement(labels.atEnd({ name }));
        return false;
      }
      onMoveSection(key, toIndex);
      setAnnouncement(announce({ name, index: toIndex + 1, total: groups.length }));
      return true;
    },
    [disabled, groups, getSectionLabel, labels, onMoveSection],
  );

  const moveSectionBy = useCallback(
    (key: string, delta: -1 | 1, announce: (c: GroupedSectionContext) => string = labels.groupMoved): void => {
      const from = groups.findIndex((group) => group.key === key);
      if (from < 0) return;
      applySectionMove(key, from + delta, announce);
    },
    [groups, applySectionMove, labels.groupMoved],
  );

  const onItemKeyDown = useCallback(
    (id: string, event: GroupedReorderKeyboardEvent): void => {
      if (disabled) return;
      const from = locate(id);
      if (!from) return;
      const section = sections[from.sectionIndex]!;
      const held = grab?.kind === 'item' && grab.id === id;
      const context = (): GroupedItemContext => ({
        name: getItemLabel(id),
        section: getSectionLabel(section.key),
        index: from.index + 1,
        total: section.itemIds.length,
      });
      if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        event.preventDefault();
        moveItemBy(id, event.key === 'ArrowUp' ? -1 : 1);
        return;
      }
      switch (event.key) {
        case ' ':
        case 'Spacebar':
        case 'Enter':
          event.preventDefault();
          if (held) {
            setGrab(null);
            setAnnouncement(labels.itemDropped(context()));
          } else {
            setGrab({ kind: 'item', id, originSection: section.key, originIndex: from.index });
            setAnnouncement(labels.itemGrabbed(context()));
          }
          return;
        case 'ArrowUp':
        case 'ArrowDown':
          if (!held) return;
          event.preventDefault();
          moveItemBy(id, event.key === 'ArrowUp' ? -1 : 1);
          return;
        case 'Escape': {
          if (!held || grab?.kind !== 'item') return;
          event.preventDefault();
          const origin = grab;
          setGrab(null);
          const back = sections.find((candidate) => candidate.key === origin.originSection);
          if (!back) return;
          if (section.key !== origin.originSection || from.index !== origin.originIndex) {
            onMoveItem(id, origin.originSection, origin.originIndex);
          }
          const total = back.itemIds.length + (section.key === origin.originSection ? 0 : 1);
          setAnnouncement(
            labels.itemCancelled({
              name: getItemLabel(id),
              section: getSectionLabel(origin.originSection),
              index: origin.originIndex + 1,
              total,
            }),
          );
          return;
        }
        default:
      }
    },
    [disabled, locate, sections, grab, getItemLabel, getSectionLabel, labels, moveItemBy, onMoveItem],
  );

  const onSectionKeyDown = useCallback(
    (key: string, event: GroupedReorderKeyboardEvent): void => {
      if (disabled) return;
      const from = groups.findIndex((group) => group.key === key);
      if (from < 0) return;
      const held = grab?.kind === 'section' && grab.key === key;
      const context = (): GroupedSectionContext => ({ name: getSectionLabel(key), index: from + 1, total: groups.length });
      if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        event.preventDefault();
        moveSectionBy(key, event.key === 'ArrowUp' ? -1 : 1);
        return;
      }
      switch (event.key) {
        case ' ':
        case 'Spacebar':
        case 'Enter':
          event.preventDefault();
          if (held) {
            setGrab(null);
            setAnnouncement(labels.groupDropped(context()));
          } else {
            setGrab({ kind: 'section', key, originIndex: from });
            setAnnouncement(labels.groupGrabbed(context()));
          }
          return;
        case 'ArrowUp':
        case 'ArrowDown':
          if (!held) return;
          event.preventDefault();
          moveSectionBy(key, event.key === 'ArrowUp' ? -1 : 1);
          return;
        case 'Escape': {
          if (!held || grab?.kind !== 'section') return;
          event.preventDefault();
          const origin = grab.originIndex;
          setGrab(null);
          if (origin !== from) onMoveSection(key, origin);
          setAnnouncement(labels.groupCancelled({ name: getSectionLabel(key), index: origin + 1, total: groups.length }));
          return;
        }
        default:
      }
    },
    [disabled, groups, grab, getSectionLabel, labels, moveSectionBy, onMoveSection],
  );

  const endDrag = useCallback((): void => {
    dragRef.current = null;
    setDropTarget(null);
  }, []);

  /** A drop of the dragged section onto `targetKey`'s place (the last group place for the fixed section). */
  const dropSectionOn = useCallback(
    (draggedKey: string, targetKey: string): void => {
      const target = sections.find((section) => section.key === targetKey);
      if (!target) return;
      const toIndex = target.fixed ? groups.length - 1 : groups.findIndex((group) => group.key === targetKey);
      applySectionMove(draggedKey, toIndex, labels.groupMoved);
    },
    [sections, groups, applySectionMove, labels.groupMoved],
  );

  const getItemProps = useCallback(
    (id: string): GroupedItemProps => ({
      draggable: !disabled,
      'aria-roledescription': labels.roleDescription ?? 'sortable item',
      onDragStart: (event): void => {
        if (disabled) return;
        if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer?.setData?.('text/plain', id);
        dragRef.current = { kind: 'item', id };
      },
      onDragOver: (event): void => {
        if (disabled || dragRef.current?.kind !== 'item') return;
        // Without this the browser never fires `drop`.
        event.preventDefault();
        event.stopPropagation?.();
        setDropTarget(id);
      },
      onDragLeave: (): void => setDropTarget((current) => (current === id ? null : current)),
      onDrop: (event): void => {
        const drag = dragRef.current;
        if (disabled || drag?.kind !== 'item') return;
        event.preventDefault();
        event.stopPropagation?.();
        endDrag();
        if (drag.id === id) return;
        const source = locate(drag.id);
        const target = locate(id);
        if (!source || !target) return;
        const sameSection = source.sectionIndex === target.sectionIndex;
        // Inserted before the line it was dropped on, counted without itself.
        const index = sameSection && source.index < target.index ? target.index - 1 : target.index;
        applyItemMove(drag.id, sections[target.sectionIndex]!.key, index, labels.itemMoved);
      },
      onDragEnd: endDrag,
    }),
    [disabled, labels, endDrag, locate, applyItemMove, sections],
  );

  const getSectionProps = useCallback(
    (key: string): GroupedSectionProps => ({
      onDragOver: (event): void => {
        if (disabled || dragRef.current === null) return;
        event.preventDefault();
        setDropTarget(`section:${key}`);
      },
      onDragLeave: (): void => setDropTarget((current) => (current === `section:${key}` ? null : current)),
      onDrop: (event): void => {
        const drag = dragRef.current;
        if (disabled || drag === null) return;
        event.preventDefault();
        endDrag();
        if (drag.kind === 'section') {
          dropSectionOn(drag.key, key);
          return;
        }
        moveItemTo(drag.id, key);
      },
    }),
    [disabled, endDrag, dropSectionOn, moveItemTo],
  );

  const getItemHandleProps = useCallback(
    (id: string): GroupedHandleProps => ({
      type: 'button',
      'aria-label': labels.itemHandle({ name: getItemLabel(id) }),
      'aria-pressed': grab?.kind === 'item' && grab.id === id,
      'aria-describedby': options.instructionsId,
      disabled,
      onKeyDown: (event): void => onItemKeyDown(id, event),
    }),
    [labels, getItemLabel, grab, options.instructionsId, disabled, onItemKeyDown],
  );

  const getSectionHandleProps = useCallback(
    (key: string): GroupedSectionHandleProps => ({
      type: 'button',
      'aria-label': labels.groupHandle({ name: getSectionLabel(key) }),
      'aria-pressed': grab?.kind === 'section' && grab.key === key,
      'aria-describedby': options.instructionsId,
      disabled,
      draggable: !disabled,
      onKeyDown: (event): void => onSectionKeyDown(key, event),
      onDragStart: (event): void => {
        if (disabled) return;
        if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer?.setData?.('text/plain', key);
        dragRef.current = { kind: 'section', key };
      },
      onDragEnd: endDrag,
    }),
    [labels, getSectionLabel, grab, options.instructionsId, disabled, onSectionKeyDown, endDrag],
  );

  return {
    announcement,
    announce: setAnnouncement,
    grabbedItemId: grab?.kind === 'item' ? grab.id : null,
    grabbedSectionKey: grab?.kind === 'section' ? grab.key : null,
    dropTarget,
    moveItemBy: (id, delta) => moveItemBy(id, delta),
    moveItemTo,
    moveSectionBy: (key, delta) => moveSectionBy(key, delta),
    getItemProps,
    getItemHandleProps,
    getSectionProps,
    getSectionHandleProps,
  };
}
