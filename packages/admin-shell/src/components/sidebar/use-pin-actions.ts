import { useCallback } from 'react';
import { useAdminPreference } from '@endora-commerce/admin-kit/lib';
import { pinDestination, unpinDestination } from '../../lib/pinned-entries.js';

export type PinOutcome = 'pinned' | 'unpinned';

/**
 * Feature 164 — pin and unpin a sidebar destination, for the sidebar's controls
 * and the command palette's alike (research R-15): one store, one optimistic
 * write, one append rule (FR-007).
 */
export function usePinActions(): {
  pins: readonly string[];
  isPinned(destination: string): boolean;
  /** Pin `destination` at the end, or unpin it; answers which it did. */
  toggle(destination: string): PinOutcome;
  setPins(next: string[]): void;
} {
  const [pins, setPins] = useAdminPreference('sidebarPins');
  const isPinned = useCallback((destination: string) => pins.includes(destination), [pins]);
  const toggle = useCallback(
    (destination: string): PinOutcome => {
      if (pins.includes(destination)) {
        setPins(unpinDestination(pins, destination));
        return 'unpinned';
      }
      setPins(pinDestination(pins, destination));
      return 'pinned';
    },
    [pins, setPins],
  );
  return { pins, isPinned, toggle, setPins };
}
