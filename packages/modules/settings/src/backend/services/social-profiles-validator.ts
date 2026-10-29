import { ERROR_CODES, type SettingWriteValidator } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { isHttpsUrl, SHOP_SOCIAL_PROFILES } from './shop-info-resolver.js';

/**
 * Feature 163 (FR-035; data-model §1.4) — `shop.social_profiles` is published
 * as `Organization.sameAs`, so every entry must be an absolute `https:` URL. A
 * write carrying anything else is refused whole, on every write path — the
 * generic Settings screen and its API alike.
 */
export function createSocialProfilesValidator(): SettingWriteValidator {
  return {
    contributorModuleId: 'settings',
    codes: [SHOP_SOCIAL_PROFILES],
    async validate({ proposedValue }) {
      const entries = Array.isArray(proposedValue) ? (proposedValue as unknown[]) : [];
      const invalid = entries
        .map((entry, index) => ({ entry, index }))
        .filter(({ entry }) => typeof entry !== 'string' || !isHttpsUrl(entry));
      if (Array.isArray(proposedValue) && invalid.length === 0) return;
      throw new HttpError(
        422,
        ERROR_CODES.VALIDATION_FAILED,
        'Every social profile must be a full https:// address.',
        invalid.length > 0
          ? invalid.map(({ index }) => ({ path: `value.${index}`, issue: 'Expected an https:// URL' }))
          : [{ path: 'value', issue: 'Expected a list of https:// URLs' }],
      );
    },
  };
}
