# @endora-commerce/mod-admin-feedback

## 0.108.0

### Minor Changes

- 53e88c7: New package `@endora-commerce/mod-admin-feedback` (module id `admin_feedback`): administrators send
  feedback from the admin to the makers of Endora Commerce.

  It serves `POST /api/v1/admin/feedback` (body `AdminFeedbackRequest` from
  `@endora-commerce/contracts`) to any signed-in administrator, with no permission code and a limit
  of five sends per administrator per ten minutes. The instance adds what it knows about itself — the
  release it runs, its configured public API address, the sending administrator's name and id — and
  posts an `AdminFeedbackRelayPayload` as JSON to the relay, with a ten-second timeout and redirects
  not followed. It answers `204` when the relay accepts, `429 RATE_LIMITED` when the relay
  rate-limits, `502 ADMIN_FEEDBACK_DELIVERY_FAILED` for any other refusal, a network failure or a
  timeout, and `503 ADMIN_FEEDBACK_NOT_CONFIGURED` when the relay address is empty or not an
  `http(s)` URL. Nothing is stored: no table, no migration, and the message is never logged.

  Settings, in the new **Feedback** group: `admin_feedback.module_enabled` (the activation switch, on
  by default — switch it off if the instance must not send data to Endora) and
  `admin_feedback.relay_url` (default `https://commerce.endora.software/api/platform-feedback/`;
  empty switches sending off). One palette action opens the settings. The admin's "Send feedback"
  link and dialog are `@endora-commerce/admin-shell`'s, shown while this module is present.

### Patch Changes

- Updated dependencies [0bd5a2b]
- Updated dependencies [4da88fd]
- Updated dependencies [20af5d5]
- Updated dependencies [cf7a9c0]
- Updated dependencies [c8aa175]
- Updated dependencies [1284428]
- Updated dependencies [1df7a5e]
- Updated dependencies [14bcf1d]
- Updated dependencies [789f917]
- Updated dependencies [d231c48]
- Updated dependencies [e47b84b]
- Updated dependencies [9434cbc]
- Updated dependencies [87ac085]
- Updated dependencies [87f673d]
- Updated dependencies [ad341ed]
- Updated dependencies [301a69f]
- Updated dependencies [1377dc8]
- Updated dependencies [af57b55]
- Updated dependencies [49d82dd]
- Updated dependencies [72f9cec]
- Updated dependencies [6f1e0ec]
- Updated dependencies [0d0a1c6]
- Updated dependencies [61a1188]
- Updated dependencies [56b075d]
- Updated dependencies [53e88c7]
- Updated dependencies [eda7da8]
- Updated dependencies [359ee2b]
- Updated dependencies [8f0fd0e]
- Updated dependencies [cc98507]
- Updated dependencies [ced7b20]
- Updated dependencies [f3598cd]
- Updated dependencies [6177c81]
- Updated dependencies [2effab9]
- Updated dependencies [c8b20f6]
- Updated dependencies [29180cd]
- Updated dependencies [0f09369]
- Updated dependencies [52884d6]
- Updated dependencies [0071cd7]
- Updated dependencies [3e949eb]
- Updated dependencies [403ccc1]
- Updated dependencies [2b8bd26]
- Updated dependencies [8a2fc1b]
- Updated dependencies [ec14b96]
- Updated dependencies [a4cd906]
- Updated dependencies [5bddd11]
- Updated dependencies [5bddd11]
- Updated dependencies [a8919dc]
  - @endora-commerce/contracts@0.108.0
  - @endora-commerce/platform@0.108.0
