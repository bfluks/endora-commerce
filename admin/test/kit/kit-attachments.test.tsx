import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AttachmentUploader, uploadAttachment } from '@endora-commerce/admin-kit/components';
import { ApiError } from '@endora-commerce/admin-kit/lib';

/**
 * Adding a file to a record, promoted from CRM into the kit
 * (`specs/163-projects-and-tasks/` research R-17; T099): the control hands a
 * file over and does nothing else, and `uploadAttachment` posts it, multipart,
 * to **the endpoint its caller names** — the record's own upload, behind the
 * record's permission rather than the media library's.
 */

const fetchSpy = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();

beforeEach(() => {
  fetchSpy.mockReset();
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const pdf = (name: string): File => new File(['%PDF-1.7'], name, { type: 'application/pdf' });

describe('AttachmentUploader', () => {
  it('hands over the file chosen with its button, and takes none while busy', async () => {
    const onFile = vi.fn();
    const { container, rerender } = render(
      <AttachmentUploader label="Add file" hint="Drop a file here" busy={false} onFile={onFile} />,
    );
    expect(screen.getByText('Drop a file here')).toBeInTheDocument();
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, pdf('offer.pdf'));
    expect(onFile).toHaveBeenCalledTimes(1);
    expect((onFile.mock.calls[0]![0] as File).name).toBe('offer.pdf');

    rerender(<AttachmentUploader label="Add file" hint="Uploading…" busy onFile={onFile} />);
    expect(screen.getByRole('button', { name: 'Add file' })).toBeDisabled();
  });

  it('hands over a dropped file', () => {
    const onFile = vi.fn();
    render(<AttachmentUploader label="Add file" hint="Drop a file here" busy={false} onFile={onFile} />);
    fireEvent.drop(screen.getByText('Drop a file here').parentElement as HTMLElement, {
      dataTransfer: { files: [pdf('drawing.pdf')] },
    });
    expect((onFile.mock.calls[0]![0] as File).name).toBe('drawing.pdf');
  });
});

describe('uploadAttachment', () => {
  it('posts the file, multipart, to the endpoint it is given, with the session cookie', async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ data: { id: 'a1' } }), { status: 201 }));
    const answer = await uploadAttachment<{ id: string }>('/api/v1/admin/projects/p1/attachments/upload', pdf('offer.pdf'));
    expect(answer).toEqual({ id: 'a1' });
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toMatch(/\/api\/v1\/admin\/projects\/p1\/attachments\/upload$/);
    expect(init?.method).toBe('POST');
    expect(init?.credentials).toBe('include');
    expect((init?.body as FormData).get('file')).toBeInstanceOf(File);
  });

  it('throws the refusal as the client’s own ApiError, sentence and all', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'ASSET_TYPE_NOT_ALLOWED', message: 'This file type is not allowed.' } }), {
        status: 415,
      }),
    );
    const failure = await uploadAttachment('/api/v1/admin/projects/p1/attachments/upload', pdf('x.exe')).catch(
      (caught: unknown) => caught,
    );
    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).status).toBe(415);
    expect((failure as ApiError).envelope.error.message).toBe('This file type is not allowed.');
  });
});
