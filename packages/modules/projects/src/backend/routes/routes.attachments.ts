// `@fastify/multipart` is registered here, by this module, for the one route
// that reads an upload — inside a child context of its own, so the parser and
// its limits reach no other route (CRM's `routes.attachment-upload.ts`).
import multipart from '@fastify/multipart';
import type { FastifyInstance } from 'fastify';
import {
  CreateProjectAttachmentBodySchema,
  ERROR_CODES,
  PROJECT_ATTACHMENT_MAX_BYTES,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import type { ProjectAttachmentService } from '../services/attachment-service.js';

export interface AttachmentRoutesDeps {
  attachmentService: ProjectAttachmentService;
  requireAdmin: RequireAdminFactory;
}

/** The code the asset library reads a file with — a dot, as its manifest declares it. */
const ASSETS_READ_PERMISSION = 'assets.read';

function noFile(): HttpError {
  return new HttpError(
    400,
    ERROR_CODES.VALIDATION_FAILED,
    'Send the file as the `file` part of a multipart/form-data request.',
  );
}

/**
 * Files attached to a Project (`contracts/admin-api.md` §2.4).
 *
 * Reading the list is `projects:read`, and that is enough to download: each
 * entry carries a link this module resolved. The upload — a file of the
 * caller's own — is `projects:write` alone. **Attaching a file of the library
 * by its id also asks for the library's `assets.read`** (CRM's rule, research
 * N-B17): without it, somebody who knew the id of a private file could attach
 * it and read a signed link off the list. `assets_library` cannot be switched
 * off, so its code is asked on the route.
 */
export async function registerAttachmentRoutes(app: FastifyInstance, deps: AttachmentRoutesDeps): Promise<void> {
  const { requireAdmin, attachmentService: attachments } = deps;

  app.get<{ Params: { id: string } }>(
    '/api/v1/admin/projects/:id/attachments',
    { preHandler: requireAdmin('projects:read') },
    async (request) => ({ data: await attachments.list(request.params.id) }),
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/projects/:id/attachments',
    {
      preHandler: [requireAdmin('projects:write'), requireAdmin(ASSETS_READ_PERMISSION)],
      schema: { body: CreateProjectAttachmentBodySchema },
    },
    async (request, reply) => {
      const body = CreateProjectAttachmentBodySchema.parse(request.body);
      const { attachment, created } = await attachments.add(request.params.id, body.assetId);
      // 200, not 201, for a file the Project already had: nothing was created.
      reply.code(created ? 201 : 200);
      return { data: attachment };
    },
  );

  app.delete<{ Params: { id: string; attachmentId: string } }>(
    '/api/v1/admin/projects/:id/attachments/:attachmentId',
    { preHandler: requireAdmin('projects:write') },
    async (request, reply) => {
      await attachments.remove(request.params.id, request.params.attachmentId);
      return reply.code(204).send();
    },
  );

  await app.register(async (upload) => {
    await upload.register(multipart, {
      limits: { files: 1, fields: 10, fileSize: PROJECT_ATTACHMENT_MAX_BYTES },
    });

    // The file is read whole before it is handed on: a multipart part carries
    // no length, and the library can hold a file to its size limit only when
    // told the size. `PROJECT_ATTACHMENT_MAX_BYTES` bounds that read.
    upload.post<{ Params: { id: string } }>(
      '/api/v1/admin/projects/:id/attachments/upload',
      { preHandler: requireAdmin('projects:write') },
      async (request, reply) => {
        if (!request.isMultipart()) throw noFile();
        // The Project before the body: one the caller cannot see is 404
        // without a byte of the file having been read.
        await attachments.assertReachable(request.params.id);
        const file = await request.file();
        if (!file) throw noFile();
        let bytes: Buffer;
        try {
          bytes = await file.toBuffer();
        } catch (error) {
          if ((error as { code?: string }).code !== 'FST_REQ_FILE_TOO_LARGE') throw error;
          const maxMb = PROJECT_ATTACHMENT_MAX_BYTES / (1024 * 1024);
          throw new HttpError(
            413,
            ERROR_CODES.PROJECT_ATTACHMENT_TOO_LARGE,
            `An attachment may be at most ${maxMb} MB.`,
            {
              maxMb,
            },
          );
        }
        const attachment = await attachments.upload(request.params.id, {
          filename: file.filename || 'attachment',
          declaredMime: file.mimetype || 'application/octet-stream',
          bytes,
        });
        reply.code(201);
        return { data: attachment };
      },
    );
  });
}
