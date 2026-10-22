// AdapterSettingsView impl that reads platform-global Library settings
// directly from the `settings` table (no per-channel scope, no cache). The
// reads are infrequent (once per upload / once per resolveUrl miss), so a
// direct DB hit is fine.
//
// AdapterRegistry consumes this view; we keep it separate to make the
// adapter side trivially mockable in tests.

import type { EntityManager } from '@mikro-orm/postgresql';
import { Setting } from '@endora-commerce/platform/kernel';
import { SettingValue } from '@endora-commerce/platform/kernel';
import type { AdapterSettingsView } from './adapter-registry.js';

const ADAPTER_CODES = ['local', 's3', 'gcs'] as const;

export function createSettingsView(
  emFactory: () => EntityManager,
): AdapterSettingsView & { softDeleteRetentionDays(): Promise<number> } {
  async function readString(code: string): Promise<string> {
    const em = emFactory();
    const setting = await em.findOne(Setting, { code });
    if (!setting) {
      throw new Error(`Assets Library settings: missing setting "${code}".`);
    }
    // Platform-global settings have no per-channel override in v1; the
    // setting_values table is empty for these codes. Returning defaultValue
    // is the correct behaviour.
    const override = await em.findOne(SettingValue, { setting: setting });
    const raw = override ? override.value : setting.defaultValue;
    return typeof raw === 'string' ? raw : String(raw ?? '');
  }
  async function readNumber(code: string, fallback: number): Promise<number> {
    const em = emFactory();
    const setting = await em.findOne(Setting, { code });
    if (!setting) return fallback;
    const override = await em.findOne(SettingValue, { setting: setting });
    const raw = override ? override.value : setting.globalValue ?? setting.defaultValue;
    // Only a number, or a string that spells one, is a value: `Number('')`,
    // `Number(null)` and `Number([])` are 0, which is not what an empty setting
    // means (FR-035 — a missing or non-numeric value applies as the fallback).
    const n =
      typeof raw === 'number'
        ? raw
        : typeof raw === 'string' && raw.trim() !== ''
          ? Number(raw)
          : Number.NaN;
    return Number.isFinite(n) ? n : fallback;
  }

  return {
    async softDeleteRetentionDays() {
      // At least one day (owner ruling P3, specs/156-asset-stable-url/): a zero
      // setting must not make a deletion or a replaced file due at once.
      const days = await readNumber('assets.soft_delete_retention_days', 30);
      return days >= 0 ? Math.max(1, days) : 30;
    },
    async activeAdapter() {
      const v = (await readString('assets.storage.adapter')).trim();
      if ((ADAPTER_CODES as readonly string[]).includes(v)) {
        return v as 'local' | 's3' | 'gcs';
      }
      return 'local';
    },
    localBaseDir() {
      return readString('assets.local.base_dir');
    },
    localPublicUrlBase() {
      return readString('assets.local.public_url_base');
    },
    privateUrlTtlSec() {
      return readNumber('assets.private_url_ttl_sec', 300);
    },
    async s3Config() {
      return {
        bucket: await readString('assets.s3.bucket'),
        region: await readString('assets.s3.region'),
        accessKeyId: await readString('assets.s3.access_key_id'),
        secretAccessKey: await readString('assets.s3.secret_access_key'),
        endpoint: await readString('assets.s3.endpoint'),
        prefix: await readString('assets.s3.prefix'),
        publicBaseUrl: await readString('assets.s3.public_base_url'),
      };
    },
    async gcsConfig() {
      return {
        bucket: await readString('assets.gcs.bucket'),
        serviceAccountJson: await readString('assets.gcs.service_account_json'),
        prefix: await readString('assets.gcs.prefix'),
        publicBaseUrl: await readString('assets.gcs.public_base_url'),
      };
    },
  };
}
