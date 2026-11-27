import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { Layers, Pencil, Plus, Trash2, X } from 'lucide-react';
import type { ProductVisibilityCategory, ProductVisibilityOverviewResponse, VisibilityThreshold } from '@endora-commerce/contracts';
import { ModalDialog, useConfirmDialog } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { Alert, AlertDescription, Badge, Button, EditorSection, EmptyState, FormField, Input, Select } from '@endora-commerce/admin-kit/ui';
import { productVisibilityClient } from '../api.js';
import { refusalMessage, thresholdLabels } from '../lib/labels.js';


interface ConditionDraft {
  currencyCode: string;
  threshold: VisibilityThreshold;
}

interface CategoryDraft {
  /** `null` for a new category. */
  readonly category: ProductVisibilityCategory | null;
  name: string;
  conditions: ConditionDraft[];
}

export interface CategoriesSectionProps {
  readonly overview: ProductVisibilityOverviewResponse;
  readonly writable: boolean;
  readonly onChanged: () => Promise<void>;
  readonly onStatus: (message: string, tone: 'success' | 'error') => void;
}

/**
 * FR-010 – FR-013 — the visibility categories. A category is a name and one or more currency
 * conditions; a product qualifies when it meets at least one of them (US2-1).
 */
export function CategoriesSection({ overview, writable, onChanged, onStatus }: CategoriesSectionProps): ReactNode {
  const t = useTranslation('product_visibility_rules');
  const { confirm, confirmDialog } = useConfirmDialog();
  const [draft, setDraft] = useState<CategoryDraft | null>(null);

  const open = (category: ProductVisibilityCategory | null): void =>
    setDraft({
      category,
      name: category?.name ?? '',
      conditions: category ? category.conditions.map((c) => ({ ...c })) : [{ currencyCode: '', threshold: 'gt_zero' }],
    });

  const remove = async (category: ProductVisibilityCategory): Promise<void> => {
    const ok = await confirm({
      title: t('config.categories.deleteTitle'),
      message: t('config.categories.deleteMessage'),
      confirmLabel: t('config.categories.delete'),
      destructive: true,
    });
    if (!ok) return;
    try {
      await productVisibilityClient.deleteCategory(category);
      onStatus(t('config.categories.deleted'), 'success');
      await onChanged();
    } catch (err) {
      onStatus(refusalMessage(err, t('config.error.write')), 'error');
    }
  };

  const addButton = writable ? (
    <Button type="button" size="sm" variant="outline" onClick={(): void => open(null)}>
      <Plus aria-hidden="true" />
      {t('config.categories.add')}
    </Button>
  ) : null;

  return (
    <EditorSection as="h2" chrome="card" title={t('config.categories.title')} action={addButton}>
      {overview.categories.length === 0 ? (
        <EmptyState
          icon={<Layers aria-hidden="true" />}
          title={t('config.categories.empty.title')}
          description={t('config.categories.empty.description')}
        />
      ) : (
        <ul className="divide-y divide-border">
          {overview.categories.map((category) => (
            <li key={category.id} data-category-row className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0 space-y-1">
                {/* Operator text: rendered as text, never as markup. */}
                <p className="font-medium break-words">{category.name}</p>
                <ul className="flex flex-wrap gap-1.5" aria-label={t('config.categories.conditionsLabel')}>
                  {category.conditions.map((condition) => (
                    <li key={`${condition.currencyCode}:${condition.threshold}`}>
                      <Badge variant="outline">
                        <span className="font-mono">{condition.currencyCode}</span>
                        <span className="ml-1">{thresholdLabels.label(t, condition.threshold)}</span>
                      </Badge>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground">
                  {t('config.categories.mappedRoles', { count: category.mappedRoleIds.length })}
                </p>
              </div>
              {writable ? (
                <div className="flex items-center gap-1">
                  <Button type="button" size="sm" variant="ghost" aria-label={t('config.categories.edit')} onClick={(): void => open(category)}>
                    <Pencil aria-hidden="true" />
                  </Button>
                  <Button type="button" size="sm" variant="ghost" aria-label={t('config.categories.delete')} onClick={(): void => void remove(category)}>
                    <Trash2 aria-hidden="true" />
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {draft ? (
        <CategoryDialog
          draft={draft}
          currencies={overview.currencies.map((c) => c.code)}
          onClose={(): void => setDraft(null)}
          onSaved={async (): Promise<void> => {
            setDraft(null);
            onStatus(t('config.categories.saved'), 'success');
            await onChanged();
          }}
        />
      ) : null}
      {confirmDialog}
    </EditorSection>
  );
}

interface CategoryDialogProps {
  readonly draft: CategoryDraft;
  readonly currencies: readonly string[];
  readonly onClose: () => void;
  readonly onSaved: () => Promise<void>;
}

interface DraftErrors {
  name?: string;
  conditions: Array<string | undefined>;
}

function CategoryDialog({ draft, currencies, onClose, onSaved }: CategoryDialogProps): ReactNode {
  const t = useTranslation('product_visibility_rules');
  const formId = useId();
  const [name, setName] = useState(draft.name);
  const [conditions, setConditions] = useState<ConditionDraft[]>(draft.conditions);
  const [errors, setErrors] = useState<DraftErrors | null>(null);
  const [saving, setSaving] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const validate = (): DraftErrors | null => {
    const found: DraftErrors = { conditions: [] };
    let any = false;
    if (name.trim() === '') {
      found.name = t('config.categories.error.nameRequired');
      any = true;
    }
    const seen = new Set<string>();
    conditions.forEach((condition, index) => {
      if (condition.currencyCode === '') {
        found.conditions[index] = t('config.categories.error.currencyRequired');
        any = true;
        return;
      }
      const key = `${condition.currencyCode}:${condition.threshold}`;
      if (seen.has(key)) {
        found.conditions[index] = t('config.categories.error.duplicate');
        any = true;
      }
      seen.add(key);
    });
    if (conditions.length === 0) any = true;
    return any ? found : null;
  };

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const found = validate();
    setErrors(found);
    if (found) return;
    setSaving(true);
    setRefusal(null);
    const body = { name: name.trim(), conditions: conditions.map((c) => ({ currencyCode: c.currencyCode, threshold: c.threshold })) };
    try {
      if (draft.category) await productVisibilityClient.updateCategory(draft.category, body);
      else await productVisibilityClient.createCategory(body);
      await onSaved();
    } catch (err) {
      setRefusal(refusalMessage(err, t('config.error.write')));
    } finally {
      setSaving(false);
    }
  };

  const update = (index: number, patch: Partial<ConditionDraft>): void =>
    setConditions((prev) => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)));

  return (
    <ModalDialog
      title={draft.category ? t('config.categories.editTitle') : t('config.categories.addTitle')}
      onClose={onClose}
      busy={saving}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            {t('config.cancel')}
          </Button>
          <Button type="submit" form={formId} disabled={saving} aria-busy={saving}>
            {t('config.categories.save')}
          </Button>
        </>
      }
    >
      <form id={formId} noValidate onSubmit={(e): void => void submit(e)} className="space-y-4">
        {refusal ? (
          <Alert variant="destructive">
            <AlertDescription>{refusal}</AlertDescription>
          </Alert>
        ) : null}
        <FormField label={t('config.categories.field.name')} error={errors?.name} required>
          <Input value={name} maxLength={120} onChange={(e): void => setName(e.target.value)} />
        </FormField>
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">{t('config.categories.conditionsLabel')}</legend>
          <p className="text-xs text-muted-foreground">{t('config.categories.conditionsHint')}</p>
          {conditions.map((condition, index) => (
            <div key={index} className="grid items-end gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <FormField label={t('config.categories.field.currency')} error={errors?.conditions[index]}>
                <Select value={condition.currencyCode} onChange={(e): void => update(index, { currencyCode: e.target.value })}>
                  <option value="">{t('config.choose')}</option>
                  {currencies.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label={t('config.categories.field.threshold')}>
                <Select value={condition.threshold} onChange={(e): void => update(index, { threshold: e.target.value as VisibilityThreshold })}>
                  {thresholdLabels.options(t).map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </FormField>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={t('config.categories.removeCondition')}
                disabled={conditions.length === 1}
                onClick={(): void => setConditions((prev) => prev.filter((_, i) => i !== index))}
              >
                <X aria-hidden="true" />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={(): void => setConditions((prev) => [...prev, { currencyCode: '', threshold: 'gt_zero' }])}
          >
            <Plus aria-hidden="true" />
            {t('config.categories.addCondition')}
          </Button>
        </fieldset>
      </form>
    </ModalDialog>
  );
}
