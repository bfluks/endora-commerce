---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-quote-requests': minor
---

A discount that is real but rounds to no cent is no longer shown as 0,00 (issue #430).

- **`DocumentValue`** (contracts): a `money` value may carry `belowMinorUnit: true`. `formatDocumentValue` prints it as `DOCUMENT_BELOW_MINOR_UNIT_TEXT` ("—"), and `sumDocumentValues` keeps the mark while the sum is zero.
- **Quote document** (quote_requests): `lineDiscount` and `discountTotal` carry the mark when a line has a unit discount but its rounded line discount is 0.00, so the PDF prints "—"; the amount stays 0, so list value − discount = net.
- **Admin quote screen** (quote_requests): the *Difference* column keeps a difference of unit prices at four places (`referenceDifference(...).amount`) and shows its significant places (`RfqNumberFormat.signedUnitAmount`), instead of rounding it to 0.00.
