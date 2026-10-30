import { slugify } from './text-normalization.js';
import type { InlineRichNode, InlineRichText } from './page-builder-props.js';

/**
 * The zod-free half of the page-builder prop shapes
 * (`specs/163-page-builder-marketing-pages/` data-model §3): the grammars and
 * the pure helpers a renderer or an editor field needs at run time. The
 * schemas in `page-builder-props.ts` are built from these, and re-export them.
 *
 * Nothing here imports `zod`, so `page-builder-core` can hand these to client
 * components without the schemas reaching a browser bundle.
 */

// ── Colours ─────────────────────────────────────────────────────────

export const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
/** `token:<role>` names a brand-token colour role and renders as `var(--cmsb-color-<role>)` (R-6). */
export const COLOR_TOKEN_RE = /^token:[a-z][a-zA-Z0-9-]{0,31}$/;

// ── Anchors ─────────────────────────────────────────────────────────

/** The grammar of a section anchor and of a rich-text heading anchor (R-8, R-14). */
export const SECTION_ANCHOR_RE = /^[a-z][a-z0-9-]{0,63}$/;
export const SECTION_ANCHOR_MAX_LENGTH = 64;

/**
 * The element ids the storefront document renders on every page, which no
 * section or heading anchor may take (R-8, data-model §6): a link to the
 * fragment would jump to the layout's element instead. `main-content` is the
 * skip link's target and `cmsb` the brand-token style; the rest are the header
 * switchers' fields and the analytics scripts. `storefront/app/reserved-anchors.ts`
 * re-exports this list for the storefront side; refused at save with
 * `CMS_RESERVED_ANCHOR`.
 */
export const RESERVED_ANCHORS = [
  'main-content',
  'cmsb',
  'cmsb-header-offset',
  'b2b-locale',
  'b2b-currency',
  'ga-gtag-src',
  'ga-gtag-init',
  'gtm-init',
] as const;
export type ReservedAnchor = (typeof RESERVED_ANCHORS)[number];

/**
 * Turn what an editor typed into an anchor matching {@link SECTION_ANCHOR_RE}:
 * folded and hyphenated by the shared slug generator, prefixed with `a-` when it
 * does not start with a letter, and capped at 64 characters. Answers `''` when
 * nothing usable is left, which the editor treats as "no anchor".
 */
export function normalizeAnchor(input: string): string {
  const slug = slugify(input);
  if (slug === '') return '';
  const lettered = /^[a-z]/.test(slug) ? slug : `a-${slug}`;
  return slugify(lettered, { maxLength: SECTION_ANCHOR_MAX_LENGTH });
}

// ── Links ───────────────────────────────────────────────────────────

const SAFE_LINK_URL_RE = /^(?:https?:\/\/|mailto:|tel:|\/(?![/\\]))/i;

/**
 * Whether `href` may be the address of a `url` link: `https:`, `http:`,
 * `mailto:`, `tel:` or root-relative `/…`. A protocol-relative `//host` is not
 * root-relative and is refused, as is anything carrying whitespace or a control
 * character a browser would strip before reading the scheme.
 */
export function isSafeLinkUrl(href: string): boolean {
  if (/[\u0000- \u007f-\u009f]/.test(href)) return false;
  return SAFE_LINK_URL_RE.test(href);
}

// ── Images ──────────────────────────────────────────────────────────

export const ASPECT_TOKENS = ['auto', '1:1', '4:3', '3:4', '16:9', '21:9', '3:1', '2:1', '4:5'] as const;
export const FOCAL_TOKENS = ['center', 'top', 'bottom', 'left', 'right'] as const;

const CUSTOM_ASPECT_RE = /^(\d{1,3}):(\d{1,3})$/;

/** Whether `value` is a preset aspect token or a custom `w:h` with integer components 1–100. */
export function isAspectToken(value: string): boolean {
  if ((ASPECT_TOKENS as readonly string[]).includes(value)) return true;
  const match = CUSTOM_ASPECT_RE.exec(value);
  if (!match) return false;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return width >= 1 && width <= 100 && height >= 1 && height <= 100;
}

// ── Backgrounds (T167) ──────────────────────────────────────────────

/**
 * The size of an image background or of the decorative layer: a CSS keyword,
 * or a fixed width in px or % (the height follows the image's own ratio).
 * Unset is today's `cover`.
 */
export const BACKGROUND_SIZE_KEYWORDS = ['cover', 'contain', 'auto'] as const;
export type BackgroundSizeKeyword = (typeof BACKGROUND_SIZE_KEYWORDS)[number];
export const BACKGROUND_SIZE_PX_MAX = 4000;
export const BACKGROUND_SIZE_PERCENT_MAX = 400;
/** How an image background or the decorative layer repeats; unset is today's `no-repeat`. */
export const BACKGROUND_REPEATS = ['no-repeat', 'repeat', 'repeat-x', 'repeat-y'] as const;
export type BackgroundRepeat = (typeof BACKGROUND_REPEATS)[number];

/**
 * R19C (T263): the breakpoint tier from which an art-directed image (or a
 * section background's image or video pair) shows its desktop variant —
 * `tablet` (768 px, today's) or `desktop` (1024 px). Unset reads as `tablet`.
 */
export const DESKTOP_FROM_TIERS = ['tablet', 'desktop'] as const;
export type DesktopFromTier = (typeof DESKTOP_FROM_TIERS)[number];

/** R19C (T265): the largest background outset of a `cms.Column`, px per side (R23 T449: a Section has none). */
export const SECTION_OUTSET_PX_MAX = 400;

/** A stored background size: a keyword, `{px}` (whole px 1–4000) or `{percent}` (1–400). */
export type BackgroundSizeValue = BackgroundSizeKeyword | { px: number } | { percent: number };

/** A stored background size as CSS, or `null` when it is unset or not one of the grammar's values. */
export function backgroundSizeToCss(value: unknown): string | null {
  if (typeof value === 'string') return (BACKGROUND_SIZE_KEYWORDS as readonly string[]).includes(value) ? value : null;
  if (typeof value !== 'object' || value === null) return null;
  const { px, percent } = value as { px?: unknown; percent?: unknown };
  if (typeof px === 'number' && Number.isInteger(px) && px >= 1 && px <= BACKGROUND_SIZE_PX_MAX) return `${px}px`;
  if (typeof percent === 'number' && Number.isFinite(percent) && percent >= 1 && percent <= BACKGROUND_SIZE_PERCENT_MAX) return `${percent}%`;
  return null;
}

export function isBackgroundRepeat(value: unknown): value is BackgroundRepeat {
  return typeof value === 'string' && (BACKGROUND_REPEATS as readonly string[]).includes(value);
}

// ── Inline rich text ────────────────────────────────────────────────

export const EMPHASIS_VARIANTS = ['gradient', 'accent', 'muted'] as const;

/** An icon name of the page builder's catalog: a camel-case identifier (`sparkles`, `arrowUpRight`). */
export const INLINE_ICON_NAME_RE = /^[a-z][A-Za-z0-9]{0,63}$/;

/**
 * T166: an inline icon's size — em of the text (0.25–3, up to two decimals) or
 * whole px (8–200) — as stored and as CSS (`'0.5em'`, `'30px'`). Unset is
 * today's `1em`.
 */
export const INLINE_ICON_SIZE_RE = /^(?:(\d(?:\.\d{1,2})?)em|(\d{1,3})px)$/;
export const INLINE_ICON_SIZE_EM = [0.25, 3] as const;
export const INLINE_ICON_SIZE_PX = [8, 200] as const;
/** T166: an inline icon's vertical offset, em of the text (positive raises it); unset is today's `-0.125em`. */
export const INLINE_ICON_OFFSET_EM = [-1, 1] as const;

export function isInlineIconSize(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = INLINE_ICON_SIZE_RE.exec(value);
  if (!match) return false;
  if (match[1] !== undefined) {
    const em = Number(match[1]);
    return em >= INLINE_ICON_SIZE_EM[0] && em <= INLINE_ICON_SIZE_EM[1];
  }
  const px = Number(match[2]);
  return px >= INLINE_ICON_SIZE_PX[0] && px <= INLINE_ICON_SIZE_PX[1];
}

export function isInlineIconOffset(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= INLINE_ICON_OFFSET_EM[0] && value <= INLINE_ICON_OFFSET_EM[1];
}

/** A plain string as a one-paragraph document; each newline becomes a hard break. */
export function plainTextToInlineRichText(text: string): InlineRichText {
  const content: InlineRichNode[] = [];
  text.split('\n').forEach((line, index) => {
    if (index > 0) content.push({ type: 'hardBreak' });
    if (line !== '') content.push({ type: 'text', text: line });
  });
  return { type: 'doc', content: [content.length > 0 ? { type: 'paragraph', content } : { type: 'paragraph' }] };
}

/** The document's text, hard breaks as newlines, marks and inline icons (T163) dropped. */
export function inlineRichTextToPlain(value: InlineRichText | string | null | undefined): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  const nodes = value.content?.[0]?.content ?? [];
  return nodes.map((node) => (node.type === 'text' ? node.text : node.type === 'hardBreak' ? '\n' : '')).join('');
}
