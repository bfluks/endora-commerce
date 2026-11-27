import { useCallback, useId, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Globe, ListFilter, Pencil, Plus, Trash2 } from 'lucide-react';
import { PRODUCT_VISIBILITY_PERMISSIONS, type ProductVisibilityOverviewResponse } from '@endora-commerce/contracts';
import { ModalDialog, useConfirmDialog } from '@endora-commerce/admin-kit/components';
import { formatDateTime, useAuth } from '@endora-commerce/admin-kit/lib';
import { useTranslation, useTranslationContext } from '@endora-commerce/admin-kit/i18n';
import {
  Alert,
  AlertDescription,
  Button,
  DetailSkeleton,
  EditorSection,
  EmptyState,
  FormField,
  InlineStatus,
  Input,
  PageHeader,
  useInlineStatus,
} from '@endora-commerce/admin-kit/ui';
import { productVisibilityClient } from '../api.js';
import { AttachDialog } from '../components/AttachDialog.js';
import { RuleEditorDialog } from '../components/RuleEditorDialog.js';
import { callerIsUnrestricted, channelName, refusalMessage } from '../lib/labels.js';
import { useOverview, useSalesChannels } from '../lib/use-overview.js';

const CONFIG_ROUTE = '/product-visibility';

type Rule = ProductVisibilityOverviewResponse['productRules'][number];

export interface WebsiteRulesPageProps {
  /** How often a pending preview is asked again. Tests shorten it. */
  readonly pollIntervalMs?: number;
}

/**
 * The website rules of `product_visibility_rules` (`specs/193-product-visibility-rules/` US4), at
 * `/product-visibility/website-rules`: which sales channels a product rule governs, and the
 * product rules themselves. Governed channels come first — they are what the storefront shows
 * (Serial Position). Attaching goes through a preview the administrator confirms (FR-053);
 * detaching leaves the membership as the rule last computed it (FR-058).
 *
 * A rule's name is operator text and is rendered as text only.
 */
export function WebsiteRulesPage({ pollIntervalMs = 2000 }: WebsiteRulesPageProps): ReactNode {
  const t = useTranslation('product_visibility_rules');
  const { language } = useTranslationContext();
  const { me, hasPermission } = useAuth();
  const { overview, loading, refreshing, failed, reload } = useOverview();
  const channels = useSalesChannels();
  const status = useInlineStatus();
  const { show } = status;
  const { confirm, confirmDialog } = useConfirmDialog();
  const [dialog, setDialog] = useState<'new' | 'attach' | { rename: Rule } | { edit: Rule } | null>(null);

  const permitted = hasPermission(PRODUCT_VISIBILITY_PERMISSIONS.MANAGE);
  const unrestricted = overview !== null && callerIsUnrestricted(overview, me?.role?.id);
  const writable = permitted && unrestricted;

  const governed = useMemo(() => new Set(overview?.websiteRuleAttachments.map((a) => a.salesChannelId) ?? []), [overview]);
  const ruleName = (id: string): string => overview?.productRules.find((r) => r.id === id)?.name ?? t('rules.unknownRule');
  const nameOfChannel = (id: string): string => channelName(channels.find((c) => c.id === id), language, t('config.unknownChannel'));
  const governs = (id: string): number => overview?.websiteRuleAttachments.filter((a) => a.productRuleId === id).length ?? 0;

  const act = useCallback(
    async (run: () => Promise<unknown>, done: string): Promise<void> => {
      try {
        await run();
        show(done, 'success');
      } catch (err) {
        show(refusalMessage(err, t('config.error.write')), 'error');
      }
      await reload();
    },
    [reload, show, t],
  );

  const detach = async (salesChannelId: string): Promise<void> => {
    const ok = await confirm({
      title: t('rules.detachTitle'),
      message: t('rules.detachMessage'),
      confirmLabel: t('rules.detach'),
      destructive: true,
    });
    if (ok) await act(() => productVisibilityClient.detach(salesChannelId), t('rules.detached'));
  };

  const remove = async (rule: Rule): Promise<void> => {
    const ok = await confirm({
      title: t('rules.deleteTitle'),
      message: t('rules.deleteMessage'),
      confirmLabel: t('rules.delete'),
      destructive: true,
    });
    if (ok) await act(() => productVisibilityClient.deleteRule(rule), t('rules.deleted'));
  };

  return (
    <>
      <PageHeader
        title={t('rules.page.title')}
        help={t('rules.page.help')}
        back={{ label: t('config.page.title'), to: CONFIG_ROUTE }}
        actions={<InlineStatus {...status.props} />}
      />
      {loading ? (
        <DetailSkeleton label={t('config.loading')} tabs={false} />
      ) : overview === null ? (
        <Alert variant="destructive">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>{t('config.error.load')}</span>
            <Button type="button" size="sm" variant="outline" onClick={(): void => void reload()}>
              {t('config.retry')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : (
        <div className="space-y-(--section-gap)" aria-busy={refreshing}>
          {failed ? (
            <Alert variant="destructive">
              <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                <span>{t('config.error.refresh')}</span>
                <Button type="button" size="sm" variant="outline" onClick={(): void => void reload()}>
                  {t('config.retry')}
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}
          {overview.currencies.some((c) => c.building) ? (
            // US4-11 (Q-2) — while a currency's catalogue prices are rebuilt, governed channels
            // keep the products they have; said here so a preview taken now is read with that.
            <Alert>
              <AlertDescription>{t('rules.building')}</AlertDescription>
            </Alert>
          ) : null}
          {!permitted ? (
            <Alert>
              <AlertDescription>{t('config.readOnly.permission')}</AlertDescription>
            </Alert>
          ) : !unrestricted ? (
            <Alert>
              <AlertDescription>{t('config.readOnly.restricted')}</AlertDescription>
            </Alert>
          ) : null}

          <EditorSection
            as="h2"
            chrome="card"
            title={t('rules.channels.title')}
            description={t('rules.channels.description')}
            action={
              writable && overview.productRules.length > 0 ? (
                <Button type="button" size="sm" onClick={(): void => setDialog('attach')}>
                  <Plus aria-hidden="true" />
                  {t('rules.attach.open')}
                </Button>
              ) : null
            }
          >
            {overview.websiteRuleAttachments.length === 0 ? (
              <EmptyState
                icon={<Globe aria-hidden="true" />}
                title={t('rules.channels.empty.title')}
                description={overview.productRules.length === 0 ? t('rules.channels.empty.noRules') : t('rules.channels.empty.description')}
              />
            ) : (
              <ul className="divide-y divide-border">
                {overview.websiteRuleAttachments.map((attachment) => (
                  <li key={attachment.salesChannelId} data-attachment-row className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div className="min-w-0 space-y-0.5">
                      <p className="font-medium">
                        {nameOfChannel(attachment.salesChannelId)}
                      </p>
                      <p className="text-sm">
                        <span className="text-muted-foreground">{t('rules.channels.governedBy')} </span>
                        <span className="break-words">{ruleName(attachment.productRuleId)}</span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t('rules.channels.since')} {formatDateTime(attachment.attachedAt, language)}
                      </p>
                    </div>
                    {writable ? (
                      <Button type="button" size="sm" variant="outline" onClick={(): void => void detach(attachment.salesChannelId)}>
                        {t('rules.detach')}
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </EditorSection>

          <EditorSection
            as="h2"
            chrome="card"
            title={t('rules.list.title')}
            action={
              writable ? (
                <Button type="button" size="sm" variant="outline" onClick={(): void => setDialog('new')}>
                  <Plus aria-hidden="true" />
                  {t('rules.editor.new')}
                </Button>
              ) : null
            }
          >
            {overview.productRules.length === 0 ? (
              <EmptyState
                icon={<ListFilter aria-hidden="true" />}
                title={t('rules.list.empty.title')}
                description={t('rules.list.empty.description')}
              />
            ) : (
              <ul className="divide-y divide-border">
                {overview.productRules.map((rule) => (
                  <li key={rule.id} data-rule-row className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div className="min-w-0 space-y-0.5">
                      <p className="font-medium break-words">{rule.name}</p>
                      <p className="text-xs text-muted-foreground">{t('rules.list.governs', { count: governs(rule.id) })}</p>
                    </div>
                    {writable ? (
                      <div className="flex items-center gap-1">
                        <Button type="button" size="sm" variant="ghost" aria-label={t('rules.edit')} onClick={(): void => setDialog({ edit: rule })}>
                          <ListFilter aria-hidden="true" />
                        </Button>
                        <Button type="button" size="sm" variant="ghost" aria-label={t('rules.rename')} onClick={(): void => setDialog({ rename: rule })}>
                          <Pencil aria-hidden="true" />
                        </Button>
                        <Button type="button" size="sm" variant="ghost" aria-label={t('rules.delete')} onClick={(): void => void remove(rule)}>
                          <Trash2 aria-hidden="true" />
                        </Button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </EditorSection>

          {dialog === 'new' ? (
            <RuleEditorDialog
              currencies={overview.currencies.map((c) => c.code)}
              onClose={(): void => setDialog(null)}
              onSaved={async (): Promise<void> => {
                setDialog(null);
                show(t('rules.saved'), 'success');
                await reload();
              }}
            />
          ) : null}
          {dialog === 'attach' ? (
            <AttachDialog
              rules={overview.productRules}
              channels={channels}
              governed={governed}
              pollIntervalMs={pollIntervalMs}
              onClose={(): void => setDialog(null)}
              onApplied={async (): Promise<void> => {
                setDialog(null);
                show(t('rules.attach.applied'), 'success');
                await reload();
              }}
            />
          ) : null}
          {dialog !== null && typeof dialog === 'object' && 'edit' in dialog ? (
            <RuleEditorDialog
              key={dialog.edit.id}
              ruleId={dialog.edit.id}
              currencies={overview.currencies.map((c) => c.code)}
              channelName={nameOfChannel}
              pollIntervalMs={pollIntervalMs}
              onClose={(): void => setDialog(null)}
              onSaved={async (outcome): Promise<void> => {
                setDialog(null);
                show(outcome === 'changed' ? t('rules.editor.changeApplied') : t('rules.saved'), 'success');
                await reload();
              }}
            />
          ) : null}
          {dialog !== null && typeof dialog === 'object' && 'rename' in dialog ? (
            <RenameDialog
              rule={dialog.rename}
              onClose={(): void => setDialog(null)}
              onSaved={async (): Promise<void> => {
                setDialog(null);
                show(t('rules.saved'), 'success');
                await reload();
              }}
            />
          ) : null}
        </div>
      )}
      {confirmDialog}
    </>
  );
}

/** A rule's name changes freely; its conditions, once attached, only through a preview (FR-053). */
function RenameDialog({ rule, onClose, onSaved }: { readonly rule: Rule; readonly onClose: () => void; readonly onSaved: () => Promise<void> }): ReactNode {
  const t = useTranslation('product_visibility_rules');
  const formId = useId();
  const [name, setName] = useState(rule.name);
  const [error, setError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (name.trim() === '') {
      setError(t('rules.editor.error.nameRequired'));
      return;
    }
    setError(undefined);
    setSaving(true);
    setRefusal(null);
    try {
      await productVisibilityClient.updateRule(rule, { name: name.trim() });
      await onSaved();
    } catch (err) {
      setRefusal(refusalMessage(err, t('config.error.write')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalDialog
      title={t('rules.renameTitle')}
      onClose={onClose}
      busy={saving}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            {t('config.cancel')}
          </Button>
          <Button type="submit" form={formId} disabled={saving} aria-busy={saving}>
            {t('rules.renameSave')}
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
        <FormField label={t('rules.editor.field.name')} error={error} required>
          <Input value={name} maxLength={120} onChange={(e): void => setName(e.target.value)} />
        </FormField>
      </form>
    </ModalDialog>
  );
}

export default WebsiteRulesPage;
