import { describe, expect, it, vi } from 'vitest';
import { ProductPageRevalidation } from './product-page-revalidation.js';

/**
 * Feature 163 (T155 finding CACHE-1) — after a committed write that can change
 * whether or where a product is available, the storefront's cached product-page
 * reads of that product are dropped by tag: every key they may have been asked
 * by (the product id, its slug, its URL keys and its former keys). Next keeps
 * only a `200`, so without this a product switched off went on showing.
 *
 * Coalesced: a bulk operation announces each product, and the storefront is
 * asked once per batch. Best-effort: nothing here may fail the write.
 */

const P1 = '00000000-0000-4000-8000-0000000000a1';
const P2 = '00000000-0000-4000-8000-0000000000a2';

function rig(keys: Record<string, string[]> = {}) {
  const revalidate = vi.fn(async (_tags: string[]) => undefined);
  const keysOf = vi.fn(async (ids: readonly string[]) => ids.flatMap((id) => keys[id] ?? []));
  const warn = vi.fn();
  const queued: Array<() => void> = [];
  const revalidation = new ProductPageRevalidation({
    revalidator: { enabled: true, revalidate },
    keysOf,
    log: { warn },
    schedule: (run) => queued.push(run),
  });
  const runQueued = async (): Promise<void> => {
    for (const run of queued.splice(0)) run();
    await revalidation.idle();
  };
  return { revalidation, revalidate, keysOf, warn, runQueued };
}

const tagsOf = (revalidate: ReturnType<typeof vi.fn>): string[] =>
  revalidate.mock.calls.flatMap(([tags]) => tags as string[]).sort();

describe('ProductPageRevalidation', () => {
  it('drops the reads asked by the product’s id, slug, URL keys and former keys', async () => {
    const { revalidation, revalidate, runQueued } = rig({ [P1]: ['wiertarka', 'drill', 'old-drill'] });
    revalidation.productChanged(P1);
    await runQueued();
    expect(tagsOf(revalidate)).toEqual(
      [`catalog:product:${P1}`, 'catalog:product:drill', 'catalog:product:old-drill', 'catalog:product:wiertarka'].sort(),
    );
  });

  it('asks the storefront once for every product announced in one batch', async () => {
    const { revalidation, revalidate, keysOf, runQueued } = rig({ [P1]: ['a'], [P2]: ['b'] });
    revalidation.productChanged(P1);
    revalidation.productChanged(P2);
    revalidation.productChanged(P1);
    await runQueued();
    expect(keysOf).toHaveBeenCalledTimes(1);
    expect(keysOf.mock.calls[0]?.[0]).toEqual([P1, P2]);
    expect(revalidate).toHaveBeenCalledTimes(1);
    expect(tagsOf(revalidate)).toEqual(
      [`catalog:product:${P1}`, `catalog:product:${P2}`, 'catalog:product:a', 'catalog:product:b'].sort(),
    );
  });

  it('drops every product-page read when a product is deleted (its keys are gone with it)', async () => {
    const { revalidation, revalidate, keysOf, runQueued } = rig();
    revalidation.productRemoved();
    await runQueued();
    expect(keysOf).not.toHaveBeenCalled();
    expect(tagsOf(revalidate)).toEqual(['catalog:product']);
  });

  it('still drops the id’s reads when its keys cannot be read, and logs it', async () => {
    const { revalidation, revalidate, keysOf, warn, runQueued } = rig();
    keysOf.mockRejectedValueOnce(new Error('db down'));
    revalidation.productChanged(P1);
    await runQueued();
    expect(tagsOf(revalidate)).toEqual([`catalog:product:${P1}`]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('never rejects when the storefront call fails', async () => {
    const { revalidation, revalidate, warn, runQueued } = rig();
    revalidate.mockRejectedValueOnce(new Error('unreachable'));
    revalidation.productChanged(P1);
    await expect(runQueued()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('leaves out a tag Next would drop for its length', async () => {
    const long = 'k'.repeat(300);
    const { revalidation, revalidate, runQueued } = rig({ [P1]: [long] });
    revalidation.productChanged(P1);
    await runQueued();
    expect(tagsOf(revalidate)).toEqual([`catalog:product:${P1}`]);
  });

  it('reads nothing and asks nothing while the storefront revalidator is not configured', async () => {
    const revalidate = vi.fn();
    const keysOf = vi.fn();
    const queued: Array<() => void> = [];
    const revalidation = new ProductPageRevalidation({
      revalidator: { enabled: false, revalidate },
      keysOf,
      schedule: (run) => queued.push(run),
    });
    revalidation.productChanged(P1);
    revalidation.productRemoved();
    expect(queued).toHaveLength(0);
    expect(keysOf).not.toHaveBeenCalled();
    expect(revalidate).not.toHaveBeenCalled();
  });
});
