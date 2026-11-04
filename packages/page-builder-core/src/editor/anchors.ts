import { SECTION_ANCHOR_RE } from '@endora-commerce/contracts/page-builder-values';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The one block that carries section settings (plan § Owner ruling 2026-10-23). */
const SECTION_BLOCK = 'cms.Section';

/** The top-level container of Sections (T158, plan § Owner ruling 2026-10-26). */
const SECTION_GROUP_BLOCK = 'cms.SectionGroup';

/**
 * The section anchors of a Puck document, in document order and once each —
 * what an in-page link (`LinkValue` of kind `anchor`) can point at
 * (`specs/163-page-builder-marketing-pages/` research R-8, R-11).
 *
 * An anchor is the `props.anchor` of a `cms.Section` in the page's own
 * content list (its settings are its own top-level props, T117): the Section
 * stands only at the top level, and only there does it render its `id`. A
 * top-level `cms.SectionGroup` renders its own anchor too, and the Sections
 * in its slot render theirs (T158). A
 * Section stored nested elsewhere, an `anchor` on any other block, and a `section`
 * object stored while feature 163 was developed render none, so they are not
 * targets. Only an anchor that already matches the stored grammar is
 * listed; the editor normalises what it writes.
 */
export function collectAnchors(data: unknown): string[] {
  const seen = new Set<string>();
  const add = (props: Record<string, unknown>): void => {
    const anchor = props.anchor;
    if (typeof anchor === 'string' && SECTION_ANCHOR_RE.test(anchor)) seen.add(anchor);
  };
  const content = isRecord(data) && Array.isArray(data.content) ? data.content : [];
  for (const item of content) {
    if (!isRecord(item) || !isRecord(item.props)) continue;
    if (item.type === SECTION_BLOCK) add(item.props);
    if (item.type !== SECTION_GROUP_BLOCK) continue;
    // T158: a top-level group renders its own id, and its Sections render theirs.
    add(item.props);
    const sections = Array.isArray(item.props.content) ? item.props.content : [];
    for (const child of sections) {
      if (isRecord(child) && child.type === SECTION_BLOCK && isRecord(child.props)) add(child.props);
    }
  }
  return [...seen];
}
