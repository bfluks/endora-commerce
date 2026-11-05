import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AssetDetail } from '@endora-commerce/contracts';
import { renderWithI18n } from '../helpers/render-with-i18n';

/**
 * `specs/156-asset-stable-url/` T069 — `AssetUploader` gains `upload` (the
 * request a caller makes instead of the default upload — the Library's replace)
 * and `accept` (the whole `accept` attribute). Without either it behaves as
 * `kit-asset-picker.test.tsx` pins.
 */

const { AssetUploader } = await import('@endora-commerce/admin-kit/components');

const CORE_EN = JSON.parse(
  readFileSync(resolve(process.cwd(), '../packages/modules/_i18n/i18n/en.json'), 'utf8'),
) as Record<string, string>;
const bundle = { core: CORE_EN };

const DETAIL = { id: 'a-1', filename: 'certificate.pdf' } as unknown as AssetDetail;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AssetUploader — upload and accept props', () => {
  it('hands the chosen file to `upload` once, never to the default upload, and reports its result', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const upload = vi.fn(async () => DETAIL);
    const onUploaded = vi.fn();
    const { container } = renderWithI18n(
      <StrictMode>
        <AssetUploader upload={upload} onUploaded={onUploaded} />
      </StrictMode>,
      bundle,
    );
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['%PDF-1.4'], 'certificate.pdf', { type: 'application/pdf' });
    await userEvent.upload(input, file);
    await waitFor(() => expect(onUploaded).toHaveBeenCalledWith(DETAIL));
    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload).toHaveBeenCalledWith(file);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('sets the input’s accept attribute from `accept`', () => {
    const { container } = renderWithI18n(
      <AssetUploader accept="application/pdf" upload={async () => DETAIL} onUploaded={(): void => {}} />,
      bundle,
    );
    expect(container.querySelector('input[type="file"]')?.getAttribute('accept')).toBe('application/pdf');
  });

  it('keeps the acceptPrefix behaviour when neither prop is given', () => {
    const { container } = renderWithI18n(
      <AssetUploader acceptPrefix="image/" onUploaded={(): void => {}} />,
      bundle,
    );
    expect(container.querySelector('input[type="file"]')?.getAttribute('accept')).toBe('image/*');
  });
});
