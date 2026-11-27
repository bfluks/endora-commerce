import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { PRICING_SETTING_CODES } from '@endora-commerce/contracts';
import { SalesChannel, Setting, SettingValue } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { recreateLegacyIsPublic, runRetireIsPublic } from '../../helpers/retire-is-public-migration.js';

/**
 * Issue #492 — the migration that retires `sales_channels.is_public`.
 *
 * A non-public channel withheld prices from every viewer; the display-mode
 * chain says the same thing for anonymous visitors with
 * `pricing.unauthenticated_display_mode = none` on that channel. So the
 * migration writes that value for every channel that had `is_public = false`
 * and has no value of its own for the key, then drops the column:
 *
 *  - M1 `is_public = false`, no value of its own → `none`;
 *  - M2 `is_public = false` and an operator's own value → that value is kept;
 *  - M3 `is_public = true` → nothing is written;
 *  - M4 the column is gone;
 *  - M5 a database whose setting row is missing is refused, not migrated into
 *    a state that shows prices the channel withheld;
 *  - M6 `down` restores the column from the per-channel `none`.
 *
 * Every case runs in a transaction that is rolled back, so the database the
 * other files share never sees the recreated column or the probe channels.
 */
class RolledBack extends Error {}

async function inRolledBackTx(em: EntityManager, fn: (tx: EntityManager) => Promise<void>): Promise<void> {
  try {
    await em.fork().transactional(async (tx) => {
      await fn(tx);
      throw new RolledBack();
    });
  } catch (err) {
    if (!(err instanceof RolledBack)) throw err;
  }
}

const GUEST_MODE = PRICING_SETTING_CODES.UNAUTHENTICATED_DISPLAY_MODE;

describe('sales_channels.is_public is retired into the guest display mode (#492)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function probeChannel(tx: EntityManager, code: string): Promise<string> {
    const channel = tx.create(SalesChannel, {
      code,
      name: { 'en-US': code },
      languages: ['en-US'],
      defaultLanguage: 'en-US',
      currencies: ['PLN'],
      defaultCurrency: 'PLN',
    });
    await tx.flush();
    return channel.id;
  }

  async function guestValue(tx: EntityManager, channelId: string): Promise<unknown> {
    const rows = await tx.execute<Array<{ value: unknown }>>(
      `select v."value" from "setting_values" v join "settings" s on s."id" = v."setting_id"
        where s."code" = ? and v."sales_channel_id" = ?`,
      [GUEST_MODE, channelId],
    );
    return rows.length === 0 ? undefined : rows[0]!.value;
  }

  async function columnExists(tx: EntityManager): Promise<boolean> {
    const rows = await tx.execute<Array<{ n: string }>>(
      `select count(*)::text as n from information_schema.columns
        where table_name = 'sales_channels' and column_name = 'is_public'`,
    );
    return rows[0]!.n === '1';
  }

  it('M1–M4 — a non-public channel gets guest `none`, an own value is kept, a public channel is untouched, the column goes', async () => {
    await inRolledBackTx(h.em(), async (tx) => {
      const closed = await probeChannel(tx, 'm492-closed');
      const kept = await probeChannel(tx, 'm492-kept');
      const open = await probeChannel(tx, 'm492-open');
      const setting = await tx.findOneOrFail(Setting, { code: GUEST_MODE });
      tx.create(SettingValue, {
        setting,
        salesChannel: tx.getReference(SalesChannel, kept),
        value: 'gross_only',
      });
      await tx.flush();

      await recreateLegacyIsPublic(tx, [closed, kept]);
      await runRetireIsPublic(tx, 'up');

      expect(await guestValue(tx, closed)).toBe('none');
      expect(await guestValue(tx, kept)).toBe('gross_only');
      expect(await guestValue(tx, open)).toBeUndefined();
      expect(await columnExists(tx)).toBe(false);
    });
  });

  it('M5 — refuses to migrate a non-public channel when the setting row is missing', async () => {
    await inRolledBackTx(h.em(), async (tx) => {
      const closed = await probeChannel(tx, 'm492-orphan');
      await tx.execute(`delete from "settings" where "code" = ?`, [GUEST_MODE]);
      await recreateLegacyIsPublic(tx, [closed]);
      await expect(runRetireIsPublic(tx, 'up')).rejects.toThrow(/pricing\.unauthenticated_display_mode/);
    });
  });

  it('M5 control — with nothing non-public, a missing setting row is no obstacle', async () => {
    await inRolledBackTx(h.em(), async (tx) => {
      await probeChannel(tx, 'm492-orphan-open');
      await tx.execute(`delete from "settings" where "code" = ?`, [GUEST_MODE]);
      await recreateLegacyIsPublic(tx, []);
      await runRetireIsPublic(tx, 'up');
      expect(await columnExists(tx)).toBe(false);
    });
  });

  it('M6 — down restores the column: false where the channel holds guest `none`, true elsewhere', async () => {
    await inRolledBackTx(h.em(), async (tx) => {
      const closed = await probeChannel(tx, 'm492-down-closed');
      const open = await probeChannel(tx, 'm492-down-open');
      await recreateLegacyIsPublic(tx, [closed]);
      await runRetireIsPublic(tx, 'up');
      await runRetireIsPublic(tx, 'down');
      const rows = await tx.execute<Array<{ id: string; is_public: boolean }>>(
        `select "id", "is_public" from "sales_channels" where "id" in (?, ?)`,
        [closed, open],
      );
      const byId = new Map(rows.map((r) => [r.id, r.is_public]));
      expect(byId.get(closed)).toBe(false);
      expect(byId.get(open)).toBe(true);
    });
  });
});
