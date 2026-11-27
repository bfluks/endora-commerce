import type { ReactElement } from 'react';
import type { Field } from '@puckeditor/core';
import { PuckFieldLabel } from './puck-field-label.js';
import { PB_FIELD_HINT_CLASS, PB_FIELD_INPUT_CLASS } from './field-classes.js';
import { useFieldText } from './field-text.js';

const inputClassName = PB_FIELD_INPUT_CLASS;

/** The input and its hint, translated (R17): a component of its own so it may read the host's copy. */
function EditorNameControl({
  value,
  onChange,
  readOnly,
}: {
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  readOnly?: boolean | undefined;
}): ReactElement {
  const text = useFieldText();
  return (
    <div className="space-y-1">
      <input
        type="text"
        className={inputClassName}
        style={{ width: '100%', boxSizing: 'border-box' }}
        readOnly={readOnly}
        value={value ?? ''}
        placeholder={text('editorName.placeholder')}
        onChange={(e): void => onChange(e.target.value || undefined)}
      />
      <p className={PB_FIELD_HINT_CLASS}>{text('editorName.hint')}</p>
    </div>
  );
}

export function createEditorNameField(): Field<string | undefined, Record<string, unknown>> {
  return {
    type: 'custom',
    label: 'Name',
    metadata: { pageBuilder: { editorChrome: true as const, sharedLabel: { key: 'editorName' as const, en: 'Name' } } },
    render: ({ value, onChange, readOnly, field }): ReactElement => (
      <PuckFieldLabel label={field.label ?? 'Name'} {...(readOnly === true ? { readOnly: true } : {})}>
        <EditorNameControl value={value} onChange={onChange} readOnly={readOnly} />
      </PuckFieldLabel>
    ),
  };
}
