import { apiClient } from '@endora-commerce/admin-kit/lib';
import type {
  CreateCustomFieldDefinitionRequest,
  CustomFieldDefinitionDto,
  CustomFieldOptionDto,
  CustomFieldEntityTypeInfo,
  SupportedEntityType,
  UpdateCustomFieldDefinitionRequest,
} from '@endora-commerce/contracts';

type OptionCreate = Omit<CustomFieldOptionDto, 'id'>;
type OptionPatch = Partial<Pick<CustomFieldOptionDto, 'label' | 'labelDefault' | 'isDefault' | 'sortOrder'>>;
type OptionRef = { id: string; value: string };

type Wrap<T> = { data: T };
const unwrap = <T>(p: Promise<Wrap<T>>): Promise<T> => p.then((r) => r.data);

/** Typed admin client for the custom-fields definition API (feature 055). */
export const customFieldsClient = {
  /** Supported host entity types + host-managed metadata (feature 061). */
  listEntityTypes: (): Promise<CustomFieldEntityTypeInfo[]> =>
    unwrap(
      apiClient.get<Wrap<CustomFieldEntityTypeInfo[]>>('/api/v1/admin/custom-fields/entity-types'),
    ),
  list: (entityType?: SupportedEntityType): Promise<CustomFieldDefinitionDto[]> =>
    unwrap(
      apiClient.get<Wrap<CustomFieldDefinitionDto[]>>(
        `/api/v1/admin/custom-fields/definitions${entityType ? `?entityType=${entityType}` : ''}`,
      ),
    ),
  get: (id: string): Promise<CustomFieldDefinitionDto> =>
    unwrap(apiClient.get<Wrap<CustomFieldDefinitionDto>>(`/api/v1/admin/custom-fields/definitions/${id}`)),
  create: (body: CreateCustomFieldDefinitionRequest): Promise<CustomFieldDefinitionDto> =>
    unwrap(apiClient.post<Wrap<CustomFieldDefinitionDto>>('/api/v1/admin/custom-fields/definitions', body)),
  update: (id: string, patch: UpdateCustomFieldDefinitionRequest): Promise<CustomFieldDefinitionDto> =>
    unwrap(apiClient.patch<Wrap<CustomFieldDefinitionDto>>(`/api/v1/admin/custom-fields/definitions/${id}`, patch)),
  remove: (id: string): Promise<unknown> =>
    apiClient.delete(`/api/v1/admin/custom-fields/definitions/${id}`),
  // ---- Options of a select / multiselect definition (feature 157) ----------
  /** Adds an option. The stored `value` is fixed from here on. */
  createOption: (id: string, option: OptionCreate): Promise<OptionRef> =>
    unwrap(apiClient.post<Wrap<OptionRef>>(`/api/v1/admin/custom-fields/definitions/${id}/options`, option)),
  /** Patches an option; never sends `value`, which cannot change. */
  updateOption: (id: string, optionId: string, patch: OptionPatch): Promise<OptionRef> =>
    unwrap(
      apiClient.patch<Wrap<OptionRef>>(`/api/v1/admin/custom-fields/definitions/${id}/options/${optionId}`, patch),
    ),
  /** Removes an option; the server refuses one that stored values still use. */
  removeOption: (id: string, optionId: string): Promise<unknown> =>
    apiClient.delete(`/api/v1/admin/custom-fields/definitions/${id}/options/${optionId}`),
};
