import { useId, type ReactNode } from 'react';
import { ITEMS_TABLE_LIMITS, itemsTableGroupingMode, type ItemsTableGroupingMode } from '@endora-commerce/contracts';
import { Checkbox, Input, Label, Select } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { useCollection } from './collections-context.js';
import { asRecord, text, type Entry } from './shared.js';

/**
 * The **Grouping** field (153 FR-042, 159 FR-041 —
 * `specs/159-quote-request-item-groups/contracts/document-sections.md` §4):
 *
 * - **Document's groups** — the groups an administrator made on the document.
 *   A table never configured stores `null`, which means this; choosing it
 *   writes `null` again, and touching one of its two options (the *Other items*
 *   heading, the item count) writes `{ by: 'sections', … }`.
 * - **By field** — 153's grouping by a field's value, stored in 153's shape so
 *   a template stays readable by the renderer it was written for.
 * - **No grouping** — `{ by: 'none' }`.
 *
 * Under a document type whose sample has no groups, *Document's groups* says
 * so: such a table prints flat.
 */
export interface GroupingFieldProps {
  readonly value: unknown;
  readonly onChange: (next: Entry | null) => void;
  readonly readOnly?: boolean;
}

const MODES: readonly ItemsTableGroupingMode[] = ['sections', 'field', 'none'];
const MODE_KEY: Record<ItemsTableGroupingMode, string> = {
  sections: 'itemsTable.grouping.mode.sections',
  field: 'itemsTable.grouping.mode.field',
  none: 'itemsTable.grouping.mode.none',
};

export function GroupingField({ value, onChange, readOnly = false }: GroupingFieldProps): ReactNode {
  const t = useTranslation('document_templates');
  const base = useId();
  const collection = useCollection();
  const fields = (collection?.fields ?? []).filter((field) => field.path !== 'row.number');
  const hasSections = (collection?.sampleSections ?? []).length > 0;
  const mode = itemsTableGroupingMode(value);
  const grouping = value === null || value === undefined ? null : asRecord(value);
  const numeric = fields.filter((field) => field.valueKind === 'number' || field.valueKind === 'money');
  const set = (patch: Entry): void => onChange({ ...(grouping ?? {}), ...patch });
  const sections = (patch: Entry): void =>
    onChange({
      by: 'sections',
      otherItemsLabel: text(grouping?.['otherItemsLabel']),
      showItemCount: grouping?.['showItemCount'] !== false && grouping?.['showItemCount'] !== 'false',
      ...patch,
    });
  const choose = (next: ItemsTableGroupingMode): void => {
    if (next === mode) return;
    if (next === 'sections') onChange(null);
    else if (next === 'none') onChange({ by: 'none' });
    else onChange({ field: fields[0]?.path ?? '', emptyLabel: '', subtotalField: null, subtotalLabel: '' });
  };
  const showItemCount = mode === 'sections' && grouping?.['showItemCount'] !== false && grouping?.['showItemCount'] !== 'false';

  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{t('itemsTable.grouping.title')}</legend>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {MODES.map((option) => (
          <label key={option} className="inline-flex items-center gap-1 text-sm">
            <input
              type="radio"
              name={`${base}-mode`}
              value={option}
              checked={mode === option}
              disabled={readOnly || (option === 'field' && fields.length === 0)}
              onChange={() => choose(option)}
            />
            {t(MODE_KEY[option])}
          </label>
        ))}
      </div>
      {mode === 'sections' ? (
        <>
          {hasSections ? null : <p className="text-sm text-muted-foreground">{t('itemsTable.grouping.noSections')}</p>}
          <div>
            <Label htmlFor={`${base}-other`}>{t('itemsTable.grouping.otherItemsLabel')}</Label>
            <Input
              id={`${base}-other`}
              disabled={readOnly}
              value={text(grouping?.['otherItemsLabel'])}
              maxLength={ITEMS_TABLE_LIMITS.maxGroupEmptyLabelLength}
              onChange={(event) => sections({ otherItemsLabel: event.target.value })}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={showItemCount}
              disabled={readOnly}
              onChange={(event) => sections({ showItemCount: event.target.checked })}
            />
            {t('itemsTable.grouping.showItemCount')}
          </label>
        </>
      ) : null}
      {mode === 'field' && grouping ? (
        <>
          <div>
            <Label htmlFor={`${base}-field`}>{t('itemsTable.grouping.field')}</Label>
            <Select
              id={`${base}-field`}
              disabled={readOnly}
              value={text(grouping['field'])}
              onChange={(event) => set({ field: event.target.value })}
            >
              {fields.map((field) => (
                <option key={field.path} value={field.path}>
                  {field.label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor={`${base}-empty`}>{t('itemsTable.grouping.emptyLabel')}</Label>
            <Input
              id={`${base}-empty`}
              disabled={readOnly}
              value={text(grouping['emptyLabel'])}
              maxLength={ITEMS_TABLE_LIMITS.maxGroupEmptyLabelLength}
              onChange={(event) => set({ emptyLabel: event.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor={`${base}-subtotal`}>{t('itemsTable.grouping.subtotalField')}</Label>
              <Select
                id={`${base}-subtotal`}
                disabled={readOnly}
                value={text(grouping['subtotalField'])}
                onChange={(event) => set({ subtotalField: event.target.value === '' ? null : event.target.value })}
              >
                <option value="">{t('itemsTable.grouping.noSubtotal')}</option>
                {numeric.map((field) => (
                  <option key={field.path} value={field.path}>
                    {field.label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor={`${base}-subtotal-label`}>{t('itemsTable.grouping.subtotalLabel')}</Label>
              <Input
                id={`${base}-subtotal-label`}
                disabled={readOnly}
                value={text(grouping['subtotalLabel'])}
                onChange={(event) => set({ subtotalLabel: event.target.value })}
              />
            </div>
          </div>
        </>
      ) : null}
    </fieldset>
  );
}
