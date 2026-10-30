---
'@endora-commerce/mod-crm': patch
---

The opportunity board no longer loses a filter when two of them change in the same moment. Two filter boxes whose typing pause ended together — two different fields, or the lowest and the highest of one field — each started from the address of the last render, so the second wrote over the first and only one reached the server and the address. Every change to the board's filters is now applied to the filters as they stand, and a field's filter is merged into the one the board holds, not the one its box was last given.
