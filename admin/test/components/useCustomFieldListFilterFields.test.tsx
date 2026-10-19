import { StrictMode, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import { useCustomFieldListFilterFields } from '@endora-commerce/admin-kit/components';
import type { CustomFieldListFilterField } from '@endora-commerce/contracts';

/**
 * Feature 157 (T040) — `useCustomFieldListFilterFields`
 * (`specs/157-custom-fields-list-filters/contracts/admin-surfaces.md` §1.1).
 * `apiClient` is replaced through the kit's `lib` barrel, the one seam a test
 * outside the package can name.
 */

const api = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return { ...actual, apiClient: { get: (...args: unknown[]) => api.get(...args) } };
});

const ENDPOINT = '/api/v1/admin/orders/custom-field-filters';
const FIELDS: CustomFieldListFilterField[] = [
  { key: 'region', valueType: 'select', label: { en: 'Region' }, labelDefault: 'Region', options: [] },
];

function strict({ children }: { children: ReactNode }): ReactNode {
  return <StrictMode>{children}</StrictMode>;
}

beforeEach(() => {
  api.get.mockReset();
});

describe('useCustomFieldListFilterFields', () => {
  it('reaches ready with the fields after the StrictMode double mount', async () => {
    api.get.mockResolvedValue({ data: FIELDS });
    const { result } = renderHook(() => useCustomFieldListFilterFields(ENDPOINT), { wrapper: strict });
    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.fields).toEqual(FIELDS);
    expect(api.get).toHaveBeenCalledWith(ENDPOINT);
  });

  it('reaches error on a failed read, with no fields', async () => {
    api.get.mockRejectedValue(new ApiError(500, { error: { code: 'INTERNAL', message: 'boom' } }));
    const { result } = renderHook(() => useCustomFieldListFilterFields(ENDPOINT), { wrapper: strict });
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.fields).toEqual([]);
  });

  it('ignores a superseded request: a stale answer settling late never overwrites the current one', async () => {
    let settleFirst!: (value: unknown) => void;
    api.get
      .mockImplementationOnce(() => new Promise((resolve) => (settleFirst = resolve)))
      .mockResolvedValue({ data: FIELDS });
    const { result, rerender } = renderHook(({ endpoint }) => useCustomFieldListFilterFields(endpoint), {
      wrapper: strict,
      initialProps: { endpoint: '/api/v1/admin/quote-requests/custom-field-filters' },
    });
    expect(result.current.status).toBe('loading');
    rerender({ endpoint: ENDPOINT });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    settleFirst({ data: [] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(result.current.status).toBe('ready');
    expect(result.current.fields).toEqual(FIELDS);
  });

  it('reads again on reload, after a failure', async () => {
    api.get.mockRejectedValueOnce(new ApiError(500, { error: { code: 'INTERNAL', message: 'boom' } })).mockResolvedValue({ data: FIELDS });
    const { result } = renderHook(() => useCustomFieldListFilterFields(ENDPOINT), { wrapper: strict });
    await waitFor(() => expect(result.current.status).toBe('error'));
    result.current.reload();
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.fields).toEqual(FIELDS);
  });
});
