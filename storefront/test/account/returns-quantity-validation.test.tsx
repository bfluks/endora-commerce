import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToString } from 'react-dom/server';
import { ReturnFormLines } from '../../components/returns/ReturnFormLines';

/**
 * Feature 155, U4 (owner ruling S8 A) — the return form's quantity input. Its native `min`/`max`
 * made the browser refuse the whole form with its own bubble, worded in the browser's language.
 * The form asks the browser not to validate: the submit action already brings every quantity
 * into `1 … remaining` (Postel's Law), and the bound is stated beside the input, in the page's
 * language, and linked to it.
 *
 * No minimum hint: a return has no minimum order quantity.
 */
const line = {
  orderItemId: 'a',
  name: 'Bolt',
  remainingQty: 4,
  returnable: true,
  notReturnableText: null,
  selectable: true,
};

function qtyInput(html: string): string {
  const match = /<input[^>]*name="qty_a"[^>]*>/.exec(html);
  expect(match).not.toBeNull();
  return match![0];
}

describe('return form — quantity', () => {
  it('asks the browser not to validate and normalises on the server instead', () => {
    const page = readFileSync(resolve(import.meta.dirname, '../../app/(account)/returns/new/page.tsx'), 'utf8');
    expect(page).toMatch(/<form action=\{submit\} noValidate className="b2b-auth__form">/);
    expect(page).toContain('Math.max(1, Math.floor(Number(formData.get(`qty_${orderItemId}`) ?? 1)) || 1)');
  });

  it.each([
    ['en-US', 'Qty: Bolt', 'of 4'],
    ['pl-PL', 'Ilość: Bolt', 'z 4'],
  ])('%s: links the input to the bound it is held to', (locale, label, bound) => {
    const html = renderToString(<ReturnFormLines lines={[line]} reasons={[]} locale={locale} />).replaceAll(
      '<!-- -->',
      '',
    );
    const input = qtyInput(html);
    expect(input).toContain(`aria-label="${label}"`);
    expect(input).toContain('aria-describedby="qty-bound-a"');
    expect(html).toMatch(new RegExp(`<span id="qty-bound-a"[^>]*> ${bound}</span>`));
    expect(html).not.toMatch(/[Mm]inimum/);
  });
});
