import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import {
  ORDER_MINIMUM_MAX,
  isOrderMinimumEligibleType,
  isValidOrderMinimum,
} from '@endora-commerce/contracts';
import { ApiError, apiClient } from '@endora-commerce/admin-kit/lib';
import { Alert, Button, Checkbox, Input } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

/**
 * Feature 155 (US1, US5; FR-001, FR-003, FR-004) — the product's order rules, in the
 * Inventory tab: the "Returnable" flag for every product type and the pieces minimum for
 * simple and configurable products only (D5 — the server refuses it on other types, so
 * the control is not offered there; a line says why instead).
 *
 * Each control saves on its own through the product `PATCH`, like the stock-management
 * checkboxes and the low-stock threshold beside it: the flag on toggle, the minimum on
 * its Save button.
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
            <div className="b2b-col" style={{ gap: 4 }}>
              <label className="b2b-row" style={{ gap: 8, alignItems: 'flex-start', cursor: 'pointer' }}>
                <Checkbox
                  className="mt-0.5"
                  checked={returnable}
                  disabled={returnableSaving}
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
                      disabled={minimumSaving}
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
                  <Button
                    type="button"
                    size="sm"
                    disabled={minimumSaving}
                    aria-busy={minimumSaving || undefined}
                    onClick={submitMinimum}
                  >
                    {minimumSaving ? t('orderRules.saving') : t('orderRules.minimum.save')}
                  </Button>
                  {savedMinimum != null ? (
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
          </>
        )}
      </div>
    </div>
  );
}
