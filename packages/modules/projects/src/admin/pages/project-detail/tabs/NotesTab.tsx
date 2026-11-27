import type { ReactNode } from 'react';
import { CommentThread } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { useProjectComments, useProjectReferences } from '../../../lib/references.js';
import type { ProjectTabProps } from '../tabs.js';

/**
 * The *Notes* tab (User Story 7, FR-025): what the people running a Project
 * want remembered. A note is its author's — only they may edit or delete it,
 * whatever else they hold; the server says so too.
 */
export function NotesTab({ project }: ProjectTabProps): ReactNode {
  const t = useTranslation('projects');
  const { kinds, lookups } = useProjectReferences({
    projectId: project.id,
    hasOrganizations: project.organizations.length > 0,
  });
  const api = useProjectComments(project.id, 'note');
  return (
    <CommentThread
      kind="note"
      api={api}
      canWrite={project.permissions.canWrite}
      referenceKinds={kinds}
      lookups={lookups}
      copy={{
        title: t('tabs.notes'),
        empty: t('comments.notes.empty'),
        hint: t('comments.notes.hint'),
        composerLabel: t('comments.notes.composer.label'),
        composerPlaceholder: t('comments.notes.composer.placeholder'),
        composerSubmit: t('comments.notes.composer.submit'),
        added: t('comments.notes.added'),
        deleteBody: t('comments.delete.body'),
      }}
    />
  );
}

export default NotesTab;
