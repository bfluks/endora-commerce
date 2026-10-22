---
'@endora-commerce/mod-search': minor
'@endora-commerce/mod-seo': patch
'@endora-commerce/mod-product-feeds': patch
---

Search, the sitemap and product feeds follow product data scopes per sales channel and language.

- **Search:** a channel index carries every member that is on in at least one channel language; each document gains `liveLanguages`, `publishFromMs`, `publishUntilMs` and the channel-effective `visibility` and `allowedOrganizationIds` (all filterable). A query filters on the request language, the publication window at query time and the caller's audience, so a page is cut from available hits only; hydration asks `catalog` again for every hit. Documents indexed before the upgrade are served as before. **Upgrade step:** run one reindex per sales channel (the `search_reindex` bulk operation or the reindex CLI) so the window and per-language filters are exact. `SearchIndexerOptions` requires `availability`; `SearchQueryService` takes the availability port as its sixth argument.
- **Sitemap:** lists a product when it is available in the channel to an anonymous visitor at generation time — on in a channel language, inside its publication window, admitted by the channel's audience rule — with one URL per live language (`?lang=<code>` outside the channel's default). A product off globally but on in the channel is listed; one switched off in the channel is not.
- **Product feeds:** the eligibility floor is effective availability at the feed's channel and language for an anonymous reader (scoped status, publication window, channel audience) instead of the global status; the selection preview counts the same set.
