import {
  ERROR_CODES,
  type ErrorCode,
  MEGAMENU_CLICK_NAVIGATES_KINDS,
  MEGAMENU_LABEL_INHERITING_KINDS,
  MEGAMENU_TAB_KINDS,
  type MegamenuAlignment,
  type MegamenuItemKind,
  type MegamenuPresentation,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';

/** What the rules read of an item, once the save has normalised the tree. */
export interface TreeRuleItem {
  id: string;
  parentId: string | null;
  kind: MegamenuItemKind;
  labels: Record<string, string>;
  presentation?: MegamenuPresentation | undefined;
  alignment?: MegamenuAlignment | undefined;
  clickNavigates?: boolean | undefined;
  target: unknown;
}

export interface TreeRuleWarning {
  code: 'MEGAMENU_DROPDOWN_DEPTH_IGNORED' | 'MEGAMENU_PROMO_SLOT_TAKEN';
  message: string;
}

/**
 * Kinds that carry no name of their own and are rendered without a label —
 * media and embeds — so a label is optional for them as well.
 */
const LABEL_OPTIONAL_KINDS: ReadonlySet<MegamenuItemKind> = new Set<MegamenuItemKind>([
  ...MEGAMENU_LABEL_INHERITING_KINDS,
  'asset',
  'cms-block-embed',
]);

/**
 * The navigation bar's tree rules (feature 168, data-model §3). Throws the
 * first refusal, naming the item; answers the non-blocking warnings.
 *
 * A pure function of the tree, so the save runs it before any cross-module
 * read and the editor's mistakes cost no query.
 */
export function checkTreeRules(items: readonly TreeRuleItem[]): TreeRuleWarning[] {
  const children = new Map<string, TreeRuleItem[]>();
  for (const item of items) {
    if (item.parentId === null) continue;
    const list = children.get(item.parentId) ?? [];
    list.push(item);
    children.set(item.parentId, list);
  }

  const warnings: TreeRuleWarning[] = [];
  for (const item of items) {
    const isTab = item.parentId === null;
    if (isTab) checkTab(item, children.get(item.id) ?? []);
    else if (item.presentation !== undefined || item.alignment !== undefined || item.clickNavigates === true) {
      refuse(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        item,
        'only a top-level item has a presentation, an alignment and a click behaviour',
      );
    }

    if (!LABEL_OPTIONAL_KINDS.has(item.kind) && !hasLabel(item.labels)) {
      refuse(400, ERROR_CODES.MEGAMENU_LABEL_REQUIRED, item, `a ${item.kind} needs a label in at least one language`);
    }

    if (!isTab) continue;
    const own = children.get(item.id) ?? [];
    if (item.presentation === 'dropdown' && own.some((child) => (children.get(child.id) ?? []).length > 0)) {
      warnings.push({
        code: 'MEGAMENU_DROPDOWN_DEPTH_IGNORED',
        message: `Tab ${item.id} is a dropdown, which shows one level; the items below its children are not displayed.`,
      });
    }
    const sides = own
      .filter((child) => child.kind === 'cms-block-embed')
      .map((child) => (child.target as { embedSide?: string }).embedSide ?? 'right');
    if (new Set(sides).size < sides.length) {
      warnings.push({
        code: 'MEGAMENU_PROMO_SLOT_TAKEN',
        message: `Tab ${item.id} has two embedded blocks on one side; only the first is displayed.`,
      });
    }
  }
  return warnings;
}

function checkTab(item: TreeRuleItem, children: readonly TreeRuleItem[]): void {
  if (item.presentation === undefined) {
    refuse(400, ERROR_CODES.VALIDATION_FAILED, item, 'a top-level item needs a presentation');
  }
  if (!MEGAMENU_TAB_KINDS.has(item.kind)) {
    refuse(400, ERROR_CODES.MEGAMENU_KIND_NOT_ALLOWED_AS_TAB, item, `a ${item.kind} cannot be a tab`);
  }
  if (item.clickNavigates === true && !MEGAMENU_CLICK_NAVIGATES_KINDS.has(item.kind)) {
    refuse(400, ERROR_CODES.VALIDATION_FAILED, item, `a ${item.kind} tab has no link of its own to follow on click`);
  }
  if (item.presentation === 'link' && (item.kind === 'group' || children.length > 0)) {
    refuse(
      400,
      ERROR_CODES.MEGAMENU_LINK_TAB_INVALID,
      item,
      item.kind === 'group' ? 'a group has no link to show as a link tab' : 'a link tab cannot have children',
    );
  }
}

function hasLabel(labels: Record<string, string>): boolean {
  return Object.values(labels).some((label) => label.trim().length > 0);
}

function refuse(status: number, code: ErrorCode, item: TreeRuleItem, reason: string): never {
  throw new HttpError(status, code, `Item ${item.id}: ${reason}.`, [{ path: `items.${item.id}`, issue: code }]);
}
