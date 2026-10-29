import type { ErrorEnvelope } from '@endora-commerce/contracts';
import { ApiError, apiBaseUrl } from '../../lib/index.js';

/**
 * Upload a file and attach it to a record in one request — the record's own
 * upload endpoint, `path` (`/api/v1/admin/crm/opportunities/:id/attachments/upload`,
 * `/api/v1/admin/projects/:id/attachments/upload`), behind the record's write
 * permission rather than the media library's (CRM's `contracts/admin-api.md`
 * §7a; promoted by `specs/163-projects-and-tasks/` research R-17).
 *
 * The kit's `apiClient` speaks JSON only, so the multipart body goes through
 * `fetch` over the same origin and with the same session cookie. A refusal is
 * thrown as the client's own `ApiError`, so the sentence the backend resolved
 * — the media library's, when it is the library that refuses the file — is
 * shown as it arrived.
 */
export async function uploadAttachment<T>(path: string, file: File): Promise<T> {
  const body = new FormData();
  body.append('file', file, file.name);
  const response = await fetch(`${apiBaseUrl.replace(/\/+$/, '')}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { Accept: 'application/json' },
    body,
  });
  const payload = (await response.json().catch(() => null)) as { data: T } | ErrorEnvelope | null;
  if (!response.ok || payload === null || !('data' in payload)) {
    throw new ApiError(
      response.status,
      payload !== null && 'error' in payload
        ? payload
        : { error: { code: 'INTERNAL', message: `HTTP ${response.status}` } },
    );
  }
  return payload.data;
}
