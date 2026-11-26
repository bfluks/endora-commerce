import { describe, expect, it } from 'vitest';
import { DEFAULT_WEBSITE_RULE_LIMITS, WebsiteRuleService, type WebsiteRuleServiceDeps } from './website-rule.service.js';

/** The TM-11 bounds are fixed at composition; a lowered bound is a sibling service, never a mutation. */
describe('WebsiteRuleService limits', () => {
  const deps = { limits: { applyBatch: 7 } } as unknown as WebsiteRuleServiceDeps;

  it('are built from deps.limits over the defaults, and frozen', () => {
    const service = new WebsiteRuleService(deps);
    expect(service.limits).toEqual({ ...DEFAULT_WEBSITE_RULE_LIMITS, applyBatch: 7 });
    expect(Object.isFrozen(service.limits)).toBe(true);
  });

  it('withLimits answers a sibling with the bound replaced and leaves the original as it was', () => {
    const service = new WebsiteRuleService(deps);
    const lowered = service.withLimits({ maxPreviewChanges: 0 });
    expect(lowered).not.toBe(service);
    expect(lowered.limits).toEqual({ ...DEFAULT_WEBSITE_RULE_LIMITS, applyBatch: 7, maxPreviewChanges: 0 });
    expect(service.limits.maxPreviewChanges).toBe(DEFAULT_WEBSITE_RULE_LIMITS.maxPreviewChanges);
  });
});
