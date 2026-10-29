---
'@endora-commerce/cms-components': minor
'@endora-commerce/mod-cms': minor
---

A video's posters, and a self-hosted video's files, follow a source the editor chooses: the asset library or URLs.

Nothing changes for a stored page: with no source chosen, a library video or image wins over a URL, as before.

- **Hero poster source.** The video media of `cms.Hero` gains `posterSource: 'library' | 'url'` and `posterUrl`. With the URL source the URLs win and the library images are the fallback; a URL is made absolute against the media origin, as `mobilePosterUrl` is. The admin's hero media control has a **Poster source** select that governs both posters: the library shows **Poster image** and **Mobile poster image**, the URL shows **Poster URL** and **Mobile poster URL**. A stored media with no source shows the one its values imply (a URL set and no library image is the URL source).
- **Video file and poster sources.** `cms.Video` gains `fileSource` and `posterSource` (`'library' | 'url'`, file source only) and `posterUrl`. An embed shows only **Video URL** and **Provider**; a file shows the fields of its chosen sources only (`resolveFields`). Its `resolveData` records, for a file stored with no source, the source its values imply — which renders what it rendered.
- `@endora-commerce/cms-components` exports `impliedMediaSource(stored, urls, assetIds)` and `pickBySource(source, fromLibrary, fromUrl)`, the rule both blocks use.

The `cms` bundle carries the English and Polish labels.
