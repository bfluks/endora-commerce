/**
 * The `./migrations` subpath — every migration class this module owns, as one ordered
 * `migrations` array (D-168), plus the named classes the generated registry imports.
 * Where this block runs relative to other modules' is decided by the manifest
 * `dependencies` graph; this module references no other module's table.
 */

import { Migration20261125T131915ProductVisibilityRulesVisibilityConfiguration } from './20261125T131915_product_visibility_rules_visibility_configuration.js';
import { Migration20261125T131918ProductVisibilityRulesCataloguePriceFlagsAndWebsiteRule } from './20261125T131918_product_visibility_rules_catalogue_price_flags_and_website_rule.js';

export const migrations = [
  Migration20261125T131915ProductVisibilityRulesVisibilityConfiguration,
  Migration20261125T131918ProductVisibilityRulesCataloguePriceFlagsAndWebsiteRule,
];

export {
  Migration20261125T131915ProductVisibilityRulesVisibilityConfiguration,
  Migration20261125T131918ProductVisibilityRulesCataloguePriceFlagsAndWebsiteRule,
};
