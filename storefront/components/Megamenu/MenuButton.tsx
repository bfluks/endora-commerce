import type { ReactNode } from 'react';
import type { ResolvedMenuItem } from '@endora-commerce/contracts';
import { LocalizedAnchor } from '../../lib/i18n/localized-link';

interface MenuButtonProps {
  item: ResolvedMenuItem;
}

/**
 * The storefront's own button styles (`.btn*` in `globals.css`). The menu used
 * `bg-primary` / `text-primary-foreground`, which no storefront theme defines,
 * so a button in a panel rendered with no background and the page's text
 * colour (feature 168 review).
 */
const variantClasses: Record<string, string> = {
  primary: 'btn--primary',
  secondary: 'btn--outline',
  ghost: 'btn--ghost',
};

/**
 * Renders a menu item of kind `button` as an anchor styled per its
 * `variant` (`primary | secondary | ghost`). Variants mirror the CMS
 * Page Builder's `Button` component so a CTA inside a megamenu panel
 * matches one inside an embedded CMS Block.
 */
export function MenuButton({ item }: MenuButtonProps): ReactNode {
  if (!item.url) return null;
  const variant = item.variant ?? 'primary';
  const className = `btn btn--sm ${variantClasses[variant] ?? variantClasses['primary']!}`;
  return (
    <LocalizedAnchor href={item.url} className={className}>
      {item.label}
    </LocalizedAnchor>
  );
}
