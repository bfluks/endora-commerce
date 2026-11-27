import { useState, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { ProductVisibilityMappingTarget, ProductVisibilityOverviewResponse } from '@endora-commerce/contracts';
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
import { isMappable, refusalMessage, roleWarningLabels } from '../lib/labels.js';
import { RoleEffect } from './RoleEffect.js';

const MODULE = 'product_visibility_rules';
const UNRESTRICTED = 'unrestricted';

type Overview = ProductVisibilityOverviewResponse;
type Role = Overview['roles'][number];

export interface RolesSectionProps {
  readonly overview: Overview;
  readonly writable: boolean;
  readonly onChanged: () => Promise<void>;
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
  const t = useTranslation(MODULE);
  const [busyRole, setBusyRole] = useState<string | null>(null);

  const save = async (role: Role, value: string): Promise<void> => {
    setBusyRole(role.roleId);
    try {
      await productVisibilityClient.setRoleMapping(role.roleId, targetOf(value));
      onStatus(t('config.roles.saved', { role: role.name }), 'success');
    } catch (err) {
      onStatus(refusalMessage(err, t('config.error.write')), 'error');
    } finally {
      // Re-read either way: a refused choice must not stay on screen as if it were saved.
      await onChanged();
      setBusyRole(null);
    }
  };

  return (
    <EditorSection as="h2" chrome="card" title={t('config.roles.title')} description={t('config.roles.description')}>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('config.roles.column.role')}</TableHead>
              <TableHead>{t('config.roles.column.effect')}</TableHead>
              <TableHead>{t('config.roles.column.mapping')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {overview.roles.map((role) => (
              <TableRow key={role.roleId} data-role-row>
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
                    busy={busyRole === role.roleId}
                    onChange={(value): void => void save(role, value)}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </EditorSection>
  );
}

/** FR-026 (a mapping without effect) and FR-086 (the audit log names products) — in words, with an icon. */
function RoleWarnings({ role }: { readonly role: Role }): ReactNode {
  const t = useTranslation(MODULE);
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
  readonly busy: boolean;
  readonly onChange: (value: string) => void;
}

function MappingCell({ role, overview, writable, busy, onChange }: MappingCellProps): ReactNode {
  const t = useTranslation(MODULE);
  if (role.effect === 'unmappable_unrestricted') {
    return <span className="text-sm text-muted-foreground">{t('config.roles.notMappable')}</span>;
  }
  if (role.effect === 'mapping_without_effect') {
    // The role gained a self-lifting permission after it was mapped (FR-026): nothing can be
    // mapped any more, and the stored mapping can only be removed.
    return writable ? (
      <Button type="button" size="sm" variant="outline" disabled={busy} aria-busy={busy} onClick={(): void => onChange('')}>
        {t('config.roles.removeMapping')}
      </Button>
    ) : (
      <span className="text-sm text-muted-foreground">{t('config.roles.notMappable')}</span>
    );
  }
  const value = mappingValue(role);
  if (!writable || !isMappable(role)) {
    const category = overview.categories.find((c) => c.id === value);
    const text = category ? category.name : value === UNRESTRICTED ? t('config.roles.target.unrestricted') : t('config.roles.target.none');
    return <span className="text-sm break-words">{text}</span>;
  }
  return (
    <Select
      aria-label={t('config.roles.mappingFor', { role: role.name })}
      value={value}
      disabled={busy}
      aria-busy={busy}
      className="min-w-48"
      onChange={(e): void => onChange(e.target.value)}
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
