# Contract: error codes

Each code lands **in one commit** with: its `ERROR_CODES` member (`packages/contracts/src/errors.ts`), its `MINTED_ERROR_CODES` entry
(`backend/test/fixtures/error-code-routing/reference-ledgers.ts`), the owner manifest's `errorCodes`
declaration, `errors.<CODE>` in the owner's `i18n/en.json` **and** `pl.json`, and the `composer:generate`
output with its Polish module-reference refresh (the rule 155's `contracts/error-codes.md` follows).

| Code | Owner | HTTP | Raised by | `details` |
| --- | --- | --- | --- | --- |
| `SCOPE_INVALID` | catalog | 422 | scope / URL-key / media writes for a non-member channel or a language the channel does not offer (FR-014) | `{ channelId, languageCode?, reason: 'not_a_member' \| 'language_not_offered' }` |
| `SCOPE_INCOMPLETE` | catalog | 422 | completeness gate in `refuse` mode (FR-060) | `{ pairs: [{ channelId, languageCode, missing: string[] }] }` |
| `URL_KEY_TAKEN` | catalog | 409 | key writes (FR-070) | `{ conflicts: [{ languageCode, key, heldByProductId, heldByProductName }] }` |
| `URL_KEY_REDIRECT_TAKEOVER_REQUIRED` | catalog | 409 | key writes meeting another product's redirect (FR-072) | `{ takeovers: [{ languageCode, key, losingProductId, losingProductName }] }` |
| `URL_REDIRECT_NOT_FOUND` | catalog | 404 | redirect delete | `{ redirectId }` |

Non-error message codes (no envelope): quote-request operator warning `PRODUCT_UNAVAILABLE_IN_SCOPE`
(FR-018), bulk result reasons `scope_invalid`, `completeness_gate`, scope warnings `completeness`,
`audience_non_members`. Buyer-facing seams never get a new code: unavailable stays `PRODUCT_NOT_FOUND`
(FR-005).
