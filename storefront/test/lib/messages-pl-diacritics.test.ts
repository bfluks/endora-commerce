import { describe, expect, it } from 'vitest';
import { MESSAGES, tForLocale } from '../../lib/i18n/messages';

/**
 * `specs/163-page-builder-marketing-pages/` R19C (T269) — the storefront's
 * Polish copy is written with its diacritics. The breadcrumb's home crumb read
 * "Strona glowna"; the same folding ran through the stock, search, checkout
 * and order messages. The words below are the folded forms that were found,
 * none of which is a Polish word as spelled.
 */

const FOLDED = [
  'glowna', 'tresci', 'Przejdz', 'Zaden', 'filtrow', 'Pokaz', 'wiecej', 'Dostepn', 'dostepn', 'Duzo', 'Sredni', 'Malo',
  'Cie', 'znow', 'bedzie', 'Wyslemy', 'udalo', 'zapisac', 'sprobuj', 'Sprobuj', 'mozna', 'zamowic', 'wysylka', 'Niedostepny',
  'Powiazane', 'Moze', 'takze', 'dostep', 'produktow', 'Nastepna', 'Dziekujemy', 'zamowienia', 'zamowienie', 'Zamowienie',
  'zostalo', 'zlozone', 'Otrzymalismy', 'wyslalismy', 'uzyciem', 'ktora', 'zaksiegowaniu', 'wplaty', 'Platnosc', 'platnosc',
  'platnosci', 'Zadne', 'czynnosci', 'sa', 'Szczegoly', 'zlozyc', 'Cos', 'poszlo', 'skladaniu', 'Twoj', 'zostal', 'mozesz',
  'sprobowac', 'pozostal', 'obciazone', 'Wroc', 'Zaplac', 'doszla', 'oplacic', 'oplacone', 'juz', 'Dokoncz', 'az',
  'wygasnie', 'rozpoczac', 'zaczelismy', 'realizowac', 'wiec', 'anulowac', 'wroci', 'sie', 'pomozemy',
  'Usun', 'Uzyj', 'Imie', 'Domyslnie', 'Mozesz', 'nadpisac', 'Dzial', 'sprzedazy', 'oferte',
];

describe('Polish storefront copy (R19C, T269)', () => {
  it('names the home crumb with its diacritics', () => {
    expect(tForLocale('pl-PL')('nav.home')).toBe('Strona główna');
  });

  it('holds no word with its diacritics folded away', () => {
    const polish = MESSAGES['pl-PL'] ?? {};
    const found: string[] = [];
    for (const [key, text] of Object.entries(polish)) {
      const words = String(text).split(/[^\p{L}]+/u);
      for (const word of FOLDED) if (words.includes(word)) found.push(`${key}: ${word}`);
    }
    expect(found).toEqual([]);
  });
});
