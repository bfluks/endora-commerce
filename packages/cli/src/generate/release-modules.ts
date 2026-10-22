/**
 * The release modules an instance's installed modules need and it does not
 * declare — `endora generate`'s first step, before anything is rendered.
 *
 * ## Why `generate` is where they get declared
 *
 * A release can make a module required that the previous one did not publish:
 * 0.107.0's `invoices` names `document_templates` in its manifest
 * `dependencies`, and `@endora-commerce/mod-document-templates` is new in that
 * release. `endora upgrade` moves only the packages an instance already
 * declares, and it is the **previous** release's CLI that runs it — the one the
 * instance had installed — so no change to the upgrade can reach the instance
 * that needs it. What runs next is the instance's `setup`, whose first step is
 * `endora generate` from the release just installed: the first program of the
 * new release that runs at all. So the module is declared here, and every later
 * `pnpm run setup` repairs the same state however it arose.
 *
 * ## The population is the platform's own predicate
 *
 * A module is needed when an installed module names it in `dependencies` **or**
 * `acknowledgedDependencies` — `assertLockedModulesPresent` makes no difference
 * between the two, and neither does {@link loadModuleCandidates}, whose reading
 * this is — unless it is installed, the platform carries it itself, or every
 * deployment declares it in `omittedModules`. Which package carries a needed id
 * is the release index's `moduleId`, and an id no entry carries is left alone:
 * the boot names it, and this command has no package to offer for it.
 */
import { type ModulePackage, scanInstalledPlatformPackage } from '../lib/module-packages.js';
import { loadModuleCandidates, type ModuleCandidate } from '../new-instance/modules.js';
import { readPackage, type ResolvedPackage } from '../new-instance/host.js';
import { omittedByEveryDeployment } from './divergence.js';

/** One edge naming a module: which installed module, and in which manifest field. */
export interface ReleaseModuleNeed {
  readonly moduleId: string;
  readonly field: 'dependencies' | 'acknowledgedDependencies';
}

/** Every edge, keyed by the module id it names. */
function needsOf(
  candidates: ReadonlyMap<string, ModuleCandidate>,
): Map<string, ReleaseModuleNeed[]> {
  const needs = new Map<string, ReleaseModuleNeed[]>();
  const add = (id: string, need: ReleaseModuleNeed): void => {
    if (candidates.has(id)) return;
    const list = needs.get(id) ?? [];
    if (!list.some((entry) => entry.moduleId === need.moduleId && entry.field === need.field)) {
      list.push(need);
    }
    needs.set(id, list);
  };
  for (const candidate of [...candidates.values()].sort((a, b) => a.id.localeCompare(b.id))) {
    for (const id of candidate.dependencies) add(id, { moduleId: candidate.id, field: 'dependencies' });
    for (const id of candidate.acknowledged) {
      add(id, { moduleId: candidate.id, field: 'acknowledgedDependencies' });
    }
  }
  return needs;
}

/**
 * The module ids the installed modules need and nothing here supplies, each
 * with the edges naming it, sorted by id.
 *
 * The platform's own manifests are read only when an edge is still open after
 * the installed packages and the deployments' omissions: they are imported from
 * every entry point the platform publishes, and the common run — nothing
 * missing — has no question to ask them. Throws `InstanceHostError` for a
 * package whose manifest cannot be read, which the caller reports.
 */
export async function missingReleaseModules(
  root: string,
  packages: readonly ModulePackage[],
): Promise<ReadonlyMap<string, readonly ReleaseModuleNeed[]>> {
  const resolved = new Map<string, ResolvedPackage>();
  for (const pkg of packages) {
    const read = readPackage(pkg.dir);
    if (read !== null) resolved.set(read.name, read);
  }
  const needs = needsOf((await loadModuleCandidates(resolved)).candidates);
  if (needs.size === 0) return needs;
  for (const id of omittedByEveryDeployment(root)) needs.delete(id);
  if (needs.size === 0) return needs;

  const platform = scanInstalledPlatformPackage(root);
  const host = platform === null ? null : readPackage(platform.dir);
  if (host !== null) {
    const { candidates } = await loadModuleCandidates(resolved, host);
    for (const candidate of candidates.values()) {
      if (candidate.carriedByHost) needs.delete(candidate.id);
    }
  }
  return new Map([...needs].sort(([a], [b]) => a.localeCompare(b)));
}

// --- the manifest edit -------------------------------------------------------
//
// The text is edited rather than re-serialised, for `upgrade`'s
// `rewriteManifestText` reason: a client's manifest is theirs, and a file
// re-written by a tool is a diff they did not ask for. So the JSON is walked
// for positions only, and one entry is spliced in.

interface Member {
  readonly key: string;
  /** The whitespace between the previous `{` or `,` and the key. */
  readonly leading: string;
  readonly keyStart: number;
  /** What separates the key from its value — `": "` or `":"`, as the file writes it. */
  readonly colon: string;
  readonly valueStart: number;
  readonly valueEnd: number;
}

function skipWhitespace(text: string, at: number): number {
  let index = at;
  while (index < text.length && /\s/.test(text[index]!)) index += 1;
  return index;
}

function skipString(text: string, at: number): number {
  let index = at + 1;
  while (index < text.length) {
    const char = text[index]!;
    if (char === '\\') index += 2;
    else if (char === '"') return index + 1;
    else index += 1;
  }
  throw new Error('an unterminated string');
}

function skipValue(text: string, at: number): number {
  const first = text[at];
  if (first === '"') return skipString(text, at);
  if (first === '{' || first === '[') {
    let depth = 0;
    let index = at;
    while (index < text.length) {
      const char = text[index]!;
      if (char === '"') {
        index = skipString(text, index);
        continue;
      }
      if (char === '{' || char === '[') depth += 1;
      else if (char === '}' || char === ']') {
        depth -= 1;
        if (depth === 0) return index + 1;
      }
      index += 1;
    }
    throw new Error('an unterminated object');
  }
  let index = at;
  while (index < text.length && !/[,}\]\s]/.test(text[index]!)) index += 1;
  return index;
}

function membersOf(text: string, open: number): { members: Member[]; close: number } {
  if (text[open] !== '{') throw new Error('not an object');
  const members: Member[] = [];
  let index = open + 1;
  for (;;) {
    const from = index;
    index = skipWhitespace(text, index);
    if (text[index] === '}' && members.length === 0) return { members, close: index };
    const keyStart = index;
    const keyEnd = skipString(text, keyStart);
    const key = JSON.parse(text.slice(keyStart, keyEnd)) as string;
    const colonAt = skipWhitespace(text, keyEnd);
    if (text[colonAt] !== ':') throw new Error(`no \`:\` after ${JSON.stringify(key)}`);
    const valueStart = skipWhitespace(text, colonAt + 1);
    const valueEnd = skipValue(text, valueStart);
    members.push({
      key,
      leading: text.slice(from, keyStart),
      keyStart,
      colon: text.slice(keyEnd, valueStart),
      valueStart,
      valueEnd,
    });
    index = skipWhitespace(text, valueEnd);
    if (text[index] === ',') {
      index += 1;
      continue;
    }
    if (text[index] === '}') return { members, close: index };
    throw new Error(`no \`,\` or \`}\` after ${JSON.stringify(key)}`);
  }
}

/** The indentation a run of whitespace ends a line with, or `null` when it holds no newline. */
function indentOf(leading: string): string | null {
  const newline = leading.lastIndexOf('\n');
  return newline === -1 ? null : leading.slice(newline + 1);
}

/**
 * `text` — a `package.json` — with `"name": "spec"` added to its top-level
 * `dependencies`, before the first entry that sorts after it, written the way
 * the entries around it are. No other byte moves. Throws when the text is not
 * a JSON object, which the caller reports with the file's path.
 */
export function insertDependency(text: string, name: string, spec: string): string {
  const open = skipWhitespace(text, 0);
  const top = membersOf(text, open);
  const entry = (colon: string): string => `${JSON.stringify(name)}${colon}${JSON.stringify(spec)}`;
  const field = top.members.find(
    (member) => member.key === 'dependencies' && text[member.valueStart] === '{',
  );

  let after: string;
  if (field === undefined) {
    // No `dependencies` at all: one is added after the last top-level field.
    const last = top.members.at(-1);
    if (last === undefined) throw new Error('an empty object');
    const indent = indentOf(last.leading);
    const body =
      indent === null
        ? `{${entry(last.colon)}}`
        : `{\n${indent}${indent}${entry(last.colon)}\n${indent}}`;
    after = `${text.slice(0, last.valueEnd)},${last.leading}"dependencies"${last.colon}${body}${text.slice(last.valueEnd)}`;
  } else {
    const { members, close } = membersOf(text, field.valueStart);
    const first = members[0];
    if (first === undefined) {
      const indent = indentOf(field.leading);
      const inner =
        indent === null ? entry(field.colon) : `\n${indent}${indent}${entry(field.colon)}\n${indent}`;
      after = `${text.slice(0, field.valueStart + 1)}${inner}${text.slice(close)}`;
    } else {
      const next = members.find((member) => member.key.localeCompare(name) > 0);
      if (next !== undefined) {
        after = `${text.slice(0, next.keyStart)}${entry(first.colon)},${next.leading}${text.slice(next.keyStart)}`;
      } else {
        const last = members.at(-1)!;
        after = `${text.slice(0, last.valueEnd)},${last.leading}${entry(first.colon)}${text.slice(last.valueEnd)}`;
      }
    }
  }
  const parsed = JSON.parse(after) as { dependencies?: Record<string, unknown> };
  if (parsed.dependencies?.[name] !== spec) throw new Error(`the edit did not declare ${name}`);
  return after;
}
