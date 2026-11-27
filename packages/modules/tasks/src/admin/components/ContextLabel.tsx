import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { TaskContextSummary } from '@endora-commerce/contracts';
import { NO_VALUE } from '../lib/labels.js';

/**
 * The record a Task belongs to, as its owner describes it
 * (`TaskContextSummarySchema`): a link while the record is available and has
 * an address, its label as plain text otherwise — an unavailable record is
 * named ("Unavailable record") but never linked. The group (a Project's Stage)
 * follows the label.
 */
export function ContextLabel(props: { context: TaskContextSummary | null }): ReactNode {
  const { context } = props;
  if (context === null) return <span className="text-muted-foreground">{NO_VALUE}</span>;
  const label =
    context.available && context.href ? (
      <Link to={context.href} className="text-primary underline-offset-4 hover:underline">
        {context.label}
      </Link>
    ) : (
      <span className="text-muted-foreground">{context.label}</span>
    );
  return (
    <span className="flex flex-col gap-0.5 [overflow-wrap:anywhere]">
      {label}
      {context.groupLabel ? <span className="text-xs text-muted-foreground">{context.groupLabel}</span> : null}
    </span>
  );
}
