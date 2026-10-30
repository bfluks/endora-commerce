---
'@endora-commerce/mod-payments': patch
---

`receivePaymentPort.reflectRefund` refuses a refunded amount with more than two decimal places instead of rounding it: the payment's refunded amount and status are unchanged, the order is not asked, the refusal is logged with the payment, order, reported amount and refund reference, and the payment is marked with `providerDetails.refundAnomaly`. It answers `{ paymentId, changed: false }` rather than throwing, so a gateway webhook is acknowledged and not redelivered.
