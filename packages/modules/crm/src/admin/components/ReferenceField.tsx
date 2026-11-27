import type { ReactNode } from 'react';
import { ReferenceField as KitReferenceField, type ReferenceFieldProps as KitReferenceFieldProps } from '@endora-commerce/admin-kit/components';
import { useCrmReferences } from '../lib/references.js';

export interface ReferenceFieldProps extends Omit<KitReferenceFieldProps, 'kinds' | 'lookups'> {
  /**
   * The Organization whose people may be mentioned and whose Orders and
   * Quote Requests may be referred to — the Opportunity's. `null` while none
   * is chosen (the create form): only Tasks are offered after `@@` then.
   */
  organizationId: string | null;
  /**
   * The Opportunity the text belongs to — what the `@@` document list is
   * asked for (`specs/163-projects-and-tasks/` FR-044). Absent on the create
   * form, where the Organization chosen stands in for it.
   */
  opportunityId?: string | null;
}

/**
 * The kit's reference editor with CRM's lookups and CRM's permissions
 * (`specs/163-projects-and-tasks/` research R-17): the field a description, a
 * note, a message or an Event's description is written in. Everything it does
 * is `ReferenceField` of `@endora-commerce/admin-kit/components`; what it may
 * refer to and where the suggestions come from is `useCrmReferences`.
 */
export function ReferenceField(props: ReferenceFieldProps): ReactNode {
  const { organizationId, opportunityId, ...field } = props;
  const { kinds, lookups } = useCrmReferences({ organizationId, opportunityId: opportunityId ?? null });
  return <KitReferenceField {...field} kinds={kinds} lookups={lookups} />;
}
