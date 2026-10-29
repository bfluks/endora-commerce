/**
 * Triggers on-demand revalidation of the storefront's tagged fetch caches
 * (feature 049; promoted to shared HTTP infrastructure in feature 066). It has
 * no module-specific content — it POSTs cache tags to the storefront's
 * revalidate endpoint — and four modules need it, so it lives here rather than
 * inside one of them (Principle I).
 *
 * Best-effort: a failed call is logged and swallowed so a config/custom-event
 * write never fails because the storefront is unreachable. Disabled (no-op)
 * when the base URL or secret is not configured.
 *
 * A call is bounded by {@link REVALIDATE_TIMEOUT_MS}, and a non-2xx answer is a
 * failure like a transport error (feature 163, security review M2): a `401` from a
 * secret the two sides disagree on used to pass in silence, leaving every tagged
 * entry stale. The log names the status and the tags, never the secret.
 */

/** How long one revalidation call may take before it is abandoned. */
const REVALIDATE_TIMEOUT_MS = 5_000;

export interface StorefrontRevalidatorOptions {
  baseUrl: string | undefined;
  secret: string | undefined;
  fetchFn?: typeof fetch;
  logger?: { warn: (obj: unknown, msg: string) => void };
}

export class StorefrontRevalidator {
  private logger: StorefrontRevalidatorOptions['logger'];

  constructor(private readonly options: StorefrontRevalidatorOptions) {
    this.logger = options.logger;
  }

  /** Attach a logger once the Fastify app (and its `log`) exists. */
  setLogger(logger: NonNullable<StorefrontRevalidatorOptions['logger']>): void {
    this.logger = logger;
  }

  get enabled(): boolean {
    return !!this.options.baseUrl && !!this.options.secret;
  }

  async revalidate(tags: string[]): Promise<void> {
    if (!this.enabled || tags.length === 0) return;
    const fetchFn = this.options.fetchFn ?? globalThis.fetch;
    try {
      const response = await fetchFn(`${this.options.baseUrl}/api/revalidate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-revalidate-secret': this.options.secret as string,
        },
        body: JSON.stringify({ tags }),
        signal: AbortSignal.timeout(REVALIDATE_TIMEOUT_MS),
      });
      if (!response.ok) {
        this.logger?.warn(
          { status: response.status, tags: tags.length },
          '[storefront-revalidate] the storefront refused the revalidation',
        );
      }
    } catch (err) {
      this.logger?.warn({ err, tags: tags.length }, '[storefront-revalidate] failed');
    }
  }
}
