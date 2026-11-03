import type { ReactNode } from 'react';

/**
 * A Stage's colour as a small dot. Decorative: the Stage's name is always
 * beside it, so nothing is told by colour alone.
 */
export function StageDot(props: { color: string; className?: string }): ReactNode {
  return (
    <span
      aria-hidden="true"
      className={`inline-block size-2.5 shrink-0 rounded-full border border-border ${props.className ?? ''}`}
      style={{ backgroundColor: props.color }}
    />
  );
}
