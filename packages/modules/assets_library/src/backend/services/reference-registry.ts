// AssetReferenceRegistry — feature 013 / research.md R10 / contracts/
// assets-library-reference-registry.contract.md.
//
// In-process registry of "who points at this asset" descriptors. Catalog
// (4 FK descriptors) and CMS (1 jsonb-body-scan descriptor) register at
// composition time. The Library consults the registry before every
// soft-delete attempt (FR-030).

import type {
  AssetReference,
  AssetReferenceDescriptor,
  AssetReferenceHit,
  AssetReferenceRegistryPort,
} from '@endora-commerce/contracts';

/**
 * Both shapes moved to `@endora-commerce/contracts` in feature 075's Phase P — four
 * modules contribute a descriptor, so the descriptor is a boundary shape and
 * not an internal. Re-exported here for the length of Phase P, which cuts no
 * consumer.
 */
export type { AssetReference, AssetReferenceDescriptor, AssetReferenceHit };

/**
 * Enumeration policy: **honoured** while the contributing module is absent
 * (feature 072, D-39).
 *
 * D-39's default is to skip, and honouring needs a written reason. This registry
 * is referential integrity, not a surface. If `blog` is switched off its posts
 * still exist and still embed assets; skipping `blog`'s scanner would let an
 * operator delete an asset that comes back as a broken image the moment `blog`
 * is switched on again — a data loss caused by an action Constitution XVII
 * promises is non-destructive and reversible.
 *
 * `skip` is right for surface-like contributions — an interceptor, a palette
 * action, a storefront element — where a switched-off module must contribute
 * nothing a user can see. Nobody sees these; they exist to refuse a delete.
 *
 * The owner is recorded on every descriptor even though this registry does not
 * filter on it, because the alternative is a registry that could not express the
 * decision either way, and because it attributes a 409 to a module.
 */
export class AssetReferenceRegistry implements AssetReferenceRegistryPort {
  private readonly descriptors: AssetReferenceDescriptor[] = [];

  register(d: AssetReferenceDescriptor): void {
    if (!this.descriptors.includes(d)) {
      this.descriptors.push(d);
    }
  }

  /** The contributing module of every registered descriptor, in registration order. */
  owners(): readonly string[] {
    return this.descriptors.map((d) => d.ownerModuleId);
  }

  /**
   * The descriptors split by whether their references hide an asset from a
   * reader who may not see the referencing record (feature 166, FR-003) —
   * `AssetVisibility`'s question, which reads the descriptors through this
   * class and never through the port. Registration order is kept in each half.
   */
  partition(): {
    readonly restricted: readonly AssetReferenceDescriptor[];
    readonly unrestricted: readonly AssetReferenceDescriptor[];
  } {
    return {
      restricted: this.descriptors.filter((d) => d.readerRestriction !== undefined),
      unrestricted: this.descriptors.filter((d) => d.readerRestriction === undefined),
    };
  }

  /**
   * Every descriptor, in registration order — the order `findReferences`
   * answers in, which the detail's filtered "used by" list keeps (feature 166,
   * US3), so a reader who sees every reference sees today's list.
   */
  inRegistrationOrder(): readonly AssetReferenceDescriptor[] {
    return [...this.descriptors];
  }

  async findReferences(assetId: string): Promise<AssetReferenceHit[]> {
    const all = await Promise.all(
      this.descriptors.map((d) => d.findReferences([assetId])),
    );
    return all.flat();
  }

  async findReferencesMany(
    assetIds: string[],
  ): Promise<Map<string, AssetReferenceHit[]>> {
    const out = new Map<string, AssetReferenceHit[]>();
    for (const id of assetIds) out.set(id, []);
    if (assetIds.length === 0) return out;
    const perDescriptor = await Promise.all(
      this.descriptors.map((d) => this.referencesOf(d, assetIds)),
    );
    for (const answer of perDescriptor) {
      for (const [id, hits] of answer) out.get(id)?.push(...hits);
    }
    return out;
  }

  /**
   * One descriptor's references to these assets, attributed to each asset —
   * every id asked for is a key (feature 166, research R-6; issue #535).
   *
   * The descriptor is asked **once** for the batch and its hits are attributed
   * by `hit.assetId`. A descriptor that returns a hit without one (an
   * overlay's, a package's written before the field existed) cannot be
   * attributed from a batch of more than one asset, so that descriptor alone
   * is asked again one asset at a time: the answer is right whatever the
   * contributor did, and only the contributor that did not tag pays for it.
   * A batch of one needs no second call — every hit is that asset's.
   */
  async referencesOf(
    descriptor: AssetReferenceDescriptor,
    assetIds: readonly string[],
  ): Promise<Map<string, AssetReferenceHit[]>> {
    const ids = [...new Set(assetIds)];
    const out = new Map<string, AssetReferenceHit[]>(ids.map((id) => [id, []]));
    if (ids.length === 0) return out;
    const hits = await descriptor.findReferences([...ids]);
    if (ids.length === 1) {
      out.set(ids[0]!, hits);
      return out;
    }
    if (hits.every((hit) => hit.assetId !== undefined)) {
      for (const hit of hits) out.get(hit.assetId!)?.push(hit);
      return out;
    }
    for (const id of ids) {
      out.set(id, await descriptor.findReferences([id]));
    }
    return out;
  }
}
