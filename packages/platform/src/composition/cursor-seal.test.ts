import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { createCursorSeal } from './cursor-seal.js';

/**
 * Issue #497 — a pagination cursor a listing hands a client may have to name a
 * row the client must not learn anything about: where a page's scan stopped,
 * which can be a product the viewer may not see or whose price is withheld.
 * The seal makes such a cursor opaque (nothing in it can be read) and
 * tamper-proof (nothing in it can be forged).
 */
describe('createCursorSeal', () => {
  const seal = createCursorSeal('a-session-secret');
  const purpose = 'catalog.price-walk';
  const payload = JSON.stringify({
    stream: 'priced',
    amount: '17.0000',
    productId: '0b9a3c55-1f0e-4c1e-9d0a-6f1d2c3b4a59',
  });

  it('opens what it sealed, for the same purpose', () => {
    expect(seal.open(purpose, seal.seal(purpose, payload))).toBe(payload);
  });

  it('issues a token that reveals nothing of the payload, however it is decoded', () => {
    const token = seal.seal(purpose, payload);
    for (const text of [token, Buffer.from(token, 'base64url').toString('utf8'), Buffer.from(token, 'base64url').toString('latin1')]) {
      expect(text).not.toContain('17.0000');
      expect(text).not.toContain('0b9a3c55');
      expect(text).not.toContain('priced');
    }
    expect(() => JSON.parse(Buffer.from(token, 'base64url').toString('utf8'))).toThrow();
  });

  it('is URL-safe', () => {
    expect(seal.seal(purpose, payload)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('seals one position to one token, so a page links its next page by one URL a cache and a crawler can reuse', () => {
    expect(seal.seal(purpose, payload)).toBe(seal.seal(purpose, payload));
    expect(createCursorSeal('a-session-secret').seal(purpose, payload)).toBe(seal.seal(purpose, payload));
  });

  it('seals two positions, or one position for two purposes or under two keys, to unrelated tokens', () => {
    const other = payload.replace('17.0000', '17.0001');
    const tokens = [
      seal.seal(purpose, payload),
      seal.seal(purpose, other),
      seal.seal('catalog.price-range-walk', payload),
      createCursorSeal('another-secret').seal(purpose, payload),
    ];
    expect(new Set(tokens).size).toBe(4);
    // Not even the IV is shared: nothing in one token predicts another.
    expect(new Set(tokens.map((t) => Buffer.from(t, 'base64url').subarray(1, 13).toString('hex'))).size).toBe(4);
  });

  it('does not let the length of a token track the length of an amount', () => {
    const at = (amount: string) =>
      seal.seal(purpose, JSON.stringify({ stream: 'priced', amount, productId: '0b9a3c55-1f0e-4c1e-9d0a-6f1d2c3b4a59' }))
        .length;
    expect(at('1.0000')).toBe(at('12345678901.1234'));
  });

  it('opens nothing sealed for another purpose', () => {
    expect(seal.open('catalog.price-range-walk', seal.seal(purpose, payload))).toBeNull();
  });

  it('opens nothing sealed with another key', () => {
    expect(createCursorSeal('another-secret').open(purpose, seal.seal(purpose, payload))).toBeNull();
  });

  it('opens nothing that was altered', () => {
    const token = seal.seal(purpose, payload);
    const bytes = Buffer.from(token, 'base64url');
    for (const at of [0, 1, 14, bytes.length - 1]) {
      const altered = Buffer.from(bytes);
      altered[at] = altered[at]! ^ 0x01;
      expect(seal.open(purpose, altered.toString('base64url')), `byte ${at}`).toBeNull();
    }
    expect(seal.open(purpose, token.slice(0, -4))).toBeNull();
  });

  it('opens nothing that is not a token: a plain cursor of the old format, garbage, the empty string', () => {
    expect(seal.open(purpose, Buffer.from(payload, 'utf8').toString('base64url'))).toBeNull();
    expect(seal.open(purpose, 'not-a-cursor')).toBeNull();
    expect(seal.open(purpose, '!!!')).toBeNull();
    expect(seal.open(purpose, '')).toBeNull();
  });

  it('round-trips a payload of any length, multi-byte text included', () => {
    for (const text of ['', 'x', 'ż'.repeat(70), 'a'.repeat(127), 'a'.repeat(128), 'a'.repeat(1000)]) {
      expect(seal.open(purpose, seal.seal(purpose, text))).toBe(text);
    }
  });

  it('refuses to seal or open without a key, rather than sealing with a guessable one', () => {
    const keyless = createCursorSeal('');
    expect(() => keyless.seal(purpose, payload)).toThrow(/no key/);
    expect(() => keyless.open(purpose, seal.seal(purpose, payload))).toThrow(/no key/);
  });

  it('is what composeApp registers as `cursorSeal`, keyed by the session key', () => {
    const source = readFileSync(fileURLToPath(new URL('./compose-app.ts', import.meta.url)), 'utf8');
    expect(source).toMatch(/cursorSeal: createCursorSeal\(process\.env\['SESSION_COOKIE_SECRET'\] \?\? ''\)/);
  });
});
