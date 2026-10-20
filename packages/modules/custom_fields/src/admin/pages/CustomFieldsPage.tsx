import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ListPlus, Pencil, Trash2, TriangleAlert } from 'lucide-react';
import { ApiError, useAuth } from '@endora-commerce/admin-kit/lib';
import { customFieldsClient } from '../api/custom-fields-client.js';
import { CarryDriftDialog } from '../components/CarryDriftWarning.js';
import { DefinitionBehaviourFields } from '../components/DefinitionBehaviourFields.js';
import { DefinitionEditorDialog } from '../components/DefinitionEditorDialog.js';
import { carryCounterpartsBrokenBy, type CarryCounterpart, type DefinitionChange } from '../lib/carry-drift.js';
import { entityTypeLabelKey, incompatibilitySentence, refusalSentence } from '../lib/carry-labels.js';
import { Alert, AlertDescription, Badge, Button, Card, CardContent, CardHeader, CardTitle, Checkbox, Label, PageHeader, Select } from '@endora-commerce/admin-kit/ui';
import { ResponsiveTable, resolveCustomFieldLabel, type ResponsiveColumn } from '@endora-commerce/admin-kit/components';
import { useTranslation, useTranslationContext } from '@endora-commerce/admin-kit/i18n';
import {
  assessCustomFieldCarry,
  type CustomFieldAudience,
  type CustomFieldDefinitionDto,
  type CustomFieldEntityTypeInfo,
  type CustomFieldValueType,
  type SupportedEntityType,
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
  // So are the carry options (feature 158).
  carryTargets: [],
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

/** A change from the table waiting on the drift warning's answer (feature 158). */
interface PendingTableChange {
  change: DefinitionChange;
  counterparts: CarryCounterpart[];
  /** The deleted field's sentence above the warning; none for an audience change. */
  lead?: string;
  proceed: () => void;
}

/**
 * Custom-field definition management (feature 055). List + create per entity
 * type; an existing definition is edited in `DefinitionEditorDialog` (feature
 * 157). Every write control — create, edit, delete, audience — is offered only
 * to an operator holding `custom_fields:write`; a reader sees the table.
 *
 * Feature 158 (`specs/158-custom-fields-value-carry/contracts/admin-surfaces.md`
 * §1): the *Carry value to …* options, a *Carries to* column whose chips are
 * marked *Incompatible* when the same-key target no longer fits, and a warning
 * before an audience change or a deletion that breaks an enabled carry. Both
 * read the definitions of **every** type — a second, unfiltered list, asked
 * only once some type offers a carry target.
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
  const { language } = useTranslationContext();
  const canWrite = useAuth().hasPermission('custom_fields:write');
  const [entityTypes, setEntityTypes] = useState<CustomFieldEntityTypeInfo[]>(
    FALLBACK_ENTITY_TYPES,
  );
  const [entityType, setEntityType] = useState<SupportedEntityType>('organization');
  const [rows, setRows] = useState<CustomFieldDefinitionDto[]>([]);
  /** The record type the rows on screen belong to; another one means its read is still on the way. */
  const [loadedFor, setLoadedFor] = useState<SupportedEntityType | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The row whose Delete is asking for confirmation. */
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const keyInputRef = useRef<HTMLInputElement>(null);
  const keepDeleteRef = useRef<HTMLButtonElement>(null);
  /** The row whose Delete takes the focus back once its confirmation is kept. */
  const returnFocusTo = useRef<string | null>(null);
  const currentEntityType = useRef(entityType);
  currentEntityType.current = entityType;

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
  const [carryTo, setCarryTo] = useState<SupportedEntityType[]>([]);

  // Feature 158 — every type's definitions, for the carry marks and warnings.
  // `null` until read (or when the read failed): no mark is shown on a guess.
  const offersCarry = entityTypes.some((info) => (info.carryTargets ?? []).length > 0);
  const [allDefinitions, setAllDefinitions] = useState<CustomFieldDefinitionDto[] | null>(null);
  const allSequence = useRef(0);
  const [pendingChange, setPendingChange] = useState<PendingTableChange | null>(null);

  const loadAll = useCallback(async (): Promise<void> => {
    const current = ++allSequence.current;
    try {
      const listed = await customFieldsClient.list();
      if (current === allSequence.current) setAllDefinitions(listed);
    } catch {
      if (current === allSequence.current) setAllDefinitions(null);
    }
  }, []);

  useEffect(() => {
    if (offersCarry) void loadAll();
  }, [offersCarry, loadAll]);

  /** What the page knows of every definition: the full list, the selected type's rows fresher. */
  const known = useMemo(() => {
    const byId = new Map<string, CustomFieldDefinitionDto>();
    for (const definition of allDefinitions ?? []) byId.set(definition.id, definition);
    for (const row of rows) byId.set(row.id, row);
    return [...byId.values()];
  }, [allDefinitions, rows]);

  const typeLabel = useCallback(
    (type: SupportedEntityType): string => t(entityTypeLabelKey(type, entityTypes)),
    [t, entityTypes],
  );

  const refresh = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const listed = await customFieldsClient.list(entityType);
      // A slower read of a record type no longer selected must not replace the current one.
      if (currentEntityType.current !== entityType) return;
      setRows(listed);
      setLoadedFor(entityType);
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

  /** The table's rows and, where carries exist, every type's definitions. */
  const reload = useCallback(async (): Promise<void> => {
    await Promise.all([refresh(), offersCarry ? loadAll() : Promise.resolve()]);
  }, [refresh, offersCarry, loadAll]);

  const run = useCallback(
    async (fn: () => Promise<unknown>): Promise<void> => {
      setError(null);
      try {
        await fn();
        await reload();
      } catch (err) {
        // A carry refusal reads as a sentence built from `details` (feature 158).
        setError(refusalSentence(t, err, typeLabel, t('customFields.error.action')));
      }
    },
    [reload, t, typeLabel],
  );

  /** Runs `proceed` at once, or after the drift warning when `change` breaks an enabled carry. */
  const guarded = (change: DefinitionChange, proceed: () => void, lead?: string): void => {
    const counterparts = carryCounterpartsBrokenBy(change, known);
    if (counterparts.length === 0) {
      proceed();
      return;
    }
    setPendingChange({ change, counterparts, proceed, ...(lead ? { lead } : {}) });
  };

  // Keep takes the place and the focus of Delete; keeping gives it back.
  useEffect(() => {
    if (confirmingDelete !== null) {
      keepDeleteRef.current?.focus();
      return;
    }
    const id = returnFocusTo.current;
    returnFocusTo.current = null;
    if (id !== null) document.querySelector<HTMLButtonElement>(`[data-delete-trigger="${id}"]`)?.focus();
  }, [confirmingDelete]);

  const carryTargets = entityTypeInfo?.carryTargets ?? [];
  /** The ticked targets the selected type still offers — a type switch keeps no stale target. */
  const draftCarryTo = carryTo.filter((target) => carryTargets.includes(target));

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
        // Feature 158 — `[]` unless the operator ticked a target the type offers.
        carryTo: draftCarryTo,
        options: opts,
        // Sent only where the entity type offers the option.
        ...(entityTypeInfo?.listFilter ? { listFilter } : {}),
      });
      setKey('');
      setLabel('');
      setOptions('');
      setAudience('internal');
      setListFilter(false);
      setCarryTo([]);
    });
  };

  const columns: ResponsiveColumn<CustomFieldDefinitionDto>[] = [
    {
      id: 'key',
      header: t('customFields.table.key'),
      primary: true,
      className: 'font-mono text-xs',
      render: (d) => d.key,
    },
    {
      id: 'label',
      header: t('customFields.table.label'),
      primary: true,
      render: (d) => resolveCustomFieldLabel(d.label, d.labelDefault, language),
    },
    { id: 'type', header: t('customFields.table.type'), render: (d) => t(`customFields.valueType.${d.valueType}`) },
    {
      id: 'required',
      header: t('customFields.table.required'),
      render: (d) => (
        <Badge variant={d.required ? 'default' : 'secondary'}>
          {d.required ? t('customFields.required.yes') : t('customFields.required.no')}
        </Badge>
      ),
    },
    {
      id: 'audience',
      header: t('customFields.audience.column'),
      render: (d) =>
        managedBy ? (
          '—'
        ) : !canWrite ? (
          t(`customFields.audience.${d.audience}`)
        ) : (
          <Select
            aria-label={t('customFields.audience.rowLabel', { key: d.key })}
            value={d.audience}
            onChange={(e) => {
              const next = e.target.value as CustomFieldAudience;
              // The select is the row's stored audience, so a cancelled warning leaves it as it was.
              guarded({ kind: 'audience', definitionId: d.id, audience: next }, () =>
                void run(() => customFieldsClient.update(d.id, { audience: next })),
              );
            }}
          >
            {AUDIENCES.map((a) => (
              <option key={a} value={a}>
                {t(`customFields.audience.${a}`)}
              </option>
            ))}
          </Select>
        ),
    },
    {
      id: 'options',
      header: t('customFields.table.options'),
      hideOnMobile: true,
      className: 'text-xs',
      render: (d) => d.options.map((o) => o.value).join(', ') || '—',
    },
    {
      id: 'listFilter',
      header: t('customFields.table.listFilter'),
      render: (d) => (d.listFilter ? t('customFields.listFilter.yes') : t('customFields.listFilter.no')),
    },
    {
      id: 'carriesTo',
      header: t('customFields.table.carriesTo'),
      render: (d) => carryChips(d),
    },
  ];

  /**
   * One chip per carry target, and an *Incompatible* mark with its reason
   * where the same-key target no longer fits (FR-020). The reason is visible
   * text on a narrow screen and the chip's description on a wide one.
   */
  function carryChips(d: CustomFieldDefinitionDto): ReactNode {
    const targets = d.carryTo ?? [];
    if (targets.length === 0) return '—';
    return (
      <ul className="flex flex-col gap-1">
        {targets.map((target) => {
          const entityType = typeLabel(target);
          const reasons =
            allDefinitions === null
              ? []
              : assessCustomFieldCarry(
                  d,
                  known.find((candidate) => candidate.entityType === target && candidate.key === d.key) ?? null,
                );
          const reason = reasons.map((item) => incompatibilitySentence(t, item, entityType, d.key)).join(' ');
          return (
            <li key={target} className="min-w-0 space-y-0.5">
              <span className="flex flex-wrap items-center gap-1">
                <Badge variant="secondary">{entityType}</Badge>
                {reasons.length > 0 ? (
                  <Badge variant="warning" title={reason} className="gap-1">
                    <TriangleAlert className="size-3" aria-hidden="true" />
                    {t('customFields.carry.incompatible')}
                  </Badge>
                ) : null}
              </span>
              {reasons.length > 0 ? (
                <span className="block break-words text-xs text-muted-foreground sm:sr-only">{reason}</span>
              ) : null}
            </li>
          );
        })}
      </ul>
    );
  }

  const actions = (d: CustomFieldDefinitionDto): ReactNode =>
    confirmingDelete === d.id ? (
      <div className="flex flex-wrap items-center gap-2">
        <Button
          ref={keepDeleteRef}
          variant="outline"
          size="sm"
          className="min-h-11"
          onClick={() => {
            returnFocusTo.current = d.id;
            setConfirmingDelete(null);
          }}
        >
          {t('customFields.table.keep')}
        </Button>
        <span className="break-words text-sm">{t('customFields.table.deleteConfirm', { key: d.key })}</span>
        <Button
          variant="destructive"
          size="sm"
          className="min-h-11"
          onClick={() => {
            setConfirmingDelete(null);
            void run(() => customFieldsClient.remove(d.id));
          }}
        >
          {t('customFields.table.deleteAction')}
        </Button>
      </div>
    ) : (
      <div className="flex gap-2">
        <Button
          variant="ghost"
          size="sm"
          className="min-h-11 min-w-11"
          aria-label={t('customFields.editor.title', { key: d.key })}
          onClick={() => setEditing(d)}
        >
          <Pencil className="size-4" aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="min-h-11 min-w-11"
          data-delete-trigger={d.id}
          aria-label={t('customFields.table.delete', { key: d.key })}
          onClick={() => {
            // A deletion that breaks a carry asks once, in the warning; any other in the row.
            const counterparts = carryCounterpartsBrokenBy({ kind: 'delete', definitionId: d.id }, known);
            if (counterparts.length === 0) {
              setConfirmingDelete(d.id);
              return;
            }
            setPendingChange({
              change: { kind: 'delete', definitionId: d.id },
              counterparts,
              lead: t('customFields.table.deleteConfirm', { key: d.key }),
              proceed: () => void run(() => customFieldsClient.remove(d.id)),
            });
          }}
        >
          <Trash2 className="size-4" aria-hidden="true" />
        </Button>
      </div>
    );

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
          {loadedFor !== entityType ? (
            <p role="status" className="text-sm text-muted-foreground">
              {t('customFields.table.loading')}
            </p>
          ) : (
            <ResponsiveTable
              data={rows}
              columns={columns}
              keyExtractor={(d): string => d.id}
              {...(editable ? { renderActions: actions } : {})}
              emptyState={
                <div className="b2b-empty">
                  <div className="b2b-empty__icon">
                    <ListPlus aria-hidden="true" />
                  </div>
                  <div className="b2b-empty__title">{t('customFields.table.empty')}</div>
                  {editable ? (
                    <Button
                      className="min-h-11 sm:min-h-9"
                      variant="outline"
                      onClick={(): void => keyInputRef.current?.focus()}
                    >
                      {t('customFields.table.emptyAction')}
                    </Button>
                  ) : null}
                </div>
              }
            />
          )}

          {editable && (
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="key">{t('customFields.form.key')}</Label>
              <input
                ref={keyInputRef}
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
            <label htmlFor="required" className="flex min-h-11 items-center gap-2 text-sm">
              <Checkbox id="required" checked={required} onChange={(e) => setRequired(e.target.checked)} />
              {t('customFields.form.required')}
            </label>
            {entityTypeInfo ? (
              <DefinitionBehaviourFields
                definition={{ key: key.trim(), valueType, options: draftOptions(valueType, options), audience }}
                entityTypeInfo={entityTypeInfo}
                value={carryTargets.length > 0 ? { listFilter, carryTo: draftCarryTo } : { listFilter }}
                onChange={(next) => {
                  setListFilter(next.listFilter);
                  if (next.carryTo !== undefined) setCarryTo(next.carryTo);
                }}
                entityTypes={entityTypes}
                layout="row"
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
          entityTypes={entityTypes}
          definitions={known}
          onClose={() => {
            setEditing(null);
            // Option actions apply at once, so a cancelled dialog may still have changed the row.
            void reload();
          }}
          onSaved={() => {
            setEditing(null);
            void reload();
          }}
        />
      ) : null}

      {pendingChange ? (
        <CarryDriftDialog
          counterparts={pendingChange.counterparts}
          typeLabel={typeLabel}
          {...(pendingChange.lead ? { lead: pendingChange.lead } : {})}
          proceedVariant={pendingChange.change.kind === 'delete' ? 'destructive' : 'default'}
          onCancel={() => setPendingChange(null)}
          onProceed={() => {
            setPendingChange(null);
            pendingChange.proceed();
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
