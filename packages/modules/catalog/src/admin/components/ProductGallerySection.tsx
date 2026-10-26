import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from 'react';
import { GripVertical } from 'lucide-react';
import { GALLERY_ALT_TEXT_MAX, type AssetSummary, type AssetDetail, type GalleryChannelRoles, type GalleryItem } from '@endora-commerce/contracts';
import { ApiError, apiClient, toAbsoluteAssetUrl, useAuth } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Button, Card, Checkbox, CardContent, CardHeader, CardTitle, Input, Label, Select, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@endora-commerce/admin-kit/ui';
import { AssetPicker, TouchReorderButtons } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import type { ScopeContext } from './ProductScopeEditor.js';
import { getProductScopeContext } from '../lib/product-scopes-api.js';
import {
  NO_CHANNEL_ROLES,
  ROLE_KEYS,
  channelNameIn,
  channelRolesChanges,
  languagesToOffer,
  memberChannels,
  sameSet,
  translationPatch,
  withChannelHidden,
  type ChannelRoles,
  type TranslationMap,
} from '../lib/media-scopes.js';

// ---------------------------------------------------------------------------
// Gallery section (T085) — admin CRUD for the Product's gallery items.
// Foundation lacks an admin Asset upload endpoint, so for now the form
// accepts an existing assetId; future work adds drag-and-drop on top of
// an Assets module admin upload route.
//
// Feature 163 (T141, US9, FR-076, FR-077) — the list is the admin read, so an
// image hidden in the channel the public read resolves to stays listed (the
// public read is only where the preview URLs come from). Per member channel the
// operator picks a role holder or "use inherited" and hides images there; alt
// text is edited per language. Everything is staged and written by the page Save.
// ---------------------------------------------------------------------------

const GALLERY_LABELS = ['base_image', 'small_image', 'thumbnail'] as const;
type GalleryLabel = (typeof GALLERY_LABELS)[number];

type Translate = (key: string, params?: Record<string, string>) => string;

interface AdminGalleryItem {
  id: string;
  productId: string;
  assetId: string;
  position: number;
  labels: GalleryLabel[];
  altText: TranslationMap;
  hiddenInChannels: string[];
  asset?: { url: string; kind: string };
}

interface AdminProductImage {
  id: string;
  kind: string;
  url: string;
  altText: string | null;
}

/** What the public product read carries that the admin read does not: the asset URLs. */
interface PublicMedia {
  gallery?: Array<{ id: string; asset: { id: string; kind: string; url: string } }>;
  assets?: Array<{ id: string; kind: string; url: string; altText?: string | null }>;
}

export interface GallerySectionHandle {
  /** Persist staged label, order, alt-text, hidden-channel and channel-role edits. Called by the page-Save button. */
  flushGallery: () => Promise<void>;
}

/** Immutable array move used by drag-and-drop / arrow reordering. */
function moveGalleryItem<T>(items: T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length || from === to) return items;
  const next = items.slice();
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return items;
  next.splice(to, 0, moved);
  return next;
}

/** The server truth the page Save diffs against. */
interface Baseline {
  items: Map<string, { labels: string; altText: TranslationMap; hiddenInChannels: string[] }>;
  order: string;
  roles: Map<string, ChannelRoles>;
}

const EMPTY_BASELINE: Baseline = { items: new Map(), order: '', roles: new Map() };

export const GallerySection = forwardRef<GallerySectionHandle, { productId: string }>(
  function GallerySection({ productId }, ref): ReactNode {
  const t = useTranslation('catalog') as Translate;
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('catalog:write');
  const scopeSelectId = useId();
  const languageSelectId = useId();
  const [items, setItems] = useState<AdminGalleryItem[]>([]);
  const [images, setImages] = useState<AdminProductImage[]>([]);
  const [context, setContext] = useState<ScopeContext | null>(null);
  const [roles, setRoles] = useState<Map<string, ChannelRoles>>(() => new Map());
  const [channelId, setChannelId] = useState('');
  const [altLanguage, setAltLanguage] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const dragIdRef = useRef<string | null>(null);
  // Server-truth snapshot used to diff the staged edits that the page-Save button flushes.
  const baselineRef = useRef<Baseline>(EMPTY_BASELINE);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      // The admin read is the list (every item, with its alt text and hidden channels).
      // The public read only lends the asset URLs — it resolves one channel, so an image
      // hidden there has no preview here — and the product's flat `assets` (legacy
      // product_assets), which the storefront renders when the gallery is empty.
      const [galleryRes, rolesRes, scope, publicRes] = await Promise.all([
        apiClient.get<{ data: GalleryItem[] }>(`/api/v1/admin/catalog/products/${productId}/gallery`),
        apiClient.get<{ data: GalleryChannelRoles[] }>(
          `/api/v1/admin/catalog/products/${productId}/gallery/channel-roles`,
        ),
        getProductScopeContext(productId).catch(() => null),
        apiClient
          .get<{ data: PublicMedia }>(`/api/v1/catalog/products/${productId}`)
          .catch(() => ({ data: {} as PublicMedia })),
      ]);
      const publicMedia = publicRes.data ?? {};
      const urlByItem = new Map((publicMedia.gallery ?? []).map((g) => [g.id, g.asset]));
      const urlByAsset = new Map((publicMedia.assets ?? []).map((a) => [a.id, a]));
      const mapped: AdminGalleryItem[] = (galleryRes.data ?? [])
        .slice()
        .sort((a, b) => a.position - b.position)
        .map((g) => {
          const asset = urlByItem.get(g.id) ?? urlByAsset.get(g.assetId);
          return {
            id: g.id,
            productId,
            assetId: g.assetId,
            position: g.position,
            labels: g.labels as GalleryLabel[],
            altText: { ...(g.altText ?? {}) },
            hiddenInChannels: [...(g.hiddenInChannels ?? [])].sort(),
            ...(asset ? { asset: { url: asset.url, kind: asset.kind } } : {}),
          };
        });
      const savedRoles = new Map((rolesRes.data ?? []).map((r) => [r.channelId, { ...NO_CHANNEL_ROLES, ...r.roles }]));
      setItems(mapped);
      setRoles(new Map(savedRoles));
      setContext(scope);
      baselineRef.current = {
        items: new Map(
          mapped.map((it) => [
            it.id,
            { labels: [...it.labels].sort().join(','), altText: it.altText, hiddenInChannels: it.hiddenInChannels },
          ]),
        ),
        order: mapped.map((it) => it.id).join(','),
        roles: savedRoles,
      };
      setImages(
        (publicMedia.assets ?? [])
          .filter((a) => a.kind === 'image' || a.kind === 'video')
          .map((a) => ({
            id: a.id,
            kind: a.kind,
            url: a.url,
            altText: a.altText ?? null,
          })),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('productEditor.gallery.error.load'));
    } finally {
      setLoading(false);
    }
  }, [productId, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const channels = memberChannels(context);
  const channel = channels.find((c) => c.id === channelId) ?? null;
  const languages = useMemo(
    () => languagesToOffer(context, ...items.map((it) => it.altText)),
    [context, items],
  );
  const language = languages.includes(altLanguage) ? altLanguage : (languages[0] ?? '');
  const itemName = useCallback(
    (itemId: string): string =>
      t('productEditor.gallery.itemName', { n: String(items.findIndex((it) => it.id === itemId) + 1) }),
    [items, t],
  );
  const channelName = useCallback(
    (id: string): string => channelNameIn(context, id, t('productEditor.mediaScopes.unknownChannel')),
    [context, t],
  );

  // --- Staged label edits: each label lives on at most one item; assigning it
  //     to one item strips it from every other (radio semantics). Persisted on
  //     page Save, so no per-row Save button and no "already taken" error. ---
  const assignLabel = useCallback((label: GalleryLabel, itemId: string): void => {
    setInfo(null);
    setItems((prev) =>
      prev.map((it) => {
        const without = it.labels.filter((l) => l !== label);
        return { ...it, labels: it.id === itemId ? [...without, label] : without };
      }),
    );
  }, []);

  const clearLabel = useCallback((label: GalleryLabel): void => {
    setInfo(null);
    setItems((prev) => prev.map((it) => ({ ...it, labels: it.labels.filter((l) => l !== label) })));
  }, []);

  // --- Staged per-channel and per-language edits (feature 163). ---
  const setChannelRole = useCallback((forChannel: string, label: GalleryLabel, itemId: string | null): void => {
    setInfo(null);
    setRoles((prev) => {
      const next = new Map(prev);
      next.set(forChannel, { ...(prev.get(forChannel) ?? NO_CHANNEL_ROLES), [ROLE_KEYS[label]]: itemId });
      return next;
    });
  }, []);

  const setHidden = useCallback((itemId: string, forChannel: string, hidden: boolean): void => {
    setInfo(null);
    setItems((prev) =>
      prev.map((it) =>
        it.id === itemId ? { ...it, hiddenInChannels: withChannelHidden(it.hiddenInChannels, forChannel, hidden) } : it,
      ),
    );
  }, []);

  const setAltText = useCallback((itemId: string, forLanguage: string, text: string): void => {
    setInfo(null);
    setItems((prev) =>
      prev.map((it) => (it.id === itemId ? { ...it, altText: { ...it.altText, [forLanguage]: text } } : it)),
    );
  }, []);

  // --- Staged reorder (array order === display order). ---
  const moveItem = useCallback((from: number, to: number): void => {
    setInfo(null);
    setItems((prev) => moveGalleryItem(prev, from, to));
  }, []);

  const handleDrop = useCallback((index: number): void => {
    const draggedId = dragIdRef.current;
    if (!draggedId) return;
    setItems((prev) => {
      const from = prev.findIndex((it) => it.id === draggedId);
      return from < 0 || from === index ? prev : moveGalleryItem(prev, from, index);
    });
  }, []);

  // --- Immediate CRUD (add / remove) — these hit the server directly and
  //     re-load, which also resets the staged baseline. ---
  const handleCreate = useCallback(
    async (assetId: string): Promise<void> => {
      setBusy(true);
      try {
        await apiClient.post(`/api/v1/admin/catalog/products/${productId}/gallery`, {
          assetId,
          labels: [],
        });
        setInfo(t('productEditor.gallery.success.add'));
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('productEditor.gallery.error.add'));
      } finally {
        setBusy(false);
      }
    },
    [productId, refresh, t],
  );

  const handleDelete = useCallback(
    async (itemId: string): Promise<void> => {
      if (!confirm(t('productEditor.gallery.removeConfirm'))) return;
      setBusy(true);
      try {
        await apiClient.delete(`/api/v1/admin/catalog/products/${productId}/gallery/${itemId}`);
        setInfo(t('productEditor.gallery.success.remove'));
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('productEditor.gallery.error.delete'));
      } finally {
        setBusy(false);
      }
    },
    [productId, refresh, t],
  );

  // --- Page-Save hook: flush the staged edits. Labels are patched with
  //     `replace=true` so reassigning a label moves it atomically; alt text and
  //     hidden channels go in one PATCH per item (`product.media.update`); the
  //     channel roles in one PUT per changed channel, changed roles only. ---
  const flushGallery = useCallback(async (): Promise<void> => {
    const baseline = baselineRef.current;
    let wrote = false;
    for (const it of items) {
      const before = baseline.items.get(it.id);
      if (!before) continue;
      if (before.labels !== [...it.labels].sort().join(',')) {
        await apiClient.patch(
          `/api/v1/admin/catalog/products/${productId}/gallery/${it.id}?replace=true`,
          { labels: it.labels },
        );
        wrote = true;
      }
      const altText = translationPatch(before.altText, it.altText);
      const hiddenChanged = !sameSet(before.hiddenInChannels, it.hiddenInChannels);
      if (altText || hiddenChanged) {
        await apiClient.patch(`/api/v1/admin/catalog/products/${productId}/gallery/${it.id}`, {
          ...(altText ? { altText } : {}),
          ...(hiddenChanged ? { hiddenInChannels: it.hiddenInChannels } : {}),
        });
        wrote = true;
      }
    }
    const curOrder = items.map((it) => it.id).join(',');
    if (items.length > 0 && curOrder !== baseline.order) {
      await apiClient.put(`/api/v1/admin/catalog/products/${productId}/gallery/order`, {
        orderedGalleryItemIds: items.map((it) => it.id),
      });
      wrote = true;
    }
    for (const [forChannel, draft] of roles) {
      const changes = channelRolesChanges(baseline.roles.get(forChannel) ?? NO_CHANNEL_ROLES, draft);
      if (!changes) continue;
      await apiClient.put(`/api/v1/admin/catalog/products/${productId}/gallery/channel-roles`, {
        channelId: forChannel,
        roles: changes,
      });
      wrote = true;
    }
    if (wrote) {
      await refresh();
    }
  }, [items, productId, refresh, roles]);

  useImperativeHandle(ref, () => ({ flushGallery }), [flushGallery]);

  const disabled = busy || loading;
  const scopeDisabled = disabled || !canWrite;

  /** The item holding a role globally (the staged labels), named for "use inherited". */
  const globalHolderName = (label: GalleryLabel): string => {
    const holder = items.find((it) => it.labels.includes(label));
    return holder ? itemName(holder.id) : t('productEditor.gallery.channelRole.none');
  };

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle>{t('productEditor.gallery.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {info ? (
          <Alert>
            <AlertDescription>{info}</AlertDescription>
          </Alert>
        ) : null}

        {!loading && images.length > 0 ? (
          <div className="space-y-2">
            <p className="text-sm font-medium">{t('productEditor.gallery.productImages.title')}</p>
            <p className="text-xs text-muted-foreground">
              {t('productEditor.gallery.productImages.hint')}
            </p>
            <div className="flex flex-wrap gap-2">
              {images.map((img) =>
                img.kind === 'video' ? (
                  <video
                    key={img.id}
                    src={toAbsoluteAssetUrl(img.url)}
                    className="h-20 w-20 rounded border object-cover"
                    muted
                  />
                ) : (
                  <img
                    key={img.id}
                    src={toAbsoluteAssetUrl(img.url)}
                    alt={img.altText ?? ''}
                    className="h-20 w-20 rounded border object-cover"
                  />
                ),
              )}
            </div>
          </div>
        ) : null}

        {loading ? (
          <p className="text-sm text-muted-foreground">{t('productEditor.loading')}</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('productEditor.gallery.empty')}</p>
        ) : (
          <>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor={scopeSelectId}>{t('productEditor.gallery.scope.label')}</Label>
                <Select
                  id={scopeSelectId}
                  aria-describedby={`${scopeSelectId}-hint`}
                  value={channel ? channel.id : ''}
                  disabled={disabled}
                  onChange={(e): void => setChannelId(e.target.value)}
                >
                  <option value="">{t('productEditor.gallery.scope.global')}</option>
                  {channels.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
                <p id={`${scopeSelectId}-hint`} className="text-xs text-muted-foreground">
                  {channels.length === 0
                    ? t('productEditor.gallery.scope.noChannels')
                    : t('productEditor.gallery.scope.hint')}
                </p>
              </div>
              {languages.length > 0 ? (
                <div className="space-y-1">
                  <Label htmlFor={languageSelectId}>{t('productEditor.gallery.alt.language')}</Label>
                  <Select
                    id={languageSelectId}
                    aria-describedby={`${languageSelectId}-hint`}
                    value={language}
                    disabled={disabled}
                    onChange={(e): void => setAltLanguage(e.target.value)}
                  >
                    {languages.map((code) => (
                      <option key={code} value={code}>
                        {code.toUpperCase()}
                      </option>
                    ))}
                  </Select>
                  <p id={`${languageSelectId}-hint`} className="text-xs text-muted-foreground">
                    {t('productEditor.gallery.alt.hint')}
                  </p>
                </div>
              ) : null}
            </div>

            {channel ? (
              <div className="grid gap-3 md:grid-cols-3" role="group" aria-label={channel.name}>
                {GALLERY_LABELS.map((label) => {
                  const key = ROLE_KEYS[label];
                  const value = roles.get(channel.id)?.[key] ?? '';
                  const selectId = `${scopeSelectId}-${label}`;
                  const options = items.filter(
                    (it) => it.id === value || !it.hiddenInChannels.includes(channel.id),
                  );
                  return (
                    <div key={label} className="space-y-1">
                      <Label htmlFor={selectId}>
                        {t('productEditor.gallery.channelRole.label', {
                          role: t(`productEditor.gallery.label.${label}`),
                          channel: channel.name,
                        })}
                      </Label>
                      <Select
                        id={selectId}
                        value={value}
                        disabled={scopeDisabled}
                        onChange={(e): void => setChannelRole(channel.id, label, e.target.value || null)}
                      >
                        <option value="">
                          {t('productEditor.gallery.channelRole.inherited', { item: globalHolderName(label) })}
                        </option>
                        {options.map((it) => (
                          <option key={it.id} value={it.id}>
                            {itemName(it.id)}
                          </option>
                        ))}
                      </Select>
                    </div>
                  );
                })}
              </div>
            ) : null}

            <p className="text-xs text-muted-foreground">{t('productEditor.gallery.dragHint')}</p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>{t('productEditor.gallery.column.preview')}</TableHead>
                  {channel ? (
                    <TableHead className="text-center">
                      {t('productEditor.gallery.column.hidden', { channel: channel.name })}
                    </TableHead>
                  ) : (
                    <>
                      {GALLERY_LABELS.map((label) => (
                        <TableHead key={label} className="text-center">
                          {t(`productEditor.gallery.label.${label}`)}
                        </TableHead>
                      ))}
                      <TableHead>{t('productEditor.gallery.column.hiddenIn')}</TableHead>
                    </>
                  )}
                  {language ? (
                    <TableHead>
                      {t('productEditor.gallery.column.altText', { language: language.toUpperCase() })}
                    </TableHead>
                  ) : null}
                  <TableHead>{t('productEditor.gallery.column.assetId')}</TableHead>
                  <TableHead className="w-[1%] whitespace-nowrap text-right">
                    {t('productEditor.gallery.column.actions')}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item, index) => (
                  <GalleryRow
                    key={item.id}
                    item={item}
                    name={itemName(item.id)}
                    index={index}
                    total={items.length}
                    disabled={disabled}
                    scopeDisabled={scopeDisabled}
                    channel={channel}
                    language={language}
                    channelName={channelName}
                    onAssignLabel={assignLabel}
                    onClearLabel={clearLabel}
                    onSetHidden={setHidden}
                    onSetAltText={setAltText}
                    onMove={moveItem}
                    onDragStart={(id) => {
                      dragIdRef.current = id;
                    }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={handleDrop}
                    onDragEnd={() => {
                      dragIdRef.current = null;
                    }}
                    onPreview={setPreviewUrl}
                    onDelete={handleDelete}
                  />
                ))}
              </TableBody>
            </Table>
          </>
        )}

        <CreateGalleryItemInline disabled={disabled} onCreate={handleCreate} />
      </CardContent>

      {previewUrl ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
          role="dialog"
          aria-modal="true"
          aria-label={t('productEditor.gallery.preview.title')}
          onClick={() => setPreviewUrl(null)}
        >
          <img
            src={previewUrl}
            alt={t('productEditor.gallery.preview.title')}
            className="max-h-full max-w-full rounded shadow-lg"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            type="button"
            className="b2b-btn b2b-btn--sm"
            style={{ position: 'fixed', top: 16, right: 16 }}
            onClick={() => setPreviewUrl(null)}
          >
            {t('productEditor.gallery.preview.close')}
          </button>
        </div>
      ) : null}
    </Card>
  );
});

function GalleryRow({
  item,
  name,
  index,
  total,
  disabled,
  scopeDisabled,
  channel,
  language,
  channelName,
  onAssignLabel,
  onClearLabel,
  onSetHidden,
  onSetAltText,
  onMove,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onPreview,
  onDelete,
}: {
  item: AdminGalleryItem;
  name: string;
  index: number;
  total: number;
  disabled: boolean;
  scopeDisabled: boolean;
  /** The channel being edited; `null` = the global roles. */
  channel: { id: string; name: string } | null;
  /** The alt-text language being edited; `''` = none to offer. */
  language: string;
  channelName: (channelId: string) => string;
  onAssignLabel: (label: GalleryLabel, itemId: string) => void;
  onClearLabel: (label: GalleryLabel) => void;
  onSetHidden: (itemId: string, channelId: string, hidden: boolean) => void;
  onSetAltText: (itemId: string, language: string, text: string) => void;
  onMove: (from: number, to: number) => void;
  onDragStart: (itemId: string) => void;
  onDragOver: (event: DragEvent<HTMLTableRowElement>) => void;
  onDrop: (index: number) => void;
  onDragEnd: () => void;
  onPreview: (url: string) => void;
  onDelete: (id: string) => void;
}): ReactNode {
  const t = useTranslation('catalog') as Translate;
  const url = item.asset?.url ? toAbsoluteAssetUrl(item.asset.url) : null;

  return (
    <TableRow
      draggable={!disabled}
      onDragStart={() => onDragStart(item.id)}
      onDragOver={onDragOver}
      onDrop={() => onDrop(index)}
      onDragEnd={onDragEnd}
    >
      <TableCell className="w-8">
        <span
          className="inline-flex cursor-grab items-center text-muted-foreground"
          title={t('productEditor.gallery.dragHint')}
          aria-hidden
        >
          <GripVertical className="h-4 w-4" />
        </span>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          {url ? (
            item.asset?.kind === 'video' ? (
              <video src={url} className="h-12 w-12 rounded border object-cover" muted />
            ) : (
              <button
                type="button"
                className="block rounded border p-0"
                title={t('productEditor.gallery.preview.open')}
                onClick={() => onPreview(url)}
              >
                <img src={url} alt="" className="h-12 w-12 rounded object-cover" />
              </button>
            )
          ) : (
            <span className="text-muted-foreground text-xs" aria-hidden>
              —
            </span>
          )}
          <span className="text-sm">{name}</span>
        </div>
      </TableCell>
      {channel ? (
        <TableCell className="text-center">
          <Checkbox
            checked={item.hiddenInChannels.includes(channel.id)}
            disabled={scopeDisabled}
            aria-label={t('productEditor.gallery.hide.label', { item: name, channel: channel.name })}
            onChange={(e) => onSetHidden(item.id, channel.id, e.target.checked)}
          />
        </TableCell>
      ) : (
        <>
          {GALLERY_LABELS.map((label) => {
            const checked = item.labels.includes(label);
            return (
              <TableCell key={label} className="text-center">
                <input
                  type="radio"
                  name={`gallery-label-${label}`}
                  checked={checked}
                  disabled={disabled}
                  aria-label={t(`productEditor.gallery.label.${label}`)}
                  onChange={() => {}}
                  onClick={() =>
                    checked ? onClearLabel(label) : onAssignLabel(label, item.id)
                  }
                />
              </TableCell>
            );
          })}
          <TableCell className="text-xs text-muted-foreground">
            {item.hiddenInChannels.length > 0 ? item.hiddenInChannels.map(channelName).join(', ') : '—'}
          </TableCell>
        </>
      )}
      {language ? (
        <TableCell>
          <Input
            value={item.altText[language] ?? ''}
            disabled={scopeDisabled}
            maxLength={GALLERY_ALT_TEXT_MAX}
            placeholder={t('productEditor.gallery.alt.placeholder')}
            aria-label={t('productEditor.gallery.alt.label', { item: name, language: language.toUpperCase() })}
            onChange={(e) => onSetAltText(item.id, language, e.target.value)}
          />
        </TableCell>
      ) : null}
      <TableCell className="font-mono text-xs">{item.assetId.slice(0, 8)}…</TableCell>
      <TableCell className="space-x-2 whitespace-nowrap text-right">
        <TouchReorderButtons
          disabled={disabled}
          onMoveUp={() => onMove(index, index - 1)}
          onMoveDown={() => onMove(index, index + 1)}
          disableUp={index === 0}
          disableDown={index === total - 1}
        />
        <Button
          type="button"
          size="sm"
          variant="destructive"
          disabled={disabled}
          onClick={() => void onDelete(item.id)}
        >
          {t('productEditor.gallery.action.remove')}
        </Button>
      </TableCell>
    </TableRow>
  );
}

function CreateGalleryItemInline({
  disabled,
  onCreate,
}: {
  disabled: boolean;
  onCreate: (assetId: string) => Promise<void>;
}): ReactNode {
  const t = useTranslation('catalog');
  const [assetId, setAssetId] = useState('');

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickedFilename, setPickedFilename] = useState<string | null>(null);
  const onPick = (a: AssetSummary | AssetDetail): void => {
    setAssetId(a.id);
    setPickedFilename(a.filename);
    setPickerOpen(false);
  };

  return (
    <div className="space-y-3 border-t pt-4" role="group" aria-label={t('productEditor.gallery.addTitle')}>
      {pickerOpen ? (
        <AssetPicker
          acceptMimePrefix="image/"
          allowUpload
          onSelect={onPick}
          onClose={() => setPickerOpen(false)}
        />
      ) : null}
      <div className="grid gap-3 md:grid-cols-4">
      <div className="space-y-1 md:col-span-3">
        <Label htmlFor="gasset">{t('productEditor.gallery.field.asset')}</Label>
        <div className="flex items-center gap-2">
          <Input
            id="gasset"
            value={pickedFilename ?? assetId}
            readOnly
            placeholder={t('productEditor.gallery.field.noAsset')}
          />
          <Button type="button" variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
            {t('productEditor.gallery.action.pickOrUpload')}
          </Button>
        </div>
      </div>
      <div className="flex items-end">
        <Button
          type="button"
          disabled={disabled || !assetId}
          onClick={() => {
            if (!assetId) return;
            void onCreate(assetId).then(() => {
              setAssetId('');
              setPickedFilename(null);
            });
          }}
        >
          {t('productEditor.gallery.action.add')}
        </Button>
      </div>
      </div>
    </div>
  );
}


