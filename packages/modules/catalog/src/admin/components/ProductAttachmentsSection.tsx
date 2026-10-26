import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ApiError, apiClient } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Select, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@endora-commerce/admin-kit/ui';
import { AssetPicker } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

// ---------------------------------------------------------------------------
// Attachments section (T086) — admin CRUD for Product Attachments. The
// Library picker (feature 013 / US1) replaces the manual UUID input; assets
// are picked from the Library or uploaded inline.
// ---------------------------------------------------------------------------

interface AdminAttachmentType {
  id: string;
  code: string;
  name: Record<string, string>;
  position: number;
}

interface AdminAttachment {
  id: string;
  productId: string;
  assetId: string;
  attachmentTypeId: string;
  name: string;
  description: string | null;
  position: number;
  asset?: { url: string; filename: string; mimeType: string };
  type?: { code: string; name: Record<string, string> };
}

export function AttachmentsSection({ productId }: { productId: string }): ReactNode {
  const t = useTranslation('catalog');
  const [attachments, setAttachments] = useState<AdminAttachment[]>([]);
  const [types, setTypes] = useState<AdminAttachmentType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const [detail, typesRes] = await Promise.all([
        apiClient.get<{
          data: {
            attachments?: Array<{
              id: string;
              position: number;
              name: string;
              description: string | null;
              type: { id: string; code: string; name: Record<string, string> };
              asset: {
                id: string;
                kind: string;
                url: string;
                filename: string;
                sizeBytes: number;
                mimeType: string;
              };
            }>;
          };
        }>(`/api/v1/catalog/products/${productId}`),
        apiClient.get<{ data: AdminAttachmentType[] }>(
          '/api/v1/admin/catalog/attachment-types',
        ),
      ]);
      const detailAttachments = detail.data.attachments ?? [];
      setAttachments(
        detailAttachments.map((a) => ({
          id: a.id,
          productId,
          assetId: a.asset.id,
          attachmentTypeId: a.type.id,
          name: a.name,
          description: a.description,
          position: a.position,
          asset: {
            url: a.asset.url,
            filename: a.asset.filename,
            mimeType: a.asset.mimeType,
          },
          type: { code: a.type.code, name: a.type.name },
        })),
      );
      setTypes(typesRes.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('productEditor.attachments.error.load'));
    } finally {
      setLoading(false);
    }
  }, [productId, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleCreate = useCallback(
    async (input: {
      assetId: string;
      attachmentTypeId: string;
      name: string;
      description: string;
    }): Promise<void> => {
      try {
        await apiClient.post(`/api/v1/admin/catalog/products/${productId}/attachments`, {
          assetId: input.assetId,
          attachmentTypeId: input.attachmentTypeId,
          name: input.name,
          ...(input.description ? { description: input.description } : {}),
        });
        setInfo(t('productEditor.attachments.success.add'));
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('productEditor.attachments.error.add'));
      }
    },
    [productId, refresh, t],
  );

  const handleDelete = useCallback(
    async (attachmentId: string, name: string): Promise<void> => {
      if (!confirm(t('productEditor.attachments.deleteConfirm', { name }))) return;
      try {
        await apiClient.delete(
          `/api/v1/admin/catalog/products/${productId}/attachments/${attachmentId}`,
        );
        setInfo(t('productEditor.attachments.success.delete', { name }));
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('productEditor.attachments.error.delete'));
      }
    },
    [productId, refresh, t],
  );

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle>{t('productEditor.attachments.title')}</CardTitle>
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

        {loading ? (
          <p className="text-sm text-muted-foreground">{t('productEditor.loading')}</p>
        ) : attachments.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('productEditor.attachments.empty')}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('productEditor.attachments.column.type')}</TableHead>
                <TableHead>{t('productEditor.attachments.column.name')}</TableHead>
                <TableHead>{t('productEditor.attachments.column.description')}</TableHead>
                <TableHead>{t('productEditor.attachments.column.file')}</TableHead>
                <TableHead className="w-[1%] whitespace-nowrap">{t('productEditor.attachments.column.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {attachments.map((att) => (
                <TableRow key={att.id}>
                  <TableCell>{att.type?.name['en-US'] ?? att.type?.code ?? '—'}</TableCell>
                  <TableCell className="font-medium">{att.name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {att.description ?? '—'}
                  </TableCell>
                  <TableCell>
                    {att.asset?.url ? (
                      <a
                        href={att.asset.url}
                        target="_blank"
                        rel="noopener"
                        className="text-xs underline"
                      >
                        {att.asset.filename}
                      </a>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      onClick={() => void handleDelete(att.id, att.name)}
                    >
                      {t('productEditor.attachments.action.delete')}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <CreateAttachmentInline types={types} onCreate={handleCreate} />
      </CardContent>
    </Card>
  );
}

function CreateAttachmentInline({
  types,
  onCreate,
}: {
  types: AdminAttachmentType[];
  onCreate: (input: {
    assetId: string;
    attachmentTypeId: string;
    name: string;
    description: string;
  }) => Promise<void>;
}): ReactNode {
  const [assetId, setAssetId] = useState('');
  const [attachmentTypeId, setAttachmentTypeId] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickedFilename, setPickedFilename] = useState<string | null>(null);
  const t = useTranslation('catalog');

  return (
    <div className="space-y-3 border-t pt-4" role="group" aria-label={t('productEditor.attachments.addTitle')}>
      {pickerOpen ? (
        <AssetPicker
          allowUpload
          onSelect={(a): void => {
            setAssetId(a.id);
            setPickedFilename(a.filename);
            setPickerOpen(false);
          }}
          onClose={() => setPickerOpen(false)}
        />
      ) : null}
      <div className="grid gap-3 md:grid-cols-4">
      <div className="space-y-1">
        <Label htmlFor="aasset">{t('productEditor.attachments.field.asset')}</Label>
        <div className="flex items-center gap-2">
          <Input
            id="aasset"
            value={pickedFilename ?? assetId}
            readOnly
            placeholder={t('productEditor.attachments.field.noAsset')}
          />
          <Button type="button" variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
            {t('productEditor.attachments.action.pickOrUpload')}
          </Button>
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="atype">{t('productEditor.attachments.field.type')}</Label>
        <Select
          id="atype"
          value={attachmentTypeId}
          onChange={(e): void => setAttachmentTypeId(e.target.value)}
        >
          <option value="">—</option>
          {types.map((typ) => (
            <option key={typ.id} value={typ.id}>
              {typ.name['en-US'] ?? typ.code}
            </option>
          ))}
        </Select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="aname">{t('productEditor.attachments.field.name')}</Label>
        <Input
          id="aname"
          value={name}
          onChange={(e): void => setName(e.target.value)}
          placeholder={t('productEditor.attachments.field.namePlaceholder')}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="adesc">{t('productEditor.attachments.field.description')}</Label>
        <Input
          id="adesc"
          value={description}
          onChange={(e): void => setDescription(e.target.value)}
          placeholder={t('productEditor.attachments.field.descriptionPlaceholder')}
        />
      </div>
      <div className="md:col-span-4">
        <Button
          type="button"
          onClick={() => {
            if (!assetId || !attachmentTypeId || !name) return;
            void onCreate({ assetId, attachmentTypeId, name, description }).then(() => {
              setAssetId('');
              setPickedFilename(null);
              setAttachmentTypeId('');
              setName('');
              setDescription('');
            });
          }}
        >
          {t('productEditor.attachments.action.add')}
        </Button>
      </div>
      </div>
    </div>
  );
}

