import { useCallback, useEffect, useId, useState, type ReactNode } from 'react';
import { RotateCcw } from 'lucide-react';
import type {
  ResolvedMeta,
  SeoEntityType,
  SeoProductMetaField,
  SeoProductMetaSource,
  UpsertSeoMetaOverrideRequest,
} from '@endora-commerce/contracts';
import { ApiError, apiClient } from '@endora-commerce/admin-kit/lib';
import {
  Alert,
  AlertDescription,
  Button,
  Input,
  Label,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

/**
 * Feature 163 (T128, US8; `contracts/seo-media-attachments.md` §1) — one entity's meta
 * override at one scope. A product is addressed by sales channel beside language: the
 * channel list is the product's **member** channels (owner decision SEO-1 A), read from
 * catalog's `scope-context` over HTTP; a channel's language list is that channel's, with
 * "whole channel" for the channel row. Naming no channel is the language row, as before.
 * The resolved values say where each field comes from; "use inherited" deletes exactly
 * the selected scope's row. A category takes no channel.
 */

const FALLBACK_LOCALE = 'en-US';

interface MetaOverrideFields {
  title: string | null;
  description: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  ogImageUrl: string | null;
}

interface MetaEnvelope {
  data: {
    resolved: ResolvedMeta;
    /** Per field, where the resolved value comes from (feature 163). */
    sources?: Record<SeoProductMetaField, SeoProductMetaSource>;
    override: MetaOverrideFields | null;
  };
}

interface MemberChannel {
  id: string;
  name: string;
  languages: string[];
}

interface ScopeContextEnvelope {
  data: { channels: MemberChannel[] };
}

export interface SeoMetaScopeEditorProps {
  entityType: SeoEntityType;
  entityId: string;
}

type Translate = (key: string, params?: Record<string, string>) => string;

function sourceLabel(source: SeoProductMetaSource, t: Translate): string {
  if (source === 'channel_language') return t('metaScope.source.channelLanguage');
  if (source === 'channel') return t('metaScope.source.channel');
  if (source === 'language') return t('metaScope.source.language');
  return t('metaScope.source.derived');
}

/** The scope's query string: `channelId` and `locale` as selected; neither = the `en-US` language row. */
function scopeQuery(channelId: string, locale: string): string {
  const params = new URLSearchParams();
  if (channelId) params.set('channelId', channelId);
  if (locale) params.set('locale', locale);
  if (!channelId && !locale) params.set('locale', FALLBACK_LOCALE);
  return params.toString();
}

export function SeoMetaScopeEditor({ entityType, entityId }: SeoMetaScopeEditorProps): ReactNode {
  const tCore = useTranslation('core');
  const t = useTranslation('seo');
  const channelSelectId = useId();
  const languageId = useId();
  const effectiveHeadingId = useId();
  const fieldIds = {
    title: useId(),
    description: useId(),
    ogTitle: useId(),
    ogDescription: useId(),
    ogImageUrl: useId(),
  };

  const isProduct = entityType === 'product';
  /** `null` until the product's member channels are read; the selector waits for them. */
  const [channels, setChannels] = useState<MemberChannel[] | null>(null);
  const [channelsFailed, setChannelsFailed] = useState(false);
  const [channelId, setChannelId] = useState('');
  const [locale, setLocale] = useState(FALLBACK_LOCALE);
  const [meta, setMeta] = useState<MetaEnvelope['data'] | null>(null);
  const [draft, setDraft] = useState<MetaOverrideFields>({
    title: null,
    description: null,
    ogTitle: null,
    ogDescription: null,
    ogImageUrl: null,
  });
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isProduct) return;
    let cancelled = false;
    setChannelsFailed(false);
    apiClient
      .get<ScopeContextEnvelope>(`/api/v1/admin/catalog/products/${encodeURIComponent(entityId)}/scope-context`)
      .then((res) => {
        if (!cancelled) setChannels(Array.isArray(res?.data?.channels) ? res.data.channels : []);
      })
      .catch(() => {
        if (!cancelled) setChannelsFailed(true);
      });
    return (): void => {
      cancelled = true;
    };
  }, [isProduct, entityId]);

  const metaPath = `/api/v1/admin/seo/meta/${entityType}/${entityId}`;
  const selectedChannel = channels?.find((c) => c.id === channelId) ?? null;

  const load = useCallback(async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiClient.get<MetaEnvelope>(`${metaPath}?${scopeQuery(channelId, locale)}`);
      setMeta(res.data);
      setDraft({
        title: res.data.override?.title ?? null,
        description: res.data.override?.description ?? null,
        ogTitle: res.data.override?.ogTitle ?? null,
        ogDescription: res.data.override?.ogDescription ?? null,
        ogImageUrl: res.data.override?.ogImageUrl ?? null,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : tCore('seo.meta.error.load'));
      setMeta(null);
    } finally {
      setBusy(false);
    }
  }, [metaPath, channelId, locale, tCore]);

  const save = useCallback(async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setStatus('');
    const body: UpsertSeoMetaOverrideRequest = {
      ...(channelId ? { channelId } : {}),
      ...(locale ? { locale } : channelId ? {} : { locale: FALLBACK_LOCALE }),
      ...draft,
    };
    try {
      await apiClient.put(metaPath, body);
      setStatus(tCore('seo.meta.info.saved'));
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : tCore('seo.meta.error.save'));
      setBusy(false);
      return;
    }
    setBusy(false);
    await load();
  }, [channelId, locale, draft, metaPath, load, tCore]);

  const inheritScope = useCallback(async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setStatus('');
    try {
      await apiClient.delete(`${metaPath}?${scopeQuery(channelId, locale)}`);
      setStatus(t('metaScope.removed'));
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('metaScope.error.remove'));
      setBusy(false);
      return;
    }
    setBusy(false);
    await load();
  }, [metaPath, channelId, locale, load, t]);

  const fieldRows: Array<{ field: SeoProductMetaField; label: string; value: string | null }> = meta
    ? [
        { field: 'title', label: tCore('seo.meta.field.title'), value: meta.resolved.title },
        { field: 'description', label: tCore('seo.meta.field.description'), value: meta.resolved.description },
        { field: 'ogTitle', label: tCore('seo.meta.field.ogTitle'), value: meta.resolved.openGraph.title },
        { field: 'ogDescription', label: tCore('seo.meta.field.ogDescription'), value: meta.resolved.openGraph.description },
        { field: 'ogImageUrl', label: tCore('seo.meta.field.ogImage'), value: meta.resolved.openGraph.image },
      ]
    : [];

  const draftFields: Array<{ field: keyof MetaOverrideFields; label: string; wide?: boolean; type?: string }> = [
    { field: 'title', label: tCore('seo.meta.field.title') },
    { field: 'description', label: tCore('seo.meta.field.description') },
    { field: 'ogTitle', label: tCore('seo.meta.field.ogTitle') },
    { field: 'ogDescription', label: tCore('seo.meta.field.ogDescription') },
    { field: 'ogImageUrl', label: tCore('seo.meta.field.ogImageUrl'), wide: true, type: 'url' },
  ];

  return (
    <div className="space-y-4">
      <div role="status" aria-live="polite" className="text-sm text-muted-foreground">
        {status}
      </div>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {isProduct && channelsFailed ? (
        <Alert>
          <AlertDescription>{t('metaScope.channelsUnavailable')}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-end gap-2">
        {isProduct && !channelsFailed && channels ? (
          <div className="space-y-1">
            <Label htmlFor={channelSelectId}>{t('metaScope.channel')}</Label>
            <Select
              id={channelSelectId}
              className="w-auto"
              value={channelId}
              onChange={(e): void => {
                const next = channels.find((c) => c.id === e.target.value) ?? null;
                setChannelId(e.target.value);
                setLocale(next ? ([...next.languages].sort()[0] ?? '') : FALLBACK_LOCALE);
                setMeta(null);
              }}
            >
              <option value="">{t('metaScope.everyChannel')}</option>
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
        <div className="space-y-1">
          <Label htmlFor={languageId}>{t('metaScope.language')}</Label>
          {selectedChannel ? (
            <Select
              id={languageId}
              className="w-auto"
              value={locale}
              onChange={(e): void => {
                setLocale(e.target.value);
                setMeta(null);
              }}
            >
              <option value="">{t('metaScope.wholeChannel')}</option>
              {[...selectedChannel.languages].sort().map((l) => (
                <option key={l} value={l}>
                  {l.toUpperCase()}
                </option>
              ))}
            </Select>
          ) : (
            <Input
              id={languageId}
              className="w-24"
              value={locale}
              onChange={(e): void => {
                setLocale(e.target.value);
                setMeta(null);
              }}
              placeholder={tCore('seo.meta.field.locale')}
            />
          )}
        </div>
        <Button type="button" variant="outline" disabled={busy} aria-busy={busy} onClick={(): void => void load()}>
          {tCore('seo.meta.load')}
        </Button>
      </div>

      {meta ? (
        <>
          <div className="space-y-2">
            <h3 id={effectiveHeadingId} className="text-sm font-semibold">
              {t('metaScope.effectiveHeading')}
            </h3>
            <Table aria-labelledby={effectiveHeadingId}>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('metaScope.column.field')}</TableHead>
                  <TableHead>{t('metaScope.column.value')}</TableHead>
                  {meta.sources ? <TableHead>{t('metaScope.column.source')}</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {fieldRows.map((row) => (
                  <TableRow key={row.field}>
                    <TableHead scope="row" className="w-40">
                      {row.label}
                    </TableHead>
                    <TableCell className={row.field === 'ogImageUrl' ? 'font-mono text-xs' : undefined}>
                      {row.value ?? '—'}
                    </TableCell>
                    {meta.sources ? <TableCell>{sourceLabel(meta.sources[row.field], t)}</TableCell> : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <h3 className="text-sm font-semibold">{tCore('seo.meta.overrideHeading')}</h3>
          <div className="grid gap-4 md:grid-cols-2">
            {draftFields.map(({ field, label, wide, type }) => (
              <div key={field} className={wide ? 'space-y-1 md:col-span-2' : 'space-y-1'}>
                <Label htmlFor={fieldIds[field]}>{label}</Label>
                <Input
                  id={fieldIds[field]}
                  type={type}
                  value={draft[field] ?? ''}
                  onChange={(e): void => setDraft((d) => ({ ...d, [field]: e.target.value || null }))}
                />
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" disabled={busy} aria-busy={busy} onClick={(): void => void save()}>
              {busy ? tCore('seo.meta.saving') : tCore('seo.meta.saveOverride')}
            </Button>
            {meta.override ? (
              <Button type="button" variant="ghost" disabled={busy} onClick={(): void => void inheritScope()}>
                <RotateCcw size={14} aria-hidden="true" />
                {t('metaScope.useInherited')}
              </Button>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
