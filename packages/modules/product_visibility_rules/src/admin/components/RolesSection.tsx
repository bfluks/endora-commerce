import { useState, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { ProductVisibilityMappingTarget, ProductVisibilityOverviewResponse } from '@endora-commerce/contracts';
import { useConfirmDialog } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import {
  Button,
  EditorSection,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@endora-commerce/admin-kit/ui';
import { productVisibilityClient } from '../api.js';
import { INERT_CLASS, isMappable, refusalMessage, roleRowId, roleWarningLabels } from '../lib/labels.js';
import { RoleEffect } from './RoleEffect.js';

const UNRESTRICTED = 'unrestricted';

/** The section's id: the unmapped-roles notice and the role screens link to it. */
export const ROLES_SECTION_ID = 'visibility-roles';

type Overview = ProductVisibilityOverviewResponse;
type Role = Overview['roles'][number];

export interface RolesSectionProps {
  readonly overview: Overview;
  readonly writable: boolean;
  /** Re-reads the overview; resolves with the fresh one, or `null` when the read failed. */
  readonly onChanged: () => Promise<Overview | null>;
  readonly onStatus: (message: string, tone: 'success' | 'error') => void;
}

/** The select's value for a role's stored mapping: a category id, `unrestricted`, or none. */
function mappingValue(role: Role): string {
  if (role.categoryId) return role.categoryId;
  return role.effect === 'mapped_unrestricted' ? UNRESTRICTED : '';
}

function targetOf(value: string): ProductVisibilityMappingTarget | null {
  if (value === '') return null;
  if (value === UNRESTRICTED) return { kind: 'unrestricted' };
  return { kind: 'category', categoryId: value };
}

/**
 * FR-020 – FR-026, FR-086 — each admin role's mapping and what it does. Roles that are always
 * unrestricted (FR-022, FR-026) are listed with that, and offer no mapping (US2-6). A mapping
 * saves on change: one choice, one audited write, its result said in the page's status line.
 */
export function RolesSection({ overview, writable, onChanged, onStatus }: RolesSectionProps): ReactNode {
  const t = useTranslation('product_visibility_rules');
  const { confirm, confirmDialog } = useConfirmDialog();
  // Per role: the choice being written, shown at once (optimistic) and dropped once the
  // overview has been read again — so a refused choice snaps back, and two rows never share
  // one busy flag that the first to finish would clear for both.
  const [pending, setPending] = useState<Readonly<Record<string, string>>>({});

  /** What the role sees after the write, said in the status line (US2, checkpoint 2). */
  const effectSentence = (role: Role, value: string, fresh: Overview | null): string => {
    if (value === UNRESTRICTED) return t('config.roles.nowSeesAll', { role: role.name });
    if (value !== '') {
      const category = (fresh ?? overview).categories.find((c) => c.id === value);
      return t('config.roles.nowSeesCategory', { role: role.name, category: category?.name ?? '' });
    }
    const after = fresh?.roles.find((r) => r.roleId === role.roleId);
    if (after === undefined) return t('config.roles.saved', { role: role.name });
    return after.effect === 'sees_no_products'
      ? t('config.roles.nowSeesNothing', { role: role.name })
      : t('config.roles.nowSeesAll', { role: role.name });
  };

  const save = async (role: Role, value: string): Promise<void> => {
    if (pending[role.roleId] !== undefined) return;
    // Leaving a mapping for none may leave the role with no products at all (FR-023, a role
    // that handles quote requests): asked first. The overview does not say which roles handle
    // quote requests, so every mapped role is asked, in words that say "if".
    if (value === '' && (role.effect === 'mapped' || role.effect === 'mapped_unrestricted')) {
      const ok = await confirm({
        title: t('config.roles.unmapTitle', { role: role.name }),
        message: t('config.roles.unmapMessage'),
        confirmLabel: t('config.roles.removeMapping'),
        cancelLabel: t('config.cancel'),
        destructive: true,
      });
      if (!ok) return;
    }
    setPending((prev) => ({ ...prev, [role.roleId]: value }));
    let saved = false;
    try {
      await productVisibilityClient.setRoleMapping(role.roleId, targetOf(value));
      saved = true;
    } catch (err) {
      onStatus(refusalMessage(err, t('config.error.write')), 'error');
    }
    // Re-read either way: a refused choice must not stay on screen as if it were saved.
    const fresh = await onChanged();
    if (saved) onStatus(effectSentence(role, value, fresh), 'success');
    setPending((prev) => {
      const next = { ...prev };
      delete next[role.roleId];
      return next;
    });
  };

  return (
    <EditorSection id={ROLES_SECTION_ID} as="h2" chrome="card" title={t('config.roles.title')} description={t('config.roles.description')}>
      <div className="overflow-x-auto">
        <Table aria-labelledby={`${ROLES_SECTION_ID}-title`}>
          <TableHeader>
            <TableRow>
              <TableHead>{t('config.roles.column.role')}</TableHead>
              <TableHead>{t('config.roles.column.effect')}</TableHead>
              <TableHead>{t('config.roles.column.mapping')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {overview.roles.map((role) => (
              <TableRow key={role.roleId} id={roleRowId(role.roleId)} tabIndex={-1} data-role-row className="focus-visible:outline-2 focus-visible:outline-ring">
                <TableCell className="align-top">
                  <p className="font-medium break-words">{role.name}</p>
                  <p className="font-mono text-xs text-muted-foreground">{role.code}</p>
                </TableCell>
                <TableCell className="align-top">
                  <RoleEffect role={role} categories={overview.categories} showCategory={false} />
                  <RoleWarnings role={role} />
                </TableCell>
                <TableCell className="align-top">
                  <MappingCell
                    role={role}
                    overview={overview}
                    writable={writable}
                    pending={pending[role.roleId]}
                    onChange={(value): void => void save(role, value)}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {confirmDialog}
    </EditorSection>
  );
}

/** FR-026 (a mapping without effect) and FR-086 (the audit log names products) — in words, with an icon. */
function RoleWarnings({ role }: { readonly role: Role }): ReactNode {
  const t = useTranslation('product_visibility_rules');
  const lines: string[] = [];
  if (role.effect === 'mapping_without_effect') lines.push(t('roleWarning.mapping_without_effect'));
  for (const warning of role.warnings) lines.push(roleWarningLabels.label(t, warning));
  if (lines.length === 0) return null;
  return (
    <ul className="mt-1 space-y-1">
      {lines.map((line) => (
        <li key={line} className="flex items-start gap-1.5 text-xs text-[var(--warn-soft-fg)]">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>{line}</span>
        </li>
      ))}
    </ul>
  );
}

interface MappingCellProps {
  readonly role: Role;
  readonly overview: Overview;
  readonly writable: boolean;
  /** The choice being written; `undefined` when the row is idle. */
  readonly pending: string | undefined;
  readonly onChange: (value: string) => void;
}

function MappingCell({ role, overview, writable, pending, onChange }: MappingCellProps): ReactNode {
  const t = useTranslation('product_visibility_rules');
  const busy = pending !== undefined;
  if (role.effect === 'unmappable_unrestricted') {
    return <span className="text-sm text-muted-foreground">{t('config.roles.notMappableBecause')}</span>;
  }
  if (role.effect === 'mapping_without_effect') {
    // The role gained a self-lifting permission after it was mapped (FR-026): nothing can be
    // mapped any more, and the stored mapping can only be removed.
    return writable ? (
      <Button
        type="button"
        size="sm"
        variant="outline"
        className={INERT_CLASS}
        aria-label={t('config.roles.removeMappingOf', { role: role.name })}
        aria-disabled={busy || undefined}
        aria-busy={busy}
        onClick={(): void => {
          if (!busy) onChange('');
        }}
      >
        {t('config.roles.removeMapping')}
      </Button>
    ) : (
      <span className="text-sm text-muted-foreground">{t('config.roles.notMappable')}</span>
    );
  }
  const value = pending ?? mappingValue(role);
  if (!writable || !isMappable(role)) {
    const category = overview.categories.find((c) => c.id === value);
    const text = category ? category.name : value === UNRESTRICTED ? t('config.roles.target.unrestricted') : t('config.roles.target.none');
    return <span className="text-sm break-words">{text}</span>;
  }
  return (
    <Select
      aria-label={t('config.roles.mappingFor', { role: role.name })}
      value={value}
      // aria-disabled, not disabled: focus stays on the select while its choice is written
      // (WCAG 2.4.3); a change made meanwhile is ignored.
      aria-disabled={busy || undefined}
      aria-busy={busy}
      className={`min-w-48 ${INERT_CLASS}`}
      onChange={(e): void => {
        if (!busy) onChange(e.target.value);
      }}
    >
      <option value="">{t('config.roles.target.none')}</option>
      <option value={UNRESTRICTED}>{t('config.roles.target.unrestricted')}</option>
      {overview.categories.map((category) => (
        <option key={category.id} value={category.id}>
          {category.name}
        </option>
      ))}
    </Select>
  );
}
