import { StrictMode, type ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppLanguageContext } from '@endora-commerce/admin-kit/i18n';
import { TranslationProvider } from '../../../../packages/admin-shell/src/i18n/TranslationProvider';
import catalogEn from '../../../../packages/modules/catalog/i18n/en.json';
import catalogPl from '../../../../packages/modules/catalog/i18n/pl.json';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';

/**
 * Feature 163 — owner decision "SEO stub = A" (2026-10-26): the product editor's SEO tab
 * no longer carries the "Page title (preview)" input that saved nothing. Below the URL
 * keys it links to the SEO screen, where the meta tags are edited per channel and
 * language — only while `seo` is present and the admin holds the code that screen's
 * routes enforce (`catalog:write`, the `open-seo` action's own gate). The SEO screen
 * picks the product itself: it has no per-product address to deep-link to.
 */

const { ProductSeoLink } = await import(
  '../../../../packages/modules/catalog/src/admin/components/ProductSeoLink'
);

function wrap(
  options: { permissions?: readonly string[]; seo?: boolean; language?: 'en' | 'pl' } = {},
): ReactElement {
  const language = options.language ?? 'en';
  const catalog = (language === 'en' ? catalogEn : catalogPl) as Record<string, string>;
  return (
    <StrictMode>
      <MemoryRouter>
        <AppLanguageContext.Provider value={{ language, setLanguage: (): void => undefined }}>
          <TranslationProvider language={language} initialBundle={{ catalog }}>
            {withSession(<ProductSeoLink />, {
              session: adminSession({ permissions: options.permissions ?? ['catalog:read', 'catalog:write'] }),
              presence: options.seo === false ? modulePresence({ absent: ['seo'] }) : modulePresence({ present: ['seo'] }),
            })}
          </TranslationProvider>
        </AppLanguageContext.Provider>
      </MemoryRouter>
    </StrictMode>
  );
}

afterEach(() => cleanup());

describe('ProductSeoLink (owner decision SEO stub = A)', () => {
  it('links to the SEO screen and says the product is picked there', () => {
    render(wrap());
    const link = screen.getByRole('link', { name: 'Edit SEO meta per channel →' });
    expect(link).toHaveAttribute('href', '/seo');
    expect(screen.getByText(/pick this product/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('Page title (preview)')).not.toBeInTheDocument();
  });

  it('renders nothing while seo is off', () => {
    const { container } = render(wrap({ seo: false }));
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing without the SEO screen’s permission', () => {
    render(wrap({ permissions: ['catalog:read'] }));
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('renders in Polish from the pl bundle', () => {
    render(wrap({ language: 'pl' }));
    expect(screen.getByRole('link', { name: 'Edytuj meta SEO w kanałach →' })).toBeInTheDocument();
  });
});
