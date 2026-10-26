import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { Link } from 'react-router-dom';
import { Archive, ArchiveRestore } from 'lucide-react';
import { ApiError, apiClient } from '@endora-commerce/admin-kit/lib';
import { CategoryTreePicker, ModalDialog } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

/**
 * Feature 022 — Products Bulk Edit dialog.
 *
 * Rendered as a fixed-overlay panel on top of the products list when the
 * admin clicks "Bulk Edit" from the selection toolbar. Each field-group
 * starts in an "untouched" state — only modified fields are sent to the
 * backend. Attributes flagged `mass_editable=true` are fetched once on
 * open via `/attributes/by-flag?flag=isMassEditable`.
 *
 * Feature 155 (US5; FR-003, FR-004, FR-034) — a "Returnable" group sets the flag on every
 * selected product. Products are not returnable until marked, existing ones included, so
 * the group carries a standing hint saying so: this is where an operator fixes that.
 *
 * Bulk **Archive** / **Restore** (feature 163). The request carries `fields.archived`
 * and nothing else — the route refuses it beside any other field — so it is not one
 * of the "touched" field groups that Apply combines: it is its own action below them,
 * confirmed in a second step, offered only while no field is touched. The host passes the one that changes something for the
 * selection (`archiveAction`), or `null` for an operator without `catalog:write`.
 */

type BulkStatus = 'active' | 'inactive';
export type BulkArchiveAction = 'archive' | 'restore';
type BulkVisibility = 'public' | 'logged_in_only' | 'organization_restricted';
type BulkMode = 'add' | 'replace';

interface AdminAttributeSummary {
  id: string;
  key: string;
  label: Record<string, string>;
  labelDefault: string;
  valueType: string;
}

interface SalesChannel {
  id: string;
  code: string;
  name: Record<string, string> | string;
}

interface AdminCategory {
  id: string;
  parentCategoryId: string | null;
  slug: string;
  name: Record<string, string>;
  sortOrder: number;
}

interface AttributeSetSummary {
  id: string;
  code: string;
  name: Record<string, string>;
}

interface BulkUpdateResultRow {
  productId: string;
  status: 'succeeded' | 'skipped' | 'failed';
  reason?: string;
  details?: { code?: string; message?: string; attribute?: string };
  changedFields?: string[];
}

interface BulkUpdateSyncData {
  bulkOperationId: string;
  summary: { succeeded: number; skipped: number; failed: number; total: number };
  results: BulkUpdateResultRow[];
}

interface BulkUpdateQueuedData {
  queued: true;
  bulkOperationId: string;
  total: number;
}

interface BulkUpdateResponse {
  data: BulkUpdateSyncData | BulkUpdateQueuedData;
}

function isQueued(data: BulkUpdateSyncData | BulkUpdateQueuedData): data is BulkUpdateQueuedData {
  return 'queued' in data && data.queued === true;
}

export interface ProductsBulkEditDialogProps {
  productIds: string[];
  /** Feature 033 — whether ids came from page-only or full filtered collection. */
  selectionScope?: 'page' | 'collection';
  onClose: () => void;
  /** Invoked after a successful apply so the parent can refresh the list. */
  onApplied?: () => void;
  /** The archive action offered for this selection; `null`/absent offers none. */
  archiveAction?: BulkArchiveAction | null;
}

export function ProductsBulkEditDialog(props: ProductsBulkEditDialogProps): ReactNode {
  const t = useTranslation('catalog');
  const { productIds, selectionScope, onClose, onApplied, archiveAction = null } = props;
  const formId = useId();
  const returnableRadioName = `${formId}-returnable`;
  const returnableHintId = `${formId}-returnable-hint`;
  const archiveHintId = `${formId}-archive-hint`;
  const archiveConfirmBodyId = `${formId}-archive-confirm`;

  // Touched flags — a field is sent to the backend only when its touched
  // flag is true. Default values are placeholders that are NOT sent.
  const [touchStatus, setTouchStatus] = useState(false);
  const [status, setStatus] = useState<BulkStatus>('active');

  const [touchVisibility, setTouchVisibility] = useState(false);
  const [visibility, setVisibility] = useState<BulkVisibility>('public');

  const [touchChannels, setTouchChannels] = useState(false);
  const [channelsMode, setChannelsMode] = useState<BulkMode>('add');
  const [channelIds, setChannelIds] = useState<string[]>([]);

  const [touchCategories, setTouchCategories] = useState(false);
  const [categoriesMode, setCategoriesMode] = useState<BulkMode>('add');
  const [categoryIds, setCategoryIds] = useState<string[]>([]);

  const [touchReturnable, setTouchReturnable] = useState(false);
  // Defaults to "returnable": marking products returnable is what the group is for.
  const [returnable, setReturnable] = useState(true);

  const [touchAttributeSet, setTouchAttributeSet] = useState(false);
  // '' represents "no attribute set" (cleared); a uuid assigns that set.
  const [attributeSetId, setAttributeSetId] = useState<string>('');

  const [attributeValues, setAttributeValues] = useState<Record<string, unknown>>({});
  const [touchedAttrs, setTouchedAttrs] = useState<Set<string>>(new Set());

  // Catalog metadata fetched on open.
  const [attrs, setAttrs] = useState<AdminAttributeSummary[]>([]);
  const [channels, setChannels] = useState<SalesChannel[]>([]);
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [attributeSets, setAttributeSets] = useState<AttributeSetSummary[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BulkUpdateSyncData | null>(null);
  const [queued, setQueued] = useState<BulkUpdateQueuedData | null>(null);
  const [confirmingArchive, setConfirmingArchive] = useState(false);
  // What the result on screen came from — the archive summary also names the
  // products that were already in the requested state.
  const [sentArchive, setSentArchive] = useState<BulkArchiveAction | null>(null);
  // The control that started the request unmounts with its step, so focus moves
  // to the outcome's heading rather than falling to the page.
  const outcomeHeadingRef = useRef<HTMLHeadingElement | null>(null);
  useEffect(() => {
    if (result || queued) outcomeHeadingRef.current?.focus();
  }, [result, queued]);

  // Load mass-editable attributes + channel / category metadata on mount.
  useEffect(() => {
    let cancelled = false;
    (async (): Promise<void> => {
      try {
        const [attrRes, chRes, catRes, setRes] = await Promise.all([
          apiClient.get<{ data: { items: AdminAttributeSummary[] } }>(
            '/api/v1/admin/catalog/attributes/by-flag?flag=isMassEditable',
          ),
          // The sales-channels list endpoint returns `{ items }` (not `{ data }`);
          // accept either shape so an unexpected envelope can never leave the
          // state holding `undefined` (which would crash the render at
          // `channels.map`).
          apiClient
            .get<{ items?: SalesChannel[]; data?: SalesChannel[] }>('/api/v1/admin/sales-channels')
            .catch((): { items?: SalesChannel[]; data?: SalesChannel[] } => ({ items: [] })),
          apiClient
            .get<{ data: AdminCategory[] }>('/api/v1/admin/catalog/categories')
            .catch(() => ({ data: [] as AdminCategory[] })),
          apiClient
            .get<{ data: AttributeSetSummary[] }>('/api/v1/admin/catalog/attribute-sets')
            .catch(() => ({ data: [] as AttributeSetSummary[] })),
        ]);
        if (cancelled) return;
        setAttrs(attrRes.data?.items ?? []);
        setChannels(chRes.items ?? chRes.data ?? []);
        setCategories(catRes.data ?? []);
        setAttributeSets(setRes.data ?? []);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof ApiError ? e.envelope.error.message : String(e));
        }
      }
    })();
    return (): void => {
      cancelled = true;
    };
  }, []);

  const anyTouched = useMemo(
    () =>
      touchStatus ||
      touchVisibility ||
      touchChannels ||
      touchCategories ||
      touchReturnable ||
      touchAttributeSet ||
      touchedAttrs.size > 0,
    [
      touchStatus,
      touchVisibility,
      touchChannels,
      touchCategories,
      touchReturnable,
      touchAttributeSet,
      touchedAttrs,
    ],
  );

  const send = useCallback(
    async (fields: Record<string, unknown>): Promise<boolean> => {
      setSubmitting(true);
      setError(null);
      try {
        const res = await apiClient.post<BulkUpdateResponse>(
          '/api/v1/admin/catalog/products/bulk-update',
          { productIds, fields },
        );
        if (isQueued(res.data)) {
          setQueued(res.data);
        } else {
          setResult(res.data);
        }
        onApplied?.();
        return true;
      } catch (e) {
        if (e instanceof ApiError) {
          const code = e.envelope.error.code;
          if (code === 'ATTRIBUTE_NOT_MASS_EDITABLE') {
            const details = e.envelope.error.details as { attribute?: string } | undefined;
            setError(
              t('productsList.bulkEdit.error.attribute_not_mass_editable', {
                attribute: details?.attribute ?? '?',
              }),
            );
          } else if (code === 'BULK_TOO_LARGE') {
            const details = e.envelope.error.details as
              | { maxBatchSize?: number }
              | undefined;
            setError(
              t('productsList.bulkEdit.error.bulk_too_large', {
                total: productIds.length,
                maxBatchSize: details?.maxBatchSize ?? 200,
              }),
            );
          } else {
            setError(e.envelope.error.message);
          }
        } else {
          setError(String(e));
        }
        return false;
      } finally {
        setSubmitting(false);
      }
    },
    [productIds, onApplied, t],
  );

  const submitArchive = useCallback(async (): Promise<void> => {
    if (archiveAction === null) return;
    // `archived` travels alone (R30.3): never combined with a touched field.
    // A failure keeps the confirmation open with its message and a second try.
    if (await send({ archived: archiveAction === 'archive' })) {
      setSentArchive(archiveAction);
      setConfirmingArchive(false);
    }
  }, [archiveAction, send]);

  const submit = useCallback(async (): Promise<void> => {
    if (!anyTouched) {
      setError(t('productsList.bulkEdit.empty'));
      return;
    }
    const fields: Record<string, unknown> = {};
    if (touchStatus) fields.status = status;
    if (touchVisibility) fields.visibility = visibility;
    if (touchChannels) {
      fields.salesChannels = { mode: channelsMode, channelIds };
    }
    if (touchCategories) {
      fields.categories = { mode: categoriesMode, categoryIds };
    }
    if (touchReturnable) fields.returnable = returnable;
    if (touchAttributeSet) {
      // '' clears the set (null); a uuid assigns it.
      fields.attributeSetId = attributeSetId === '' ? null : attributeSetId;
    }
    if (touchedAttrs.size > 0) {
      const av: Record<string, unknown> = {};
      for (const k of touchedAttrs) av[k] = attributeValues[k];
      fields.attributeValues = av;
    }
    await send(fields);
  }, [
    anyTouched,
    touchStatus,
    status,
    touchVisibility,
    visibility,
    touchChannels,
    channelsMode,
    channelIds,
    touchCategories,
    categoriesMode,
    categoryIds,
    touchReturnable,
    returnable,
    touchAttributeSet,
    attributeSetId,
    touchedAttrs,
    attributeValues,
    send,
    t,
  ]);

  const confirming = confirmingArchive && archiveAction !== null && !result && !queued;
  const editing = !confirming && !result && !queued;
  const editFooter = (
    <>
      <button type="button" className="b2b-btn" onClick={onClose} disabled={submitting}>
        {t('productsList.bulkEdit.action.cancel')}
      </button>
      <button
        type="button"
        className="b2b-btn b2b-btn--primary"
        onClick={(): void => {
          void submit();
        }}
        disabled={submitting || !anyTouched}
      >
        {t('productsList.bulkEdit.action.apply')}
      </button>
    </>
  );
  const confirmFooter =
    archiveAction !== null ? (
      <>
        <button
          type="button"
          className="b2b-btn"
          disabled={submitting}
          onClick={(): void => setConfirmingArchive(false)}
        >
          {t('productsList.bulkEdit.action.back')}
        </button>
        <button
          type="button"
          className="b2b-btn b2b-btn--primary"
          disabled={submitting}
          aria-busy={submitting || undefined}
          onClick={(): void => {
            void submitArchive();
          }}
        >
          {t(`productsList.bulkEdit.${archiveAction}.confirm`, { count: productIds.length })}
        </button>
      </>
    ) : null;

  // One modal root: the archive confirmation is a second step of this dialog, not
  // a dialog over it. Escape on that step goes back to the form, not out of it.
  return (
    <ModalDialog
      title={
        confirming && archiveAction !== null
          ? t(`productsList.bulkEdit.${archiveAction}.confirmTitle`, { count: productIds.length })
          : t('productsList.bulkEdit.title', { count: productIds.length })
      }
      onClose={confirming ? (): void => setConfirmingArchive(false) : onClose}
      busy={submitting}
      dismissOnScrim={false}
      widthClassName="max-w-2xl"
      {...(confirming ? { 'aria-describedby': archiveConfirmBodyId } : {})}
      {...(editing ? { footer: editFooter } : confirming && confirmFooter ? { footer: confirmFooter } : {})}
    >
      {selectionScope && editing ? (
        <div className="b2b-muted" style={{ fontSize: 12, marginTop: -8, marginBottom: 12 }}>
          {selectionScope === 'collection'
            ? t('productsList.selection.scopeCollection')
            : t('productsList.selection.scopePage')}
        </div>
      ) : null}

      {/* While confirming, the error is said once, inside the step, as an alert. */}
      {error && !confirming ? (
        <div
          style={{
            marginBottom: 12,
            padding: '10px 12px',
            background: 'var(--danger-soft, #fee2e2)',
            color: 'var(--danger-soft-fg, #991b1b)',
            borderRadius: 6,
            fontSize: 13,
          }}
        >
          {error}
        </div>
      ) : null}

      {queued ? (
        <BulkEditQueuedAck
          queued={queued}
          archiveAction={sentArchive}
          headingRef={outcomeHeadingRef}
          onClose={onClose}
          t={t}
        />
      ) : result ? (
        <BulkEditSummary
          result={result}
          archiveAction={sentArchive}
          headingRef={outcomeHeadingRef}
          onClose={onClose}
          t={t}
        />
      ) : confirming && archiveAction !== null ? (
        <div>
          <p id={archiveConfirmBodyId} style={{ fontSize: 14, lineHeight: 1.5 }}>
            {t(`productsList.bulkEdit.${archiveAction}.confirmBody`)}
          </p>
          {error ? (
            <p role="alert" style={{ marginTop: 8, fontSize: 13, color: 'var(--danger-soft-fg, #991b1b)' }}>
              {error}
            </p>
          ) : null}
        </div>
      ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <FieldGroup
              label={t('productsList.bulkEdit.section.status')}
              touched={touchStatus}
              onToggle={setTouchStatus}
              t={t}
            >
              <select
                className="b2b-field"
                disabled={!touchStatus}
                value={status}
                onChange={(e): void => setStatus(e.target.value as BulkStatus)}
              >
                <option value="active">{t('productsList.status.active')}</option>
                <option value="inactive">{t('productsList.status.inactive')}</option>
              </select>
            </FieldGroup>

            <FieldGroup
              label={t('productsList.bulkEdit.section.visibility')}
              touched={touchVisibility}
              onToggle={setTouchVisibility}
              t={t}
            >
              <select
                className="b2b-field"
                disabled={!touchVisibility}
                value={visibility}
                onChange={(e): void => setVisibility(e.target.value as BulkVisibility)}
              >
                <option value="public">public</option>
                <option value="logged_in_only">logged_in_only</option>
                <option value="organization_restricted">organization_restricted</option>
              </select>
            </FieldGroup>

            <FieldGroup
              label={t('productsList.bulkEdit.section.salesChannels')}
              touched={touchChannels}
              onToggle={setTouchChannels}
              t={t}
            >
              <ModePicker
                mode={channelsMode}
                onChange={setChannelsMode}
                disabled={!touchChannels}
                t={t}
              />
              <MultiSelect
                options={channels.map((c) => ({
                  id: c.id,
                  label:
                    typeof c.name === 'string'
                      ? c.name
                      : c.name['en-US'] ?? c.name['pl-PL'] ?? c.code,
                }))}
                selected={channelIds}
                onChange={setChannelIds}
                disabled={!touchChannels}
              />
            </FieldGroup>

            <FieldGroup
              label={t('productsList.bulkEdit.section.categories')}
              touched={touchCategories}
              onToggle={setTouchCategories}
              t={t}
            >
              <ModePicker
                mode={categoriesMode}
                onChange={setCategoriesMode}
                disabled={!touchCategories}
                t={t}
              />
              <CategoryTreePicker
                categories={categories}
                selectedIds={categoryIds}
                onChange={setCategoryIds}
                disabled={!touchCategories}
              />
            </FieldGroup>

            <FieldGroup
              label={t('productsList.bulkEdit.section.returnable')}
              touched={touchReturnable}
              onToggle={setTouchReturnable}
              t={t}
            >
              <div
                role="radiogroup"
                aria-label={t('productsList.bulkEdit.section.returnable')}
                aria-describedby={returnableHintId}
                style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}
              >
                {([true, false] as const).map((value) => (
                  <label
                    key={String(value)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      fontSize: 13,
                      minHeight: 32,
                      cursor: touchReturnable ? 'pointer' : 'default',
                    }}
                  >
                    <input
                      type="radio"
                      name={returnableRadioName}
                      checked={returnable === value}
                      disabled={!touchReturnable}
                      onChange={(): void => setReturnable(value)}
                    />
                    {value
                      ? t('productsList.bulkEdit.returnable.yes')
                      : t('productsList.bulkEdit.returnable.no')}
                  </label>
                ))}
              </div>
              <div id={returnableHintId} className="b2b-help">
                {t('productsList.bulkEdit.returnable.hint')}
              </div>
            </FieldGroup>

            <FieldGroup
              label={t('productsList.bulkEdit.section.attributeSet')}
              touched={touchAttributeSet}
              onToggle={setTouchAttributeSet}
              t={t}
            >
              <select
                className="b2b-field"
                disabled={!touchAttributeSet}
                value={attributeSetId}
                onChange={(e): void => setAttributeSetId(e.target.value)}
              >
                <option value="">{t('productsList.bulkEdit.attributeSet.none')}</option>
                {attributeSets.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name['en-US'] ?? s.name['pl-PL'] ?? Object.values(s.name)[0] ?? s.code}
                  </option>
                ))}
              </select>
            </FieldGroup>

            {attrs.length > 0 ? (
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
                  {t('productsList.bulkEdit.section.attributes')}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {attrs.map((a) => {
                    const touched = touchedAttrs.has(a.key);
                    return (
                      <div
                        key={a.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          padding: 10,
                          background: 'var(--bg-muted, #f8fafc)',
                          borderRadius: 6,
                        }}
                      >
                        <input
                          type="checkbox"
                          className="b2b-cbx"
                          checked={touched}
                          onChange={(): void => {
                            setTouchedAttrs((prev) => {
                              const next = new Set(prev);
                              if (next.has(a.key)) {
                                next.delete(a.key);
                              } else {
                                next.add(a.key);
                              }
                              return next;
                            });
                          }}
                        />
                        <div style={{ minWidth: 140, fontSize: 13 }}>
                          {a.label['en-US'] ?? a.labelDefault}
                        </div>
                        <input
                          type="text"
                          className="b2b-field"
                          disabled={!touched}
                          style={{ flex: 1 }}
                          value={(attributeValues[a.key] as string | undefined) ?? ''}
                          onChange={(e): void =>
                            setAttributeValues((prev) => ({ ...prev, [a.key]: e.target.value }))
                          }
                          placeholder={a.valueType}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {archiveAction !== null ? (
              <section
                aria-labelledby={`${formId}-archive-title`}
                style={{ borderTop: '1px solid var(--border, #e5e7eb)', paddingTop: 14 }}
              >
                <div id={`${formId}-archive-title`} style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                  {t(`productsList.bulkEdit.${archiveAction}.title`)}
                </div>
                <p id={archiveHintId} className="b2b-help" style={{ marginBottom: 8 }}>
                  {anyTouched
                    ? t('productsList.bulkEdit.archiveAlone')
                    : t(`productsList.bulkEdit.${archiveAction}.hint`)}
                </p>
                <button
                  type="button"
                  className="b2b-btn"
                  aria-describedby={archiveHintId}
                  disabled={anyTouched || submitting}
                  onClick={(): void => setConfirmingArchive(true)}
                >
                  {archiveAction === 'archive' ? (
                    <Archive size={13} aria-hidden="true" />
                  ) : (
                    <ArchiveRestore size={13} aria-hidden="true" />
                  )}{' '}
                  {t(`productsList.bulkEdit.${archiveAction}.action`, { count: productIds.length })}
                </button>
              </section>
            ) : null}
          </div>
      )}
    </ModalDialog>
  );
}

interface FieldGroupProps {
  label: string;
  touched: boolean;
  onToggle: (next: boolean) => void;
  t: ReturnType<typeof useTranslation>;
  children: ReactNode;
}

function FieldGroup(props: FieldGroupProps): ReactNode {
  return (
    <div>
      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 13,
          fontWeight: 600,
          marginBottom: 6,
          cursor: 'pointer',
        }}
      >
        <input
          type="checkbox"
          className="b2b-cbx"
          checked={props.touched}
          onChange={(e): void => props.onToggle(e.target.checked)}
        />
        {props.label}
        {!props.touched ? (
          <span style={{ fontWeight: 400, color: 'var(--fg-muted, #64748b)', fontSize: 12 }}>
            {props.t('productsList.bulkEdit.untouched')}
          </span>
        ) : null}
      </label>
      <div style={{ paddingLeft: 26, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {props.children}
      </div>
    </div>
  );
}

interface ModePickerProps {
  mode: BulkMode;
  onChange: (next: BulkMode) => void;
  disabled: boolean;
  t: ReturnType<typeof useTranslation>;
}

function ModePicker(props: ModePickerProps): ReactNode {
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {(['add', 'replace'] as const).map((m) => (
        <button
          key={m}
          type="button"
          className={`b2b-btn b2b-btn--sm${props.mode === m ? ' b2b-btn--primary' : ''}`}
          disabled={props.disabled}
          onClick={(): void => props.onChange(m)}
        >
          {props.t(`productsList.bulkEdit.mode.${m}`)}
        </button>
      ))}
    </div>
  );
}

interface MultiSelectProps {
  options: Array<{ id: string; label: string }>;
  selected: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}

function MultiSelect(props: MultiSelectProps): ReactNode {
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 6,
        opacity: props.disabled ? 0.5 : 1,
        pointerEvents: props.disabled ? 'none' : 'auto',
      }}
    >
      {props.options.map((o) => {
        const active = props.selected.includes(o.id);
        return (
          <button
            key={o.id}
            type="button"
            className={`b2b-btn b2b-btn--sm${active ? ' b2b-btn--primary' : ''}`}
            onClick={(): void => {
              if (active) {
                props.onChange(props.selected.filter((x) => x !== o.id));
              } else {
                props.onChange([...props.selected, o.id]);
              }
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

interface BulkEditQueuedAckProps {
  queued: BulkUpdateQueuedData;
  archiveAction: BulkArchiveAction | null;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onClose: () => void;
  t: ReturnType<typeof useTranslation>;
}

function BulkEditQueuedAck(props: BulkEditQueuedAckProps): ReactNode {
  const prefix = props.archiveAction ? `productsList.bulkEdit.${props.archiveAction}` : 'productsList.bulkEdit';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div
        style={{
          padding: 14,
          borderRadius: 8,
          background: 'var(--info-bg, #eff6ff)',
          border: '1px solid var(--info-border, #bfdbfe)',
          fontSize: 14,
          lineHeight: 1.5,
        }}
      >
        <h3 ref={props.headingRef} tabIndex={-1} style={{ fontWeight: 600 }}>
          {props.t(`${prefix}.queued.title`)}
        </h3>
        <div style={{ marginTop: 4 }}>
          {props.t(`${prefix}.queued.body`, { total: props.queued.total })}
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {/* A queued run is persisted: its page holds the per-product record and Undo. */}
          <Link
            to={`/catalog/bulk-operations/${props.queued.bulkOperationId}`}
            className="b2b-btn"
            onClick={props.onClose}
            style={{ textDecoration: 'none' }}
          >
            {props.t('productsList.bulkEdit.viewOperation')}
          </Link>
          <Link
            to="/catalog/bulk-operations"
            className="b2b-btn"
            onClick={props.onClose}
            style={{ textDecoration: 'none' }}
          >
            {props.t('productsList.bulkEdit.queued.viewAll')}
          </Link>
        </span>
        <button type="button" className="b2b-btn b2b-btn--primary" onClick={props.onClose}>
          {props.t('productsList.bulkEdit.action.close')}
        </button>
      </div>
    </div>
  );
}

interface BulkEditSummaryProps {
  result: BulkUpdateSyncData;
  /** Set when the result is a bulk Archive / Restore. */
  archiveAction: BulkArchiveAction | null;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onClose: () => void;
  t: ReturnType<typeof useTranslation>;
}

/**
 * Products already in the requested state succeed with nothing changed; the archive
 * summary says how many, so "Succeeded" is not read as "all of them moved".
 */
export function unchangedArchiveCount(results: readonly BulkUpdateResultRow[]): number {
  return results.filter((r) => r.status === 'succeeded' && (r.changedFields?.length ?? 0) === 0).length;
}

function BulkEditSummary(props: BulkEditSummaryProps): ReactNode {
  const { summary, results } = props.result;
  const unchanged = props.archiveAction ? unchangedArchiveCount(results) : 0;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <h3 ref={props.headingRef} tabIndex={-1} style={{ fontSize: 14, fontWeight: 600 }}>
          {props.archiveAction
            ? props.t(`productsList.bulkEdit.${props.archiveAction}.done`, {
                count: summary.succeeded - unchanged,
              })
            : props.t('productsList.bulkEdit.summary.title')}
        </h3>
        {props.archiveAction && unchanged > 0 ? (
          <p className="b2b-help">
            {props.t(`productsList.bulkEdit.${props.archiveAction}.unchanged`, { count: unchanged })}
          </p>
        ) : null}
      </div>
      <div style={{ display: 'flex', gap: 12 }}>
        <SummaryBadge
          label={props.t('productsList.bulkEdit.summary.succeeded')}
          count={summary.succeeded}
          color="#16a34a"
        />
        <SummaryBadge
          label={props.t('productsList.bulkEdit.summary.skipped')}
          count={summary.skipped}
          color="#ca8a04"
        />
        <SummaryBadge
          label={props.t('productsList.bulkEdit.summary.failed')}
          count={summary.failed}
          color="#dc2626"
        />
        <SummaryBadge
          label={props.t('productsList.bulkEdit.summary.total')}
          count={summary.total}
          color="#475569"
        />
      </div>

      {results.some((r) => r.status !== 'succeeded') ? (
        <div
          style={{
            maxHeight: 260,
            overflow: 'auto',
            border: '1px solid var(--border, #e5e7eb)',
            borderRadius: 6,
          }}
        >
          <table className="b2b-tbl" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>Product</th>
                <th>Status</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {results
                .filter((r) => r.status !== 'succeeded')
                .map((r) => (
                  <tr key={r.productId}>
                    <td>
                      <Link
                        to={`/catalog/products/${r.productId}`}
                        style={{ color: 'var(--primary-color, #2563eb)' }}
                      >
                        {r.productId.slice(0, 8)}…
                      </Link>
                    </td>
                    <td>{r.status}</td>
                    <td>
                      {r.reason
                        ? props.t(`productsList.bulkEdit.reason.${r.reason}`)
                        : ''}
                      {r.details?.attribute ? ` (${r.details.attribute})` : ''}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {/* An inline run is not persisted as an operation, so there is no page to link. */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button
          type="button"
          className="b2b-btn b2b-btn--primary"
          onClick={props.onClose}
        >
          {props.t('productsList.bulkEdit.action.close')}
        </button>
      </div>
    </div>
  );
}

function SummaryBadge(props: { label: string; count: number; color: string }): ReactNode {
  return (
    <div
      style={{
        flex: 1,
        padding: '10px 12px',
        borderRadius: 6,
        background: 'var(--bg-muted, #f8fafc)',
        borderLeft: `4px solid ${props.color}`,
      }}
    >
      <div style={{ fontSize: 11, color: 'var(--fg-muted, #64748b)' }}>{props.label}</div>
      <div style={{ fontSize: 20, fontWeight: 600, color: props.color }}>{props.count}</div>
    </div>
  );
}
