import { describe, expect, it } from 'vitest';
import { parseChannelIdentity } from '../../lib/channel/channel-identity';

/**
 * Feature 167 (FR-004, FR-019) — the middleware's channel identity carries the URL
 * languages the backend derived. A body without them (a backend older than the
 * feature) yields an identity with no URL languages, which switches language
 * handling off rather than guessing.
 */
const body = (data: Record<string, unknown>) => ({ data: { code: 'b2b', anonymousAccess: true, ...data } });

describe('parseChannelIdentity — URL languages', () => {
  it('reads urlLanguages, urlLanguageAliases and prefixDefaultLanguage', () => {
    const identity = parseChannelIdentity(
      body({
        prefixDefaultLanguage: false,
        urlLanguages: [
          { languageCode: 'pl-PL', prefix: 'pl', prefixed: false, isDefault: true },
          { languageCode: 'en-US', prefix: 'en-us', prefixed: true, isDefault: false },
          { languageCode: 'en-GB', prefix: 'en-gb', prefixed: true, isDefault: false },
        ],
        urlLanguageAliases: [{ alias: 'en', languageCodes: ['en-US', 'en-GB'] }],
      }),
    );
    expect(identity).toEqual({
      code: 'b2b',
      anonymousAccess: true,
      prefixDefaultLanguage: false,
      urlLanguages: [
        { languageCode: 'pl-PL', prefix: 'pl', prefixed: false, isDefault: true },
        { languageCode: 'en-US', prefix: 'en-us', prefixed: true, isDefault: false },
        { languageCode: 'en-GB', prefix: 'en-gb', prefixed: true, isDefault: false },
      ],
      urlLanguageAliases: [{ alias: 'en', languageCodes: ['en-US', 'en-GB'] }],
    });
  });

  it('an older backend body yields no URL languages', () => {
    expect(parseChannelIdentity(body({}))).toEqual({
      code: 'b2b',
      anonymousAccess: true,
      prefixDefaultLanguage: true,
      urlLanguages: [],
      urlLanguageAliases: [],
    });
  });

  it('drops malformed URL language entries rather than trusting them', () => {
    const identity = parseChannelIdentity(
      body({
        urlLanguages: [
          { languageCode: 'pl-PL', prefix: 'pl', prefixed: true, isDefault: true },
          { languageCode: 'x', prefix: 'NOT A PREFIX', prefixed: true, isDefault: false },
          'junk',
        ],
        urlLanguageAliases: [{ alias: 'en' }],
      }),
    );
    expect(identity?.urlLanguages).toEqual([{ languageCode: 'pl-PL', prefix: 'pl', prefixed: true, isDefault: true }]);
    expect(identity?.urlLanguageAliases).toEqual([]);
  });

  it('answers no URL languages when no entry is the default', () => {
    const identity = parseChannelIdentity(
      body({ urlLanguages: [{ languageCode: 'en-US', prefix: 'en', prefixed: true, isDefault: false }] }),
    );
    expect(identity?.urlLanguages).toEqual([]);
  });
});
