import { useCallback, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
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
import { RolesSection } from '../components/RolesSection.js';
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
export function ConfigurationPage(): ReactNode {
  const t = useTranslation('product_visibility_rules');
  const { me, hasPermission } = useAuth();
  const { overview, loading, refreshing, failed, reload } = useOverview();
  const channels = useSalesChannels();
  const status = useInlineStatus();
  const { show } = status;
  const onStatus = useCallback((message: string, tone: 'success' | 'error'): void => show(message, tone), [show]);

  const permitted = hasPermission(PRODUCT_VISIBILITY_PERMISSIONS.MANAGE);
  const unrestricted = overview !== null && callerIsUnrestricted(overview, me?.role?.id);
  const writable = permitted && unrestricted;
  const unmapped = overview?.roles.filter((role) => role.effect === 'sees_no_products').length ?? 0;

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
          <Alert variant="warning">
            <AlertDescription>{t('config.offWarning')}</AlertDescription>
          </Alert>
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
          {!permitted ? (
            <Alert>
              <AlertDescription>{t('config.readOnly.permission')}</AlertDescription>
            </Alert>
          ) : !unrestricted ? (
            <Alert>
              <AlertDescription>{t('config.readOnly.restricted')}</AlertDescription>
            </Alert>
          ) : null}
          {unmapped > 0 ? (
            <Alert variant="warning">
              <AlertDescription>{t('config.roles.unmappedNotice', { count: unmapped })}</AlertDescription>
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
