// `config: { rateLimit }` is a declaration-merging augmentation of
// `@fastify/rate-limit`, which the host registers globally.
import type {} from '@fastify/rate-limit';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AdminFeedbackRequestSchema } from '@endora-commerce/contracts';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import type { AdminFeedbackSender } from './feedback-sender.js';

export interface AdminFeedbackRouteDeps {
  readonly sender: AdminFeedbackSender;
  readonly requireAdmin: RequireAdminFactory;
  readonly resolveAdminContext: (request: FastifyRequest) => { adminUserId: string };
}

/**
 * Sends per administrator per ten minutes. Generous for a person writing to
 * support, tight enough that a stuck client or a scripted session cannot turn
 * the instance into a mail cannon aimed at the relay.
 */
export const ADMIN_FEEDBACK_SEND_RATE_LIMIT = {
  max: 5,
  timeWindow: '10 minutes',
  // After the guard: an anonymous caller is answered 401 and spends nothing.
  hook: 'preHandler' as const,
  keyGenerator: (request: FastifyRequest): string => {
    const actor = request.actor as { kind?: string; adminUserId?: string } | undefined;
    return `admin-feedback-send:${actor?.kind === 'admin' ? actor.adminUserId : request.ip}`;
  },
};

/**
 * `POST /api/v1/admin/feedback` (issue #379).
 *
 * **No permission code, deliberately**: any signed-in administrator may write
 * to support, whatever their role — the person who most needs to report a
 * broken screen is often the one whose role cannot open much else. The route
 * reads nothing of the instance's and changes nothing; it is listed with that
 * reason in `backend/test/helpers/permissionless-admin-routes.ts`.
 *
 * Registered through `ctx.routes`, so a switched-off module answers 503
 * `MODULE_DISABLED`.
 */
export async function registerAdminFeedbackRoutes(
  app: FastifyInstance,
  deps: AdminFeedbackRouteDeps,
): Promise<void> {
  const { sender, requireAdmin, resolveAdminContext } = deps;

  app.post(
    '/api/v1/admin/feedback',
    {
      preHandler: requireAdmin(),
      config: { rateLimit: ADMIN_FEEDBACK_SEND_RATE_LIMIT },
    },
    async (request, reply) => {
      const body = AdminFeedbackRequestSchema.parse(request.body ?? {});
      const { adminUserId } = resolveAdminContext(request);
      await sender.send(body, { adminUserId });
      return reply.status(204).send();
    },
  );
}
