---
'@endora-commerce/mod-invoices': patch
---

The one-time document template access grant no longer opens a system scope of its own at boot. It runs inside the system scope the platform already enters for every boot hook (`boot: invoices`), so each boot recorded a second `tenant.escape_hatch` entry for the same access, labelled with the `worker` entry point although only the boot ran it. What the grant writes, and when, is unchanged.
