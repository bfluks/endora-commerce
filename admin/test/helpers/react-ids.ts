/**
 * React's `useId` ids in every form it has generated them: `:r1a:` (React 18),
 * `«r1a»` (React 19.0/19.1) and `_r_1a_` (React 19.2). Issue #451.
 */
const REACT_ID = /:r[0-9a-z]+:|«r[0-9a-z]+»|_r_[0-9a-z]+_/g;

/**
 * Markup with React's per-render ids replaced by `_`, so two renders compare —
 * wherever an id stands, including where a component derives one from it
 * (`<id>-body`).
 */
export function normaliseReactIds(html: string): string {
  return html.replace(REACT_ID, '_');
}

/** An element's inner markup with React's per-render ids taken out. */
export function markup(container: HTMLElement): string {
  return normaliseReactIds(container.innerHTML);
}
