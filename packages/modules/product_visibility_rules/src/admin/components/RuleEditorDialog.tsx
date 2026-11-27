import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import { Plus, X } from 'lucide-react';
import {
  PRODUCT_RULE_MAX_CONDITIONS,
  type ProductRuleAttributesResponse,
  type ProductRuleDefinition,
  type RuleCondition,
  type VisibilityThreshold,
} from '@endora-commerce/contracts';
import { ModalDialog } from '@endora-commerce/admin-kit/components';
import { useTranslation, useTranslationContext } from '@endora-commerce/admin-kit/i18n';
import { Alert, AlertDescription, Button, Checkbox, FormField, Input, Label, Select } from '@endora-commerce/admin-kit/ui';
import { productVisibilityClient } from '../api.js';
import { refusalMessage, thresholdLabels } from '../lib/labels.js';


type Attribute = ProductRuleAttributesResponse['items'][number];

type ConditionDraft =
  | { kind: 'attribute'; attributeKey: string; value: '' | 'true' | 'false'; optionKeys: string[] }
  | { kind: 'price'; currencyCode: string; threshold: VisibilityThreshold };

export interface RuleEditorDialogProps {
  readonly currencies: readonly string[];
  readonly onClose: () => void;
  readonly onSaved: () => Promise<void>;
}

/**
 * FR-050 — a new product rule: a name, "all of" / "any of", and conditions on a product's
 * attribute values and catalogue prices. The attribute picker offers only what the server lists
 * (global boolean and choice attributes), and a condition offers only the values its attribute
 * can hold — the editor never builds a definition the server would refuse (Tesler, Postel).
 *
 * The kit's `RuleBuilder` was not reused: its attribute operators (`eq`, `in`, `between`, …) and
 * unbounded nesting describe a different tree from `ProductRuleDefinition`, and fitting one to
 * the other would offer choices the API refuses.
 */
export function RuleEditorDialog({ currencies, onClose, onSaved }: RuleEditorDialogProps): ReactNode {
  const t = useTranslation('product_visibility_rules');
  const { language } = useTranslationContext();
  const formId = useId();
  const [attributes, setAttributes] = useState<readonly Attribute[] | null>(null);
  const [attributesFailed, setAttributesFailed] = useState(false);
  const [name, setName] = useState('');
  const [match, setMatch] = useState<'all' | 'any'>('all');
  const [conditions, setConditions] = useState<ConditionDraft[]>([]);
  const [errors, setErrors] = useState<{ name?: string; conditions?: string; each: Array<string | undefined> } | null>(null);
  const [saving, setSaving] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    productVisibilityClient
      .attributes()
      .then((answer) => {
        if (live) setAttributes(answer.items);
      })
      .catch(() => {
        if (live) setAttributesFailed(true);
      });
    return (): void => {
      live = false;
    };
  }, []);

  const attributeLabel = (attribute: Attribute): string =>
    attribute.label[language] ?? attribute.labelDefault ?? attribute.key;

  const update = (index: number, next: ConditionDraft): void =>
    setConditions((prev) => prev.map((c, i) => (i === index ? next : c)));

  const atLimit = conditions.length >= PRODUCT_RULE_MAX_CONDITIONS;

  const build = (): { definition: ProductRuleDefinition | null; found: NonNullable<typeof errors> | null } => {
    const found: NonNullable<typeof errors> = { each: [] };
    let any = false;
    if (name.trim() === '') {
      found.name = t('rules.editor.error.nameRequired');
      any = true;
    }
    if (conditions.length === 0) {
      found.conditions = t('rules.editor.error.noConditions');
      any = true;
    }
    const built: RuleCondition[] = [];
    conditions.forEach((condition, index) => {
      if (condition.kind === 'price') {
        if (condition.currencyCode === '') {
          found.each[index] = t('rules.editor.error.currencyRequired');
          any = true;
          return;
        }
        built.push({ kind: 'catalogue_price', currencyCode: condition.currencyCode, threshold: condition.threshold });
        return;
      }
      const attribute = attributes?.find((a) => a.key === condition.attributeKey);
      if (!attribute) {
        found.each[index] = t('rules.editor.error.attributeRequired');
        any = true;
        return;
      }
      if (attribute.kind === 'boolean') {
        if (condition.value === '') {
          found.each[index] = t('rules.editor.error.valueRequired');
          any = true;
          return;
        }
        built.push({ kind: 'attribute_boolean', attributeKey: attribute.key, value: condition.value === 'true' });
        return;
      }
      if (condition.optionKeys.length === 0) {
        found.each[index] = t('rules.editor.error.optionsRequired');
        any = true;
        return;
      }
      built.push({ kind: 'attribute_choice', attributeKey: attribute.key, optionKeys: condition.optionKeys });
    });
    return any ? { definition: null, found } : { definition: { match, conditions: built }, found: null };
  };

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const { definition, found } = build();
    setErrors(found);
    if (!definition) return;
    setSaving(true);
    setRefusal(null);
    try {
      await productVisibilityClient.createRule({ name: name.trim(), definition });
      await onSaved();
    } catch (err) {
      setRefusal(refusalMessage(err, t('config.error.write')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalDialog
      title={t('rules.editor.title')}
      onClose={onClose}
      busy={saving}
      widthClassName="max-w-2xl"
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            {t('config.cancel')}
          </Button>
          <Button type="submit" form={formId} disabled={saving} aria-busy={saving}>
            {t('rules.editor.save')}
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
        {attributesFailed ? (
          <Alert variant="warning">
            <AlertDescription>{t('rules.editor.attributesFailed')}</AlertDescription>
          </Alert>
        ) : null}
        <FormField label={t('rules.editor.field.name')} error={errors?.name} required>
          <Input value={name} maxLength={120} onChange={(e): void => setName(e.target.value)} />
        </FormField>
        <FormField label={t('rules.editor.field.match')}>
          <Select value={match} onChange={(e): void => setMatch(e.target.value === 'any' ? 'any' : 'all')}>
            <option value="all">{t('rules.editor.match.all')}</option>
            <option value="any">{t('rules.editor.match.any')}</option>
          </Select>
        </FormField>
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">{t('rules.editor.conditions')}</legend>
          {conditions.map((condition, index) => (
            <div key={index} className="space-y-2 rounded-md border border-border p-3">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium">
                  {condition.kind === 'price' ? t('rules.editor.kind.price') : t('rules.editor.kind.attribute')}
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={t('rules.editor.removeCondition')}
                  onClick={(): void => setConditions((prev) => prev.filter((_, i) => i !== index))}
                >
                  <X aria-hidden="true" />
                </Button>
              </div>
              {condition.kind === 'price' ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  <FormField label={t('rules.editor.field.currency')} error={errors?.each[index]}>
                    <Select value={condition.currencyCode} onChange={(e): void => update(index, { ...condition, currencyCode: e.target.value })}>
                      <option value="">{t('config.choose')}</option>
                      {currencies.map((code) => (
                        <option key={code} value={code}>
                          {code}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                  <FormField label={t('rules.editor.field.threshold')}>
                    <Select
                      value={condition.threshold}
                      onChange={(e): void => update(index, { ...condition, threshold: e.target.value as VisibilityThreshold })}
                    >
                      {thresholdLabels.options(t).map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                </div>
              ) : (
                <AttributeConditionFields
                  condition={condition}
                  attributes={attributes}
                  attributeLabel={attributeLabel}
                  error={errors?.each[index]}
                  onChange={(next): void => update(index, next)}
                />
              )}
            </div>
          ))}
          {errors?.conditions ? (
            <p role="alert" className="text-sm text-destructive">
              {errors.conditions}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={atLimit}
              onClick={(): void => setConditions((prev) => [...prev, { kind: 'attribute', attributeKey: '', value: '', optionKeys: [] }])}
            >
              <Plus aria-hidden="true" />
              {t('rules.editor.addAttribute')}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={atLimit}
              onClick={(): void => setConditions((prev) => [...prev, { kind: 'price', currencyCode: '', threshold: 'gt_zero' }])}
            >
              <Plus aria-hidden="true" />
              {t('rules.editor.addPrice')}
            </Button>
          </div>
          {atLimit ? (
            <p className="text-xs text-muted-foreground">{t('rules.editor.limit', { count: PRODUCT_RULE_MAX_CONDITIONS })}</p>
          ) : null}
        </fieldset>
      </form>
    </ModalDialog>
  );
}

type AttributeDraft = Extract<ConditionDraft, { kind: 'attribute' }>;

function AttributeConditionFields({
  condition,
  attributes,
  attributeLabel,
  error,
  onChange,
}: {
  readonly condition: AttributeDraft;
  readonly attributes: readonly Attribute[] | null;
  readonly attributeLabel: (attribute: Attribute) => string;
  readonly error: string | undefined;
  readonly onChange: (next: AttributeDraft) => void;
}): ReactNode {
  const t = useTranslation('product_visibility_rules');
  const groupId = useId();
  const attribute = attributes?.find((a) => a.key === condition.attributeKey);
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <FormField label={t('rules.editor.field.attribute')} error={attribute ? undefined : error}>
        <Select
          value={condition.attributeKey}
          disabled={attributes === null}
          aria-busy={attributes === null}
          onChange={(e): void => onChange({ kind: 'attribute', attributeKey: e.target.value, value: '', optionKeys: [] })}
        >
          <option value="">{attributes === null ? t('config.loadingOptions') : t('config.choose')}</option>
          {(attributes ?? []).map((a) => (
            <option key={a.key} value={a.key}>
              {attributeLabel(a)}
            </option>
          ))}
        </Select>
      </FormField>
      {attribute?.kind === 'boolean' ? (
        <FormField label={t('rules.editor.field.booleanValue')} error={error}>
          <Select value={condition.value} onChange={(e): void => onChange({ ...condition, value: e.target.value as AttributeDraft['value'] })}>
            <option value="">{t('config.choose')}</option>
            <option value="true">{t('rules.editor.value.true')}</option>
            <option value="false">{t('rules.editor.value.false')}</option>
          </Select>
        </FormField>
      ) : null}
      {attribute?.kind === 'choice' ? (
        <fieldset className="space-y-1" aria-describedby={error ? `${groupId}-error` : undefined}>
          <legend className="text-sm font-medium">{t('rules.editor.field.options')}</legend>
          {attribute.options.map((option) => {
            const id = `${groupId}-${option}`;
            const checked = condition.optionKeys.includes(option);
            return (
              <div key={option} className="flex items-center gap-2">
                <Checkbox
                  id={id}
                  checked={checked}
                  onChange={(e): void =>
                    onChange({
                      ...condition,
                      optionKeys: e.target.checked ? [...condition.optionKeys, option] : condition.optionKeys.filter((o) => o !== option),
                    })
                  }
                />
                <Label htmlFor={id} className="font-mono text-sm font-normal">
                  {option}
                </Label>
              </div>
            );
          })}
          {error ? (
            <p id={`${groupId}-error`} role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </fieldset>
      ) : null}
    </div>
  );
}
