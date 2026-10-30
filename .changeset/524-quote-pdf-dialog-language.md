---
'@endora-commerce/mod-quote-requests': patch
---

`QuoteRequestPdfDialog` (*Export PDF* / *Send PDF to customer*) picks the language in the same update that loads the template choices or changes the template, instead of in a following effect. A click on *Download PDF* or *Send* the moment the dialog finished loading could otherwise go out with no `language` while the select already showed one, leaving the server to fall back to the channel's language even where the preselected template does not offer it.
