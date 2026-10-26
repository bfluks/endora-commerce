import { useCallback, useEffect, useId, useState, type ReactNode } from 'react';
import { ORDER_MINIMUM_MAX, type PackagingUnitDto } from '@endora-commerce/contracts';
import { ApiError, apiClient } from '@endora-commerce/admin-kit/lib';
import { Button, Input, Label } from '@endora-commerce/admin-kit/ui';
import { ModalDialog } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { parseOrderMinimumInput } from './ProductOrderRulesCard.js';
import type { ScopeContext } from './ProductScopeEditor.js';
import { getProductScopeContext } from '../lib/product-scopes-api.js';
import { languagesToOffer, translationPatch, type TranslationMap } from '../lib/media-scopes.js';

/**
 * Feature 043 — Packaging units editor, rendered inside the product card's
 * Inventory tab. Lets operators define named ordering units (e.g. "Paleta" =
 * 480 pieces): add / edit / remove / reorder, and pick one default. Calls the
 * catalog admin packaging-unit endpoints directly via `apiClient`, mirroring
 * the rest of the Inventory tab.
 *
 * Feature 155 (US2, FR-002) — each unit also carries an optional minimum number of that
 * unit per order (`minOrderUnits`), edited in its own column; empty clears it.
 *
 * Feature 163 (T142, US9 #5, FR-079) — each unit's name per language, edited in a
 * dialog over the member channels' languages plus any language the unit already
 * names; Save sends the changed languages only (`''` = use the global name).
 */
export function PackagingUnitsEditor({ productId }: { productId: string }): ReactNode {
  const t = useTranslation('catalog');
  const base = `/api/v1/admin/catalog/products/${productId}/packaging-units`;

  const [units, setUnits] = useState<PackagingUnitDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState('');
  const [newQty, setNewQty] = useState('');
  const [newMin, setNewMin] = useState('');
  /** The unit id (or `'new'`) whose minimum input holds the value the error refers to. */
  const [invalidMinimum, setInvalidMinimum] = useState<string | null>(null);
  const errorId = `${useId()}-error`;
  const [context, setContext] = useState<ScopeContext | null>(null);
  const [translating, setTranslating] = useState<PackagingUnitDto | null>(null);
  const minimumMessage = (): string =>
    t('packagingUnits.error.invalidMinimum', { max: String(ORDER_MINIMUM_MAX) });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<{ data: PackagingUnitDto[] }>(base);
      setUnits(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('packagingUnits.error.load'));
    } finally {
      setLoading(false);
    }
  }, [base, t]);

  useEffect(() => {
    void load();
  }, [load]);

  // The languages to translate into; without this read the unit's own languages remain.
  useEffect(() => {
    let cancelled = false;
    getProductScopeContext(productId)
      .then((scope) => {
        if (!cancelled) setContext(scope);
      })
      .catch(() => {
        if (!cancelled) setContext(null);
      });
    return (): void => {
      cancelled = true;
    };
  }, [productId]);

  const run = useCallback(
    async (fn: () => Promise<void>) => {
      setBusy(true);
      setError(null);
      // The invalid minimum is not cleared here: the refused value is still in
      // its (uncontrolled) cell, so its `aria-invalid` and message stay until
      // that value changes or is saved (round B UI review).
      try {
        await fn();
        await load();
      } catch (err) {
        setError(err instanceof ApiError ? err.message : t('packagingUnits.error.save'));
      } finally {
        setBusy(false);
      }
    },
    [load, t],
  );

  const add = (): void => {
    const name = newName.trim();
    const qty = Number(newQty);
    if (name === '' || !Number.isInteger(qty) || qty < 1) {
      setError(t('packagingUnits.error.invalid'));
      return;
    }
    const minimum = parseOrderMinimumInput(newMin);
    if (!minimum.ok) {
      setInvalidMinimum('new');
      return;
    }
    void run(async () => {
      // Sent only when entered, so a unit without a minimum is created as before.
      await apiClient.post(base, {
        name,
        baseQuantity: qty,
        ...(minimum.value != null ? { minOrderUnits: minimum.value } : {}),
      });
      setNewName('');
      setNewQty('');
      setNewMin('');
    });
  };

  const patch = (id: string, body: Record<string, unknown>): void => {
    void run(async () => {
      await apiClient.patch(`${base}/${id}`, body);
    });
  };

  const saveMinimum = (unit: PackagingUnitDto, raw: string): void => {
    const parsed = parseOrderMinimumInput(raw);
    if (!parsed.ok) {
      setInvalidMinimum(unit.id);
      return;
    }
    if (invalidMinimum === unit.id) setInvalidMinimum(null);
    if (parsed.value === (unit.minOrderUnits ?? null)) return;
    patch(unit.id, { minOrderUnits: parsed.value });
  };

  const minimumA11y = (key: string): { 'aria-invalid'?: true; 'aria-describedby'?: string } =>
    invalidMinimum === key ? { 'aria-invalid': true, 'aria-describedby': errorId } : {};

  const remove = (id: string): void => {
    if (invalidMinimum === id) setInvalidMinimum(null);
    void run(async () => {
      await apiClient.delete(`${base}/${id}`);
    });
  };

  const move = (index: number, delta: number): void => {
    const next = [...units];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    void run(async () => {
      await apiClient.patch(`${base}/reorder`, { orderedIds: next.map((u) => u.id) });
    });
  };

  return (
    <div className="b2b-card">
      <div className="b2b-card__head">{t('packagingUnits.title')}</div>
      <div className="b2b-card__body b2b-col" style={{ gap: 12 }}>
        <div className="b2b-help">{t('packagingUnits.help')}</div>
        <div className="b2b-help">{t('packagingUnits.minOrderUnitsHelp')}</div>
        {invalidMinimum !== null ? (
          <div id={errorId} role="alert" className="b2b-alert b2b-alert--error">
            {minimumMessage()}
          </div>
        ) : null}
        {error ? (
          <div role="alert" className="b2b-alert b2b-alert--error">
            {error}
          </div>
        ) : null}

        {loading ? (
          <div className="b2b-help">{t('packagingUnits.loading')}</div>
        ) : units.length === 0 ? (
          <div className="b2b-help">{t('packagingUnits.empty')}</div>
        ) : (
          <table className="b2b-table">
            <thead>
              <tr>
                <th>{t('packagingUnits.col.name')}</th>
                <th>{t('packagingUnits.col.baseQuantity')}</th>
                <th>{t('packagingUnits.col.minOrderUnits')}</th>
                <th>{t('packagingUnits.col.default')}</th>
                <th>{t('packagingUnits.col.order')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {units.map((u, i) => (
                <tr key={u.id}>
                  <td>
                    <input
                      className="b2b-input"
                      defaultValue={u.name}
                      disabled={busy}
                      aria-label={t('packagingUnits.col.name')}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v && v !== u.name) patch(u.id, { name: v });
                      }}
                    />
                  </td>
                  <td>
                    <input
                      className="b2b-input"
                      type="number"
                      min={1}
                      step={1}
                      defaultValue={u.baseQuantity}
                      disabled={busy}
                      aria-label={t('packagingUnits.col.baseQuantity')}
                      onBlur={(e) => {
                        const v = Number(e.target.value);
                        if (Number.isInteger(v) && v >= 1 && v !== u.baseQuantity) {
                          patch(u.id, { baseQuantity: v });
                        }
                      }}
                    />
                  </td>
                  <td>
                    <input
                      className="b2b-input"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={ORDER_MINIMUM_MAX}
                      step={1}
                      defaultValue={u.minOrderUnits ?? ''}
                      disabled={busy}
                      aria-label={t('packagingUnits.col.minOrderUnits')}
                      {...minimumA11y(u.id)}
                      onChange={() => {
                        if (invalidMinimum === u.id) setInvalidMinimum(null);
                      }}
                      onBlur={(e) => saveMinimum(u, e.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      type="radio"
                      name={`pkg-default-${productId}`}
                      checked={u.isDefault}
                      disabled={busy}
                      aria-label={t('packagingUnits.col.default')}
                      onChange={() => {
                        if (!u.isDefault) patch(u.id, { isDefault: true });
                      }}
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="b2b-btn b2b-btn--ghost b2b-btn--sm"
                      disabled={busy || i === 0}
                      aria-label={t('packagingUnits.action.moveUp')}
                      onClick={() => move(i, -1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="b2b-btn b2b-btn--ghost b2b-btn--sm"
                      disabled={busy || i === units.length - 1}
                      aria-label={t('packagingUnits.action.moveDown')}
                      onClick={() => move(i, 1)}
                    >
                      ↓
                    </button>
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button
                      type="button"
                      className="b2b-btn b2b-btn--ghost b2b-btn--sm"
                      disabled={busy}
                      aria-label={t('packagingUnits.translations.title', { name: u.name })}
                      onClick={() => setTranslating(u)}
                    >
                      {t('packagingUnits.translations.open')}
                    </button>
                    <button
                      type="button"
                      className="b2b-btn b2b-btn--ghost b2b-btn--sm"
                      disabled={busy}
                      onClick={() => remove(u.id)}
                    >
                      {t('packagingUnits.action.remove')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="b2b-row" style={{ gap: 8, alignItems: 'flex-end' }}>
          <input
            className="b2b-input"
            placeholder={t('packagingUnits.newName')}
            value={newName}
            disabled={busy}
            aria-label={t('packagingUnits.col.name')}
            onChange={(e) => setNewName(e.target.value)}
          />
          <input
            className="b2b-input"
            type="number"
            min={1}
            step={1}
            placeholder={t('packagingUnits.newQuantity')}
            value={newQty}
            disabled={busy}
            aria-label={t('packagingUnits.col.baseQuantity')}
            onChange={(e) => setNewQty(e.target.value)}
          />
          <input
            className="b2b-input"
            type="number"
            inputMode="numeric"
            min={1}
            max={ORDER_MINIMUM_MAX}
            step={1}
            placeholder={t('packagingUnits.newMinimum')}
            value={newMin}
            disabled={busy}
            aria-label={t('packagingUnits.col.minOrderUnits')}
            {...minimumA11y('new')}
            onChange={(e) => {
              setNewMin(e.target.value);
              if (invalidMinimum === 'new') setInvalidMinimum(null);
            }}
          />
          <button
            type="button"
            className="b2b-btn b2b-btn--primary b2b-btn--sm"
            disabled={busy}
            onClick={add}
          >
            {t('packagingUnits.action.add')}
          </button>
        </div>
      </div>
      {translating ? (
        <PackagingUnitTranslationsDialog
          unit={translating}
          context={context}
          onClose={() => setTranslating(null)}
          onSave={async (nameTranslations) => {
            await apiClient.patch(`${base}/${translating.id}`, { nameTranslations });
            await load();
          }}
        />
      ) : null}
    </div>
  );
}

const UNIT_NAME_MAX = 160;

function PackagingUnitTranslationsDialog({
  unit,
  context,
  onClose,
  onSave,
}: {
  unit: PackagingUnitDto;
  context: ScopeContext | null;
  onClose: () => void;
  onSave: (nameTranslations: TranslationMap) => Promise<void>;
}): ReactNode {
  const t = useTranslation('catalog');
  const fieldId = useId();
  const errorId = `${fieldId}-error`;
  const saved = unit.nameTranslations ?? {};
  const [names, setNames] = useState<TranslationMap>({ ...saved });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const languages = languagesToOffer(context, saved);

  const save = async (): Promise<void> => {
    const patch = translationPatch(saved, names);
    if (!patch) {
      onClose();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSave(patch);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('packagingUnits.translations.error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalDialog
      title={t('packagingUnits.translations.title', { name: unit.name })}
      onClose={onClose}
      busy={busy}
      dismissOnScrim={false}
      {...(error ? { 'aria-describedby': errorId } : {})}
      footer={
        <>
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            {t('packagingUnits.translations.cancel')}
          </Button>
          <Button type="button" disabled={busy} onClick={() => void save()}>
            {t('packagingUnits.translations.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {error ? (
          <div id={errorId} role="alert" className="b2b-alert b2b-alert--error">
            {error}
          </div>
        ) : null}
        <p className="text-xs text-muted-foreground">
          {languages.length === 0
            ? t('packagingUnits.translations.noLanguages')
            : t('packagingUnits.translations.hint')}
        </p>
        {languages.map((language) => (
          <div key={language} className="space-y-1">
            <Label htmlFor={`${fieldId}-${language}`}>
              {t('packagingUnits.translations.name', { language: language.toUpperCase() })}
            </Label>
            <Input
              id={`${fieldId}-${language}`}
              value={names[language] ?? ''}
              placeholder={unit.name}
              maxLength={UNIT_NAME_MAX}
              disabled={busy}
              onChange={(e): void => setNames((prev) => ({ ...prev, [language]: e.target.value }))}
            />
          </div>
        ))}
      </div>
    </ModalDialog>
  );
}
