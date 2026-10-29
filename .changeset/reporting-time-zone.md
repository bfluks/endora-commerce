---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-analytics': minor
---

A reporting time zone: the setting `analytics.reporting_time_zone` (*Reporting time zone*, in the
*Analytics* section of the settings screen) is the calendar reports count days in — a range of days
runs from midnight of its first day to midnight after its last, in that zone. Default `UTC`. It
belongs to `@endora-commerce/mod-analytics` rather than to a reporting module, so that any report
can read it: Projects analytics does, CRM is to follow. Other modules read it through the gated
port `reportingTimeZonePort` and count in `UTC` while Analytics is switched off. A write of a zone
the runtime does not know is refused with `422` `VALIDATION_FAILED`. `@endora-commerce/contracts`
exports the code as `ANALYTICS_REPORTING_TIME_ZONE_SETTING`, the port as `ReportingTimeZonePort`
and the check as `isIanaTimeZone`. `mod-analytics` now declares `settings` as a dependency and
`zod` as a peer.
