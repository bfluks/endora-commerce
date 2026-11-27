import { useCallback, useEffect, useState } from 'react';
import type { CustomFieldListFilterField, CustomFieldListFilterFieldsResponse } from '@endora-commerce/contracts';
// The barrel, not `../../lib/api-client.js`: see `CustomFieldValuesPanel.tsx`.
import { apiClient } from '../../lib/index.js';

export type CustomFieldListFilterFieldsStatus = 'loading' | 'ready' | 'error';

export interface CustomFieldListFilterFieldsState {
  fields: CustomFieldListFilterField[];
  status: CustomFieldListFilterFieldsStatus;
  /** Read the fields again — the retry after a failed load. */
  reload: () => void;
}

/**
 * The custom fields an admin list offers as filters — one `GET` of the host
 * list's `…/custom-field-filters` endpoint per mount (feature 157,
 * `admin-surfaces.md` §1.1). The "alive" flag is set in the effect body and
 * cleared in its cleanup, so StrictMode's double mount cannot leave the
 * status stuck at `loading` (feature 147's rule).
 */
export function useCustomFieldListFilterFields(endpoint: string): CustomFieldListFilterFieldsState {
  const [state, setState] = useState<Omit<CustomFieldListFilterFieldsState, 'reload'>>({
    fields: [],
    status: 'loading',
  });
  const [attempt, setAttempt] = useState(0);
  const reload = useCallback((): void => setAttempt((current) => current + 1), []);

  useEffect(() => {
    let alive = true;
    setState((current) => (current.status === 'loading' ? current : { fields: [], status: 'loading' }));
    apiClient.get<CustomFieldListFilterFieldsResponse>(endpoint).then(
      (response) => {
        if (alive) setState({ fields: response.data, status: 'ready' });
      },
      () => {
        if (alive) setState({ fields: [], status: 'error' });
      },
    );
    return (): void => {
      alive = false;
    };
  }, [endpoint, attempt]);

  return { ...state, reload };
}
