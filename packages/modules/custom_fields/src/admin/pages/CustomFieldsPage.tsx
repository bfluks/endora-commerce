import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Pencil, Trash2 } from 'lucide-react';
import { ApiError, useAuth } from '@endora-commerce/admin-kit/lib';
import { customFieldsClient } from '../api/custom-fields-client.js';
import { DefinitionBehaviourFields } from '../components/DefinitionBehaviourFields.js';
import { DefinitionEditorDialog } from '../components/DefinitionEditorDialog.js';
import { Alert, AlertDescription, Badge, Button, Card, CardContent, CardHeader, CardTitle, Label, PageHeader, Select, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import type {
  CustomFieldAudience,
  CustomFieldDefinitionDto,
  CustomFieldEntityTypeInfo,
  CustomFieldValueType,
  SupportedEntityType,
} from '@endora-commerce/contracts';

/**
 * Pre-API fallback so the page renders before the entity-types fetch resolves.
 * Only types that declare no owner module: a type that follows a module (a
 * Quote Request follows `quote_requests`, an Opportunity `crm`) is offered once
 * the server says it is, never before.
 */
const FALLBACK_ENTITY_TYPES: CustomFieldEntityTypeInfo[] = (
  ['category', 'order', 'organization', 'customer'] as SupportedEntityType[]
).map((entityType) => ({
  entityType,
  labelKey: `customFields.entity.${entityType}`,
  // The list-filter option is offered only once the server says the type has it.
  listFilter: false,
}));
const VALUE_TYPES: CustomFieldValueType[] = [
  'text',
  'number',
  'boolean',
  'date',
  'select',
  'multiselect',
];
const AUDIENCES: CustomFieldAudience[] = ['internal', 'customer'];
const SELECT_TYPES = new Set<CustomFieldValueType>(['select', 'multiselect']);

/** The create form's comma-separated options as option drafts; none for a type without options. */
function draftOptions(
  valueType: CustomFieldValueType,
  raw: string,
): Array<{ value: string; label: Record<string, string>; labelDefault: string; isDefault: boolean; sortOrder: number }> {
  if (!SELECT_TYPES.has(valueType)) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((value, i) => ({ value, label: {}, labelDefault: value, isDefault: false, sortOrder: i }));
}

/**
 * Custom-field definition management (feature 055). List + create per entity
 * type; an existing definition is edited in `DefinitionEditorDialog` (feature
 * 157). Every write control — create, edit, delete, audience — is offered only
 * to an operator holding `custom_fields:write`; a reader sees the table.
 */
export function CustomFieldsPage(): ReactNode {
  // One namespace, this module's own (feature 091, R8). The screen used to
  // read `customFields.title` and `customFields.description` out of the shared
  // `core` bundle beside four keys of its own; both were already written in
  // this module's `i18n/{en,pl}.json`, so the `core` reader was a second copy
  // of two strings and nothing else. `customFields.title` and
  // `customFields.save` stay in `_i18n` because
  // `@endora-commerce/admin-kit`'s `CustomFieldValuesPanel` renders them, and a
  // kit component reads the shared namespace by construction.
  const t = useTranslation('custom_fields');
  const canWrite = useAuth().hasPermission('custom_fields:write');
  const [entityTypes, setEntityTypes] = useState<CustomFieldEntityTypeInfo[]>(
    FALLBACK_ENTITY_TYPES,
  );
  const [entityType, setEntityType] = useState<SupportedEntityType>('organization');
  const [rows, setRows] = useState<CustomFieldDefinitionDto[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Host-managed marker for the selected type (feature 061): definitions are
  // rendered read-only with a link to the owning module's surface.
  const entityTypeInfo = entityTypes.find((i) => i.entityType === entityType);
  const managedBy = entityTypeInfo?.managedBy;
  const editable = canWrite && !managedBy;
  const [editing, setEditing] = useState<CustomFieldDefinitionDto | null>(null);

  // New-definition form state.
  const [key, setKey] = useState('');
  const [label, setLabel] = useState('');
  const [valueType, setValueType] = useState<CustomFieldValueType>('text');
  const [required, setRequired] = useState(false);
  // `internal` until the administrator says otherwise: a field's values reach
  // a customer only as a decision, never as the form's resting state.
  const [audience, setAudience] = useState<CustomFieldAudience>('internal');
  const [options, setOptions] = useState('');
  const [listFilter, setListFilter] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      setRows(await customFieldsClient.list(entityType));
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('customFields.error.load'));
    }
  }, [entityType, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    void (async () => {
      try {
        setEntityTypes(await customFieldsClient.listEntityTypes());
      } catch {
        // Keep the static fallback; the definitions list still works.
      }
    })();
  }, []);

  const run = useCallback(
    async (fn: () => Promise<unknown>): Promise<void> => {
      setError(null);
      try {
        await fn();
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('customFields.error.action'));
      }
    },
    [refresh, t],
  );

  const submit = (): void => {
    const opts = draftOptions(valueType, options);
    void run(async () => {
      await customFieldsClient.create({
        entityType,
        key: key.trim(),
        label: label.trim() ? { en: label.trim() } : {},
        labelDefault: label.trim() || key.trim(),
        valueType,
        required,
        audience,
        sortOrder: rows.length,
        config: {},
        options: opts,
        // Sent only where the entity type offers the option.
        ...(entityTypeInfo?.listFilter ? { listFilter } : {}),
      });
      setKey('');
      setLabel('');
      setOptions('');
      setAudience('internal');
      setListFilter(false);
    });
  };

  return (
    <div className="space-y-4">
      <PageHeader title={t('customFields.title')} description={t('customFields.description')} />
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor="entity">{t('customFields.form.entity')}</Label>
          <Select
            id="entity"
            value={entityType}
            onChange={(e) => setEntityType(e.target.value as SupportedEntityType)}
          >
            {entityTypes.map((info) => (
              <option key={info.entityType} value={info.entityType}>
                {t(info.labelKey)}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {managedBy && (
        <Alert>
          <AlertDescription className="flex flex-wrap items-center gap-2">
            <span>{t('customFields.managedBy.notice')}</span>
            <Link to={managedBy.route} className="font-medium underline underline-offset-4">
              {t(managedBy.labelKey)}
            </Link>
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t('customFields.table.title')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('customFields.table.key')}</TableHead>
                <TableHead>{t('customFields.table.label')}</TableHead>
                <TableHead>{t('customFields.table.type')}</TableHead>
                <TableHead>{t('customFields.table.required')}</TableHead>
                <TableHead>{t('customFields.audience.column')}</TableHead>
                <TableHead>{t('customFields.table.options')}</TableHead>
                <TableHead>{t('customFields.table.listFilter')}</TableHead>
                <TableHead>
                  <span className="sr-only">{t('customFields.table.actions')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="font-mono text-xs">{d.key}</TableCell>
                  <TableCell>{d.label['en'] ?? d.labelDefault}</TableCell>
                  <TableCell>{t(`customFields.valueType.${d.valueType}`)}</TableCell>
                  <TableCell>
                    <Badge variant={d.required ? 'default' : 'secondary'}>
                      {d.required ? t('customFields.required.yes') : t('customFields.required.no')}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {managedBy ? (
                      '—'
                    ) : !canWrite ? (
                      t(`customFields.audience.${d.audience}`)
                    ) : (
                      <Select
                        aria-label={t('customFields.audience.rowLabel', { key: d.key })}
                        value={d.audience}
                        onChange={(e) =>
                          void run(() =>
                            customFieldsClient.update(d.id, {
                              audience: e.target.value as CustomFieldAudience,
                            }),
                          )
                        }
                      >
                        {AUDIENCES.map((a) => (
                          <option key={a} value={a}>
                            {t(`customFields.audience.${a}`)}
                          </option>
                        ))}
                      </Select>
                    )}
                  </TableCell>
                  <TableCell className="text-xs">
                    {d.options.map((o) => o.value).join(', ') || '—'}
                  </TableCell>
                  <TableCell>{d.listFilter ? t('customFields.listFilter.yes') : '—'}</TableCell>
                  <TableCell>
                    {editable && (
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={t('customFields.editor.title', { key: d.key })}
                          onClick={() => setEditing(d)}
                        >
                          <Pencil className="size-4" aria-hidden="true" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={t('customFields.table.delete', { key: d.key })}
                          onClick={() => void run(() => customFieldsClient.remove(d.id))}
                        >
                          <Trash2 className="size-4" aria-hidden="true" />
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {editable && (
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="key">{t('customFields.form.key')}</Label>
              <input
                id="key"
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder={t('customFields.form.keyPlaceholder')}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="label">{t('customFields.form.label')}</Label>
              <input
                id="label"
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="vt">{t('customFields.form.valueType')}</Label>
              <Select
                id="vt"
                value={valueType}
                onChange={(e) => setValueType(e.target.value as CustomFieldValueType)}
              >
                {VALUE_TYPES.map((vt) => (
                  <option key={vt} value={vt}>
                    {t(`customFields.valueType.${vt}`)}
                  </option>
                ))}
              </Select>
            </div>
            {SELECT_TYPES.has(valueType) && (
              <div className="space-y-1">
                <Label htmlFor="opts">{t('customFields.form.options')}</Label>
                <input
                  id="opts"
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                  value={options}
                  onChange={(e) => setOptions(e.target.value)}
                  placeholder={t('customFields.form.optionsPlaceholder')}
                />
              </div>
            )}
            <div className="space-y-1">
              <Label htmlFor="audience">{t('customFields.audience.label')}</Label>
              <Select
                id="audience"
                aria-describedby="audience-help"
                value={audience}
                onChange={(e) => setAudience(e.target.value as CustomFieldAudience)}
              >
                {AUDIENCES.map((a) => (
                  <option key={a} value={a}>
                    {t(`customFields.audience.${a}`)}
                  </option>
                ))}
              </Select>
            </div>
            <label className="flex items-center gap-1 text-sm">
              <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />
              {t('customFields.form.required')}
            </label>
            {entityTypeInfo ? (
              <DefinitionBehaviourFields
                definition={{ key: key.trim(), valueType, options: draftOptions(valueType, options), audience }}
                entityTypeInfo={entityTypeInfo}
                value={{ listFilter }}
                onChange={(next) => setListFilter(next.listFilter)}
              />
            ) : null}
            <Button size="sm" disabled={!key.trim()} onClick={submit}>
              {t('customFields.form.submit')}
            </Button>
            <p id="audience-help" className="basis-full text-sm text-muted-foreground">
              {t('customFields.audience.help')}
            </p>
          </div>
          )}
        </CardContent>
      </Card>

      {editing && entityTypeInfo ? (
        <DefinitionEditorDialog
          definition={editing}
          entityTypeInfo={entityTypeInfo}
          onClose={() => {
            setEditing(null);
            // Option actions apply at once, so a cancelled dialog may still have changed the row.
            void refresh();
          }}
          onSaved={() => {
            setEditing(null);
            void refresh();
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * The registry loads a route component through a dynamic-import factory and
 * reads its default export (feature 091, FR-013). The named export stays: it is
 * the spelling this module's own code and its tests use.
 */
export default CustomFieldsPage;
