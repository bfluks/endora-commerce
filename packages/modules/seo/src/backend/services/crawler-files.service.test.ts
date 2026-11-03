import { describe, expect, it } from 'vitest';
import {
  CRAWLER_TEXT_MAX_BYTES,
  storefrontCrawlerFilesSchema,
} from '@endora-commerce/contracts';
import type { z } from 'zod';
import {
  LLMS_TXT_ADDITIONAL_SETTING_CODE,
  ROBOTS_TXT_CUSTOM_SETTING_CODE,
  StoredCrawlerTextTooLargeError,
  resolveCrawlerFiles,
  type CrawlerFilesSettingsPort,
} from './crawler-files.service.js';

/**
 * What a sales channel's crawler files are built from
 * (`specs/144-seo-search-engine-robots/contracts/crawler-policy.md` §2).
 *
 * The settings store resolves channel value → all-channels value → default;
 * this is only about what the module does with what it is handed, so the store
 * is a table here. The resolution itself is held against a real database in
 * `backend/test/integration/seo/crawler-files-channel-scope.test.ts`.
 */
describe('resolveCrawlerFiles', () => {
  const CHANNEL = '00000000-0000-4000-8000-000000000001';
  /** The request's resolved channel, open to anonymous visitors. */
  const OPEN = { id: CHANNEL, anonymousAccess: true };

  function settings(
    values: Record<string, unknown>,
    seen: { code: string; salesChannelId: string | null }[] = [],
  ): CrawlerFilesSettingsPort {
    return {
      async get<T>(code: string, salesChannelId: string, schema: z.ZodType<T>): Promise<T> {
        seen.push({ code, salesChannelId });
        if (!Object.hasOwn(values, code)) throw new Error(`Setting "${code}" is not registered.`);
        return schema.parse(values[code]);
      },
      async getMany(codes: string[], salesChannelId: string) {
        return new Map(
          codes.map((code) => {
            seen.push({ code, salesChannelId });
            return [
              code,
              Object.hasOwn(values, code)
                ? ({ ok: true, value: values[code] } as const)
                : ({ ok: false, error: 'not_registered' } as const),
            ];
          }),
        );
      },
    };
  }

  const STORED = {
    'seo.default_robots': 'NOINDEX, FOLLOW',
    'seo.robots_txt_custom': 'User-agent: GPTBot\r\nDisallow: /\n\n  # kept \n',
    'seo.llms_txt_additional': '## About\r\n\r\nWe sell bolts. \n',
    'shop.name': 'Endora Demo',
  };

  it('answers the documented shape', async () => {
    const files = await resolveCrawlerFiles(settings(STORED), OPEN);
    expect(files).toEqual({
      index: false,
      follow: true,
      robotsTxtCustom: STORED['seo.robots_txt_custom'],
      llmsTxtAdditional: STORED['seo.llms_txt_additional'],
      shop: { name: 'Endora Demo' },
      anonymousAccess: true,
    });
    // Nothing was unreadable, and the answer does not say otherwise.
    expect(files).not.toHaveProperty('unreadable');
    expect(storefrontCrawlerFilesSchema.parse(files)).toEqual(files);
    expect(ROBOTS_TXT_CUSTOM_SETTING_CODE).toBe('seo.robots_txt_custom');
    expect(LLMS_TXT_ADDITIONAL_SETTING_CODE).toBe('seo.llms_txt_additional');
  });

  it('says whether the channel is open to anonymous visitors (specs/154-sales-channel-access/)', async () => {
    // The storefront builds a closed store's files differently — `robots.txt`
    // disallows everything, `llms.txt` lists nothing — so it has to be told.
    // The texts are answered as stored either way: what a closed store does
    // with them is the storefront's to say.
    const closed = await resolveCrawlerFiles(settings(STORED), { id: CHANNEL, anonymousAccess: false });
    expect(closed).toEqual({
      index: false,
      follow: true,
      robotsTxtCustom: STORED['seo.robots_txt_custom'],
      llmsTxtAdditional: STORED['seo.llms_txt_additional'],
      shop: { name: 'Endora Demo' },
      anonymousAccess: false,
    });
    expect(storefrontCrawlerFilesSchema.parse(closed)).toEqual(closed);
    expect((await resolveCrawlerFiles(settings(STORED), OPEN)).anonymousAccess).toBe(true);
  });

  it('returns the text exactly as stored — no trimming, no line-break rewriting', async () => {
    const text = '\r\n  \tfirst  \r\n\r\nsecond\n\n\n';
    const files = await resolveCrawlerFiles(
      settings({ ...STORED, 'seo.robots_txt_custom': text }),
      OPEN,
    );
    expect(files.robotsTxtCustom).toBe(text);
    const llms = await resolveCrawlerFiles(
      settings({ ...STORED, 'seo.llms_txt_additional': text }),
      OPEN,
    );
    expect(llms.llmsTxtAdditional).toBe(text);
  });

  it('reads every setting for the channel it was given, and no other', async () => {
    const seen: { code: string; salesChannelId: string | null }[] = [];
    await resolveCrawlerFiles(settings(STORED, seen), OPEN);
    expect(seen.map((read) => read.code).sort()).toEqual([
      'seo.default_robots',
      'seo.llms_txt_additional',
      'seo.robots_txt_custom',
      'shop.name',
    ]);
    expect(new Set(seen.map((read) => read.salesChannelId))).toEqual(new Set([CHANNEL]));
  });

  it('answers an empty shop name when none is set, is registered, or is a text', async () => {
    for (const values of [
      { ...STORED, 'shop.name': '' },
      {
        'seo.default_robots': 'INDEX, FOLLOW',
        'seo.robots_txt_custom': '',
        'seo.llms_txt_additional': '',
      },
      { ...STORED, 'shop.name': 42 },
    ]) {
      expect((await resolveCrawlerFiles(settings(values), OPEN)).shop).toEqual({ name: '' });
    }
  });

  /**
   * The parts of the answer fail apart (`contracts/crawler-policy.md` §2.2).
   * `robots.txt` is built from the texts and never from the policy, so a
   * default robots row nobody can interpret must not cost the channel its
   * `robots.txt`. The answer is still given, and says what it does not know.
   */
  describe('a stored default robots value that cannot be interpreted', () => {
    it.each([['NOINDEX'], ['index, follow'], [''], [42], [null], [['NOINDEX, FOLLOW']]])(
      'answers the texts, and names the policy unreadable — %j',
      async (stored) => {
        const files = await resolveCrawlerFiles(
          settings({ ...STORED, 'seo.default_robots': stored }),
          OPEN,
        );
        expect(files.unreadable).toEqual(['policy']);
        // The operator's text is as readable as it ever was.
        expect(files.robotsTxtCustom).toBe(STORED['seo.robots_txt_custom']);
        expect(files.llmsTxtAdditional).toBe(STORED['seo.llms_txt_additional']);
        expect(storefrontCrawlerFilesSchema.safeParse(files).success).toBe(true);
      },
    );

    it('never answers "no restriction" for it: the two members read as the restrictive pair', async () => {
      // A reader that does not know `unreadable` and acts on the booleans must
      // err towards keeping a channel out, never towards letting it in.
      const files = await resolveCrawlerFiles(
        settings({ ...STORED, 'seo.default_robots': 'INDEX' }),
        OPEN,
      );
      expect(files.index).toBe(false);
      expect(files.follow).toBe(false);
    });
  });

  describe('stored additional llms.txt content that cannot be served', () => {
    it.each([
      ['a text over the limit', `${'ż'.repeat(CRAWLER_TEXT_MAX_BYTES / 2)}a`],
      ['a value that is not a text', 42],
      ['a list', ['# About']],
      ['null', null],
    ])('answers robots.txt its text, and names the content unreadable — %s', async (_name, stored) => {
      const files = await resolveCrawlerFiles(
        settings({ ...STORED, 'seo.llms_txt_additional': stored }),
        OPEN,
      );
      expect(files.unreadable).toEqual(['llmsTxtAdditional']);
      // Never the text, and never a part of it.
      expect(files.llmsTxtAdditional).toBe('');
      expect(files.robotsTxtCustom).toBe(STORED['seo.robots_txt_custom']);
      expect(files.index).toBe(false);
      expect(files.follow).toBe(true);
      expect(storefrontCrawlerFilesSchema.safeParse(files).success).toBe(true);
    });

    it('accepts exactly the limit', async () => {
      const atLimit = 'a'.repeat(CRAWLER_TEXT_MAX_BYTES);
      const files = await resolveCrawlerFiles(
        settings({ ...STORED, 'seo.llms_txt_additional': atLimit }),
        OPEN,
      );
      expect(files.llmsTxtAdditional).toBe(atLimit);
      expect(files).not.toHaveProperty('unreadable');
    });

    it('names both when both are unreadable, in a fixed order', async () => {
      const files = await resolveCrawlerFiles(
        settings({ ...STORED, 'seo.default_robots': 'x', 'seo.llms_txt_additional': 7 }),
        OPEN,
      );
      expect(files.unreadable).toEqual(['policy', 'llmsTxtAdditional']);
    });
  });

  it('still throws when a setting is not there to be read at all', async () => {
    // "The store has no such setting" is not a value that is wrong; it is an
    // instance that is, and nothing here is in a position to answer for it.
    const { 'seo.default_robots': _robots, ...withoutRobots } = STORED;
    await expect(resolveCrawlerFiles(settings(withoutRobots), OPEN)).rejects.toThrow(
      /seo\.default_robots/,
    );
    const { 'seo.llms_txt_additional': _llms, ...withoutLlms } = STORED;
    await expect(resolveCrawlerFiles(settings(withoutLlms), OPEN)).rejects.toThrow(
      /seo\.llms_txt_additional/,
    );
  });

  it('throws for stored robots.txt instructions over the limit, rather than serve what the write door refuses', async () => {
    // Only a row written around the settings API can be this long.
    const atLimit = 'a'.repeat(CRAWLER_TEXT_MAX_BYTES);
    await expect(
      resolveCrawlerFiles(settings({ ...STORED, 'seo.robots_txt_custom': atLimit }), OPEN),
    ).resolves.toMatchObject({ robotsTxtCustom: atLimit });

    const tooLong = resolveCrawlerFiles(
      settings({ ...STORED, 'seo.robots_txt_custom': `${'ż'.repeat(CRAWLER_TEXT_MAX_BYTES / 2)}a` }),
      OPEN,
    );
    await expect(tooLong).rejects.toBeInstanceOf(StoredCrawlerTextTooLargeError);
    await expect(tooLong).rejects.toThrow(/seo\.robots_txt_custom.*65537.*65536/);
  });

  it('throws when the text setting cannot be read, rather than answer an empty text', async () => {
    // An empty text at `200` would be definitive: the storefront would serve a
    // file without the operator's instructions and call it current.
    await expect(
      resolveCrawlerFiles(
        settings({ 'seo.default_robots': 'INDEX, FOLLOW', 'seo.llms_txt_additional': '' }),
        OPEN,
      ),
    ).rejects.toThrow(/seo\.robots_txt_custom/);
    await expect(
      resolveCrawlerFiles(settings({ ...STORED, 'seo.robots_txt_custom': 42 }), OPEN),
    ).rejects.toThrow();
  });
});
