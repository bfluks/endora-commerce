import { z } from 'zod';

/**
 * Feedback an administrator sends to the makers of Endora Commerce from the
 * Admin UI (issue #379; the `admin_feedback` module).
 *
 * Two hops, two shapes:
 *
 * 1. `POST /api/v1/admin/feedback` — the Admin UI to its own instance:
 *    {@link AdminFeedbackRequestSchema}. What the person typed, and the address
 *    of the Admin UI they typed it in (the instance cannot know the address its
 *    browser-facing application is served at).
 * 2. The instance to the relay — by default the contact endpoint of
 *    `commerce.endora.software` — {@link AdminFeedbackRelayPayloadSchema}: the
 *    same words plus what the instance knows and the person need not type —
 *    the release, the API's public address, who sent it. The relay turns it
 *    into one e-mail to support, with `Reply-To` the sender's address.
 *
 * Nothing here is stored by the instance.
 */

/** The longest feedback accepted — a few screens of text. */
export const ADMIN_FEEDBACK_MESSAGE_MAX_LENGTH = 5000;

/** The phone number, liberal in what it accepts: digits, spaces, `+`, `-`, `(`, `)`, `/`, `.`. */
export const adminFeedbackPhoneSchema = z
  .string()
  .trim()
  .max(40)
  .regex(/^[0-9+()\-/. ]*$/, 'phone')
  .refine((value) => value === '' || (value.match(/\d/g)?.length ?? 0) >= 6, 'phone');

export const AdminFeedbackRequestSchema = z.object({
  message: z.string().trim().min(1).max(ADMIN_FEEDBACK_MESSAGE_MAX_LENGTH),
  email: z.string().trim().email().max(254),
  /** Optional; an empty string is no phone. */
  phone: adminFeedbackPhoneSchema.optional(),
  /** The Admin UI's own address — `window.location.origin`. */
  adminUrl: z.string().url().max(2048).optional(),
  /** The language the Admin UI was in, so support can answer in it. */
  language: z.string().min(2).max(16).optional(),
});
export type AdminFeedbackRequest = z.infer<typeof AdminFeedbackRequestSchema>;

/** What the instance sends to the relay. */
export const AdminFeedbackRelayPayloadSchema = z.object({
  /** Fixed: lets the relay tell this payload from its other forms. */
  kind: z.literal('admin_feedback'),
  message: z.string().min(1).max(ADMIN_FEEDBACK_MESSAGE_MAX_LENGTH),
  email: z.string().email().max(254),
  phone: z.string().max(40).nullable(),
  language: z.string().max(16).nullable(),
  /** The platform release the instance runs, or `null` when it could not read one. */
  platformVersion: z.string().max(64).nullable(),
  adminUrl: z.string().max(2048).nullable(),
  /** The API's public base address, when the instance has one configured. */
  apiUrl: z.string().max(2048).nullable(),
  /** The sending administrator: their name as the instance knows it. */
  adminName: z.string().max(200).nullable(),
  adminUserId: z.string().max(64).nullable(),
});
export type AdminFeedbackRelayPayload = z.infer<typeof AdminFeedbackRelayPayloadSchema>;

/** The error codes `POST /api/v1/admin/feedback` answers with besides validation. */
export const ADMIN_FEEDBACK_ERROR_CODES = {
  /** The relay address setting is empty: sending is switched off on this instance. */
  NOT_CONFIGURED: 'ADMIN_FEEDBACK_NOT_CONFIGURED',
  /** The relay could not be reached, or refused the message. */
  DELIVERY_FAILED: 'ADMIN_FEEDBACK_DELIVERY_FAILED',
} as const;

/** The setting codes of the `admin_feedback` module. */
export const ADMIN_FEEDBACK_SETTING_CODES = {
  MODULE_ENABLED: 'admin_feedback.module_enabled',
  RELAY_URL: 'admin_feedback.relay_url',
} as const;

/** Where feedback goes unless an operator says otherwise. */
/** With its trailing slash: the site answers the bare path with a redirect, and a POST does not follow one. */
export const ADMIN_FEEDBACK_DEFAULT_RELAY_URL = 'https://commerce.endora.software/api/platform-feedback/';
