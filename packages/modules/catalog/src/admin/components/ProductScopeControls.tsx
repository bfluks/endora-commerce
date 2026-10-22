import { useCallback, useContext, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import {
  PRODUCT_SCOPE_STATUSES,
  type ProductScopes,
  type ProductScopeStatus,
  type ProductVisibility,
  type ScopeWarning,
} from '@endora-commerce/contracts';
import { useAuth } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Badge, Button, Checkbox, Input, Label, Select } from '@endora-commerce/admin-kit/ui';
import { OrganizationPickerMulti } from '@endora-commerce/admin-kit/components';
import { AppLanguageContext, useTranslation } from '@endora-commerce/admin-kit/i18n';
import {
  buildChannelPatch,
  draftFromChannelScope,
  inheritedStatus,
  type ChannelScopeDraft,
  type ChannelScopePatch,
} from '../lib/product-scope-drafts.js';
import {
  describeIncompletePair,
  getProductScopes,
  patchProductScopes,
  scopeSaveErrorMessage,
  shortId,
  type OrganizationLabels,
} from '../lib/product-scopes-api.js';
import type { Channel } from './ProductScopeEditor.js';

/**
 * Feature 163 (T089; US1–US3, FR-012, FR-013, FR-023, FR-030, FR-040, FR-042) — the scope
 * controls of the product editor: status per channel and per channel × language, the
 * publication window and the audience rule per channel, each with "use inherited" and the
 * source of the value it shows.
 *
 * Mounted inside `ProductScopeEditor`, under its channel switcher, which is the
 * disclosure: one channel's controls at a time (Hick). Edits are kept per channel while
 * the operator switches, and one Save sends every changed channel as **one**
 * `PATCH …/scopes` — one Command, one audit entry — carrying only the keys that changed.
 * It is not folded into the page Save: that one runs the product `PATCH` beside other
 * flushes, and a refused scope write (the completeness gate in refuse mode) must not leave
 * half of an edit committed. A refusal keeps every draft as it was.
 *
 * Changing a global value never warns about the overrides here (FR-013, A-9): the
 * inherited labels simply follow `globalStatus`.
 */

export interface ProductScopeControlsProps {
  productId: string;
  /** The product's member channels (scope-context), for names and languages. */
  channels: readonly Channel[];
  /** The channel picked in the editor's switcher; `null` = Global. */
  activeChannelId: string | null;
  /** The global status as the page form holds it, so inherited labels follow it live. */
  globalStatus?: ProductScopeStatus;
}

const VISIBILITIES: readonly ProductVisibility[] = ['public', 'logged_in_only', 'organization_restricted'];

type WindowError = { field: 'from' | 'until'; reason: 'invalidDate' | 'order' };

export function ProductScopeControls({
  productId,
  channels,
  activeChannelId,
  globalStatus: globalStatusProp,
}: ProductScopeControlsProps): ReactNode {
  const t = useTranslation('catalog');
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('catalog:write');
  const language = useContext(AppLanguageContext)?.language ?? 'en';

  const [scopes, setScopes] = useState<ProductScopes | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, ChannelScopeDraft>>({});
  const [windowErrors, setWindowErrors] = useState<Record<string, WindowError>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<ScopeWarning[]>([]);
  const [status, setStatus] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadFailed(false);
    getProductScopes(productId)
      .then((data) => {
        if (cancelled) return;
        setScopes(data);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setLoadFailed(true);
        setLoading(false);
      });
    return (): void => {
      cancelled = true;
    };
  }, [productId, reloadToken]);

  // Owner decision U1 — the scopes answer names the organizations its rules name, so the
  // non-member warning can say who without a `customers:read` read of each one.
  const orgLabels = useMemo<OrganizationLabels>(
    () => Object.fromEntries((scopes?.organizations ?? []).map((org) => [org.id, { name: org.name }])),
    [scopes],
  );

  const channelName = useCallback(
    (channelId: string): string => {
      const channel = channels.find((c) => c.id === channelId);
      return channel ? channel.name : t('productEditor.scopeControls.unknownChannel');
    },
    [channels, t],
  );

  const savedDraft = useCallback(
    (channelId: string): ChannelScopeDraft | null => {
      if (!scopes) return null;
      const row = scopes.channels.find((r) => r.channelId === channelId);
      const languages = row?.languages ?? channels.find((c) => c.id === channelId)?.languages ?? [];
      return draftFromChannelScope(scopes.global, row, languages);
    },
    [scopes, channels],
  );

  const pending = useMemo(() => {
    const entries: Array<{ channelId: string; result: ReturnType<typeof buildChannelPatch> }> = [];
    const order = channels.map((c) => c.id);
    const ids = Object.keys(drafts).sort((a, b) => order.indexOf(a) - order.indexOf(b));
    for (const id of ids) {
      const saved = savedDraft(id);
      const draft = drafts[id];
      if (!saved || !draft) continue;
      const result = buildChannelPatch(id, saved, draft);
      if (!result.ok || result.patch !== null) entries.push({ channelId: id, result });
    }
    return entries;
  }, [drafts, savedDraft, channels]);

  const update = useCallback(
    (channelId: string, changes: Partial<ChannelScopeDraft>): void => {
      const saved = savedDraft(channelId);
      if (!saved) return;
      setDrafts((prev) => ({ ...prev, [channelId]: { ...(prev[channelId] ?? saved), ...changes } }));
      setStatus('');
      setSaveError(null);
      if ('windowFrom' in changes || 'windowUntil' in changes || 'windowOverride' in changes) {
        setWindowErrors((prev) => {
          if (!(channelId in prev)) return prev;
          const next = { ...prev };
          delete next[channelId];
          return next;
        });
      }
    },
    [savedDraft],
  );

  const save = useCallback(async (): Promise<void> => {
    const patches: ChannelScopePatch[] = [];
    const errors: Record<string, WindowError> = {};
    for (const { channelId, result } of pending) {
      if (!result.ok) errors[channelId] = { field: result.field, reason: result.reason };
      else if (result.patch) patches.push(result.patch);
    }
    if (Object.keys(errors).length > 0) {
      setWindowErrors(errors);
      const elsewhere = Object.keys(errors).find((id) => id !== activeChannelId);
      setSaveError(
        elsewhere
          ? t('productEditor.scopeControls.error.windowIn', { channel: channelName(elsewhere) })
          : null,
      );
      return;
    }
    if (patches.length === 0) return;
    setSaving(true);
    setSaveError(null);
    setWarnings([]);
    setStatus(t('productEditor.scopeControls.saving'));
    try {
      const res = await patchProductScopes(productId, { channels: patches });
      setScopes(res.data);
      setDrafts({});
      setWarnings(res.warnings ?? []);
      setStatus(t('productEditor.scopeControls.saved'));
    } catch (err) {
      setSaveError(scopeSaveErrorMessage(err, channelName, t));
      setStatus('');
    } finally {
      setSaving(false);
    }
  }, [pending, activeChannelId, channelName, productId, t]);

  const statusLabel = (value: ProductScopeStatus): string =>
    t(`productEditor.scopeControls.statusValue.${value}`);
  const visibilityLabel = (value: ProductVisibility): string =>
    t(`productEditor.scopeControls.visibility.${value}`);
  const orgName = (id: string): string => orgLabels[id]?.name ?? shortId(id);
  const formatInstant = (iso: string): string =>
    new Date(iso).toLocaleString(language, { dateStyle: 'medium', timeStyle: 'short' });

  const footer = (
    <ScopeSaveFooter
      canWrite={canWrite}
      saving={saving}
      dirtyChannelNames={pending.map((p) => channelName(p.channelId))}
      status={status}
      saveError={saveError}
      onSave={(): void => {
        void save();
      }}
      onDiscard={(): void => {
        setDrafts({});
        setWindowErrors({});
        setSaveError(null);
      }}
      t={t}
    />
  );

  if (loading) {
    return (
      <p className="b2b-help" aria-busy="true">
        {t('productEditor.scopeControls.loading')}
      </p>
    );
  }
  if (loadFailed || !scopes) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          <span>{t('productEditor.scopeControls.loadFailed')}</span>{' '}
          <Button type="button" size="sm" variant="outline" onClick={(): void => setReloadToken((n) => n + 1)}>
            {t('productEditor.scopeControls.retry')}
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  const globalStatus = globalStatusProp ?? scopes.global.status;
  const activeChannel = activeChannelId ? channels.find((c) => c.id === activeChannelId) : undefined;

  if (!activeChannelId || !activeChannel) {
    return (
      <div className="b2b-col" style={{ gap: 8 }}>
        <p className="b2b-help" style={{ margin: 0 }}>
          {t('productEditor.scopeControls.pickChannel')}
        </p>
        {pending.length > 0 ? footer : null}
      </div>
    );
  }

  const saved = savedDraft(activeChannel.id);
  if (!saved) return null;
  const draft = drafts[activeChannel.id] ?? saved;
  const row = scopes.channels.find((r) => r.channelId === activeChannel.id);
  const disabled = !canWrite || saving;
  const offered = new Set(row?.languages ?? activeChannel.languages);
  const languageCodes = Object.keys(draft.languageStatuses).sort();
  const nonMembers = row?.audience?.nonMemberOrganizationIds ?? [];
  const completeness = warnings.filter(
    (w): w is Extract<ScopeWarning, { kind: 'completeness' }> => w.kind === 'completeness',
  );

  const globalWindowSummary = windowSummary(scopes.global.publishFrom, scopes.global.publishUntil, formatInstant, t);
  const globalAudienceSummary =
    scopes.global.visibility === 'organization_restricted' && scopes.global.allowedOrganizationIds.length > 0
      ? `${visibilityLabel(scopes.global.visibility)} (${scopes.global.allowedOrganizationIds.map(orgName).join(', ')})`
      : visibilityLabel(scopes.global.visibility);

  return (
    <section className="b2b-col" style={{ gap: 16 }} aria-labelledby={`scope-controls-${activeChannel.id}`}>
      <h3 id={`scope-controls-${activeChannel.id}`} className="text-sm font-semibold" style={{ margin: 0 }}>
        {t('productEditor.scopeControls.title', { channel: activeChannel.name })}
      </h3>
      {!canWrite ? (
        <p className="b2b-help" style={{ margin: 0 }}>
          {t('productEditor.scopeControls.readOnly')}
        </p>
      ) : null}

      {/* Status — first, because it is the switch (Serial Position). */}
      <fieldset className="b2b-col" style={{ gap: 10, border: 0, padding: 0, margin: 0 }}>
        <legend className="b2b-label">{t('productEditor.scopeControls.status.legend')}</legend>
        <StatusRow
          label={t('productEditor.scopeControls.status.channelLabel', { channel: activeChannel.name })}
          value={draft.status}
          inheritedValue={statusLabel(globalStatus)}
          source={
            draft.status === null
              ? t('productEditor.scopeControls.source.global', { value: statusLabel(globalStatus) })
              : t('productEditor.scopeControls.source.setChannel')
          }
          statusLabel={statusLabel}
          disabled={disabled}
          onChange={(value): void => update(activeChannel.id, { status: value })}
          t={t}
        />
        {languageCodes.map((code) => {
          const value = draft.languageStatuses[code] ?? null;
          const inherited = inheritedStatus(globalStatus, draft.status);
          const label = t('productEditor.scopeControls.status.languageLabel', {
            channel: activeChannel.name,
            language: code.toUpperCase(),
          });
          if (!offered.has(code)) {
            // FR-015 — kept and ignored until removed; removing is always allowed.
            if ((saved.languageStatuses[code] ?? null) === null && value === null) return null;
            return (
              <OrphanedLanguageRow
                key={code}
                label={label}
                language={code.toUpperCase()}
                removed={value === null}
                disabled={disabled}
                onRemove={(): void =>
                  update(activeChannel.id, {
                    languageStatuses: { ...draft.languageStatuses, [code]: null },
                  })
                }
                t={t}
              />
            );
          }
          return (
            <StatusRow
              key={code}
              label={label}
              value={value}
              inheritedValue={statusLabel(inherited.value)}
              source={
                value !== null
                  ? t('productEditor.scopeControls.source.setLanguage')
                  : inherited.source === 'global'
                    ? t('productEditor.scopeControls.source.global', { value: statusLabel(inherited.value) })
                    : t('productEditor.scopeControls.source.channel', {
                        channel: activeChannel.name,
                        value: statusLabel(inherited.value),
                      })
              }
              statusLabel={statusLabel}
              disabled={disabled}
              onChange={(next): void =>
                update(activeChannel.id, { languageStatuses: { ...draft.languageStatuses, [code]: next } })
              }
              t={t}
            />
          );
        })}
        <p className="b2b-help" style={{ margin: 0 }}>
          {t('productEditor.scopeControls.status.help')}
        </p>
      </fieldset>

      <WindowFieldset
        draft={draft}
        inheritedSummary={globalWindowSummary}
        error={windowErrors[activeChannel.id] ?? null}
        disabled={disabled}
        onChange={(changes): void => update(activeChannel.id, changes)}
        t={t}
      />

      <fieldset className="b2b-col" style={{ gap: 8, border: 0, padding: 0, margin: 0 }}>
        <legend className="b2b-label">{t('productEditor.scopeControls.audience.legend')}</legend>
        <CheckboxRow
          label={t('productEditor.scopeControls.audience.override')}
          checked={draft.audienceOverride}
          disabled={disabled}
          onChange={(checked): void => update(activeChannel.id, { audienceOverride: checked })}
        />
        {draft.audienceOverride ? (
          <AudienceEditor
            draft={draft}
            orgLabels={orgLabels}
            visibilityLabel={visibilityLabel}
            disabled={disabled}
            onChange={(changes): void => update(activeChannel.id, changes)}
            t={t}
          />
        ) : (
          <p className="b2b-help" style={{ margin: 0 }}>
            {t('productEditor.scopeControls.audience.inherited', { value: globalAudienceSummary })}
          </p>
        )}
        {nonMembers.length > 0 ? (
          <Alert variant="warning">
            <AlertDescription>
              {t('productEditor.scopeControls.audience.nonMembers', {
                channel: activeChannel.name,
                organizations: nonMembers.map(orgName).join(', '),
              })}
            </AlertDescription>
          </Alert>
        ) : null}
      </fieldset>

      {completeness.length > 0 ? (
        <Alert variant="warning">
          <AlertDescription>
            {t('productEditor.scopeControls.warning.incomplete', {
              details: completeness.map((w) => describeIncompletePair(w, channelName, t)).join('; '),
            })}
          </AlertDescription>
        </Alert>
      ) : null}

      {footer}
    </section>
  );
}

type Translate = (key: string, params?: Record<string, string>) => string;

function windowSummary(
  from: string | null,
  until: string | null,
  format: (iso: string) => string,
  t: Translate,
): string {
  if (from && until) return t('productEditor.scopeControls.window.summary.range', { from: format(from), until: format(until) });
  if (from) return t('productEditor.scopeControls.window.summary.from', { from: format(from) });
  if (until) return t('productEditor.scopeControls.window.summary.until', { until: format(until) });
  return t('productEditor.scopeControls.window.summary.none');
}

function StatusRow({
  label,
  value,
  inheritedValue,
  source,
  statusLabel,
  disabled,
  onChange,
  t,
}: {
  label: string;
  value: ProductScopeStatus | null;
  inheritedValue: string;
  source: string;
  statusLabel: (value: ProductScopeStatus) => string;
  disabled: boolean;
  onChange: (value: ProductScopeStatus | null) => void;
  t: Translate;
}): ReactNode {
  const id = useId();
  return (
    <div className="b2b-col" style={{ gap: 4 }}>
      <Label htmlFor={id}>{label}</Label>
      <div className="b2b-row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <Select
          id={id}
          value={value ?? ''}
          disabled={disabled}
          aria-describedby={`${id}-source`}
          style={{ maxWidth: 280 }}
          onChange={(e): void => onChange(e.target.value === '' ? null : (e.target.value as ProductScopeStatus))}
        >
          <option value="">{t('productEditor.scopeControls.status.inherit', { value: inheritedValue })}</option>
          {PRODUCT_SCOPE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {statusLabel(s)}
            </option>
          ))}
        </Select>
        <Badge id={`${id}-source`} variant={value === null ? 'secondary' : 'outline'}>
          {source}
        </Badge>
      </div>
    </div>
  );
}

function OrphanedLanguageRow({
  label,
  language,
  removed,
  disabled,
  onRemove,
  t,
}: {
  label: string;
  language: string;
  removed: boolean;
  disabled: boolean;
  onRemove: () => void;
  t: Translate;
}): ReactNode {
  return (
    <div className="b2b-col" style={{ gap: 4 }}>
      <span className="text-sm font-medium">{label}</span>
      <div className="b2b-row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <Badge variant="warning">
          {removed
            ? t('productEditor.scopeControls.status.orphanRemoved', { language })
            : t('productEditor.scopeControls.status.orphaned', { language })}
        </Badge>
        {!removed ? (
          <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={onRemove}>
            {t('productEditor.scopeControls.status.removeOrphan', { language })}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function CheckboxRow({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}): ReactNode {
  // The whole row is the hit area (Fitts).
  return (
    <label className="b2b-row" style={{ gap: 8, alignItems: 'center', cursor: disabled ? 'default' : 'pointer' }}>
      <Checkbox checked={checked} disabled={disabled} onChange={(e): void => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

function WindowFieldset({
  draft,
  inheritedSummary,
  error,
  disabled,
  onChange,
  t,
}: {
  draft: ChannelScopeDraft;
  inheritedSummary: string;
  error: WindowError | null;
  disabled: boolean;
  onChange: (changes: Partial<ChannelScopeDraft>) => void;
  t: Translate;
}): ReactNode {
  const id = useId();
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  const describedBy = (field: 'from' | 'until'): string =>
    error && error.field === field ? `${helpId} ${errorId}` : helpId;
  // Enter in a date field must not submit the surrounding product form.
  const stopEnter = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') e.preventDefault();
  };
  return (
    <fieldset className="b2b-col" style={{ gap: 8, border: 0, padding: 0, margin: 0 }}>
      <legend className="b2b-label">{t('productEditor.scopeControls.window.legend')}</legend>
      <CheckboxRow
        label={t('productEditor.scopeControls.window.override')}
        checked={draft.windowOverride}
        disabled={disabled}
        onChange={(checked): void => onChange({ windowOverride: checked })}
      />
      {draft.windowOverride ? (
        <>
          <div className="b2b-row" style={{ gap: 12, flexWrap: 'wrap' }}>
            <div className="b2b-col" style={{ gap: 4 }}>
              <Label htmlFor={`${id}-from`}>{t('productEditor.scopeControls.window.from')}</Label>
              <Input
                id={`${id}-from`}
                type="datetime-local"
                value={draft.windowFrom}
                disabled={disabled}
                aria-invalid={error?.field === 'from' ? true : undefined}
                aria-describedby={describedBy('from')}
                onKeyDown={stopEnter}
                onChange={(e): void => onChange({ windowFrom: e.target.value })}
              />
            </div>
            <div className="b2b-col" style={{ gap: 4 }}>
              <Label htmlFor={`${id}-until`}>{t('productEditor.scopeControls.window.until')}</Label>
              <Input
                id={`${id}-until`}
                type="datetime-local"
                value={draft.windowUntil}
                disabled={disabled}
                aria-invalid={error?.field === 'until' ? true : undefined}
                aria-describedby={describedBy('until')}
                onKeyDown={stopEnter}
                onChange={(e): void => onChange({ windowUntil: e.target.value })}
              />
            </div>
          </div>
          <p id={helpId} className="b2b-help" style={{ margin: 0 }}>
            {t('productEditor.scopeControls.window.help')}
          </p>
          {error ? (
            <p id={errorId} role="alert" className="text-sm text-destructive" style={{ margin: 0 }}>
              {error.reason === 'order'
                ? t('productEditor.scopeControls.window.invalidOrder')
                : t('productEditor.scopeControls.window.invalidDate')}
            </p>
          ) : null}
        </>
      ) : (
        <p className="b2b-help" style={{ margin: 0 }}>
          {t('productEditor.scopeControls.window.inherited', { value: inheritedSummary })}
        </p>
      )}
    </fieldset>
  );
}

function AudienceEditor({
  draft,
  orgLabels,
  visibilityLabel,
  disabled,
  onChange,
  t,
}: {
  draft: ChannelScopeDraft;
  orgLabels: OrganizationLabels;
  visibilityLabel: (value: ProductVisibility) => string;
  disabled: boolean;
  onChange: (changes: Partial<ChannelScopeDraft>) => void;
  t: Translate;
}): ReactNode {
  const id = useId();
  return (
    <div className="b2b-col" style={{ gap: 8 }}>
      <div className="b2b-col" style={{ gap: 4 }}>
        <Label htmlFor={`${id}-visibility`}>{t('productEditor.scopeControls.audience.visibility')}</Label>
        <Select
          id={`${id}-visibility`}
          value={draft.visibility}
          disabled={disabled}
          aria-describedby={`${id}-help`}
          style={{ maxWidth: 280 }}
          onChange={(e): void => onChange({ visibility: e.target.value as ProductVisibility })}
        >
          {VISIBILITIES.map((v) => (
            <option key={v} value={v}>
              {visibilityLabel(v)}
            </option>
          ))}
        </Select>
        <p id={`${id}-help`} className="b2b-help" style={{ margin: 0 }}>
          {t('productEditor.scopeControls.audience.help')}
        </p>
      </div>
      {draft.visibility === 'organization_restricted' ? (
        <div className="b2b-col" style={{ gap: 4 }}>
          <Label htmlFor={`${id}-orgs`}>{t('productEditor.scopeControls.audience.organizations')}</Label>
          <OrganizationPickerMulti
            id={`${id}-orgs`}
            value={draft.allowedOrganizationIds}
            selectedLabels={orgLabels}
            disabled={disabled}
            placeholder={t('productEditor.scopeControls.audience.organizationsPlaceholder')}
            emptyMessage={t('productEditor.scopeControls.audience.organizationsEmpty')}
            ariaLabel={t('productEditor.scopeControls.audience.organizationsAria')}
            onChange={(ids): void => onChange({ allowedOrganizationIds: ids })}
          />
          {draft.allowedOrganizationIds.length === 0 ? (
            <p className="b2b-help" style={{ margin: 0 }}>
              {t('productEditor.scopeControls.audience.noOrganizations')}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ScopeSaveFooter({
  canWrite,
  saving,
  dirtyChannelNames,
  status,
  saveError,
  onSave,
  onDiscard,
  t,
}: {
  canWrite: boolean;
  saving: boolean;
  dirtyChannelNames: string[];
  status: string;
  saveError: string | null;
  onSave: () => void;
  onDiscard: () => void;
  t: Translate;
}): ReactNode {
  const dirty = dirtyChannelNames.length > 0;
  return (
    <div className="b2b-col" style={{ gap: 8 }}>
      {saveError ? (
        <Alert variant="destructive">
          <AlertDescription>{saveError}</AlertDescription>
        </Alert>
      ) : null}
      {dirty ? (
        <p className="b2b-help" style={{ margin: 0 }}>
          {t('productEditor.scopeControls.unsavedIn', { channels: dirtyChannelNames.join(', ') })}
        </p>
      ) : null}
      <div className="b2b-row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {canWrite ? (
          <>
            <Button type="button" size="sm" disabled={!dirty || saving} aria-busy={saving || undefined} onClick={onSave}>
              {saving ? t('productEditor.scopeControls.saving') : t('productEditor.scopeControls.save')}
            </Button>
            {dirty ? (
              <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={onDiscard}>
                {t('productEditor.scopeControls.discard')}
              </Button>
            ) : null}
          </>
        ) : null}
        {/* Mounted before it carries text so a save is announced (WCAG 4.1.3). */}
        <span role="status" aria-live="polite" className="b2b-help">
          {status}
        </span>
      </div>
    </div>
  );
}
