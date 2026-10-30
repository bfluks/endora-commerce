import type { ReactNode } from 'react';
import type { AdminZoneProps } from '@endora-commerce/contracts';
import { ProjectPanel } from './ProjectPanel.js';

/** `projects`' contribution to `quote_request.detail.after`: the Project the record is in (User Story 6). */
export function QuoteRequestProjectPanel({ quoteRequestId }: AdminZoneProps<'quote_request.detail.after'>): ReactNode {
  return <ProjectPanel kind="quote_request" recordId={quoteRequestId} />;
}

/** The default export the zone declaration's dynamic-import factory resolves. */
export default QuoteRequestProjectPanel;
