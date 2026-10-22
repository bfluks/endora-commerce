import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ASSET_ID, core, detail, en, mockClient, refusal, renderDrawer } from './drawer-fixtures';

/**
 * `specs/156-asset-stable-url/` T072 — **Replace file** in the asset detail
 * drawer (FR-001, FR-006, FR-009, FR-026; contracts/admin-surfaces.md §3).
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

function render(permissions: readonly string[] = WRITE) {
  return renderDrawer(<AssetDetailDrawer assetId={ASSET_ID} onChanged={vi.fn()} onClose={vi.fn()} />, permissions);
}

function fileInput(container: HTMLElement): HTMLInputElement {
  return container.querySelector('input[type="file"]') as HTMLInputElement;
}

const NEW_PDF = new File(['%PDF-1.4 new'], 'certificate-2026.pdf', { type: 'application/pdf' });

beforeEach(() => {
  client.current = mockClient();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AssetDetailDrawer — replace file', () => {
  it('is absent without assets.write', async () => {
    client.current!.getAsset.mockResolvedValue(detail());
    render(['assets.read']);
    await screen.findByText(en('detail.title'));
    expect(screen.queryByRole('button', { name: en('detail.replace.trigger') })).toBeNull();
  });

  // Owner ruling S3: a legacy row or one with no storage key cannot be replaced
  // in place; the drawer offers no Replace file and says why.
  it('offers no Replace file for an asset the detail marks not replaceable, and says to upload a new one', async () => {
    client.current!.getAsset.mockResolvedValue(detail({ replaceable: false, storageBackend: 'local' }));
    const { container } = render();
    await screen.findByText(en('detail.title'));
    expect(screen.queryByRole('button', { name: en('detail.replace.trigger') })).toBeNull();
    expect(container.querySelector('input[type="file"]')).toBeNull();
    expect(screen.getByText(en('detail.replace.unavailable'))).toBeInTheDocument();
  });

  it('accepts only the asset’s own kind, confirms naming both files and the retention, then replaces once and shows the answer', async () => {
    client.current!.getAsset.mockResolvedValue(detail({ retentionDays: 14 }));
    client.current!.replaceAsset.mockResolvedValue(
      detail({ filename: 'certificate-2026.pdf', contentVersion: 'ffffffffffff', retentionDays: 14 }),
    );
    const user = userEvent.setup();
    const { container } = render();
    await screen.findByRole('button', { name: en('detail.replace.trigger') });
    expect(fileInput(container).getAttribute('accept')).toBe('application/pdf');

    await user.upload(fileInput(container), NEW_PDF);
    const dialog = await screen.findByRole('dialog', { name: en('detail.replace.confirmTitle') });
    expect(
      within(dialog).getByText(
        en('detail.replace.confirmBody', { currentFilename: 'certificate.pdf', newFilename: 'certificate-2026.pdf', retentionDays: 14 }),
      ),
    ).toBeInTheDocument();
    expect(client.current!.replaceAsset).not.toHaveBeenCalled();
    const fetches = client.current!.getAsset.mock.calls.length;

    await user.click(within(dialog).getByRole('button', { name: en('detail.replace.confirm') }));
    await waitFor(() => expect(client.current!.replaceAsset).toHaveBeenCalledTimes(1));
    expect(client.current!.replaceAsset).toHaveBeenCalledWith(ASSET_ID, NEW_PDF, 'a1b2c3d4e5f6');
    // US1-1: the drawer shows the server's answer — the new filename — without fetching again.
    expect(await screen.findByDisplayValue('certificate-2026.pdf')).toBeInTheDocument();
    expect(client.current!.getAsset.mock.calls.length).toBe(fetches);
  });

  it('keeps the trigger’s own label while the confirmation is open, not "Uploading…"', async () => {
    client.current!.getAsset.mockResolvedValue(detail());
    const user = userEvent.setup();
    const { container } = render();
    await screen.findByRole('button', { name: en('detail.replace.trigger') });
    await user.upload(fileInput(container), NEW_PDF);
    await screen.findByRole('dialog', { name: en('detail.replace.confirmTitle') });
    expect(screen.getByRole('button', { name: en('detail.replace.trigger') })).toBeEnabled();
    expect(screen.queryAllByText(core('assetPicker.upload.uploading'))).toEqual([]);
  });

  it.each([
    ['image/png', 'image/*'],
    ['image/svg+xml', 'image/*'],
    ['video/mp4', 'video/*'],
  ])('accepts %s assets as %s', async (mimeType, accept) => {
    client.current!.getAsset.mockResolvedValue(detail({ mimeType, filename: 'photo' }));
    const { container } = render();
    await screen.findByRole('button', { name: en('detail.replace.trigger') });
    expect(fileInput(container).getAttribute('accept')).toBe(accept);
  });

  it('sets no accept attribute for an asset of another kind', async () => {
    client.current!.getAsset.mockResolvedValue(detail({ mimeType: 'application/zip', filename: 'bundle.zip' }));
    const { container } = render();
    await screen.findByRole('button', { name: en('detail.replace.trigger') });
    expect(fileInput(container).hasAttribute('accept')).toBe(false);
  });

  it('refuses a dropped file of the wrong kind for an image asset before asking or sending', async () => {
    client.current!.getAsset.mockResolvedValue(detail({ mimeType: 'image/png', filename: 'photo.png' }));
    const { container } = render();
    await screen.findByRole('button', { name: en('detail.replace.trigger') });
    const zone = fileInput(container).parentElement as HTMLElement;
    fireEvent.drop(zone, { dataTransfer: { files: [NEW_PDF] } });
    expect(
      await screen.findByText(core('assetPicker.upload.error.wrongType', { expected: 'image', actual: 'application/pdf' })),
    ).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(client.current!.replaceAsset).not.toHaveBeenCalled();
  });

  it('Escape on the confirmation replaces nothing', async () => {
    client.current!.getAsset.mockResolvedValue(detail());
    const user = userEvent.setup();
    const { container } = render();
    await screen.findByRole('button', { name: en('detail.replace.trigger') });
    await user.upload(fileInput(container), NEW_PDF);
    await screen.findByRole('dialog', { name: en('detail.replace.confirmTitle') });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(client.current!.replaceAsset).not.toHaveBeenCalled();
  });

  it('confirms without a number when the detail carries no retention, never with a placeholder', async () => {
    const { retentionDays: _omit, ...withoutRetention } = detail();
    client.current!.getAsset.mockResolvedValue(withoutRetention);
    const user = userEvent.setup();
    const { container } = render();
    await screen.findByRole('button', { name: en('detail.replace.trigger') });
    await user.upload(fileInput(container), NEW_PDF);
    const dialog = await screen.findByRole('dialog', { name: en('detail.replace.confirmTitle') });
    expect(
      within(dialog).getByText(
        en('detail.replace.confirmBodyNoRetention', { currentFilename: 'certificate.pdf', newFilename: 'certificate-2026.pdf' }),
      ),
    ).toBeInTheDocument();
    expect(dialog.textContent).not.toMatch(/…|undefined|\{retentionDays\}/);
  });

  it('Cancel on the confirmation replaces nothing', async () => {
    client.current!.getAsset.mockResolvedValue(detail());
    const user = userEvent.setup();
    const { container } = render();
    await screen.findByRole('button', { name: en('detail.replace.trigger') });
    await user.upload(fileInput(container), NEW_PDF);
    const dialog = await screen.findByRole('dialog', { name: en('detail.replace.confirmTitle') });
    await user.click(within(dialog).getByRole('button', { name: en('common.cancel') }));
    expect(client.current!.replaceAsset).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('says a kind mismatch in its own words, with translated kind names', async () => {
    client.current!.getAsset.mockResolvedValue(detail());
    client.current!.replaceAsset.mockRejectedValue(
      refusal(415, 'ASSET_REPLACE_KIND_MISMATCH', 'raw', { currentKind: 'pdf', newKind: 'image' }),
    );
    const user = userEvent.setup();
    const { container } = render();
    await screen.findByRole('button', { name: en('detail.replace.trigger') });
    await user.upload(fileInput(container), NEW_PDF);
    const dialog = await screen.findByRole('dialog', { name: en('detail.replace.confirmTitle') });
    await user.click(within(dialog).getByRole('button', { name: en('detail.replace.confirm') }));
    expect(
      await screen.findByText(
        en('detail.replace.kindMismatch', { currentKind: en('kind.pdf'), newKind: en('kind.image') }),
      ),
    ).toBeInTheDocument();
  });

  it('falls back to the server sentence for a kind mismatch without details, never "undefined"', async () => {
    client.current!.getAsset.mockResolvedValue(detail());
    client.current!.replaceAsset.mockRejectedValue(
      refusal(415, 'ASSET_REPLACE_KIND_MISMATCH', 'The file you chose is a different kind.'),
    );
    const user = userEvent.setup();
    const { container } = render();
    await screen.findByRole('button', { name: en('detail.replace.trigger') });
    await user.upload(fileInput(container), NEW_PDF);
    const dialog = await screen.findByRole('dialog', { name: en('detail.replace.confirmTitle') });
    await user.click(within(dialog).getByRole('button', { name: en('detail.replace.confirm') }));
    expect(await screen.findByText('The file you chose is a different kind.')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('undefined');
  });

  it('shows a translated generic sentence for an answer that is not an error envelope', async () => {
    client.current!.getAsset.mockResolvedValue(detail());
    client.current!.replaceAsset.mockRejectedValue(refusal(503, 'INTERNAL', 'HTTP 503'));
    const user = userEvent.setup();
    const { container } = render();
    await screen.findByRole('button', { name: en('detail.replace.trigger') });
    await user.upload(fileInput(container), NEW_PDF);
    const dialog = await screen.findByRole('dialog', { name: en('detail.replace.confirmTitle') });
    await user.click(within(dialog).getByRole('button', { name: en('detail.replace.confirm') }));
    expect(await screen.findByText(en('detail.error.generic'))).toBeInTheDocument();
    expect(screen.queryByText('HTTP 503')).toBeNull();
  });

  it('shows a conflict with the server sentence and a Reload that fetches the asset again', async () => {
    client.current!.getAsset.mockResolvedValue(detail());
    client.current!.replaceAsset.mockRejectedValue(
      refusal(409, 'ASSET_REPLACE_CONFLICT', "Someone else changed this asset's file while you were uploading."),
    );
    const user = userEvent.setup();
    const { container } = render();
    await screen.findByRole('button', { name: en('detail.replace.trigger') });
    await user.upload(fileInput(container), NEW_PDF);
    const dialog = await screen.findByRole('dialog', { name: en('detail.replace.confirmTitle') });
    await user.click(within(dialog).getByRole('button', { name: en('detail.replace.confirm') }));
    expect(await screen.findByText("Someone else changed this asset's file while you were uploading.")).toBeInTheDocument();
    const before = client.current!.getAsset.mock.calls.length;
    await user.click(screen.getByRole('button', { name: en('detail.replace.reload') }));
    await waitFor(() => expect(client.current!.getAsset.mock.calls.length).toBe(before + 1));
  });
});
