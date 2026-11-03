import type { ReactNode } from 'react';
import { LinkedRecords } from '../../../components/LinkedRecords.js';
import type { ProjectTabProps } from '../tabs.js';

/**
 * A Project's *Linked records* tab (User Story 6): Orders, Quote Requests and
 * Opportunities of its Organizations. Linking or unlinking changes the
 * Project's count of links, so the page reads the Project again.
 */
export function LinkedRecordsTab({ project, reload }: ProjectTabProps): ReactNode {
  return <LinkedRecords project={project} onLinksChanged={(): void => void reload()} />;
}

export default LinkedRecordsTab;
