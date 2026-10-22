import type { FastifyInstance, FastifyRequest } from 'fastify';
import { LANGUAGE_FALLBACK, type SupportedLanguage } from '@endora-commerce/contracts';

/**
 * `request.responseLanguage()` — the language this response is answered in,
 * the same answer the error envelope translates a refusal's sentence into
 * (feature 155, D3/D4).
 *
 * ## Why a request decoration
 *
 * A refusal such as `PRODUCT_BELOW_MINIMUM_QUANTITY` is two halves written by
 * two parties: the sentence, translated by the envelope through the kernel's
 * language ladder (`kernel/i18n/request-language.ts` — the admin's stored
 * preference, else the q-sorted `Accept-Language`, else the channel's default),
 * and the product name in it, picked by the module that raised it. Before this
 * the modules picked the name from a first-tag parse of the header of their
 * own — three of them, none q-sorting, all of them ignoring the admin's stored
 * preference — so a Polish sentence could name the English product. The ladder
 * already reaches `registerErrorEnvelope` as an injected callback (`src/http`
 * may not import `src/kernel`), so that is where the one answer is exposed.
 *
 * ## Resolved once per request, lazily
 *
 * The admin rung is a port read, so nothing is resolved until a handler asks,
 * and the answer is memoised for the request — the envelope reads the same
 * promise, so a refusal costs one read whichever side asks first.
 *
 * ## It never throws
 *
 * The ladder's admin rung may throw (its owner switched off). The envelope then
 * answers untranslated, which is English prose; this decoration answers
 * `LANGUAGE_FALLBACK` for the same request, so the name stays in the language
 * of the sentence it sits in.
 *
 * ## It is carried by the `./http` barrel and exports nothing a module names
 *
 * As `request-actor.ts`: `http/index.ts` imports this file, which puts the
 * augmentation in the program of every consumer of
 * `@endora-commerce/platform/http`.
 */
declare module 'fastify' {
  interface FastifyRequest {
    /**
     * The language this response is answered in — the language an error
     * sentence is translated into. Decorated by `registerErrorEnvelope`, which
     * every composition installs; answers `LANGUAGE_FALLBACK` when the
     * composition injected no ladder or the ladder failed.
     */
    responseLanguage(): Promise<SupportedLanguage>;
  }
}

type LanguageResolver = (request: FastifyRequest) => Promise<SupportedLanguage | null | undefined>;

/** What each app was installed with — the decoration and its memo are per app. */
const installs = new WeakMap<
  FastifyInstance,
  { resolve: LanguageResolver | undefined; resolveOnce: (request: FastifyRequest) => Promise<SupportedLanguage> }
>();

/**
 * Installs `request.responseLanguage()` over `resolve` and returns the memoised
 * raw resolution the envelope reads (which, unlike the decoration, rejects when
 * the ladder throws — the envelope has its own guard for that).
 *
 * Once per app. A second install with the same `resolve` returns the first
 * install's memo, so the decoration and every envelope share one resolution per
 * request. A second install with a different `resolve` throws: the decoration
 * can only answer one ladder, and an envelope reading another would translate
 * the sentence into a language the product name in it was not picked in.
 */
export function installResponseLanguage(
  app: FastifyInstance,
  resolve: LanguageResolver | undefined,
): (request: FastifyRequest) => Promise<SupportedLanguage> {
  const installed = installs.get(app);
  if (installed !== undefined && installed.resolve === resolve) return installed.resolveOnce;
  if (installed !== undefined || app.hasRequestDecorator('responseLanguage')) {
    throw new Error(
      '[http] request.responseLanguage() is already installed on this app with a different language resolver — register the error envelope once.',
    );
  }
  const resolved = new WeakMap<FastifyRequest, Promise<SupportedLanguage>>();
  const resolveOnce = (request: FastifyRequest): Promise<SupportedLanguage> => {
    let answer = resolved.get(request);
    if (answer === undefined) {
      answer = (async () => (await resolve?.(request)) ?? LANGUAGE_FALLBACK)();
      resolved.set(request, answer);
    }
    return answer;
  };
  app.decorateRequest('responseLanguage', function responseLanguage(this: FastifyRequest) {
    return resolveOnce(this).catch((error: unknown) => {
      this.log.warn({ err: error }, 'response language could not be resolved; answering the fallback');
      return LANGUAGE_FALLBACK;
    });
  });
  installs.set(app, { resolve, resolveOnce });
  return resolveOnce;
}
