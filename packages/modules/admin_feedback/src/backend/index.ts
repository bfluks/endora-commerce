import type { FastifyRequest } from 'fastify';
import type { AdminUserReadPort } from '@endora-commerce/contracts';
import {
  configuredPublicApiBaseUrl,
  lazyPort,
  type ModuleContext,
  type RequireAdminFactory,
  type SettingsReadPort,
} from '@endora-commerce/platform/kernel';
import { AdminFeedbackSender } from './feedback-sender.js';
import { readPlatformRelease } from './platform-release.js';
import { registerAdminFeedbackRoutes } from './routes.js';

/**
 * `admin_feedback` — an administrator's feedback, relayed to the makers of
 * Endora Commerce (issue #379). No table, no worker, no subscriber: one
 * service and one route.
 */
export interface AdminFeedbackCradle {
  readonly requireAdmin: RequireAdminFactory;
  readonly adminContextResolver: (request: FastifyRequest) => { adminUserId: string };
  readonly adminFeedbackSender: AdminFeedbackSender;
}

export function registerModule(ctx: ModuleContext): void {
  ctx.di.register({
    adminFeedbackSender: ctx
      .asFunction(
        () =>
          new AdminFeedbackSender({
            // Ports of other modules — lazy, resolved per call, never captured.
            settings: lazyPort<SettingsReadPort>(ctx, 'settingsReadPort'),
            adminUsers: lazyPort<AdminUserReadPort>(ctx, 'adminUserReadPort'),
            // Looked up per call rather than captured, so a test stubbing the
            // global reaches the sender it already composed.
            fetch: (url, init) => globalThis.fetch(url, init),
            platformVersion: readPlatformRelease(),
            apiUrl: () => configuredPublicApiBaseUrl(),
            logger: ctx.log,
          }),
      )
      .singleton(),
  });

  ctx.routes(async (app) => {
    const { adminFeedbackSender, requireAdmin, adminContextResolver } =
      ctx.cradle<AdminFeedbackCradle>();
    await registerAdminFeedbackRoutes(app, {
      sender: adminFeedbackSender,
      requireAdmin,
      resolveAdminContext: adminContextResolver,
    });
  });
}

/**
 * The module's persisted entity classes (D-168). Feedback is stored nowhere,
 * so the array is empty and stays empty.
 */
export const entities: readonly never[] = [];
