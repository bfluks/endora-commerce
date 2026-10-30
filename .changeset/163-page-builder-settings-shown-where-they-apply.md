---
'@endora-commerce/cms-components': minor
'@endora-commerce/mod-cms': minor
'@endora-commerce/page-builder-admin': minor
---

A block's settings are shown where they apply and in one order — content, layout, look, spacing, visibility — and new blocks follow the section's colours.

Nothing stored changes; the defaults below apply to newly inserted blocks only.

- **Sliders** (`withoutUnusedCarouselFields`): the autoplay interval only with autoplay on; the arrows' look only while the arrows show; the disabled-arrow look (and its colour, for **Color**) only on a carousel that stops at its ends; the controls' placement and alignment only while arrows or dots show. The `controls` field is a cached copy, so the input keeps its focus.
- **Shown where they apply**: a carousel image's caption look with a caption; a CTA card's image side with an image; a row's **Vertical position** with a minimum height; an accordion's **Divider position** where its items have lines; **Muted** only for a video file that does not autoplay (an autoplaying file is always muted); the social icon colour only with **Use brand colors** off (now before it).
- **Order**: the media-and-text layout after the footnote; the link tile's image, title, link label and link first; the CTA card's look after its content; the stats' metrics before the image; the feature list's image next to the features; the background panel's text side after the buttons; a carousel image's link after its caption; the video's accessible title under its sources; the image and its alt text together on the General tab; the latest posts' number and category on the Data tab, the category picked from the blog's categories (`createBlogCategorySlugField`, still storing the slug).
- **Item open at first** (`cms.Accordion`) and **Tab shown at first** (`cms.Tabs`) are chosen among the items (`createItemIndexField`), storing the index they always stored.
- **Media and text** and the **carousel split slide** take a **Poster source** (asset library or URL) for both posters, with `posterUrl`; unset, the library image wins as before.
- **Sources**: every image and video source offers the asset library first, and a new image starts on it; an image stored with no source and a URL keeps its URL source.
- **New blocks**: a text has no colour of its own, icons and social links take `currentColor`, an announcement bar the brand's primary colours, so they read on a dark section.
- Wording: the hero overlay's directions as the image's ("Darker at the bottom"…), the product card's **Button label**, **Card style** and plain words for its optional sizes, a custom maximum width's one range (160–2000 px), the video's maximum width "% of the available width".
