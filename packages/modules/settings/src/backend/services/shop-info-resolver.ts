import type { ShopInfo } from '@endora-commerce/contracts';
import type { SettingsReadPort } from '@endora-commerce/platform/kernel';

/**
 * Maps the `shop.*` settings to the public {@link ShopInfo} surface consumed
 * by the storefront. Every text field degrades to an empty string when the
 * setting is unset, out of scope, or not registered — the storefront decides
 * what to render, and a missing setting must never 500 a public page.
 * `logoUrl` degrades to `null` and `socialProfiles` to `[]` the same way.
 */
type TextField = 'name' | 'address' | 'contactEmail' | 'supportEmail' | 'phone';

const FIELD_TO_CODE: Record<TextField, string> = {
  name: 'shop.name',
  address: 'shop.address',
  contactEmail: 'shop.contact_email',
  supportEmail: 'shop.support_email',
  phone: 'shop.phone',
};

/** Feature 163 (FR-035; research R-20). */
export const SHOP_LOGO_ASSET_ID = 'shop.logo_asset_id';
export const SHOP_SOCIAL_PROFILES = 'shop.social_profiles';

/**
 * How an asset id becomes the public URL `Organization.logo` carries, or
 * `null` when it does not resolve to a public asset. Supplied by the
 * composition over `assets_library`' port, so this class stays testable over a
 * stub.
 */
export type ShopLogoUrlResolver = (assetId: string) => Promise<string | null>;

export class ShopInfoResolver {
  constructor(
    private readonly settingsService: SettingsReadPort,
    private readonly resolveLogoUrl: ShopLogoUrlResolver = async () => null,
  ) {}

  /**
   * Feature 075 / D-87 — the resolved request channel's id, passed in by the
   * route. It used to be the channel *code*, looked back up here with a raw
   * `select id from sales_channels`: a re-resolution of a channel the resolver
   * middleware had already resolved (feature 053, FR-011), across a boundary
   * no import specifier named.
   */
  async resolve(salesChannelId: string): Promise<ShopInfo> {
    const codes = [...Object.values(FIELD_TO_CODE), SHOP_LOGO_ASSET_ID, SHOP_SOCIAL_PROFILES];
    const resolved = await this.settingsService.getMany(codes, salesChannelId);

    const text = (code: string): string => {
      const r = resolved.get(code);
      return r && r.ok && typeof r.value === 'string' ? r.value : '';
    };

    const logoAssetId = text(SHOP_LOGO_ASSET_ID).trim();
    const profiles = resolved.get(SHOP_SOCIAL_PROFILES);

    return {
      name: text(FIELD_TO_CODE.name),
      address: text(FIELD_TO_CODE.address),
      contactEmail: text(FIELD_TO_CODE.contactEmail),
      supportEmail: text(FIELD_TO_CODE.supportEmail),
      phone: text(FIELD_TO_CODE.phone),
      logoUrl: logoAssetId.length > 0 ? await this.resolveLogoUrl(logoAssetId) : null,
      // Filtered on read as well as refused on write: a value stored before the
      // validator existed must not reach `sameAs` either.
      socialProfiles:
        profiles && profiles.ok && Array.isArray(profiles.value)
          ? profiles.value.filter((entry): entry is string => typeof entry === 'string' && isHttpsUrl(entry))
          : [],
    };
  }
}

/** An absolute `https:` URL — the only form `shop.social_profiles` accepts. */
export function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}
