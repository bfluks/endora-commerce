---
'@endora-commerce/admin-kit': patch
---

`CustomFieldListFilters` no longer loses a text or number filter typed into a control in the moment it appears, before its effects have run. The control used to take the value it mounted with back over what had just been typed, and in StrictMode the simulated unmount also cleared the pending commit, so clearing a filter as a list's fields finished loading could leave the list filtered by the old value. The control now adopts an outside value only when that value changes, and a pending commit is skipped only once the control is really unmounted.
