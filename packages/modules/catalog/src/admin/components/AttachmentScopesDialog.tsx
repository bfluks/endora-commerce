import { useId, useState, type ReactNode } from 'react';
import { ATTACHMENT_DESCRIPTION_TRANSLATION_MAX, ATTACHMENT_NAME_MAX } from '@endora-commerce/contracts';
import { apiClient } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Button, Checkbox, Input, Label, Textarea } from '@endora-commerce/admin-kit/ui';
import { ModalDialog } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import type { ScopeContext } from './ProductScopeEditor.js';
import { DiscardChangesPrompt, InheritedHint, scopedSaveError } from './ScopedDialogParts.js';
import {
  languagesToOffer,
  memberChannels,
  sameSet,
  translationPatch,
  withChannelHidden,
  type TranslationMap,
} from '../lib/media-scopes.js';

/**
 * Feature 163 (T141, US9 #4, FR-078) — one attachment's name and description per
 * language and the member channels it is hidden in. Save sends one
 * `PATCH …/attachments/:id` with what changed: each map as a patch (`''` = use the
 * global value), the hidden set whole (a channel the product has left is kept).
 */

type Translate = (key: string, params?: Record<string, string>) => string;

export interface AttachmentScopesValue {
  id: string;
  name: string;
  description: string | null;
  nameTranslations: TranslationMap;
  descriptionTranslations: TranslationMap;
  hiddenInChannels: string[];
}

export interface AttachmentScopesDialogProps {
  productId: string;
  attachment: AttachmentScopesValue;
  context: ScopeContext | null;
  canWrite: boolean;
  onClose: () => void;
  /** Called after a write; the caller re-reads the list. */
  onSaved: () => void;
}

export function AttachmentScopesDialog({
  productId,
  attachment,
  context,
  canWrite,
  onClose,
  onSaved,
}: AttachmentScopesDialogProps): ReactNode {
  const t = useTranslation('catalog') as Translate;
  const fieldId = useId();
  const errorId = `${fieldId}-error`;
  const [names, setNames] = useState<TranslationMap>({ ...attachment.nameTranslations });
  const [descriptions, setDescriptions] = useState<TranslationMap>({ ...attachment.descriptionTranslations });
  const [hidden, setHidden] = useState<string[]>([...attachment.hiddenInChannels].sort());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const dirty =
    translationPatch(attachment.nameTranslations, names) !== null ||
    translationPatch(attachment.descriptionTranslations, descriptions) !== null ||
    !sameSet(attachment.hiddenInChannels, hidden);
  /** Escape and Cancel: unsaved edits are dropped only when the operator says so (D16). */
  const requestClose = (): void => {
    if (dirty && canWrite) setConfirmDiscard(true);
    else onClose();
  };

  const languages = languagesToOffer(context, attachment.nameTranslations, attachment.descriptionTranslations);
  const channels = memberChannels(context);
  const disabled = busy || !canWrite;

  const save = async (): Promise<void> => {
    const nameTranslations = translationPatch(attachment.nameTranslations, names);
    const descriptionTranslations = translationPatch(attachment.descriptionTranslations, descriptions);
    const hiddenChanged = !sameSet(attachment.hiddenInChannels, hidden);
    if (!nameTranslations && !descriptionTranslations && !hiddenChanged) {
      onClose();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiClient.patch(`/api/v1/admin/catalog/products/${productId}/attachments/${attachment.id}`, {
        ...(nameTranslations ? { nameTranslations } : {}),
        ...(descriptionTranslations ? { descriptionTranslations } : {}),
        ...(hiddenChanged ? { hiddenInChannels: hidden } : {}),
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(scopedSaveError(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalDialog
      title={t('productEditor.attachments.scopes.title', { name: attachment.name })}
      onClose={requestClose}
      busy={busy}
      dismissOnScrim={false}
      widthClassName="max-w-2xl"
      {...(error ? { 'aria-describedby': errorId } : {})}
      footer={
        <>
          <Button type="button" variant="outline" disabled={busy} onClick={requestClose}>
            {t('productEditor.attachments.scopes.cancel')}
          </Button>
          <Button type="button" disabled={disabled} aria-busy={busy} onClick={() => void save()}>
            {busy ? t('productEditor.scopeDialog.saving') : t('productEditor.attachments.scopes.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        {confirmDiscard ? (
          <DiscardChangesPrompt onDiscard={onClose} onKeep={(): void => setConfirmDiscard(false)} t={t} />
        ) : null}
        {error ? (
          <Alert id={errorId} variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <section className="space-y-3" aria-labelledby={`${fieldId}-languages`}>
          <h3 id={`${fieldId}-languages`} className="text-sm font-medium">
            {t('productEditor.attachments.scopes.languagesHeading')}
          </h3>
          <p className="text-xs text-muted-foreground">
            {languages.length === 0
              ? t('productEditor.attachments.scopes.noLanguages')
              : t('productEditor.attachments.scopes.languagesHint')}
          </p>
          {languages.map((language) => {
            const code = language.toUpperCase();
            return (
              <div key={language} className="grid gap-2 md:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor={`${fieldId}-name-${language}`}>
                    {t('productEditor.attachments.scopes.name', { language: code })}
                  </Label>
                  <Input
                    id={`${fieldId}-name-${language}`}
                    value={names[language] ?? ''}
                    placeholder={attachment.name}
                    maxLength={ATTACHMENT_NAME_MAX}
                    disabled={disabled}
                    aria-describedby={`${fieldId}-name-${language}-inherited`}
                    onChange={(e): void => setNames((prev) => ({ ...prev, [language]: e.target.value }))}
                  />
                  <InheritedHint id={`${fieldId}-name-${language}-inherited`} value={attachment.name} t={t} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`${fieldId}-description-${language}`}>
                    {t('productEditor.attachments.scopes.description', { language: code })}
                  </Label>
                  <Textarea
                    id={`${fieldId}-description-${language}`}
                    value={descriptions[language] ?? ''}
                    placeholder={attachment.description ?? ''}
                    maxLength={ATTACHMENT_DESCRIPTION_TRANSLATION_MAX}
                    rows={2}
                    disabled={disabled}
                    {...(attachment.description
                      ? { 'aria-describedby': `${fieldId}-description-${language}-inherited` }
                      : {})}
                    onChange={(e): void => setDescriptions((prev) => ({ ...prev, [language]: e.target.value }))}
                  />
                  {attachment.description ? (
                    <InheritedHint
                      id={`${fieldId}-description-${language}-inherited`}
                      value={attachment.description}
                      t={t}
                    />
                  ) : null}
                </div>
              </div>
            );
          })}
        </section>

        <section className="space-y-2" aria-labelledby={`${fieldId}-channels`}>
          <h3 id={`${fieldId}-channels`} className="text-sm font-medium">
            {t('productEditor.attachments.scopes.channelsHeading')}
          </h3>
          <p className="text-xs text-muted-foreground">
            {channels.length === 0
              ? t('productEditor.attachments.scopes.noChannels')
              : t('productEditor.attachments.scopes.channelsHint')}
          </p>
          {channels.map((channel) => (
            <div key={channel.id} className="flex items-center gap-2">
              <Checkbox
                id={`${fieldId}-hide-${channel.id}`}
                checked={hidden.includes(channel.id)}
                disabled={disabled}
                onChange={(e): void => setHidden((prev) => withChannelHidden(prev, channel.id, e.target.checked))}
              />
              <Label htmlFor={`${fieldId}-hide-${channel.id}`}>
                {t('productEditor.attachments.scopes.hide', { channel: channel.name })}
              </Label>
            </div>
          ))}
        </section>
      </div>
    </ModalDialog>
  );
}
