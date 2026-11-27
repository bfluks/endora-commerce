import { COLOR_TOKEN_RE } from '@endora-commerce/contracts/page-builder-values';

/**
 * The brand colour roles a block colour may reference as `token:<role>`
 * (`specs/163-page-builder-marketing-pages/` research R-6, T040), in the order
 * the colour picker lists them, each with the literal it falls back to when no
 * brand tokens are on the page — the `DEFAULT_BRAND_TOKENS` colours of
 * `@endora-commerce/contracts`, restated here because every `--cmsb-*` use
 * carries today's literal (standing rule 9) and a renderer does not load the
 * schemas at run time. `cms-components`' `brand/brand-css.ts` writes the
 * matching `--cmsb-color-<role>` variables.
 */
export const BRAND_COLOR_ROLES = [
  { role: 'primary', fallback: '#1261a6', value: 'token:primary' },
  { role: 'primary-hover', fallback: '#0f5189', value: 'token:primary-hover' },
  { role: 'secondary', fallback: '#0f766e', value: 'token:secondary' },
  { role: 'secondary-hover', fallback: '#115e59', value: 'token:secondary-hover' },
  { role: 'on-primary', fallback: '#ffffff', value: 'token:on-primary' },
  { role: 'on-secondary', fallback: '#ffffff', value: 'token:on-secondary' },
] as const;

export type BrandColorRole = (typeof BRAND_COLOR_ROLES)[number]['role'];

const FALLBACK_BY_ROLE: ReadonlyMap<string, string> = new Map(BRAND_COLOR_ROLES.map((entry) => [entry.role, entry.fallback]));

/** `onPrimary` and `on-primary` both name the `--cmsb-color-on-primary` variable. */
function kebabRole(role: string): string {
  return role.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

/**
 * The role a `token:<role>` value names, kebab-cased, when it is one of
 * {@link BRAND_COLOR_ROLES}; `null` for anything else.
 */
export function brandColorRole(value: string | null | undefined): BrandColorRole | null {
  if (!value || !COLOR_TOKEN_RE.test(value)) return null;
  const role = kebabRole(value.slice('token:'.length));
  return FALLBACK_BY_ROLE.has(role) ? (role as BrandColorRole) : null;
}

/** The literal a brand colour role falls back to with no brand tokens set. */
export function brandColorFallback(role: BrandColorRole): string {
  return FALLBACK_BY_ROLE.get(role)!;
}

/**
 * A block colour as CSS (research R-6): `token:<role>` becomes
 * `var(--cmsb-color-<role>, <literal>)`, a token naming no known role is
 * `undefined`, and anything else — a `#rrggbb` override, or a literal stored
 * before tokens existed — is applied as it is.
 */
export function resolveColorValue(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  if (!value.startsWith('token:')) return value;
  const role = brandColorRole(value);
  return role ? `var(--cmsb-color-${role}, ${brandColorFallback(role)})` : undefined;
}
