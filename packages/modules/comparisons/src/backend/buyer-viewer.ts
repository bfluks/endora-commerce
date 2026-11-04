import type { FastifyRequest } from 'fastify';
import { productAudienceOf } from '@endora-commerce/platform/http';
import type { ComparisonViewer } from './services/comparison-service.js';

/**
 * Feature 163 — the reader as a comparison view takes it: the session's
 * audience and the request's language tag, which the scope language L of the
 * column's availability is resolved from. One definition for the owner routes
 * and the share route (final code review C-n1), so they cannot answer the same
 * reader differently.
 */
export function buyerViewerOf(request: FastifyRequest): ComparisonViewer {
  const tag = languageTagOf(request);
  return {
    kind: 'buyer',
    audience: productAudienceOf(request),
    ...(tag ? { languageTag: tag } : {}),
  };
}

/** The first `Accept-Language` tag without its quality parameter, or `undefined`. */
export function languageTagOf(request: FastifyRequest): string | undefined {
  const header = request.headers['accept-language'];
  const tag = typeof header === 'string' ? header.split(',')[0]?.split(';')[0]?.trim() : undefined;
  return tag ? tag : undefined;
}
