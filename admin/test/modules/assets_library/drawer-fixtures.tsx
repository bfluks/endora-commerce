import { StrictMode, type ReactElement } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { vi, type Mock } from 'vitest';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import type { AssetDetail } from '@endora-commerce/contracts';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, withSession } from '../../helpers/render-with-session';

/**
 * Shared fixtures for the asset detail drawer tests
 * (`specs/156-asset-stable-url/` T071 – T073): the module's **shipped** English
 * bundle, so every assertion names the sentence an operator reads, a detail
 * builder, a refusal builder, and a StrictMode render inside a session.
 */

export const EN = JSON.parse(
  readFileSync(resolve(process.cwd(), '../packages/modules/assets_library/i18n/en.json'), 'utf8'),
) as Record<string, string>;
export const CORE = JSON.parse(
  readFileSync(resolve(process.cwd(), '../packages/modules/_i18n/i18n/en.json'), 'utf8'),
) as Record<string, string>;

/** The English sentence for a key, with `{name}` placeholders filled. */
export function en(key: string, values: Record<string, string | number> = {}): string {
  const template = EN[key];
  if (template === undefined) throw new Error(`assets_library en.json has no ${key}`);
  return template.replace(/\{(\w+)\}/g, (_m, name: string) => String(values[name] ?? `{${name}}`));
}

/** The kit's (`core`) English sentence for a key, with `{name}` placeholders filled. */
export function core(key: string, values: Record<string, string | number> = {}): string {
  const template = CORE[key];
  if (template === undefined) throw new Error(`core en.json has no ${key}`);
  return template.replace(/\{(\w+)\}/g, (_m, name: string) => String(values[name] ?? `{${name}}`));
}

export const ASSET_ID = '0b8f3c1e-2d4a-4b6c-8e9f-1a2b3c4d5e6f';

export function detail(over: Partial<AssetDetail> = {}): AssetDetail {
  return {
    id: ASSET_ID,
    folderId: null,
    filename: 'certificate.pdf',
    label: null,
    mimeType: 'application/pdf',
    sizeBytes: 2048,
    visibility: 'public',
    storageBackend: 'local',
    url: `https://api.example.test/assets/file/${ASSET_ID}?v=a1b2c3d4e5f6`,
    fileUrl: `https://api.example.test/assets/file/${ASSET_ID}`,
    permalink: null,
    permalinkUrl: null,
    contentVersion: 'a1b2c3d4e5f6',
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
    deletedAt: null,
    pendingCleanup: false,
    altText: null,
    references: [],
    previousVersion: null,
    retentionDays: 30,
    replaceable: true,
    ...over,
  };
}

export function refusal(status: number, code: string, message: string, details?: Record<string, unknown>): ApiError {
  return new ApiError(status, { error: { code, message, ...(details ? { details } : {}) } } as never);
}

export interface MockClient {
  getAsset: Mock;
  patchAsset: Mock;
  softDeleteAsset: Mock;
  replaceAsset: Mock;
  restorePreviousVersion: Mock;
  setPermalink: Mock;
  removePermalink: Mock;
}

export function mockClient(): MockClient {
  return {
    getAsset: vi.fn(),
    patchAsset: vi.fn(),
    softDeleteAsset: vi.fn(),
    replaceAsset: vi.fn(),
    restorePreviousVersion: vi.fn(),
    setPermalink: vi.fn(),
    removePermalink: vi.fn(),
  };
}

/** The element `renderDrawer` mounts — also what a `rerender` passes. */
export function drawerUi(ui: ReactElement, permissions: readonly string[]): ReactElement {
  return withSession(<StrictMode>{ui}</StrictMode>, { session: adminSession({ permissions }) });
}

export function renderDrawer(ui: ReactElement, permissions: readonly string[]): ReturnType<typeof renderWithI18n> {
  return renderWithI18n(drawerUi(ui, permissions), { assets_library: EN, core: CORE });
}
