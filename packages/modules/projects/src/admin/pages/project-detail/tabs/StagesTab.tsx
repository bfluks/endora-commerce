import type { ReactNode } from 'react';
import { StageEditor } from '../../../components/StageEditor.js';
import type { ProjectTabProps } from '../tabs.js';

/** A Project's *Stages* tab: its Stages and its workflow (`contracts/admin-surfaces.md` §2). */
export function StagesTab(props: ProjectTabProps): ReactNode {
  return <StageEditor project={props.project} onChange={props.onChange} reload={props.reload} />;
}

export default StagesTab;
