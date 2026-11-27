import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ERROR_CODES,
  TASK_ATTACHMENT_MAX_BYTES,
  TaskAttachmentListResponseSchema,
  TaskAttachmentResponseSchema,
  TaskDetailResponseSchema,
  type AssetReferenceRegistryPort,
  type TaskAttachment,
  type TaskDetail,
} from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import { Asset } from '../../helpers/package-entities.js';
import { removeCrmAssets, seedCrmAdmin, seedCrmAsset } from '../../helpers/seed-crm.js';
import { multipartBody, TINY_PNG, useTemporaryAssetStore } from '../../helpers/crm-attachment-upload.js';

/**
 * Files attached to a Task (`specs/165-task-management/` US1 scenario 7, FR-008,
 * research R-7; `contracts/admin-api.md` §2) — Projects' model.
 *
 * An attachment is a private file of the asset library, uploaded by anybody
 * who may write Tasks, listed with its name, size, uploader and time and a
 * download link. A document a browser would run is refused (415
 * `TASK_ATTACHMENT_REFUSED`), and so is a file over 25 MB. The library refuses
 * to delete a file a Task uses — also while Tasks is off — and lets go of it
 * when the attachment is removed. A Task the caller may not see answers every
 * attachment route 404.
 */
describe('tasks — attachments (US1)', () => {
  let h: BackendServerHandle;
  type Person = { cookies: { b2b_session: string }; adminUserId: string; undo: () => void };
  let writer: Person;
  let stranger: Person;
  let task: TaskDetail;
  let store: Awaited<ReturnType<typeof useTemporaryAssetStore>>;
  const admin = { b2b_session: 'stub-admin-session' };
  const API = '/api/v1/admin/tasks';
  const created: string[] = [];
  const assets: string[] = [];

  const call = (method: 'GET' | 'POST' | 'DELETE', path: string, payload?: unknown, cookies: Record<string, string> = admin) =>
    h.app.inject({
      method,
      url: `${API}${path}`,
      cookies,
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });

  function uploadRaw(taskId: string, file: { filename: string; mime?: string; value: Buffer | string }, who?: Person) {
    const { body, contentType } = multipartBody([{ name: 'file', ...file }]);
    return h.app.inject({
      method: 'POST',
      url: `${API}/${taskId}/attachments/upload`,
      headers: { 'content-type': contentType },
      cookies: who?.cookies ?? admin,
      payload: body,
    });
  }

  async function upload(taskId: string, file: { filename: string; mime?: string; value: Buffer | string }, who?: Person) {
    const response = await uploadRaw(taskId, file, who);
    expect(response.statusCode, response.body).toBe(201);
    const { data } = TaskAttachmentResponseSchema.parse(response.json());
    assets.push(data.assetId);
    return data;
  }

  async function list(taskId: string, who?: Person): Promise<TaskAttachment[]> {
    const response = await call('GET', `/${taskId}/attachments`, undefined, who?.cookies ?? admin);
    expect(response.statusCode, response.body).toBe(200);
    return TaskAttachmentListResponseSchema.parse(response.json()).data;
  }

  const registry = () => h.container.resolve<AssetReferenceRegistryPort>('assetReferenceRegistry');
  const audit = (taskId: string) =>
    h.auditLogService.query({ objectType: 'task', objectId: taskId }).then((rows) => rows.map((r) => r.action).reverse());

  beforeAll(async () => {
    h = await setupBackendServer();
    store = await useTemporaryAssetStore(h);
    writer = await seedCrmAdmin(h.em(), 'task-att-writer', ['tasks:read', 'tasks:write']);
    stranger = await seedCrmAdmin(h.em(), 'task-att-stranger', ['tasks:read', 'tasks:write', 'assets.read']);
    const response = await call('POST', '', { title: 'With files' });
    expect(response.statusCode, response.body).toBe(201);
    task = TaskDetailResponseSchema.parse(response.json()).data;
    created.push(task.id);
  });

  afterAll(async () => {
    writer?.undo();
    stranger?.undo();
    if (created.length > 0) {
      await h.em().getConnection().execute(`delete from "tasks" where "id" = any(?::uuid[])`, [`{${created.join(',')}}`]);
    }
    await removeCrmAssets(h.em(), assets);
    await store.undo();
    await teardownBackendServer(h);
  });

  it('uploads a private file for a Tasks writer, lists it with name, size, uploader and time, and removes it — audited', async () => {
    const attached = await upload(task.id, { filename: 'plan.png', mime: 'image/png', value: TINY_PNG }, writer);
    expect(attached).toMatchObject({ fileName: 'plan.png', mimeType: 'image/png', uploadedBy: { id: writer.adminUserId } });
    expect(attached.sizeBytes).toBe(TINY_PNG.byteLength);
    expect(Date.parse(attached.createdAt)).not.toBeNaN();
    expect((await h.em().findOneOrFail(Asset, { id: attached.assetId }, { filters: false })).visibility).toBe('private');

    const listed = await list(task.id, writer);
    expect(listed.map((row) => row.id)).toEqual([attached.id]);
    expect(listed[0]?.url).toMatch(/[?&]download=1/);
    const detail = TaskDetailResponseSchema.parse((await call('GET', `/${task.id}`)).json()).data;
    expect(detail.attachmentsCount).toBe(1);

    const removed = await call('DELETE', `/${task.id}/attachments/${attached.id}`, undefined, writer.cookies);
    expect(removed.statusCode, removed.body).toBe(204);
    expect(await list(task.id)).toEqual([]);
    expect(await audit(task.id)).toEqual(
      expect.arrayContaining(['tasks.attachment.add', 'tasks.attachment.remove']),
    );
  });

  it('refuses an HTML page and an SVG — 415 TASK_ATTACHMENT_REFUSED, nothing stored', async () => {
    for (const file of [
      { filename: 'page.html', mime: 'text/html', value: '<script>1</script>' },
      { filename: 'image.svg', mime: 'image/svg+xml', value: '<svg/>' },
    ]) {
      const response = await uploadRaw(task.id, file);
      expect(response.statusCode, response.body).toBe(415);
      expect(response.json().error.code).toBe(ERROR_CODES.TASK_ATTACHMENT_REFUSED);
      expect(await h.em().count(Asset, { filename: file.filename }, { filters: false })).toBe(0);
    }
  });

  it('refuses a file over 25 MB', async () => {
    const response = await uploadRaw(task.id, {
      filename: 'too-large.bin',
      value: Buffer.alloc(TASK_ATTACHMENT_MAX_BYTES + 1, 0x41),
    });
    expect(response.statusCode, response.body.slice(0, 400)).toBe(413);
    expect(response.json().error.code).toBe(ERROR_CODES.TASK_ATTACHMENT_REFUSED);
  });

  it('attaches a file of the library by id only with the library’s read code', async () => {
    const file = await seedCrmAsset(h.em());
    assets.push(file.id);
    const refused = await call('POST', `/${task.id}/attachments`, { assetId: file.id }, writer.cookies);
    expect(refused.statusCode, refused.body).toBe(403);
    const ok = await call('POST', `/${task.id}/attachments`, { assetId: file.id });
    expect(ok.statusCode, ok.body).toBe(201);
    const again = await call('POST', `/${task.id}/attachments`, { assetId: file.id });
    expect(again.statusCode, again.body).toBe(200);
    expect(again.json().data.id).toBe(ok.json().data.id);
    await call('DELETE', `/${task.id}/attachments/${ok.json().data.id}`);
  });

  it('the library refuses to delete a file a Task uses — also with Tasks off — and lets go once it is removed', async () => {
    const attached = await upload(task.id, { filename: 'kept.png', mime: 'image/png', value: TINY_PNG });
    expect(registry().owners()).toContain('tasks');
    expect(await registry().findReferences(attached.assetId)).toEqual([
      { kind: 'task_attachment', entityId: task.id, label: `Task ${task.number}`, assetId: attached.assetId },
    ]);
    const refused = await h.app.inject({ method: 'DELETE', url: `/api/v1/admin/assets/${attached.assetId}`, cookies: admin });
    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.json().error.code).toBe(ERROR_CODES.ASSET_REFERENCED);
    expect(refused.body).toContain(`Task ${task.number}`);

    await withModuleOff('tasks', 'deactivated', async () => {
      const whileOff = await h.app.inject({ method: 'DELETE', url: `/api/v1/admin/assets/${attached.assetId}`, cookies: admin });
      expect(whileOff.statusCode, whileOff.body).toBe(409);
    });

    expect((await call('DELETE', `/${task.id}/attachments/${attached.id}`)).statusCode).toBe(204);
    expect(await registry().findReferences(attached.assetId)).toEqual([]);
  });

  it('answers every attachment route for a Task the caller may not see as for one that does not exist', async () => {
    const privateId = randomUUID();
    await h
      .em()
      .getConnection()
      .execute(
        `insert into "tasks" ("id", "number", "title", "created_by_admin_user_id", "is_private", "published_at", "created_at", "updated_at")
         values (?, ?, 'Private files', ?, true, now(), now(), now())`,
        [privateId, `TSK-A${privateId.slice(0, 8)}`.toUpperCase(), TEST_ADMIN_ID],
      );
    created.push(privateId);
    const missing = randomUUID();
    for (const [method, path] of [
      ['GET', '/:id/attachments'],
      ['DELETE', `/:id/attachments/${randomUUID()}`],
    ] as const) {
      const hidden = await call(method, path.replace(':id', privateId), undefined, stranger.cookies);
      const none = await call(method, path.replace(':id', missing), undefined, stranger.cookies);
      expect(hidden.statusCode, hidden.body).toBe(404);
      expect(none.statusCode, none.body).toBe(404);
      expect(hidden.json().error.code).toBe(none.json().error.code);
    }
    const before = await h.em().count(Asset, { filename: 'not-stored.png' }, { filters: false });
    const refused = await uploadRaw(privateId, { filename: 'not-stored.png', mime: 'image/png', value: TINY_PNG }, stranger);
    expect(refused.statusCode, refused.body).toBe(404);
    expect(await h.em().count(Asset, { filename: 'not-stored.png' }, { filters: false })).toBe(before);
  });

  /**
   * FR-006 (`specs/166-asset-reference-visibility/` research R-13, F-19): a file
   * the library hides from the caller is not there to attach. Here it is held
   * by **another** module's record — a members-only Project the caller is not a
   * Member of — so Tasks' own holder check cannot see it; and one of the two is
   * **public**, so the refusal must come before the private-file one to give
   * the missing-file sentence.
   */
  describe('attaching a file the library hides from the caller (feature 166, FR-006)', () => {
    const hiddenProject = randomUUID();
    let reader: Person;

    beforeAll(async () => {
      reader = await seedCrmAdmin(h.em(), 'task-att-fr6', ['tasks:read', 'tasks:write', 'projects:read', 'assets.read']);
      const stageId = randomUUID();
      const connection = h.orm.em.getConnection();
      await connection.transactional(async (trx) => {
        await connection.execute(
          `insert into "projects" ("id", "number", "title", "visibility", "created_by_admin_user_id")
           values (?, ?, 'Members only', 'members_and_listed', ?)`,
          [hiddenProject, `PRJ-F6${hiddenProject.slice(0, 8)}`.toUpperCase(), TEST_ADMIN_ID],
          'run',
          trx,
        );
        await connection.execute(
          `insert into "project_stages" ("id", "project_id", "name", "color", "position") values (?, ?, 'Design', '#3b82f6', 1)`,
          [stageId, hiddenProject],
          'run',
          trx,
        );
        await connection.execute(`update "projects" set "current_stage_id" = ? where "id" = ?`, [stageId, hiddenProject], 'run', trx);
      });
    });

    afterAll(async () => {
      reader?.undo();
      await h.em().getConnection().execute(`delete from "projects" where "id" = ?`, [hiddenProject]);
    });

    it.each(['private', 'public'] as const)(
      'refuses a %s file held only by a Project the caller may not see — the missing-file 422',
      async (visibility) => {
        const own = await call('POST', '', { title: `Own ${visibility}` }, reader.cookies);
        expect(own.statusCode, own.body).toBe(201);
        const ownTask = TaskDetailResponseSchema.parse(own.json()).data;
        created.push(ownTask.id);
        const file = await seedCrmAsset(h.em(), { visibility });
        assets.push(file.id);
        await h
          .em()
          .getConnection()
          .execute(`insert into "project_attachments" ("project_id", "asset_id", "added_by_admin_user_id") values (?, ?, ?)`, [
            hiddenProject,
            file.id,
            TEST_ADMIN_ID,
          ]);

        const hidden = await call('POST', `/${ownTask.id}/attachments`, { assetId: file.id }, reader.cookies);
        const missing = await call('POST', `/${ownTask.id}/attachments`, { assetId: randomUUID() }, reader.cookies);
        expect(missing.statusCode, missing.body).toBe(422);
        expect(hidden.statusCode, hidden.body).toBe(422);
        const shape = (body: string) => {
          const { requestId: _requestId, ...rest } = (JSON.parse(body) as { error: Record<string, unknown> }).error;
          return rest;
        };
        expect(shape(hidden.body)).toEqual(shape(missing.body));
        expect(shape(hidden.body)).toMatchObject({
          code: ERROR_CODES.VALIDATION_FAILED,
          message: 'The file does not exist in the media library.',
        });
        expect(await list(ownTask.id, reader)).toEqual([]);

        // The control: the Platform administrator sees the Project, so the file is there to attach
        // — and is then refused for what it is (a public file), not for being missing.
        const forAdmin = await call('POST', `/${ownTask.id}/attachments`, { assetId: file.id });
        if (visibility === 'private') {
          expect(forAdmin.statusCode, forAdmin.body).toBe(201);
        } else {
          expect(forAdmin.statusCode, forAdmin.body).toBe(422);
          expect(forAdmin.json().error.message).not.toBe('The file does not exist in the media library.');
        }
      },
    );
  });
});
