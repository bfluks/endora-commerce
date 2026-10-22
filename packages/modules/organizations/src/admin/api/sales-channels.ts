import type {
  AdminOrganizationCreateRequest,
  OrganizationSalesChannelOptionsResponse,
  OrganizationSalesChannelsResponse,
} from '@endora-commerce/contracts';
import { apiClient } from '@endora-commerce/admin-kit/lib';

/**
 * The Organization's sales-channel assignment and the admin create (feature
 * 154). Source-of-truth shapes live in `@endora-commerce/contracts`.
 */
export const organizationSalesChannelsClient = {
  get(organizationId: string): Promise<OrganizationSalesChannelsResponse> {
    return apiClient.get<OrganizationSalesChannelsResponse>(
      `/api/v1/admin/organizations/${encodeURIComponent(organizationId)}/sales-channels`,
    );
  },

  /** Replaces the whole set; answers what the server stored. */
  replace(organizationId: string, salesChannelIds: string[]): Promise<OrganizationSalesChannelsResponse> {
    return apiClient.put<OrganizationSalesChannelsResponse>(
      `/api/v1/admin/organizations/${encodeURIComponent(organizationId)}/sales-channels`,
      { salesChannelIds },
    );
  },

  /** What the *New organization* form chooses from. */
  options(): Promise<OrganizationSalesChannelOptionsResponse> {
    return apiClient.get<OrganizationSalesChannelOptionsResponse>(
      '/api/v1/admin/organizations/sales-channel-options',
    );
  },

  create(body: AdminOrganizationCreateRequest): Promise<{ data: { id: string } }> {
    return apiClient.post<{ data: { id: string } }>('/api/v1/admin/organizations', body);
  },
};
