import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { ERROR_CODES, LANGUAGE_FALLBACK, type SupportedLanguage } from '@endora-commerce/contracts';
import { HttpError, registerErrorEnvelope } from './error-envelope.js';
import { installResponseLanguage } from './response-language.js';

/**
 * Feature 155 (D3/D4) — `request.responseLanguage()` is the language the error
 * envelope translates a refusal's sentence into, so a handler that names a
 * product in a refusal names it in the sentence's language.
 */
describe('request.responseLanguage()', () => {
  const build = (resolve?: () => Promise<SupportedLanguage | null>) => {
    const app = Fastify();
    let calls = 0;
    registerErrorEnvelope(app, {
      errorTranslationTargets: {
        [ERROR_CODES.PRODUCT_NOT_FOUND]: { moduleId: 'core', key: 'errors.PRODUCT_NOT_FOUND' },
      },
      translateErrorMessage: async ({ language }) => `[${language}] not found`,
      ...(resolve
        ? {
            resolvePreferredLanguage: async () => {
              calls += 1;
              return resolve();
            },
          }
        : {}),
    });
    app.get('/language', async (request) => {
      const first = await request.responseLanguage();
      const second = await request.responseLanguage();
      return { first, second };
    });
    app.get('/refuse', async (request) => {
      const language = await request.responseLanguage();
      throw new HttpError(404, ERROR_CODES.PRODUCT_NOT_FOUND, `named in ${language}`);
    });
    return { app, calls: () => calls };
  };

  it('answers the injected ladder, resolved once per request', async () => {
    const probe = build(async () => 'pl');
    const res = await probe.app.inject({ method: 'GET', url: '/language' });
    expect(res.json()).toEqual({ first: 'pl', second: 'pl' });
    expect(probe.calls()).toBe(1);
    await probe.app.close();
  });

  it('the envelope translates into the same answer without resolving it again', async () => {
    const probe = build(async () => 'pl');
    const res = await probe.app.inject({ method: 'GET', url: '/refuse' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.message).toBe('[pl] not found');
    expect(probe.calls()).toBe(1);
    await probe.app.close();
  });

  it('answers the fallback when the composition injects no ladder or it answers nothing', async () => {
    const none = build();
    expect((await none.app.inject({ method: 'GET', url: '/language' })).json().first).toBe(LANGUAGE_FALLBACK);
    await none.app.close();
    const empty = build(async () => null);
    expect((await empty.app.inject({ method: 'GET', url: '/language' })).json().first).toBe(LANGUAGE_FALLBACK);
    await empty.app.close();
  });

  it('never throws: a ladder that fails answers the fallback, and the envelope stays untranslated', async () => {
    const probe = build(async () => {
      throw new Error('admin_users is switched off');
    });
    expect((await probe.app.inject({ method: 'GET', url: '/language' })).json().first).toBe(LANGUAGE_FALLBACK);
    const refused = await probe.app.inject({ method: 'GET', url: '/refuse' });
    expect(refused.statusCode).toBe(404);
    expect(refused.json().error.message).toBe(`named in ${LANGUAGE_FALLBACK}`);
    await probe.app.close();
  });

  /**
   * Round C (item 6) — the decoration is installed once, so a second install
   * with another ladder would have handed its envelope a resolution the
   * decoration never answers: a sentence and a name in two languages. That is
   * refused; a second install with the same ladder shares the first's memo.
   */
  describe('a second install on one app', () => {
    it('with a different ladder is refused', async () => {
      const app = Fastify();
      installResponseLanguage(app, async () => 'pl');
      expect(() => installResponseLanguage(app, async () => 'en')).toThrow(/responseLanguage/);
      expect(() => installResponseLanguage(app, undefined)).toThrow(/responseLanguage/);
      await app.close();
    });

    it('with the same ladder shares one resolution per request with the decoration', async () => {
      const app = Fastify();
      let calls = 0;
      const ladder = async () => {
        calls += 1;
        return 'pl' as const;
      };
      installResponseLanguage(app, ladder);
      const again = installResponseLanguage(app, ladder);
      app.get('/both', async (request) => ({ decoration: await request.responseLanguage(), envelope: await again(request) }));
      const res = await app.inject({ method: 'GET', url: '/both' });
      expect(res.json()).toEqual({ decoration: 'pl', envelope: 'pl' });
      expect(calls).toBe(1);
      await app.close();
    });

    it('without a ladder, twice, is idempotent', async () => {
      const app = Fastify();
      installResponseLanguage(app, undefined);
      expect(() => installResponseLanguage(app, undefined)).not.toThrow();
      await app.close();
    });
  });
});
