import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { PRODUCT_VISIBILITY_PERMISSIONS } from '@endora-commerce/contracts';
import { useAuth } from '@endora-commerce/admin-kit/lib';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import {
  Alert,
  AlertDescription,
  Button,
  DetailSkeleton,
  InlineStatus,
  PageHeader,
  useInlineStatus,
} from '@endora-commerce/admin-kit/ui';
import { CategoriesSection } from '../components/CategoriesSection.js';
import { DesignationsSection } from '../components/DesignationsSection.js';
import { ROLES_SECTION_ID, RolesSection } from '../components/RolesSection.js';
import { callerIsUnrestricted } from '../lib/labels.js';
import { useOverview, useSalesChannels } from '../lib/use-overview.js';

export const WEBSITE_RULES_ROUTE = '/product-visibility/website-rules';

/**
 * The configuration screen of `product_visibility_rules` (`specs/193-product-visibility-rules/`
 * US2), at `/product-visibility`: the visibility categories, the book designated for each
 * currency's catalogue price, and each admin role's mapping — in the order an administrator sets
 * them up (a category before a role can be mapped to it; Goal-Gradient).
 *
 * Writes need `product_visibility:manage` **and** a caller who sees every product (TM-4 c);
 * anyone else reads the screen with every control withdrawn and a line saying why (US2-4). The
 * screen always says that switching the module off lifts every restriction (FR-073, TM-13).
 */
export interface ConfigurationPageProps {
  /** How often the overview is read again while a currency's catalogue prices are rebuilt. Tests shorten it. */
  readonly buildingPollMs?: number;
}

export function ConfigurationPage({ buildingPollMs = 8000 }: ConfigurationPageProps = {}): ReactNode {
  const t = useTranslation('product_visibility_rules');
  const { me, hasPermission } = useAuth();
  const { overview, loading, refreshing, failed, reload } = useOverview();
  const { channels, failed: channelsFailed } = useSalesChannels();
  const status = useInlineStatus();
  const { show } = status;
  const onStatus = useCallback((message: string, tone: 'success' | 'error'): void => show(message, tone), [show]);

  const permitted = hasPermission(PRODUCT_VISIBILITY_PERMISSIONS.MANAGE);
  const unrestricted = overview !== null && callerIsUnrestricted(overview, me?.role?.id);
  const writable = permitted && unrestricted;
  const unmapped = overview?.roles.filter((role) => role.effect === 'sees_no_products').length ?? 0;
  const building = overview?.currencies.some((currency) => currency.building) ?? false;

  // US2-15 — while a currency's catalogue prices are rebuilt, the overview is read again every
  // few seconds; the end of the rebuild is said in the page's polite status line. Stops when the
  // rebuild ends or the screen unmounts.
  const wasBuilding = useRef(false);
  useEffect(() => {
    if (wasBuilding.current && !building && overview !== null) show(t('config.designations.built'), 'success');
    wasBuilding.current = building;
    if (!building) return undefined;
    const timer = setInterval(() => void reload(), buildingPollMs);
    return (): void => clearInterval(timer);
  }, [building, buildingPollMs, overview, reload, show, t]);

  // The role editor links to `#role-<id>`: that row takes focus once the overview has drawn it.
  const { hash } = useLocation();
  const focusedHash = useRef<string | null>(null);
  useEffect(() => {
    if (overview === null || !hash.startsWith('#role-') || focusedHash.current === hash) return;
    const row = document.getElementById(decodeURIComponent(hash.slice(1)));
    if (row) {
      focusedHash.current = hash;
      row.focus();
    }
  }, [hash, overview]);

  return (
    <>
      <PageHeader
        title={t('config.page.title')}
        help={t('config.page.help')}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <InlineStatus {...status.props} />
            <Button asChild variant="outline">
              <Link to={WEBSITE_RULES_ROUTE}>{t('config.toWebsiteRules')}</Link>
            </Button>
          </div>
        }
      />
      {loading ? (
        <DetailSkeleton label={t('config.loading')} tabs={false} />
      ) : overview === null ? (
        <Alert variant="destructive">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>{t('config.error.load')}</span>
            <Button type="button" size="sm" variant="outline" onClick={(): void => void reload()}>
              {t('config.retry')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : (
        <div className="space-y-(--section-gap)" aria-busy={refreshing}>
          {/* Why nothing can be changed comes first: it explains every control the screen withholds. */}
          {!permitted ? (
            <Alert>
              <AlertDescription>{t('config.readOnly.permission')}</AlertDescription>
            </Alert>
          ) : !unrestricted ? (
            <Alert>
              <AlertDescription>{t('config.readOnly.restricted')}</AlertDescription>
            </Alert>
          ) : null}
          {/* Permanent information, not a warning: only what needs action is styled as one (Von Restorff). */}
          <Alert>
            <AlertDescription>{t('config.offWarning')}</AlertDescription>
          </Alert>
          {channelsFailed ? (
            <Alert variant="warning">
              <AlertDescription>{t('config.error.channels')}</AlertDescription>
            </Alert>
          ) : null}
          {failed ? (
            <Alert variant="destructive">
              <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                <span>{t('config.error.refresh')}</span>
                <Button type="button" size="sm" variant="outline" onClick={(): void => void reload()}>
                  {t('config.retry')}
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}
          {unmapped > 0 ? (
            <Alert variant="warning">
              <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                <span>{t('config.roles.unmappedNotice', { count: unmapped })}</span>
                <a href={`#${ROLES_SECTION_ID}`} className="font-medium underline underline-offset-4">
                  {t('config.roles.unmappedLink')}
                </a>
              </AlertDescription>
            </Alert>
          ) : null}
          <CategoriesSection overview={overview} writable={writable} onChanged={reload} onStatus={onStatus} />
          <DesignationsSection overview={overview} channels={channels} writable={writable} onChanged={reload} onStatus={onStatus} />
          <RolesSection overview={overview} writable={writable} onChanged={reload} onStatus={onStatus} />
        </div>
      )}
    </>
  );
}

export default ConfigurationPage;
