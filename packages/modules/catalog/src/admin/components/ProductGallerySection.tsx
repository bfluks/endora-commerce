import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from 'react';
import { GripVertical } from 'lucide-react';
import { ApiError, apiClient, toAbsoluteAssetUrl } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@endora-commerce/admin-kit/ui';
import { AssetPicker, TouchReorderButtons } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import type { AssetSummary, AssetDetail } from '@endora-commerce/contracts';

// ---------------------------------------------------------------------------
// Gallery section (T085) — admin CRUD for the Product's gallery items.
// Foundation lacks an admin Asset upload endpoint, so for now the form
// accepts an existing assetId; future work adds drag-and-drop on top of
// an Assets module admin upload route.
// ---------------------------------------------------------------------------

const GALLERY_LABELS = ['base_image', 'small_image', 'thumbnail'] as const;
type GalleryLabel = (typeof GALLERY_LABELS)[number];

interface AdminGalleryItem {
  id: string;
  productId: string;
  assetId: string;
  position: number;
  labels: GalleryLabel[];
  asset?: { url: string; kind: string };
}

interface AdminProductImage {
  id: string;
  kind: string;
  url: string;
  altText: string | null;
}

export interface GallerySectionHandle {
  /** Persist staged label + order edits. Called by the page-Save button. */
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

export const GallerySection = forwardRef<GallerySectionHandle, { productId: string }>(
  function GallerySection({ productId }, ref): ReactNode {
  const t = useTranslation('catalog');
  const [items, setItems] = useState<AdminGalleryItem[]>([]);
  const [images, setImages] = useState<AdminProductImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const dragIdRef = useRef<string | null>(null);
  // Server-truth snapshot (id order + labels) used to diff the staged edits
  // that the page-Save button flushes.
  const baselineRef = useRef<string>('');

  const snapshot = (list: AdminGalleryItem[]): string =>
    JSON.stringify(list.map((g) => ({ id: g.id, labels: [...g.labels].sort() })));

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      // Public PDP carries the resolved gallery (with asset urls) so
      // admins see the same shape customers do; the admin GET returns
      // bare ids without urls. The PDP also carries the product's flat
      // `assets` (legacy product_assets) — the storefront renders those
      // when the label-aware gallery is empty, so we surface them here
      // too, otherwise a product whose images live on product_assets
      // looks empty in the admin while showing fine on the storefront.
      const res = await apiClient.get<{
        data: {
          gallery?: Array<{
            id: string;
            position: number;
            labels: GalleryLabel[];
            asset: { id: string; kind: string; url: string };
          }>;
          assets?: Array<{
            id: string;
            kind: string;
            url: string;
            altText?: string | null;
          }>;
        };
      }>(`/api/v1/catalog/products/${productId}`);
      const gallery = res.data.gallery ?? [];
      const mapped = gallery
        .slice()
        .sort((a, b) => a.position - b.position)
        .map((g) => ({
          id: g.id,
          productId,
          assetId: g.asset.id,
          position: g.position,
          labels: g.labels,
          asset: { url: g.asset.url, kind: g.asset.kind },
        }));
      setItems(mapped);
      baselineRef.current = snapshot(mapped);
      const assets = res.data.assets ?? [];
      setImages(
        assets
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

  // --- Page-Save hook: flush staged label + order edits. Labels are patched
  //     with `replace=true` so reassigning a label moves it atomically. ---
  const flushGallery = useCallback(async (): Promise<void> => {
    const baseline = JSON.parse(baselineRef.current || '[]') as Array<{ id: string; labels: string[] }>;
    const baseLabels = new Map(baseline.map((b) => [b.id, [...b.labels].sort().join(',')]));
    const changed = items.filter(
      (it) => baseLabels.get(it.id) !== [...it.labels].sort().join(','),
    );
    for (const it of changed) {
      await apiClient.patch(
        `/api/v1/admin/catalog/products/${productId}/gallery/${it.id}?replace=true`,
        { labels: it.labels },
      );
    }
    const baseOrder = baseline.map((b) => b.id).join(',');
    const curOrder = items.map((it) => it.id).join(',');
    if (items.length > 0 && curOrder !== baseOrder) {
      await apiClient.put(`/api/v1/admin/catalog/products/${productId}/gallery/order`, {
        orderedGalleryItemIds: items.map((it) => it.id),
      });
    }
    if (changed.length > 0 || curOrder !== baseOrder) {
      await refresh();
    }
  }, [items, productId, refresh]);

  useImperativeHandle(ref, () => ({ flushGallery }), [flushGallery]);

  const disabled = busy || loading;

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
            <p className="text-xs text-muted-foreground">{t('productEditor.gallery.dragHint')}</p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>{t('productEditor.gallery.column.preview')}</TableHead>
                  {GALLERY_LABELS.map((label) => (
                    <TableHead key={label} className="text-center">
                      {t(`productEditor.gallery.label.${label}`)}
                    </TableHead>
                  ))}
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
                    index={index}
                    total={items.length}
                    disabled={disabled}
                    onAssignLabel={assignLabel}
                    onClearLabel={clearLabel}
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
  index,
  total,
  disabled,
  onAssignLabel,
  onClearLabel,
  onMove,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onPreview,
  onDelete,
}: {
  item: AdminGalleryItem;
  index: number;
  total: number;
  disabled: boolean;
  onAssignLabel: (label: GalleryLabel, itemId: string) => void;
  onClearLabel: (label: GalleryLabel) => void;
  onMove: (from: number, to: number) => void;
  onDragStart: (itemId: string) => void;
  onDragOver: (event: DragEvent<HTMLTableRowElement>) => void;
  onDrop: (index: number) => void;
  onDragEnd: () => void;
  onPreview: (url: string) => void;
  onDelete: (id: string) => void;
}): ReactNode {
  const t = useTranslation('catalog');
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
          <span className="text-muted-foreground text-xs">—</span>
        )}
      </TableCell>
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

