import { z } from 'zod';
import {
  ADMIN_FEEDBACK_SETTING_CODES,
  ERROR_CODES,
  type AdminFeedbackRelayPayload,
  type AdminFeedbackRequest,
  type AdminUserReadPort,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import type { PlatformLogger, SettingsReadPort } from '@endora-commerce/platform/kernel';

/** The slice of `fetch` the sender uses — injected so a test answers for the relay. */
export type FetchLike = (url: string | URL, init?: RequestInit) => Promise<Response>;

export interface AdminFeedbackSenderDeps {
  /** `admin_feedback.relay_url`, read platform-wide on every send. */
  readonly settings: Pick<SettingsReadPort, 'get'>;
  /** The sending administrator's name. */
  readonly adminUsers: Pick<AdminUserReadPort, 'findById'>;
  readonly fetch: FetchLike;
  /** The release this instance runs, or `null` when it could not be read. */
  readonly platformVersion: string | null;
  /** The configured public API origin, or `null`. Asked per send. */
  readonly apiUrl: () => string | null;
  readonly logger: PlatformLogger;
  /** How long the relay has to answer. */
  readonly timeoutMs?: number;
}

export const ADMIN_FEEDBACK_RELAY_TIMEOUT_MS = 10_000;

/** Who is sending, as the session says — never as the request body says. */
export interface AdminFeedbackSenderIdentity {
  readonly adminUserId: string;
}

/**
 * Sends one administrator's feedback to the relay (issue #379).
 *
 * **Not a Command, deliberately** (Constitution XIII). The Command Bus exists
 * so that domain writes are audited and undoable uniformly; this writes
 * nothing — no row, no setting, no file. It forwards what the person typed to
 * an address outside the instance and reports whether that worked. There is
 * no state here to audit or to undo, and recording the message itself would
 * keep on the instance exactly what the module promises not to keep.
 *
 * What it refuses, and how:
 *
 * - the relay address is empty (sending switched off) or is not an `http(s)`
 *   URL (a misconfiguration, logged) — `503 ADMIN_FEEDBACK_NOT_CONFIGURED`,
 *   and nothing leaves the instance;
 * - the relay answers `429` — `429 RATE_LIMITED`, its `Retry-After` passed on
 *   when it is a number of seconds;
 * - anything else that is not a `2xx` — a redirect included, which is never
 *   followed — a network failure or no answer within the timeout — `502 ADMIN_FEEDBACK_DELIVERY_FAILED`.
 *
 * A failure is logged with the relay's status and the reason, **never** with
 * the message, the e-mail address or the phone number.
 */
export class AdminFeedbackSender {
  constructor(private readonly deps: AdminFeedbackSenderDeps) {}

  async send(request: AdminFeedbackRequest, identity: AdminFeedbackSenderIdentity): Promise<void> {
    const relay = await this.relayUrl();
    const payload = await this.payloadFor(request, identity);
    const { platformVersion, logger } = this.deps;

    let response: Response;
    try {
      response = await this.deps.fetch(relay, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          'user-agent': platformVersion ? `endora-commerce/${platformVersion}` : 'endora-commerce',
        },
        body: JSON.stringify(payload),
        // A redirect is not followed: a POST that is redirected arrives as a
        // GET or not at all, and the operator should learn the address is
        // wrong rather than have it silently work around.
        redirect: 'manual',
        signal: AbortSignal.timeout(this.deps.timeoutMs ?? ADMIN_FEEDBACK_RELAY_TIMEOUT_MS),
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'TimeoutError';
      logger.warn(
        {
          relayHost: relay.host,
          reason: timedOut ? 'timeout' : 'network',
          error: error instanceof Error ? error.message : String(error),
        },
        '[admin_feedback] the feedback relay could not be reached',
      );
      throw deliveryFailed();
    }
    // The body is never read: the answer is the status. Release the stream.
    void response.body?.cancel().catch(() => undefined);

    if (response.ok) return;

    if (response.status === 429) {
      const retryAfter = response.headers.get('retry-after')?.trim();
      throw new HttpError(
        429,
        ERROR_CODES.RATE_LIMITED,
        'Too much feedback has been sent recently. Try again later.',
        undefined,
        retryAfter && /^\d+$/.test(retryAfter) ? { 'Retry-After': retryAfter } : undefined,
      );
    }

    const redirected = response.status >= 300 && response.status < 400;
    logger.warn(
      {
        relayHost: relay.host,
        status: response.status,
        ...(redirected
          ? {
              hint:
                'The relay answered with a redirect, which is not followed. Check ' +
                `${ADMIN_FEEDBACK_SETTING_CODES.RELAY_URL} — the address may need a trailing slash.`,
            }
          : {}),
      },
      '[admin_feedback] the feedback relay refused the message',
    );
    throw deliveryFailed();
  }

  /** The configured relay address, or a refusal. */
  private async relayUrl(): Promise<URL> {
    const raw = (
      await this.deps.settings.get(ADMIN_FEEDBACK_SETTING_CODES.RELAY_URL, null, z.string())
    ).trim();
    if (raw === '') throw notConfigured();
    let url: URL | null = null;
    try {
      url = new URL(raw);
    } catch {
      url = null;
    }
    if (url === null || (url.protocol !== 'https:' && url.protocol !== 'http:')) {
      this.deps.logger.warn(
        { setting: ADMIN_FEEDBACK_SETTING_CODES.RELAY_URL, scheme: url?.protocol ?? null },
        '[admin_feedback] the relay address is not an http(s) URL; feedback is not sent',
      );
      throw notConfigured();
    }
    return url;
  }

  private async payloadFor(
    request: AdminFeedbackRequest,
    identity: AdminFeedbackSenderIdentity,
  ): Promise<AdminFeedbackRelayPayload> {
    const admin = await this.deps.adminUsers.findById(identity.adminUserId);
    const fullName = admin ? `${admin.firstName} ${admin.lastName}`.trim() : '';
    const phone = request.phone?.trim() ?? '';
    return {
      kind: 'admin_feedback',
      message: request.message,
      email: request.email,
      phone: phone === '' ? null : phone,
      language: request.language ?? null,
      platformVersion: this.deps.platformVersion,
      adminUrl: request.adminUrl ?? null,
      apiUrl: this.deps.apiUrl(),
      adminName: admin ? (fullName === '' ? admin.email : fullName) : null,
      adminUserId: identity.adminUserId,
    };
  }
}

function notConfigured(): HttpError {
  return new HttpError(
    503,
    ERROR_CODES.ADMIN_FEEDBACK_NOT_CONFIGURED,
    'Sending feedback is switched off on this instance.',
  );
}

function deliveryFailed(): HttpError {
  return new HttpError(
    502,
    ERROR_CODES.ADMIN_FEEDBACK_DELIVERY_FAILED,
    'Your feedback could not be delivered. Try again later.',
  );
}
