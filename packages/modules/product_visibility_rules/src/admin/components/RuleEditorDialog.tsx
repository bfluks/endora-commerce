import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import { Plus, X } from 'lucide-react';
import {
  PRODUCT_RULE_MAX_CONDITIONS,
  type ProductRuleAttributesResponse,
  type ProductRuleDefinition,
  type ProductRuleDetail,
  type RuleCondition,
  type VisibilityThreshold,
} from '@endora-commerce/contracts';
import { ModalDialog } from '@endora-commerce/admin-kit/components';
import { useTranslation, useTranslationContext } from '@endora-commerce/admin-kit/i18n';
import { Alert, AlertDescription, Button, Checkbox, FormField, Input, Label, Select } from '@endora-commerce/admin-kit/ui';
import { productVisibilityClient } from '../api.js';
import { INERT_CLASS, localized, refusalMessage, thresholdLabels } from '../lib/labels.js';
import { usePreviewFlow } from '../lib/use-preview-flow.js';
import { PreviewPanel } from './PreviewPanel.js';

type Attribute = ProductRuleAttributesResponse['items'][number];

type ConditionDraft =
  | { kind: 'attribute'; attributeKey: string; value: '' | 'true' | 'false'; optionKeys: string[] }
  | { kind: 'price'; currencyCode: string; threshold: VisibilityThreshold };

function toDraft(condition: RuleCondition): ConditionDraft {
  switch (condition.kind) {
    case 'attribute_boolean':
      return { kind: 'attribute', attributeKey: condition.attributeKey, value: condition.value ? 'true' : 'false', optionKeys: [] };
    case 'attribute_choice':
      return { kind: 'attribute', attributeKey: condition.attributeKey, value: '', optionKeys: [...condition.optionKeys] };
    case 'catalogue_price':
      return { kind: 'price', currencyCode: condition.currencyCode, threshold: condition.threshold };
  }
}

export interface RuleEditorDialogProps {
  readonly currencies: readonly string[];
  /** T103 — the saved rule to open; absent for a new rule. */
  readonly ruleId?: string;
  /** Names a governed channel in a change preview. */
  readonly channelName?: (id: string) => string;
  /** How often a pending change preview is asked again. */
  readonly pollIntervalMs?: number;
  readonly slowAfterMs?: number;
  readonly onClose: () => void;
  /** `saved` — written directly; `changed` — an attached rule's change preview was confirmed. */
  readonly onSaved: (outcome: 'saved' | 'changed') => Promise<void>;
}

/**
 * FR-050 — a product rule: a name, "all of" / "any of", and conditions on a product's attribute
 * values and catalogue prices. The attribute picker offers only what the server lists (global
 * boolean and choice attributes, options by their label in the operator's language), and a
 * condition offers only the values its attribute can hold — the editor never builds a definition
 * the server would refuse (Tesler, Postel).
 *
 * T103 (FR-053, US4-5) — with `ruleId` it opens a saved rule, read fresh so the version it saves
 * against is the one shown. A rule that governs no channel saves directly; one that governs a
 * channel changes only through a preview of each governed channel's joins and leaves, confirmed
 * by the administrator. Editing a condition drops a preview, which counted the old conditions. A
 * saved attribute, option or currency the server no longer offers is still shown, by its key, so
 * it can be removed. The name is changed by "Rename", not here. A rule with grouped conditions
 * (one nesting level, written through the API) is not opened: this editor builds flat rules only,
 * and saving one would drop its groups.
 *
 * The kit's `RuleBuilder` was not reused: its attribute operators (`eq`, `in`, `between`, …) and
 * unbounded nesting describe a different tree from `ProductRuleDefinition`, and fitting one to
 * the other would offer choices the API refuses.
 */
export function RuleEditorDialog({ currencies, ruleId, channelName, pollIntervalMs = 2000, slowAfterMs, onClose, onSaved }: RuleEditorDialogProps): ReactNode {
  const t = useTranslation('product_visibility_rules');
  const { language } = useTranslationContext();
  const formId = useId();
  const editing = ruleId !== undefined;
  const [saved, setSaved] = useState<ProductRuleDetail | null>(null);
  const [savedFailed, setSavedFailed] = useState(false);
  const [attributes, setAttributes] = useState<readonly Attribute[] | null>(null);
  const [attributesFailed, setAttributesFailed] = useState(false);
  const [name, setName] = useState('');
  const [match, setMatch] = useState<'all' | 'any'>('all');
  const [conditions, setConditions] = useState<ConditionDraft[]>([]);
  const [errors, setErrors] = useState<{ name?: string; conditions?: string; each: Array<string | undefined> } | null>(null);
  const [saving, setSaving] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const flow = usePreviewFlow(pollIntervalMs, slowAfterMs);
  const { reset: resetPreview } = flow;

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

  useEffect(() => {
    if (ruleId === undefined) return;
    let live = true;
    productVisibilityClient
      .rule(ruleId)
      .then((rule) => {
        if (!live) return;
        setSaved(rule);
        setMatch(rule.definition.match);
        // A grouped definition (API only) is not something this editor builds; it is not opened.
        setConditions(rule.definition.conditions.flatMap((c) => (c.kind === 'group' ? [] : [toDraft(c)])));
      })
      .catch(() => {
        if (live) setSavedFailed(true);
      });
    return (): void => {
      live = false;
    };
  }, [ruleId]);

  const governed = saved !== null && saved.attachments.length > 0;
  const grouped = saved !== null && saved.definition.conditions.some((c) => c.kind === 'group');
  const loading = editing && saved === null && !savedFailed;
  const ready = !editing || (saved !== null && !grouped);

  // A preview counted the conditions as they were; any edit drops it.
  useEffect(() => {
    resetPreview();
  }, [match, conditions, resetPreview]);

  const attributeLabel = (attribute: Attribute): string =>
    localized(attribute.label, language) ?? attribute.labelDefault ?? attribute.key;

  const update = (index: number, next: ConditionDraft): void =>
    setConditions((prev) => prev.map((c, i) => (i === index ? next : c)));

  const atLimit = conditions.length >= PRODUCT_RULE_MAX_CONDITIONS;

  const build = (): { definition: ProductRuleDefinition | null; found: NonNullable<typeof errors> | null } => {
    const found: NonNullable<typeof errors> = { each: [] };
    let any = false;
    if (!editing && name.trim() === '') {
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
    if (!ready || governed || saving || waiting) return;
    const { definition, found } = build();
    setErrors(found);
    if (!definition) return;
    setSaving(true);
    setRefusal(null);
    try {
      if (saved) await productVisibilityClient.updateRule(saved, { definition });
      else await productVisibilityClient.createRule({ name: name.trim(), definition });
      await onSaved('saved');
    } catch (err) {
      setRefusal(refusalMessage(err, t('config.error.write')));
    } finally {
      setSaving(false);
    }
  };

  const previewChange = async (): Promise<void> => {
    if (!saved || flow.busy || waiting) return;
    const { definition, found } = build();
    setErrors(found);
    if (!definition) return;
    await flow.start(() => productVisibilityClient.createPreview({ kind: 'change', productRuleId: saved.id, definition }, saved.version));
  };

  const applying = flow.preview.phase === 'applying';
  const locked = saving || applying || !ready;
  // T103 — until the attribute list answers, a saved attribute condition cannot be shown by its
  // label nor checked, so Save and Preview wait (aria-disabled, with the reason beside them).
  const waiting = attributes === null && !attributesFailed;
  const waitingId = `${formId}-waiting`;
  const close = (): void => {
    if (saving || applying) return;
    flow.stop();
    onClose();
  };

  return (
    <ModalDialog
      title={editing ? t('rules.editor.editTitle') : t('rules.editor.title')}
      onClose={close}
      busy={saving || applying}
      widthClassName="max-w-2xl"
      footer={
        <>
          <Button type="button" variant="outline" className={INERT_CLASS} onClick={close} aria-disabled={saving || applying || undefined}>
            {t('config.cancel')}
          </Button>
          {!ready ? null : governed ? (
            flow.counts ? (
              <Button
                ref={flow.confirmRef}
                type="button"
                className={INERT_CLASS}
                onClick={(): void => {
                  if (!applying) void flow.confirm(() => onSaved('changed'));
                }}
                aria-disabled={applying || undefined}
                aria-busy={applying}
              >
                {t('rules.attach.confirm')}
              </Button>
            ) : (
              <Button
                type="button"
                className={INERT_CLASS}
                onClick={(): void => void previewChange()}
                aria-disabled={flow.busy || waiting || undefined}
                aria-busy={flow.busy}
                aria-describedby={waiting ? waitingId : undefined}
              >
                {t('rules.attach.preview')}
              </Button>
            )
          ) : (
            <Button
              type="submit"
              form={formId}
              className={INERT_CLASS}
              aria-disabled={saving || waiting || undefined}
              aria-busy={saving}
              aria-describedby={waiting ? waitingId : undefined}
            >
              {t('rules.editor.save')}
            </Button>
          )}
        </>
      }
    >
      {loading ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t('rules.editor.loading')}
        </p>
      ) : savedFailed ? (
        <Alert variant="destructive">
          <AlertDescription>{t('rules.editor.loadFailed')}</AlertDescription>
        </Alert>
      ) : grouped ? (
        <Alert variant="warning">
          <AlertDescription>{t('rules.editor.grouped')}</AlertDescription>
        </Alert>
      ) : (
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
          {saved ? (
            <p className="font-medium break-words">{saved.name}</p>
          ) : (
            <FormField label={t('rules.editor.field.name')} error={errors?.name} required>
              <Input value={name} maxLength={120} onChange={(e): void => setName(e.target.value)} />
            </FormField>
          )}
          {governed ? <p className="text-sm text-muted-foreground">{t('rules.editor.governed')}</p> : null}
          <fieldset disabled={locked} className="space-y-4">
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
                          {(currencies.includes(condition.currencyCode) || condition.currencyCode === ''
                            ? currencies
                            : [...currencies, condition.currencyCode]
                          ).map((code) => (
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
                      language={language}
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
          </fieldset>
          {governed ? <PreviewPanel flow={flow} channelName={channelName ?? ((id: string): string => id)} /> : null}
        </form>
      )}
    </ModalDialog>
  );
}

type AttributeDraft = Extract<ConditionDraft, { kind: 'attribute' }>;

function AttributeConditionFields({
  condition,
  attributes,
  attributeLabel,
  language,
  error,
  onChange,
}: {
  readonly condition: AttributeDraft;
  readonly attributes: readonly Attribute[] | null;
  readonly attributeLabel: (attribute: Attribute) => string;
  readonly language: string;
  readonly error: string | undefined;
  readonly onChange: (next: AttributeDraft) => void;
}): ReactNode {
  const t = useTranslation('product_visibility_rules');
  const groupId = useId();
  const attribute = attributes?.find((a) => a.key === condition.attributeKey);
  // A saved attribute the server no longer offers stays visible by its key (it can only be removed).
  const unlisted = attributes !== null && condition.attributeKey !== '' && attribute === undefined;
  // A choice attribute's options by label; a saved option it no longer has, by its key.
  const options =
    attribute?.kind === 'choice'
      ? [
          ...attribute.options.map((o) => ({ key: o.key, label: localized(o.label, language) ?? (o.labelDefault || o.key) })),
          ...condition.optionKeys.filter((key) => !attribute.options.some((o) => o.key === key)).map((key) => ({ key, label: key })),
        ]
      : [];
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
          {unlisted ? <option value={condition.attributeKey}>{condition.attributeKey}</option> : null}
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
          {options.map((option) => {
            const id = `${groupId}-${option.key}`;
            const checked = condition.optionKeys.includes(option.key);
            return (
              <div key={option.key} className="flex items-center gap-2">
                <Checkbox
                  id={id}
                  checked={checked}
                  onChange={(e): void =>
                    onChange({
                      ...condition,
                      optionKeys: e.target.checked ? [...condition.optionKeys, option.key] : condition.optionKeys.filter((o) => o !== option.key),
                    })
                  }
                />
                <Label htmlFor={id} className="text-sm font-normal">
                  {option.label}
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
