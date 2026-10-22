---
'@endora-commerce/contracts': minor
---

CRM free text gains a formatted-text grammar, and an Order reference says more than its number.

- **New exports (`crm-rich-text`)**: `parseOpportunityRichText(text)` reads a description, a comment body or an Event description into blocks — paragraphs, bulleted and numbered lists, bold (`**…**`), italic (`_…_`, never inside a word), strikethrough (`~~…~~`), links (`[label](https://…)`, `http`/`https`/`mailto` only) and the existing `[[type:id]]` reference tokens; `formatOpportunityRichText(blocks)` writes them back; `opportunityRichTextToPlain(text)` drops the formatting for a plain-text surface; `isSafeOpportunityRichHref(href)`. Types `OpportunityRichBlock`, `OpportunityRichInline`, `OpportunityRichMark`. Stored text is still a string: plain text written before reads as the paragraphs it was, so nothing needs migrating.
- **`OpportunityReferenceSchema`** gains an optional `order` (`OpportunityReferenceOrderSchema`: `status`, `total`, `currency`, `placedAt`, `customerName`), present on an available Order reference only. Consumers that rebuild the object field by field keep working; one that compares references with strict equality sees the new key.
