import { describe, expect, it } from 'vitest';
import { countWords, splitHtmlWords, splitWords } from './split-words.js';

/**
 * `specs/163-page-builder-marketing-pages/` US10, FR-037, research R-21 — the
 * word reveal splits its text at render time into
 * `<span class="cmsc-w" style="--i:n">` words. The split keeps every character:
 * whitespace (runs, line breaks, non-breaking spaces) and inline marks stay as
 * they were, so the server HTML carries the full text and reads the same.
 */

const textOf = (html: string): string => html.replace(/<[^>]*>/g, '');

describe('splitWords (T089)', () => {
  it('splits into words and whitespace runs whose joined text equals the source', () => {
    const source = '  Build   faster,\nship\tsooner.  ';
    const parts = splitWords(source);
    expect(parts.map((part) => ('word' in part ? part.word : part.space)).join('')).toBe(source);
    expect(parts.filter((part) => 'word' in part).map((part) => (part as { word: string }).word)).toEqual([
      'Build',
      'faster,',
      'ship',
      'sooner.',
    ]);
    expect(parts[0]).toEqual({ space: '  ' });
  });

  it('keeps a non-breaking space inside its word, so the two never part', () => {
    const parts = splitWords('10 kg box');
    expect(parts).toEqual([{ word: '10 kg' }, { space: ' ' }, { word: 'box' }]);
  });

  it('counts words, not whitespace; an empty or blank text has none', () => {
    expect(countWords('one two  three')).toBe(3);
    expect(countWords('')).toBe(0);
    expect(countWords('   ')).toBe(0);
  });
});

describe('splitHtmlWords (T089)', () => {
  it('wraps each word in a numbered span and keeps tags, marks and whitespace as they were', () => {
    const source = '<p>Hello <strong>bold world</strong>, <a href="/about-us">read more</a></p>\n<p>Next</p>';
    const { html, count } = splitHtmlWords(source);
    expect(count).toBe(7);
    expect(html).toBe(
      '<p><span class="cmsc-w" style="--i:0">Hello</span> <strong><span class="cmsc-w" style="--i:1">bold</span> ' +
        '<span class="cmsc-w" style="--i:2">world</span></strong><span class="cmsc-w" style="--i:3">,</span> ' +
        '<a href="/about-us"><span class="cmsc-w" style="--i:4">read</span> <span class="cmsc-w" style="--i:5">more</span></a></p>\n' +
        '<p><span class="cmsc-w" style="--i:6">Next</span></p>',
    );
    expect(textOf(html)).toBe(textOf(source));
  });

  it('numbers from `start`, so a second text continues the stagger of the first', () => {
    const { html, count } = splitHtmlWords('<p>a b</p>', 5);
    expect(count).toBe(2);
    expect(html).toContain('style="--i:5">a<');
    expect(html).toContain('style="--i:6">b<');
  });

  it('leaves attribute values and entities intact', () => {
    const source = '<p title="two words">Fish &amp; chips</p>';
    const { html } = splitHtmlWords(source);
    expect(html).toContain('title="two words"');
    expect(html).toContain('>&amp;</span>');
    expect(textOf(html)).toBe(textOf(source));
  });

  it('an empty document is returned unchanged', () => {
    expect(splitHtmlWords('')).toEqual({ html: '', count: 0 });
    expect(splitHtmlWords('<p></p>')).toEqual({ html: '<p></p>', count: 0 });
  });
});
