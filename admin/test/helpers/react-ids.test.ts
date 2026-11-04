import { describe, expect, it } from 'vitest';
import { markup, normaliseReactIds } from './react-ids';

/** Issue #451: every form React has generated `useId` ids in is taken out. */
describe('normaliseReactIds', () => {
  it.each([
    ['React 18', ':r1a:'],
    ['React 19.0/19.1', '«r1a»'],
    ['React 19.2', '_r_1a_'],
  ])('normalises the %s form', (_label, id) => {
    expect(normaliseReactIds(`<label for="${id}"></label><div id="${id}-body" aria-labelledby="${id}"></div>`)).toBe(
      '<label for="_"></label><div id="_-body" aria-labelledby="_"></div>',
    );
  });

  it('makes two renders with different ids compare equal', () => {
    expect(normaliseReactIds('<i id=":r1:"></i><b id="_r_2_"></b>')).toBe(
      normaliseReactIds('<i id="«r9»"></i><b id="_r_z_"></b>'),
    );
  });

  it('leaves ordinary text alone', () => {
    expect(normaliseReactIds('<p id="order-1">a_r_b</p>')).toBe('<p id="order-1">a_r_b</p>');
  });

  it("reads an element's markup through markup()", () => {
    const el = document.createElement('div');
    el.innerHTML = '<span id="_r_3_"></span>';
    expect(markup(el)).toBe('<span id="_"></span>');
  });
});
