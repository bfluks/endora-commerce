import { describe, expect, it } from 'vitest';
import { SUPPORTED_ENTITIES, SUPPORTED_ENTITY_TYPES } from './custom-field-registry.js';

/**
 * The registry markers of `specs/157-custom-fields-list-filters/` (data-model
 * §2): which entity types offer the list-filter option, and which follow an
 * owner module.
 */
describe('custom-field registry', () => {
  it('offers the list-filter option on exactly order, quote_request and opportunity', () => {
    const offering = SUPPORTED_ENTITY_TYPES.filter((type) => SUPPORTED_ENTITIES[type].listFilter === true);
    expect([...offering].sort()).toEqual(['opportunity', 'order', 'quote_request']);
  });

  it('names the owner of quote_request and opportunity, and of no other type', () => {
    expect(SUPPORTED_ENTITIES.quote_request.ownerModuleId).toBe('quote_requests');
    expect(SUPPORTED_ENTITIES.opportunity.ownerModuleId).toBe('crm');
    const owned = SUPPORTED_ENTITY_TYPES.filter((type) => SUPPORTED_ENTITIES[type].ownerModuleId !== undefined);
    expect([...owned].sort()).toEqual(['opportunity', 'quote_request']);
  });

  it('keeps product host-managed', () => {
    expect(SUPPORTED_ENTITIES.product.managedBy?.moduleId).toBe('catalog');
  });
});
