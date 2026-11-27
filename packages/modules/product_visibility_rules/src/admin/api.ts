import type {
  I18nConfigResponse,
  ProductRuleAttributesResponse,
  ProductRuleCreateBody,
  ProductRuleDetail,
  ProductRuleUpdateBody,
  ProductRuleView,
  ProductVisibilityCategory,
  ProductVisibilityCategoryCreateBody,
  ProductVisibilityCategoryUpdateBody,
  ProductVisibilityDesignationBody,
  ProductVisibilityDesignationOptionsResponse,
  ProductVisibilityDesignationResponse,
  ProductVisibilityMappingTarget,
  ProductVisibilityOverviewResponse,
  ProductVisibilityRoleMappingResponse,
  SalesChannelListResponse,
  WebsiteRulePreviewCreateBody,
  WebsiteRulePreviewResponse,
} from '@endora-commerce/contracts';
import { apiClient } from '@endora-commerce/admin-kit/lib';

const BASE = '/api/v1/admin/product-visibility';
const ifMatch = (version: number): RequestInit => ({ headers: { 'If-Match': `"${version}"` } });
const seg = (value: string): string => encodeURIComponent(value);

/** The module's admin API (`specs/193-product-visibility-rules/contracts/admin-api.md` §1). */
export const productVisibilityClient = {
  async overview(): Promise<ProductVisibilityOverviewResponse> {
    return (await apiClient.get<{ data: ProductVisibilityOverviewResponse }>(`${BASE}/overview`)).data;
  },

  createCategory(body: ProductVisibilityCategoryCreateBody): Promise<{ data: ProductVisibilityCategory }> {
    return apiClient.post(`${BASE}/categories`, body);
  },

  updateCategory(category: Pick<ProductVisibilityCategory, 'id' | 'version'>, body: ProductVisibilityCategoryUpdateBody): Promise<{ data: ProductVisibilityCategory }> {
    return apiClient.patch(`${BASE}/categories/${seg(category.id)}`, body, ifMatch(category.version));
  },

  deleteCategory(category: Pick<ProductVisibilityCategory, 'id' | 'version'>): Promise<unknown> {
    return apiClient.delete(`${BASE}/categories/${seg(category.id)}`, ifMatch(category.version));
  },

  setRoleMapping(roleId: string, target: ProductVisibilityMappingTarget | null): Promise<{ data: ProductVisibilityRoleMappingResponse }> {
    return apiClient.put(`${BASE}/role-mappings/${seg(roleId)}`, { target });
  },

  setDesignation(currencyCode: string, body: ProductVisibilityDesignationBody): Promise<{ data: ProductVisibilityDesignationResponse }> {
    return apiClient.put(`${BASE}/designations/${seg(currencyCode)}`, body);
  },

  clearDesignation(currencyCode: string): Promise<{ data: ProductVisibilityDesignationResponse }> {
    return apiClient.delete(`${BASE}/designations/${seg(currencyCode)}`);
  },

  async designationOptions(currencyCode: string): Promise<ProductVisibilityDesignationOptionsResponse> {
    return (await apiClient.get<{ data: ProductVisibilityDesignationOptionsResponse }>(`${BASE}/designations/${seg(currencyCode)}/options`)).data;
  },

  async attributes(): Promise<ProductRuleAttributesResponse> {
    return (await apiClient.get<{ data: ProductRuleAttributesResponse }>(`${BASE}/attributes`)).data;
  },

  /** A saved rule with the channels it governs; its `version` is what a save or change preview sends. */
  async rule(id: string): Promise<ProductRuleDetail> {
    return (await apiClient.get<{ data: ProductRuleDetail }>(`${BASE}/product-rules/${seg(id)}`)).data;
  },

  createRule(body: ProductRuleCreateBody): Promise<{ data: ProductRuleView }> {
    return apiClient.post(`${BASE}/product-rules`, body);
  },

  updateRule(rule: { id: string; version: number }, body: ProductRuleUpdateBody): Promise<{ data: ProductRuleView }> {
    return apiClient.patch(`${BASE}/product-rules/${seg(rule.id)}`, body, ifMatch(rule.version));
  },

  deleteRule(rule: { id: string; version: number }): Promise<unknown> {
    return apiClient.delete(`${BASE}/product-rules/${seg(rule.id)}`, ifMatch(rule.version));
  },

  /** `version` — the rule version the administrator read; a rule that moved since is refused. */
  async createPreview(body: WebsiteRulePreviewCreateBody, version?: number): Promise<{ previewId: string }> {
    const path = `${BASE}/website-rules/previews`;
    return (await (version === undefined ? apiClient.post<{ data: { previewId: string } }>(path, body) : apiClient.post<{ data: { previewId: string } }>(path, body, ifMatch(version)))).data;
  },

  async preview(previewId: string): Promise<WebsiteRulePreviewResponse> {
    return (await apiClient.get<{ data: WebsiteRulePreviewResponse }>(`${BASE}/website-rules/previews/${seg(previewId)}`)).data;
  },

  confirmPreview(previewId: string): Promise<unknown> {
    return apiClient.post(`${BASE}/website-rules/previews/${seg(previewId)}/confirm`);
  },

  detach(salesChannelId: string): Promise<unknown> {
    return apiClient.delete(`${BASE}/website-rules/attachments/${seg(salesChannelId)}`);
  },

  /** Every sales channel, active or not, for naming the ones this module's rows point at. */
  /**
   * The shop's base currency, from the public `GET /api/v1/i18n/config` (no permission needed), so
   * the configuration screen can list it first. `null` when none is set.
   */
  async baseCurrency(): Promise<string | null> {
    return (await apiClient.get<{ data: I18nConfigResponse | null }>('/api/v1/i18n/config')).data?.defaultCurrencyCode ?? null;
  },

  async salesChannels(): Promise<SalesChannelListResponse['items']> {
    const qs = new URLSearchParams({ pageSize: '200', activeOnly: 'false' });
    return (await apiClient.get<SalesChannelListResponse>(`/api/v1/admin/sales-channels?${qs.toString()}`)).items;
  },
};
