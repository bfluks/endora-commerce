---
title: Product visibility rules
description: Limit which products an administrator role sees by catalogue price, and let a sales channel's products follow a rule
---

# Product visibility rules

The `product_visibility_rules` module limits which products an administrator role sees, by the
products' catalogue prices, and lets a sales channel's product membership follow a named product
rule (the *website rule*). It ships **switched off**: until an operator switches it on, nothing
changes.

This page grows with the feature (`specs/193-product-visibility-rules/`); the operator guide is
written when the configuration screens land.

## Switching it on and off

The activation control is on **Platform → Modules**. Switching it on applies the role mappings at
once — an unmapped role that handles quote requests sees no products until it is mapped, so map
roles right after enabling. Switching it off lifts every restriction at once and keeps the whole
configuration, which applies again when the module is switched back on.
