import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import {
  ORDER_MINIMUM_MAX,
  isOrderMinimumEligibleType,
  isValidOrderMinimum,
  type PatchProductScopesRequest,
  type ProductScopes,
} from '@endora-commerce/contracts';
import { ApiError, apiClient, useAuth } from '@endora-commerce/admin-kit/lib';
import {
  Alert,
  Button,
  Checkbox,
  Input,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import {
  getProductScopeContext,
  getProductScopes,
  patchProductScopes,
  scopeSaveErrorMessage,
} from '../lib/product-scopes-api.js';

/**
 * Feature 155 (US1, US5; FR-001, FR-003, FR-004) — the product's order rules, in the
 * Inventory tab: the "Returnable" flag for every product type and the pieces minimum for
 * simple and configurable products only (D5 — the server refuses it on other types, so
 * the control is not offered there; a line says why instead).
 *
 * Each control saves on its own through the product `PATCH`, like the stock-management
 * checkboxes and the low-stock threshold beside it: the flag on toggle, the minimum on
 * its Save button.
 *
 * Feature 163 (US10, FR-100) adds both rules per sales channel below the global ones,
 * inheriting them; that table saves through `PATCH …/scopes` with one Save, and is
 * read-only — like the global controls — without `catalog:write` (FR-042).
 */

interface OrderRulesResponse {
  data: { minOrderQuantity: number | null; returnable: boolean };
}

export type OrderMinimumInput = { ok: true; value: number | null } | { ok: false };

/**
 * Reads a typed minimum: empty (or whitespace) means "no minimum" (`null`); otherwise an
 * integer in 1…ORDER_MINIMUM_MAX. Spaces used as thousands separators are tolerated.
 * Shared with the packaging-units editor so both minimums are read the same way.
 */
export function parseOrderMinimumInput(raw: string): OrderMinimumInput {
  const compact = raw.replace(/[\s  ]/g, '');
  if (compact === '') return { ok: true, value: null };
  if (!/^\d+$/.test(compact)) return { ok: false };
  const value = Number(compact);
  return isValidOrderMinimum(value) ? { ok: true, value } : { ok: false };
}

function errorText(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.envelope.error.message : fallback;
}

export interface ProductOrderRulesCardProps {
  productId: string;
  productType: string;
}

export function ProductOrderRulesCard({
  productId,
  productType,
}: ProductOrderRulesCardProps): ReactNode {
  const t = useTranslation('catalog');
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('catalog:write');
  const path = `/api/v1/admin/catalog/products/${productId}`;
  const minimumEligible = isOrderMinimumEligibleType(productType);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [returnable, setReturnable] = useState(false);
  const [returnableSaving, setReturnableSaving] = useState(false);
  const [returnableError, setReturnableError] = useState<string | null>(null);
  const [savedMinimum, setSavedMinimum] = useState<number | null>(null);
  const [minimumDraft, setMinimumDraft] = useState('');
  const [minimumSaving, setMinimumSaving] = useState(false);
  const [minimumError, setMinimumError] = useState<string | null>(null);
  const [status, setStatus] = useState('');

  // Saves resolve after the user may have left the tab; `alive` is set in the effect
  // body so StrictMode's mount → unmount → mount leaves it true.
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    return (): void => {
      alive.current = false;
    };
  }, []);

  const ids = useId();
  const returnableHelpId = `${ids}-returnable-help`;
  const returnableErrorId = `${ids}-returnable-error`;
  const minimumInputId = `${ids}-minimum`;
  const minimumHelpId = `${ids}-minimum-help`;
  const minimumErrorId = `${ids}-minimum-error`;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    apiClient
      .get<OrderRulesResponse>(path)
      .then((res) => {
        if (cancelled) return;
        setReturnable(res.data.returnable === true);
        setSavedMinimum(res.data.minOrderQuantity ?? null);
        setMinimumDraft(res.data.minOrderQuantity == null ? '' : String(res.data.minOrderQuantity));
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(errorText(err, t('orderRules.error.load')));
        setLoading(false);
      });
    return (): void => {
      cancelled = true;
    };
  }, [path, t]);

  const saveReturnable = useCallback(
    async (next: boolean): Promise<void> => {
      const previous = returnable;
      setReturnable(next);
      setReturnableSaving(true);
      setReturnableError(null);
      setStatus(t('orderRules.saving'));
      try {
        await apiClient.patch(path, { returnable: next });
        if (!alive.current) return;
        setStatus(t('orderRules.saved'));
      } catch (err) {
        if (!alive.current) return;
        setReturnable(previous);
        setReturnableError(errorText(err, t('orderRules.error.save')));
        setStatus('');
      } finally {
        if (alive.current) setReturnableSaving(false);
      }
    },
    [path, returnable, t],
  );

  const saveMinimum = useCallback(
    async (value: number | null): Promise<void> => {
      setMinimumSaving(true);
      setMinimumError(null);
      setStatus(t('orderRules.saving'));
      try {
        await apiClient.patch(path, { minOrderQuantity: value });
        if (!alive.current) return;
        setSavedMinimum(value);
        setMinimumDraft(value == null ? '' : String(value));
        setStatus(t('orderRules.saved'));
      } catch (err) {
        if (!alive.current) return;
        setMinimumError(errorText(err, t('orderRules.error.save')));
        setStatus('');
      } finally {
        if (alive.current) setMinimumSaving(false);
      }
    },
    [path, t],
  );

  const submitMinimum = (): void => {
    const parsed = parseOrderMinimumInput(minimumDraft);
    if (!parsed.ok) {
      setMinimumError(t('orderRules.minimum.invalid', { max: String(ORDER_MINIMUM_MAX) }));
      return;
    }
    void saveMinimum(parsed.value);
  };

  return (
    <div className="b2b-card">
      <div className="b2b-card__head">
        <h2>{t('orderRules.title')}</h2>
      </div>
      <div className="b2b-card__body b2b-col" style={{ gap: 16 }}>
        {/* Mounted before it carries text so screen readers announce saves (WCAG 4.1.3);
            errors announce through their own `role="alert"` next to the control. */}
        <div role="status" aria-live="polite" className="sr-only">
          {status}
        </div>

        {loading ? (
          <div className="b2b-help" aria-busy="true">
            {t('orderRules.loading')}
          </div>
        ) : loadError ? (
          <Alert variant="destructive">{loadError}</Alert>
        ) : (
          <>
            {!canWrite ? <div className="b2b-help">{t('orderRules.readOnly')}</div> : null}
            <div className="b2b-col" style={{ gap: 4 }}>
              <label className="b2b-row" style={{ gap: 8, alignItems: 'flex-start', cursor: 'pointer' }}>
                <Checkbox
                  className="mt-0.5"
                  checked={returnable}
                  disabled={returnableSaving || !canWrite}
                  aria-describedby={
                    returnableError ? `${returnableHelpId} ${returnableErrorId}` : returnableHelpId
                  }
                  onChange={(e): void => {
                    void saveReturnable(e.target.checked);
                  }}
                />
                <span>{t('orderRules.returnable.label')}</span>
              </label>
              <div id={returnableHelpId} className="b2b-help" style={{ paddingLeft: 24 }}>
                {t('orderRules.returnable.help')}
              </div>
              {returnableError ? (
                <Alert id={returnableErrorId} variant="destructive" style={{ marginLeft: 24 }}>
                  {returnableError}
                </Alert>
              ) : null}
            </div>

            {minimumEligible ? (
              <div className="b2b-col" style={{ gap: 4 }}>
                <label htmlFor={minimumInputId} style={{ fontWeight: 500 }}>
                  {t('orderRules.minimum.label')}
                </label>
                <div className="b2b-row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 180 }}>
                    <Input
                      id={minimumInputId}
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={ORDER_MINIMUM_MAX}
                      step={1}
                      value={minimumDraft}
                      placeholder={t('orderRules.minimum.placeholder')}
                      disabled={minimumSaving || !canWrite}
                      aria-invalid={minimumError ? true : undefined}
                      aria-describedby={
                        minimumError ? `${minimumHelpId} ${minimumErrorId}` : minimumHelpId
                      }
                      onChange={(e): void => {
                        setMinimumDraft(e.target.value);
                        if (minimumError) setMinimumError(null);
                      }}
                      onKeyDown={(e): void => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          submitMinimum();
                        }
                      }}
                    />
                  </div>
                  {canWrite ? (
                    <Button
                      type="button"
                      size="sm"
                      disabled={minimumSaving}
                      aria-busy={minimumSaving || undefined}
                      onClick={submitMinimum}
                    >
                      {minimumSaving ? t('orderRules.saving') : t('orderRules.minimum.save')}
                    </Button>
                  ) : null}
                  {canWrite && savedMinimum != null ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={minimumSaving}
                      onClick={(): void => {
                        void saveMinimum(null);
                      }}
                    >
                      {t('orderRules.minimum.clear')}
                    </Button>
                  ) : null}
                </div>
                <div id={minimumHelpId} className="b2b-help">
                  {t('orderRules.minimum.help')}
                </div>
                {minimumError ? (
                  <Alert id={minimumErrorId} variant="destructive">
                    {minimumError}
                  </Alert>
                ) : null}
              </div>
            ) : (
              <div className="b2b-help">{t('orderRules.minimum.notApplicable')}</div>
            )}

            <ChannelOrderRules
              productId={productId}
              minimumEligible={minimumEligible}
              globalMinimum={savedMinimum}
              globalReturnable={returnable}
              canWrite={canWrite}
            />
          </>
        )}
      </div>
    </div>
  );
}

type ReturnableChoice = 'inherit' | 'yes' | 'no';

interface ChannelRuleDraft {
  minimum: string;
  returnable: ReturnableChoice;
}

function draftFromRow(row: ProductScopes['channels'][number]): ChannelRuleDraft {
  return {
    minimum: row.minOrderQuantity == null ? '' : String(row.minOrderQuantity),
    returnable: row.returnable === null ? 'inherit' : row.returnable ? 'yes' : 'no',
  };
}

/**
 * Feature 163 (US10, FR-100) — minimum order quantity and "returnable" per member
 * channel. An empty minimum and "use inherited" both send `null` (FR-012); `1` is how a
 * channel says "no minimum here" against a global one, which the help line states rather
 * than leaving the operator to discover it (Tesler). Only changed fields are sent, every
 * channel in one request.
 */
function ChannelOrderRules({
  productId,
  minimumEligible,
  globalMinimum,
  globalReturnable,
  canWrite,
}: {
  productId: string;
  minimumEligible: boolean;
  globalMinimum: number | null;
  globalReturnable: boolean;
  canWrite: boolean;
}): ReactNode {
  const t = useTranslation('catalog');
  const ids = useId();
  const [rows, setRows] = useState<ProductScopes['channels'] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loadFailed, setLoadFailed] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, ChannelRuleDraft>>({});
  const [errors, setErrors] = useState<Record<string, true>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [status, setStatus] = useState('');

  useEffect(() => {
    let cancelled = false;
    Promise.all([getProductScopes(productId), getProductScopeContext(productId)])
      .then(([scopes, context]) => {
        if (cancelled) return;
        setRows(scopes.channels.filter((row) => row.isMember));
        setNames(Object.fromEntries(context.channels.map((c) => [c.id, c.name])));
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      });
    return (): void => {
      cancelled = true;
    };
  }, [productId]);

  const channelName = (channelId: string): string =>
    names[channelId] ?? t('productEditor.scopeControls.unknownChannel');

  const update = (row: ProductScopes['channels'][number], changes: Partial<ChannelRuleDraft>): void => {
    setDrafts((prev) => ({ ...prev, [row.channelId]: { ...(prev[row.channelId] ?? draftFromRow(row)), ...changes } }));
    if ('minimum' in changes && errors[row.channelId]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[row.channelId];
        return next;
      });
    }
    setSaveError(null);
    setStatus('');
  };

  const changedRows = (rows ?? []).filter((row) => {
    const draft = drafts[row.channelId];
    if (!draft) return false;
    const saved = draftFromRow(row);
    return draft.returnable !== saved.returnable || (minimumEligible && draft.minimum !== saved.minimum);
  });

  const save = async (): Promise<void> => {
    const entries: PatchProductScopesRequest['channels'] = [];
    const invalid: Record<string, true> = {};
    for (const row of changedRows) {
      const draft = drafts[row.channelId]!;
      const saved = draftFromRow(row);
      const entry: PatchProductScopesRequest['channels'][number] = { channelId: row.channelId };
      if (minimumEligible && draft.minimum !== saved.minimum) {
        const parsed = parseOrderMinimumInput(draft.minimum);
        if (!parsed.ok) {
          invalid[row.channelId] = true;
          continue;
        }
        entry.minOrderQuantity = parsed.value;
      }
      if (draft.returnable !== saved.returnable) {
        entry.returnable = draft.returnable === 'inherit' ? null : draft.returnable === 'yes';
      }
      entries.push(entry);
    }
    if (Object.keys(invalid).length > 0) {
      setErrors(invalid);
      return;
    }
    if (entries.length === 0) return;
    setSaving(true);
    setSaveError(null);
    setStatus(t('orderRules.saving'));
    try {
      const res = await patchProductScopes(productId, { channels: entries });
      setRows(res.data.channels.filter((row) => row.isMember));
      setDrafts({});
      setStatus(t('orderRules.channels.saved'));
    } catch (err) {
      setSaveError(scopeSaveErrorMessage(err, channelName, t, 'orderRules.channels.error.save'));
      setStatus('');
    } finally {
      setSaving(false);
    }
  };

  const inheritedMinimum =
    globalMinimum == null ? t('orderRules.channels.minimumNone') : String(globalMinimum);
  const inheritedReturnable = globalReturnable
    ? t('orderRules.channels.returnable.inheritedYes')
    : t('orderRules.channels.returnable.inheritedNo');
  const disabled = saving || !canWrite;
  const helpId = `${ids}-channels-help`;

  return (
    <div className="b2b-col" style={{ gap: 8 }}>
      <h3 className="text-sm font-semibold" style={{ margin: 0 }}>
        {t('orderRules.channels.title')}
      </h3>
      {loadFailed ? (
        <Alert variant="destructive">{t('orderRules.channels.loadFailed')}</Alert>
      ) : rows === null ? (
        <div className="b2b-help" aria-busy="true">
          {t('orderRules.channels.loading')}
        </div>
      ) : rows.length === 0 ? (
        <div className="b2b-help">{t('orderRules.channels.empty')}</div>
      ) : (
        <>
          {minimumEligible ? (
            <div id={helpId} className="b2b-help">
              {t('orderRules.channels.help')}
            </div>
          ) : null}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">{t('orderRules.channels.column.channel')}</TableHead>
                {minimumEligible ? (
                  <TableHead scope="col">{t('orderRules.channels.column.minimum')}</TableHead>
                ) : null}
                <TableHead scope="col">{t('orderRules.channels.column.returnable')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const draft = drafts[row.channelId] ?? draftFromRow(row);
                const name = channelName(row.channelId);
                const errorId = `${ids}-${row.channelId}-minimum-error`;
                const invalid = errors[row.channelId] === true;
                return (
                  <TableRow key={row.channelId}>
                    <TableCell>{name}</TableCell>
                    {minimumEligible ? (
                      <TableCell>
                        <Input
                          type="number"
                          inputMode="numeric"
                          value={draft.minimum}
                          placeholder={t('orderRules.channels.minimumInherited', { value: inheritedMinimum })}
                          aria-label={t('orderRules.channels.minimumLabel', { channel: name })}
                          aria-invalid={invalid ? true : undefined}
                          aria-describedby={invalid ? `${helpId} ${errorId}` : helpId}
                          disabled={disabled}
                          style={{ maxWidth: 160 }}
                          onChange={(e): void => update(row, { minimum: e.target.value })}
                          onKeyDown={(e): void => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              void save();
                            }
                          }}
                        />
                        {invalid ? (
                          <div id={errorId} role="alert" className="text-sm text-destructive">
                            {t('orderRules.minimum.invalid', { max: String(ORDER_MINIMUM_MAX) })}
                          </div>
                        ) : null}
                      </TableCell>
                    ) : null}
                    <TableCell>
                      <Select
                        value={draft.returnable}
                        aria-label={t('orderRules.channels.returnableLabel', { channel: name })}
                        disabled={disabled}
                        style={{ maxWidth: 240 }}
                        onChange={(e): void => update(row, { returnable: e.target.value as ReturnableChoice })}
                      >
                        <option value="inherit">
                          {t('orderRules.channels.returnable.inherit', { value: inheritedReturnable })}
                        </option>
                        <option value="yes">{t('orderRules.channels.returnable.yes')}</option>
                        <option value="no">{t('orderRules.channels.returnable.no')}</option>
                      </Select>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {saveError ? <Alert variant="destructive">{saveError}</Alert> : null}
          <div className="b2b-row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {canWrite ? (
              <Button
                type="button"
                size="sm"
                disabled={saving || changedRows.length === 0}
                aria-busy={saving || undefined}
                onClick={(): void => {
                  void save();
                }}
              >
                {saving ? t('orderRules.saving') : t('orderRules.channels.save')}
              </Button>
            ) : null}
            {/* Mounted before it carries text so a save is announced (WCAG 4.1.3). */}
            <span role="status" aria-live="polite" className="b2b-help">
              {status}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
