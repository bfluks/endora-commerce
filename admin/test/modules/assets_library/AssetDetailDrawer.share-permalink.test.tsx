import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ASSET_ID, detail, drawerUi, en, mockClient, refusal, renderDrawer } from './drawer-fixtures';

/**
 * `specs/156-asset-stable-url/` T071 — the shareable link and the permalink
 * controls of the asset detail drawer (FR-018 – FR-021, FR-026, owner ruling P5;
 * contracts/admin-surfaces.md §3).
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
const READ = ['assets.read'];
const PERMALINK_URL = 'https://api.example.test/assets/file/docs/certificate.pdf';

function render(permissions: readonly string[] = WRITE) {
  return renderDrawer(<AssetDetailDrawer assetId={ASSET_ID} onChanged={vi.fn()} onClose={vi.fn()} />, permissions);
}

beforeEach(() => {
  client.current = mockClient();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AssetDetailDrawer — shareable link', () => {
  it('shows the file URL when no permalink is set, never the embed URL', async () => {
    client.current!.getAsset.mockResolvedValue(detail());
    render();
    const link = await screen.findByLabelText(en('detail.shareUrl.label'));
    expect((link as HTMLInputElement).value).toBe(detail().fileUrl);
    expect(screen.queryByDisplayValue(detail().url)).toBeNull();
  });

  it('shows the permalink URL when one is set, and copies it once', async () => {
    client.current!.getAsset.mockResolvedValue(detail({ permalink: 'docs/certificate.pdf', permalinkUrl: PERMALINK_URL }));
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText');
    render();
    const link = await screen.findByLabelText(en('detail.shareUrl.label'));
    expect((link as HTMLInputElement).value).toBe(PERMALINK_URL);
    await user.click(screen.getByRole('button', { name: en('detail.shareUrl.copy') }));
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(PERMALINK_URL);
    expect(await screen.findByText(en('detail.shareUrl.copied'))).toBeInTheDocument();
  });

  it('says the copy failed when the clipboard refuses, without an unhandled rejection', async () => {
    client.current!.getAsset.mockResolvedValue(detail());
    const user = userEvent.setup();
    render();
    await screen.findByLabelText(en('detail.shareUrl.label'));
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);
    try {
      await user.click(screen.getByRole('button', { name: en('detail.shareUrl.copy') }));
      expect(await screen.findByText(en('detail.shareUrl.copyFailed'))).toBeInTheDocument();
      await new Promise((resolve) => setTimeout(resolve, 20));
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
    expect(unhandled).toEqual([]);
    expect(screen.queryByText(en('detail.shareUrl.copied'))).toBeNull();
  });

  it('says the copy failed when there is no clipboard at all', async () => {
    client.current!.getAsset.mockResolvedValue(detail());
    const user = userEvent.setup();
    render();
    await screen.findByLabelText(en('detail.shareUrl.label'));
    const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    try {
      await user.click(screen.getByRole('button', { name: en('detail.shareUrl.copy') }));
      expect(await screen.findByText(en('detail.shareUrl.copyFailed'))).toBeInTheDocument();
    } finally {
      if (original) Object.defineProperty(navigator, 'clipboard', original);
      else delete (navigator as unknown as Record<string, unknown>)['clipboard'];
    }
  });

  it('says a private asset’s link is not publicly reachable', async () => {
    client.current!.getAsset.mockResolvedValue(detail({ visibility: 'private' }));
    render();
    expect(await screen.findByText(en('detail.shareUrl.privateNotice'))).toBeInTheDocument();
  });
});

describe('AssetDetailDrawer — permalink', () => {
  it('validates as you type: a//b shows the invalid_segment sentence and disables Save', async () => {
    client.current!.getAsset.mockResolvedValue(detail());
    const user = userEvent.setup();
    render();
    const input = await screen.findByLabelText(en('detail.permalink.label'));
    await user.type(input, 'a//b');
    expect(screen.getByText(en('detail.permalink.invalid.invalid_segment'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: en('detail.permalink.save') })).toBeDisabled();
  });

  it('describes the input by its help and, when invalid, by an announced error too; no literal placeholder', async () => {
    client.current!.getAsset.mockResolvedValue(detail());
    const user = userEvent.setup();
    render();
    const input = await screen.findByLabelText(en('detail.permalink.label'));
    expect(input).not.toHaveAttribute('placeholder');
    const ids = (): string[] => (input.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
    expect(ids().map((id) => document.getElementById(id)?.textContent)).toEqual([en('detail.permalink.help')]);
    await user.type(input, 'a//b');
    const texts = ids().map((id) => document.getElementById(id)?.textContent);
    expect(texts).toEqual([en('detail.permalink.help'), en('detail.permalink.invalid.invalid_segment')]);
    const error = screen.getByText(en('detail.permalink.invalid.invalid_segment'));
    expect(error.closest('[aria-live="polite"]')).not.toBeNull();
  });

  it('lets an asset take back its own former permalink without a dialog', async () => {
    client.current!.getAsset.mockResolvedValue(detail());
    client.current!.setPermalink.mockResolvedValue(detail({ permalink: 'docs/own.pdf', permalinkUrl: PERMALINK_URL }));
    const user = userEvent.setup();
    render();
    await user.type(await screen.findByLabelText(en('detail.permalink.label')), 'docs/own.pdf');
    await user.click(screen.getByRole('button', { name: en('detail.permalink.save') }));
    await waitFor(() => expect(client.current!.setPermalink).toHaveBeenCalledTimes(1));
    expect(client.current!.setPermalink.mock.calls[0]).toEqual([ASSET_ID, 'docs/own.pdf']);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('starts empty for another asset: a draft typed for one never reaches the next', async () => {
    const OTHER_ID = '7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f';
    client.current!.getAsset.mockImplementation(async (id: string) => detail({ id, filename: `${id}.pdf` }));
    client.current!.setPermalink.mockImplementation(async (id: string, permalink: string) =>
      detail({ id, permalink, permalinkUrl: PERMALINK_URL }),
    );
    const user = userEvent.setup();
    const view = render();
    await user.type(await screen.findByLabelText(en('detail.permalink.label')), 'draft/for-a.pdf');
    view.rerender(drawerUi(<AssetDetailDrawer assetId={OTHER_ID} onChanged={vi.fn()} onClose={vi.fn()} />, WRITE));
    await screen.findByDisplayValue(`${OTHER_ID}.pdf`);
    const input = screen.getByLabelText(en('detail.permalink.label')) as HTMLInputElement;
    expect(input.value).toBe('');
    expect(screen.getByRole('button', { name: en('detail.permalink.save') })).toBeDisabled();
    expect(client.current!.setPermalink).not.toHaveBeenCalled();
  });

  it('saves a new permalink once', async () => {
    client.current!.getAsset.mockResolvedValue(detail());
    client.current!.setPermalink.mockResolvedValue(detail({ permalink: 'docs/certificate.pdf', permalinkUrl: PERMALINK_URL }));
    const user = userEvent.setup();
    render();
    await user.type(await screen.findByLabelText(en('detail.permalink.label')), 'docs/certificate.pdf');
    await user.click(screen.getByRole('button', { name: en('detail.permalink.save') }));
    await waitFor(() => expect(client.current!.setPermalink).toHaveBeenCalledTimes(1));
    expect(client.current!.setPermalink).toHaveBeenCalledWith(ASSET_ID, 'docs/certificate.pdf');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('asks before changing or removing a set permalink, and Cancel sends nothing', async () => {
    client.current!.getAsset.mockResolvedValue(detail({ permalink: 'docs/certificate.pdf', permalinkUrl: PERMALINK_URL }));
    const user = userEvent.setup();
    render();
    const input = await screen.findByLabelText(en('detail.permalink.label'));
    await user.clear(input);
    await user.type(input, 'docs/certificate-2026.pdf');
    await user.click(screen.getByRole('button', { name: en('detail.permalink.save') }));
    const change = await screen.findByRole('dialog', { name: en('detail.permalink.changeTitle') });
    expect(within(change).getByText(en('detail.permalink.changeBody', { oldUrl: PERMALINK_URL }))).toBeInTheDocument();
    await user.click(within(change).getByRole('button', { name: EN_CANCEL }));
    expect(screen.queryByRole('dialog')).toBeNull();

    await user.click(screen.getByRole('button', { name: en('detail.permalink.remove') }));
    const remove = await screen.findByRole('dialog', { name: en('detail.permalink.removeTitle') });
    expect(within(remove).getByText(en('detail.permalink.removeBody', { oldUrl: PERMALINK_URL }))).toBeInTheDocument();
    await user.click(within(remove).getByRole('button', { name: EN_CANCEL }));
    expect(client.current!.setPermalink).not.toHaveBeenCalled();
    expect(client.current!.removePermalink).not.toHaveBeenCalled();
  });

  it('asks before taking a name another asset used, and Use it anyway re-sends with confirmReuse once', async () => {
    client.current!.getAsset.mockResolvedValue(detail());
    client.current!.setPermalink
      .mockRejectedValueOnce(
        refusal(409, 'ASSET_PERMALINK_PREVIOUSLY_USED', 'used before', {
          permalink: 'docs/sheet.pdf',
          releasedAt: '2026-10-10T10:00:00.000Z',
        }),
      )
      .mockResolvedValueOnce(detail({ permalink: 'docs/sheet.pdf', permalinkUrl: PERMALINK_URL }));
    const user = userEvent.setup();
    render();
    await user.type(await screen.findByLabelText(en('detail.permalink.label')), 'docs/sheet.pdf');
    await user.click(screen.getByRole('button', { name: en('detail.permalink.save') }));
    const reuse = await screen.findByRole('dialog', { name: en('detail.permalink.reuseTitle') });
    expect(within(reuse).getByText(/docs\/sheet\.pdf/)).toBeInTheDocument();
    await user.click(within(reuse).getByRole('button', { name: en('detail.permalink.reuseConfirm') }));
    await waitFor(() => expect(client.current!.setPermalink).toHaveBeenCalledTimes(2));
    expect(client.current!.setPermalink).toHaveBeenLastCalledWith(ASSET_ID, 'docs/sheet.pdf', { confirmReuse: true });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('asks without a date when the refusal names none', async () => {
    client.current!.getAsset.mockResolvedValue(detail());
    client.current!.setPermalink.mockRejectedValueOnce(
      refusal(409, 'ASSET_PERMALINK_PREVIOUSLY_USED', 'used before', { permalink: 'docs/sheet.pdf' }),
    );
    const user = userEvent.setup();
    render();
    await user.type(await screen.findByLabelText(en('detail.permalink.label')), 'docs/sheet.pdf');
    await user.click(screen.getByRole('button', { name: en('detail.permalink.save') }));
    const reuse = await screen.findByRole('dialog', { name: en('detail.permalink.reuseTitle') });
    expect(within(reuse).getByText(en('detail.permalink.reuseBodyNoDate', { permalink: 'docs/sheet.pdf' }))).toBeInTheDocument();
  });

  it('Cancel on the reuse dialog sends nothing more', async () => {
    client.current!.getAsset.mockResolvedValue(detail());
    client.current!.setPermalink.mockRejectedValueOnce(
      refusal(409, 'ASSET_PERMALINK_PREVIOUSLY_USED', 'used before', {
        permalink: 'docs/sheet.pdf',
        releasedAt: '2026-10-10T10:00:00.000Z',
      }),
    );
    const user = userEvent.setup();
    render();
    await user.type(await screen.findByLabelText(en('detail.permalink.label')), 'docs/sheet.pdf');
    await user.click(screen.getByRole('button', { name: en('detail.permalink.save') }));
    const reuse = await screen.findByRole('dialog', { name: en('detail.permalink.reuseTitle') });
    await user.click(within(reuse).getByRole('button', { name: EN_CANCEL }));
    expect(client.current!.setPermalink).toHaveBeenCalledTimes(1);
  });

  it('shows the server message for a name another asset holds', async () => {
    client.current!.getAsset.mockResolvedValue(detail());
    client.current!.setPermalink.mockRejectedValueOnce(
      refusal(409, 'ASSET_PERMALINK_TAKEN', 'The permalink "docs/x.pdf" is already used by another asset.'),
    );
    const user = userEvent.setup();
    render();
    await user.type(await screen.findByLabelText(en('detail.permalink.label')), 'docs/x.pdf');
    await user.click(screen.getByRole('button', { name: en('detail.permalink.save') }));
    expect(await screen.findByText('The permalink "docs/x.pdf" is already used by another asset.')).toBeInTheDocument();
  });

  it('is read-only without assets.write: no Save, no Remove', async () => {
    client.current!.getAsset.mockResolvedValue(detail({ permalink: 'docs/certificate.pdf', permalinkUrl: PERMALINK_URL }));
    render(READ);
    const input = await screen.findByLabelText(en('detail.permalink.label'));
    expect(input).toHaveAttribute('readonly');
    expect(screen.queryByRole('button', { name: en('detail.permalink.save') })).toBeNull();
    expect(screen.queryByRole('button', { name: en('detail.permalink.remove') })).toBeNull();
  });
});

const EN_CANCEL = en('common.cancel');
