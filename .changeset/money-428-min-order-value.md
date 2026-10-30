---
'@endora-commerce/mod-orders': minor
---

`orders.min_order_value` is a typed money amount: a settings write with more than two decimal places is refused with `400 AMOUNT_PRECISION_EXCEEDED` (a `SettingWriteValidator` the module contributes), never rounded. A line group's summary on the admin order screen (`orderSectionTotals`) takes the VAT per rate on the group's net amounts and no longer adds up a placed order's line totals, which could be a cent away from the order's VAT; `OrderSummaryLine.gross` is removed (a type-level break: drop the field where a caller passed it).
