import { describe, expect, it } from 'vitest';
import type { CustomFieldOptionDto } from '@endora-commerce/contracts';
import {
  firstIssue,
  hasIssues,
  maxDefaultOptions,
  optionValueIssue,
  singleDefaultConflict,
  toCreateOptions,
  validateDefinitionDraft,
  type DefinitionDraft,
} from './definition-draft.js';

/**
 * Issue #447 — the checks the definition form runs before it sends anything,
 * the same in the create and the edit view.
 */

const option = (value: string, overrides: Partial<CustomFieldOptionDto> = {}): CustomFieldOptionDto => ({
  value,
  label: {},
  labelDefault: value.toUpperCase(),
  isDefault: false,
  sortOrder: 0,
  ...overrides,
});

const draft = (overrides: Partial<DefinitionDraft> = {}): DefinitionDraft => ({
  key: 'region',
  labelDefault: 'Region',
  valueType: 'select',
  options: [option('north'), option('south')],
  ...overrides,
});

describe('validateDefinitionDraft', () => {
  it('accepts a complete select draft', () => {
    expect(hasIssues(validateDefinitionDraft(draft(), 'create'))).toBe(false);
  });

  it.each(['', '  '])('asks for a key when it is %j', (key) => {
    expect(validateDefinitionDraft(draft({ key }), 'create').key).toBe('customFields.validation.keyRequired');
  });

  it.each(['Region', '1region', 'region-code', 'région', `r${'x'.repeat(64)}`])(
    'refuses the key %j by its format',
    (key) => {
      expect(validateDefinitionDraft(draft({ key }), 'create').key).toBe('customFields.validation.keyFormat');
    },
  );

  it('accepts a key surrounded by spaces, which is trimmed before it is sent', () => {
    expect(validateDefinitionDraft(draft({ key: ' po_number ' }), 'create').key).toBeUndefined();
  });

  it('does not judge the key while editing: it is fixed', () => {
    expect(validateDefinitionDraft(draft({ key: 'Legacy-Key' }), 'edit').key).toBeUndefined();
  });

  it('asks for a default label', () => {
    expect(validateDefinitionDraft(draft({ labelDefault: ' ' }), 'create').labelDefault).toBe(
      'customFields.editor.labelDefaultRequired',
    );
    expect(validateDefinitionDraft(draft({ labelDefault: ' ' }), 'edit').labelDefault).toBe(
      'customFields.editor.labelDefaultRequired',
    );
  });

  it('asks a choice field for at least one option', () => {
    expect(validateDefinitionDraft(draft({ options: [] }), 'create').options).toBe(
      'customFields.validation.optionsRequired',
    );
  });

  it('asks nothing of options for a type that has none', () => {
    const issues = validateDefinitionDraft(draft({ valueType: 'text', options: [] }), 'create');
    expect(hasIssues(issues)).toBe(false);
  });

  it('refuses an empty stored value and an option without a default label, on their rows', () => {
    const issues = validateDefinitionDraft(
      draft({ options: [option(' ', { labelDefault: 'Blank' }), option('south', { labelDefault: '' })] }),
      'create',
    );
    expect(issues.optionRows[0]).toEqual({ value: 'customFields.validation.optionValueRequired' });
    expect(issues.optionRows[1]).toEqual({ labelDefault: 'customFields.editor.labelDefaultRequired' });
  });

  it('refuses a stored value used twice — trimmed — on the later row only', () => {
    const issues = validateDefinitionDraft(draft({ options: [option('north'), option(' north ')] }), 'create');
    expect(issues.optionRows[0]).toBeUndefined();
    expect(issues.optionRows[1]).toEqual({ value: 'customFields.validation.optionValueDuplicate' });
  });

  it('refuses a second default option on a single-choice field, on the second one', () => {
    const issues = validateDefinitionDraft(
      draft({ options: [option('north', { isDefault: true }), option('south', { isDefault: true })] }),
      'create',
    );
    expect(issues.optionRows[1]).toEqual({ isDefault: 'customFields.validation.singleDefault' });
    expect(issues.optionRows[0]).toBeUndefined();
  });

  it('accepts several default options on a multiple-choice field, and none on either', () => {
    const several = [option('north', { isDefault: true }), option('south', { isDefault: true })];
    expect(hasIssues(validateDefinitionDraft(draft({ valueType: 'multiselect', options: several }), 'create'))).toBe(false);
    expect(hasIssues(validateDefinitionDraft(draft({ valueType: 'select' }), 'create'))).toBe(false);
  });

  it('names the first issue in the order the form shows its sections', () => {
    const issues = validateDefinitionDraft(draft({ key: '', labelDefault: '', options: [option('')] }), 'create');
    expect(firstIssue(issues)).toBe('key');
    expect(firstIssue(validateDefinitionDraft(draft({ options: [option('a'), option('')] }), 'create'))).toEqual({
      row: 1,
      field: 'value',
    });
  });
});

describe('maxDefaultOptions — the cardinality the form holds', () => {
  it('is one for a single-choice field, unbounded for a multiple-choice one, none otherwise', () => {
    expect(maxDefaultOptions('select')).toBe(1);
    expect(maxDefaultOptions('multiselect')).toBe(Number.POSITIVE_INFINITY);
    expect(maxDefaultOptions('text')).toBe(0);
  });
});

describe('singleDefaultConflict', () => {
  const options = [option('north', { isDefault: true }), option('south')];

  it('names the option already marked when a single-choice field would get a second default', () => {
    expect(singleDefaultConflict('select', options, 'south')?.value).toBe('north');
  });

  it('is null for a multiple-choice field, for the option already marked, and for unmarking', () => {
    expect(singleDefaultConflict('multiselect', options, 'south')).toBeNull();
    expect(singleDefaultConflict('select', options, 'north')).toBeNull();
    expect(singleDefaultConflict('select', [option('north'), option('south')], 'south')).toBeNull();
  });
});

describe('optionValueIssue — the check a single new option runs', () => {
  it('asks for a value, then refuses one already used', () => {
    expect(optionValueIssue('  ', ['north'])).toBe('customFields.validation.optionValueRequired');
    expect(optionValueIssue(' north', ['north'])).toBe('customFields.validation.optionValueDuplicate');
    expect(optionValueIssue('east', ['north'])).toBeUndefined();
  });
});

describe('toCreateOptions', () => {
  it('trims what is sent, drops empty languages, and numbers the options in their order', () => {
    expect(
      toCreateOptions([
        option(' south ', { labelDefault: ' South ', label: { en: ' South ', pl: '' }, sortOrder: 7 }),
        option('north', { isDefault: true, label: { pl: 'Północ' }, sortOrder: 3 }),
      ]),
    ).toEqual([
      { value: 'south', labelDefault: 'South', label: { en: 'South' }, isDefault: false, sortOrder: 0 },
      { value: 'north', labelDefault: 'NORTH', label: { pl: 'Północ' }, isDefault: true, sortOrder: 1 },
    ]);
  });
});
