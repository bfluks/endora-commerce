// `@fastify/multipart` is registered here, by this module, for the one route
// that reads an upload — inside a child context of its own, so the parser and
// its limits reach no other route (Projects' `routes.attachments.ts`).
import multipart from '@fastify/multipart';
import type { FastifyInstance } from 'fastify';
import {
  CreateTaskAttachmentBodySchema,
  CreateTaskCommentBodySchema,
  CreateTaskLinkBodySchema,
  ERROR_CODES,
  TASK_ATTACHMENT_MAX_BYTES,
  UpdateTaskCommentBodySchema,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import type { TaskAttachmentService } from '../services/attachment-service.js';
import type { TaskCommentService } from '../services/comment-service.js';
import type { TaskRecordLinkService } from '../services/record-link-service.js';
import type { TaskRelationService } from '../services/relation-service.js';

export interface TaskCollaborationRoutesDeps {
  attachmentService: TaskAttachmentService;
  commentService: TaskCommentService;
  relationService: TaskRelationService;
  recordLinkService: TaskRecordLinkService;
  requireAdmin: RequireAdminFactory;
}

const API = '/api/v1/admin/tasks';

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
 * A Task's collaboration routes (`specs/165-task-management/contracts/admin-api.md`
 * §2) — the attachments from User Story 1, comments from User Story 4,
 * related Tasks from User Story 5, record links from User Story 6; reminders
 * arrive with User Story 7.
 *
 * Reading the list is `tasks:read`, and that is enough to download: each entry
 * carries a link this module resolved. The upload — a file of the caller's own
 * — is `tasks:write` alone, at `POST …/attachments/upload` (multipart).
 * **Attaching a file of the library by its id, `POST …/attachments`, also asks
 * for the library's `assets.read`** (CRM's and Projects' rule): without it,
 * somebody who knew the id of a private file could attach it and read a signed
 * link off the list. `assets_library` cannot be switched off, so its code is
 * asked on the route.
 */
export async function registerTaskCollaborationRoutes(
  app: FastifyInstance,
  deps: TaskCollaborationRoutesDeps,
): Promise<void> {
  const {
    requireAdmin,
    attachmentService: attachments,
    commentService: comments,
    relationService: relations,
    recordLinkService: links,
  } = deps;

  // Record links (FR-031, R-16): `tasks:write`. The record's own read code is
  // asked by the service, after its owner's presence — a switchable owner's
  // code on the route would answer 403 where the contract says 422. Linking a
  // record already linked answers the existing link with 200.
  app.post<{ Params: { id: string } }>(
    `${API}/:id/links`,
    { preHandler: requireAdmin('tasks:write'), schema: { body: CreateTaskLinkBodySchema } },
    async (request, reply) => {
      const { link, created } = await links.link(request.params.id, CreateTaskLinkBodySchema.parse(request.body));
      reply.code(created ? 201 : 200);
      return { data: link };
    },
  );

  // Never validated against the record: a link of a module that is off can be removed.
  app.delete<{ Params: { id: string; linkId: string } }>(
    `${API}/:id/links/:linkId`,
    { preHandler: requireAdmin('tasks:write') },
    async (request, reply) => {
      await links.unlink(request.params.id, request.params.linkId);
      return reply.code(204).send();
    },
  );

  // Related Tasks (FR-030): `tasks:write`, and the service asks that the caller
  // may see and change **both** Tasks. Idempotent both ways: 204 whether or not
  // anything changed.
  app.put<{ Params: { id: string; otherId: string } }>(
    `${API}/:id/relations/:otherId`,
    { preHandler: requireAdmin('tasks:write') },
    async (request, reply) => {
      await relations.relate(request.params.id, request.params.otherId);
      return reply.code(204).send();
    },
  );

  app.delete<{ Params: { id: string; otherId: string } }>(
    `${API}/:id/relations/:otherId`,
    { preHandler: requireAdmin('tasks:write') },
    async (request, reply) => {
      await relations.unrelate(request.params.id, request.params.otherId);
      return reply.code(204).send();
    },
  );

  app.get<{ Params: { id: string } }>(
    `${API}/:id/comments`,
    { preHandler: requireAdmin('tasks:read') },
    async (request) => ({ data: await comments.list(request.params.id) }),
  );

  app.post<{ Params: { id: string } }>(
    `${API}/:id/comments`,
    { preHandler: requireAdmin('tasks:read'), schema: { body: CreateTaskCommentBodySchema } },
    async (request, reply) => {
      const body = CreateTaskCommentBodySchema.parse(request.body);
      const comment = await comments.add(request.params.id, body.body);
      reply.code(201);
      return { data: comment };
    },
  );

  app.patch<{ Params: { id: string; commentId: string } }>(
    `${API}/:id/comments/:commentId`,
    { preHandler: requireAdmin('tasks:read'), schema: { body: UpdateTaskCommentBodySchema } },
    async (request) => {
      const body = UpdateTaskCommentBodySchema.parse(request.body);
      return { data: await comments.update(request.params.id, request.params.commentId, body.body) };
    },
  );

  app.delete<{ Params: { id: string; commentId: string } }>(
    `${API}/:id/comments/:commentId`,
    { preHandler: requireAdmin('tasks:read') },
    async (request, reply) => {
      await comments.delete(request.params.id, request.params.commentId);
      return reply.code(204).send();
    },
  );

  app.get<{ Params: { id: string } }>(
    `${API}/:id/attachments`,
    { preHandler: requireAdmin('tasks:read') },
    async (request) => ({ data: await attachments.list(request.params.id) }),
  );

  app.post<{ Params: { id: string } }>(
    `${API}/:id/attachments`,
    {
      preHandler: [requireAdmin('tasks:write'), requireAdmin(ASSETS_READ_PERMISSION)],
      schema: { body: CreateTaskAttachmentBodySchema },
    },
    async (request, reply) => {
      const body = CreateTaskAttachmentBodySchema.parse(request.body);
      const { attachment, created } = await attachments.add(request.params.id, body.assetId);
      // 200, not 201, for a file the Task already had: nothing was created.
      reply.code(created ? 201 : 200);
      return { data: attachment };
    },
  );

  app.delete<{ Params: { id: string; attachmentId: string } }>(
    `${API}/:id/attachments/:attachmentId`,
    { preHandler: requireAdmin('tasks:write') },
    async (request, reply) => {
      await attachments.remove(request.params.id, request.params.attachmentId);
      return reply.code(204).send();
    },
  );

  await app.register(async (upload) => {
    await upload.register(multipart, {
      limits: { files: 1, fields: 10, fileSize: TASK_ATTACHMENT_MAX_BYTES },
    });

    // The file is read whole before it is handed on: a multipart part carries
    // no length, and the library can hold a file to its size limit only when
    // told the size. `TASK_ATTACHMENT_MAX_BYTES` bounds that read.
    upload.post<{ Params: { id: string } }>(
      `${API}/:id/attachments/upload`,
      { preHandler: requireAdmin('tasks:write') },
      async (request, reply) => {
        if (!request.isMultipart()) throw noFile();
        // The Task before the body: one the caller cannot see is 404 without a
        // byte of the file having been read.
        await attachments.assertWritable(request.params.id);
        const file = await request.file();
        if (!file) throw noFile();
        let bytes: Buffer;
        try {
          bytes = await file.toBuffer();
        } catch (error) {
          if ((error as { code?: string }).code !== 'FST_REQ_FILE_TOO_LARGE') throw error;
          const maxMb = TASK_ATTACHMENT_MAX_BYTES / (1024 * 1024);
          throw new HttpError(413, ERROR_CODES.TASK_ATTACHMENT_REFUSED, `An attachment may be at most ${maxMb} MB.`, {
            reason: 'too_large',
            maxMb,
          });
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
