import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ASSET_ID, detail, en, mockClient, refusal, renderDrawer } from './drawer-fixtures';

/**
 * `specs/156-asset-stable-url/` T073 — the previous version section and the
 * soft-delete warning of the asset detail drawer (FR-020, FR-022, FR-023,
 * FR-026; contracts/admin-surfaces.md §3).
 */

const client = vi.hoisted(() => ({ current: null as ReturnType<typeof mockClient> | null }));
vi.mock('../../../../packages/modules/assets_library/src/admin/api/assets-library-client', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    assetsLibraryClient: new Proxy({}, { get: (_t, prop: string) => (client.current as unknown as Record<string, unknown>)[prop] }),
  };
});

const { AssetDetailDrawer } = await import(
  '../../../../packages/modules/assets_library/src/admin/components/AssetDetailDrawer'
);

const WRITE = ['assets.read', 'assets.write'];
const PREVIOUS = {
  filename: 'certificate-2025.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 1024,
  contentVersion: '0f1e2d3c4b5a',
  replacedAt: '2026-10-10T08:00:00.000Z',
  replacedBy: { id: '6c2a3d40-1111-4222-8333-444455556666', displayName: 'First Last' },
  restorableUntil: '2026-11-09T08:00:00.000Z',
};

function render(permissions: readonly string[] = WRITE, onClose = vi.fn()) {
  return renderDrawer(<AssetDetailDrawer assetId={ASSET_ID} onChanged={vi.fn()} onClose={onClose} />, permissions);
}

beforeEach(() => {
  client.current = mockClient();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AssetDetailDrawer — previous version', () => {
  it('lists the previous file, who replaced it and until when it can be restored', async () => {
    client.current!.getAsset.mockResolvedValue(detail({ previousVersion: PREVIOUS }));
    render();
    const section = await screen.findByRole('region', { name: en('detail.previous.title') });
    expect(within(section).getByText('certificate-2025.pdf')).toBeInTheDocument();
    expect(within(section).getByText('application/pdf')).toBeInTheDocument();
    expect(within(section).getByText('First Last')).toBeInTheDocument();
    expect(within(section).getByText(en('detail.previous.restorableUntil'))).toBeInTheDocument();
    expect(within(section).getByText(en('detail.previous.replacedAt'))).toBeInTheDocument();
  });

  it('names an unknown actor when replacedBy is null', async () => {
    client.current!.getAsset.mockResolvedValue(detail({ previousVersion: { ...PREVIOUS, replacedBy: null } }));
    render();
    const section = await screen.findByRole('region', { name: en('detail.previous.title') });
    expect(within(section).getByText(en('detail.previous.unknownActor'))).toBeInTheDocument();
  });

  it('restores through a dialog with both versions the drawer rendered, once', async () => {
    client.current!.getAsset.mockResolvedValue(detail({ previousVersion: PREVIOUS }));
    client.current!.restorePreviousVersion.mockResolvedValue(detail());
    const user = userEvent.setup();
    render();
    await user.click(await screen.findByRole('button', { name: en('detail.previous.restore') }));
    const dialog = await screen.findByRole('dialog', { name: en('detail.previous.confirmTitle') });
    expect(
      within(dialog).getByText(
        en('detail.previous.confirmBody', { previousFilename: 'certificate-2025.pdf', currentFilename: 'certificate.pdf' }),
      ),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: en('detail.previous.restore') }));
    await waitFor(() => expect(client.current!.restorePreviousVersion).toHaveBeenCalledTimes(1));
    expect(client.current!.restorePreviousVersion).toHaveBeenCalledWith(ASSET_ID, {
      expectedContentVersion: 'a1b2c3d4e5f6',
      expectedPreviousContentVersion: '0f1e2d3c4b5a',
    });
  });

  it('restores with the versions of the detail it rendered last — the one a replace answered', async () => {
    client.current!.getAsset.mockResolvedValue(detail());
    client.current!.replaceAsset.mockResolvedValue(
      detail({
        filename: 'certificate-2026.pdf',
        contentVersion: 'ffffffffffff',
        previousVersion: { ...PREVIOUS, filename: 'certificate.pdf', contentVersion: 'a1b2c3d4e5f6' },
      }),
    );
    client.current!.restorePreviousVersion.mockResolvedValue(detail());
    const user = userEvent.setup();
    const { container } = render();
    await screen.findByRole('button', { name: en('detail.replace.trigger') });
    await user.upload(
      container.querySelector('input[type="file"]') as HTMLInputElement,
      new File(['%PDF-1.4 new'], 'certificate-2026.pdf', { type: 'application/pdf' }),
    );
    const replace = await screen.findByRole('dialog', { name: en('detail.replace.confirmTitle') });
    await user.click(within(replace).getByRole('button', { name: en('detail.replace.confirm') }));
    await user.click(await screen.findByRole('button', { name: en('detail.previous.restore') }));
    const dialog = await screen.findByRole('dialog', { name: en('detail.previous.confirmTitle') });
    await user.click(within(dialog).getByRole('button', { name: en('detail.previous.restore') }));
    await waitFor(() => expect(client.current!.restorePreviousVersion).toHaveBeenCalledTimes(1));
    expect(client.current!.restorePreviousVersion).toHaveBeenCalledWith(ASSET_ID, {
      expectedContentVersion: 'ffffffffffff',
      expectedPreviousContentVersion: 'a1b2c3d4e5f6',
    });
  });

  it('shows a conflict with the server sentence and Reload', async () => {
    client.current!.getAsset.mockResolvedValue(detail({ previousVersion: PREVIOUS }));
    client.current!.restorePreviousVersion.mockRejectedValue(
      refusal(409, 'ASSET_REPLACE_CONFLICT', "Someone else changed this asset's file since you opened it."),
    );
    const user = userEvent.setup();
    render();
    await user.click(await screen.findByRole('button', { name: en('detail.previous.restore') }));
    const dialog = await screen.findByRole('dialog', { name: en('detail.previous.confirmTitle') });
    await user.click(within(dialog).getByRole('button', { name: en('detail.previous.restore') }));
    expect(await screen.findByText("Someone else changed this asset's file since you opened it.")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: en('detail.replace.reload') })).toBeInTheDocument();
  });

  it('has no section without a previous version, and no Restore without assets.write', async () => {
    client.current!.getAsset.mockResolvedValue(detail());
    const first = render();
    await screen.findByText(en('detail.title'));
    expect(screen.queryByRole('region', { name: en('detail.previous.title') })).toBeNull();
    first.unmount();

    client.current!.getAsset.mockResolvedValue(detail({ previousVersion: PREVIOUS }));
    render(['assets.read']);
    await screen.findByRole('region', { name: en('detail.previous.title') });
    expect(screen.queryByRole('button', { name: en('detail.previous.restore') })).toBeNull();
  });
});

describe('AssetDetailDrawer — soft delete with a permalink', () => {
  it('warns with the permalink URL before deleting', async () => {
    const permalinkUrl = 'https://api.example.test/assets/file/docs/certificate.pdf';
    client.current!.getAsset.mockResolvedValue(detail({ permalink: 'docs/certificate.pdf', permalinkUrl }));
    client.current!.softDeleteAsset.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render();
    await user.click(await screen.findByRole('button', { name: en('detail.softDelete') }));
    const dialog = await screen.findByRole('dialog', { name: en('detail.delete.permalinkTitle') });
    expect(within(dialog).getByText(en('detail.delete.permalinkBody', { permalinkUrl }))).toBeInTheDocument();
    expect(client.current!.softDeleteAsset).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: en('detail.softDelete') }));
    await waitFor(() => expect(client.current!.softDeleteAsset).toHaveBeenCalledTimes(1));
  });

  it('deletes directly without a permalink', async () => {
    client.current!.getAsset.mockResolvedValue(detail());
    client.current!.softDeleteAsset.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render();
    await user.click(await screen.findByRole('button', { name: en('detail.softDelete') }));
    await waitFor(() => expect(client.current!.softDeleteAsset).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
