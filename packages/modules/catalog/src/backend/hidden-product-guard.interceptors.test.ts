import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { HIDDEN_ANSWERS } from './hidden-product-guard.js';

/**
 * Spec 193 T041 (TM-1, checkpoint 1) — the guard answers a hidden product before the API
 * pre-interceptor dispatcher runs, **except** on the `'in-handler'` routes: there the guard abstains
 * and the handler asks at its own lookup, which runs after the dispatcher. A pre-interceptor on one
 * of those routes would see a hidden product's id. This architecture test holds that no
 * `phase: 'pre'` registration in the repository's source (every module, the platform, the backend's
 * apps and fixture modules) targets one of them.
 *
 * Interceptor targets are exact endpoint identities (`"<METHOD> <route pattern>"`, validated at
 * boot against the route table), so equality is the right comparison. A registration whose
 * `target` is not a string literal (or an array of them) cannot be checked here and fails the test:
 * write the target out. What this cannot see — a module outside this repository — is the residual
 * risk recorded in `specs/193-product-visibility-rules/research.md`.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..', '..', '..');
const ROOTS = [join(REPO, 'packages'), join(REPO, 'backend', 'src')];
const SKIP = new Set(['node_modules', 'dist', 'coverage', '.turbo']);

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(path, out);
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.d\.ts$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(path);
  }
  return out;
}

const propertyOf = (node: ts.ObjectLiteralExpression, name: string): ts.PropertyAssignment | undefined =>
  node.properties.find(
    (p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) && p.name.text === name,
  );

/** Every `{ phase: 'pre', target }` object literal: its literal targets, or `null` when not literal. */
function preRegistrations(): Array<{ at: string; targets: string[] | null }> {
  const found: Array<{ at: string; targets: string[] | null }> = [];
  for (const root of ROOTS) {
    for (const path of sourceFiles(root)) {
      const text = readFileSync(path, 'utf8');
      if (!/phase:\s*['"]pre['"]/.test(text)) continue;
      const file = relative(REPO, path);
      const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
      const visit = (node: ts.Node): void => {
        if (ts.isObjectLiteralExpression(node)) {
          const phase = propertyOf(node, 'phase');
          const target = propertyOf(node, 'target');
          if (phase && ts.isStringLiteralLike(phase.initializer) && phase.initializer.text === 'pre' && target) {
            const init = target.initializer;
            const targets = ts.isStringLiteralLike(init)
              ? [init.text]
              : ts.isArrayLiteralExpression(init) && init.elements.every(ts.isStringLiteralLike)
                ? init.elements.map((e) => (e as ts.StringLiteralLike).text)
                : null;
            found.push({ at: `${file}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`, targets });
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
    }
  }
  return found;
}

describe('no API pre-interceptor targets an in-handler catalog route (spec 193, T041)', () => {
  const inHandler = Object.entries(HIDDEN_ANSWERS)
    .filter(([, answer]) => answer === 'in-handler')
    .map(([route]) => route);

  it('the in-handler set is the nine routes the guard abstains on', () => {
    expect(inHandler).toHaveLength(9);
  });

  it('every pre-interceptor registration in the repository names its targets literally, and none is in-handler', () => {
    const registrations = preRegistrations();
    // Not vacuous: the connectors' activation interceptors are found.
    expect(registrations.length).toBeGreaterThan(0);
    expect(registrations.filter((r) => r.targets === null).map((r) => r.at), 'registrations with a non-literal target').toEqual([]);
    const hits = registrations.flatMap((r) => (r.targets ?? []).filter((t) => inHandler.includes(t)).map((t) => `${r.at} ${t}`));
    expect(hits).toEqual([]);
  });
});
