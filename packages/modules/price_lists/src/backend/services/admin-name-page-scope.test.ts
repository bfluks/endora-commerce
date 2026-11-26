import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Spec 193 T043 — `CatalogAdminNamePageQuery.scope` is optional on the published port (absent =
 * the system scope, so the change is compatible), which makes it every caller's job to never leave
 * it out: every `pageProductsByAdminName({ … })` call **anywhere in `packages/`** names `scope`
 * explicitly (checkpoint 1: the guard covers all callers, not only this module's). A call whose
 * argument is not an object literal naming `scope` fails, so a spread or a variable is refused too.
 */
const BACKEND = dirname(dirname(fileURLToPath(import.meta.url)));
const PACKAGES = join(BACKEND, '..', '..', '..', '..');
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

describe('every caller in packages/ passes the admin product scope to pageProductsByAdminName (spec 193 T043)', () => {
  it('every call names `scope`', () => {
    const findings: string[] = [];
    let calls = 0;
    const callers = new Set<string>();
    for (const path of sourceFiles(PACKAGES)) {
      const text = readFileSync(path, 'utf8');
      if (!text.includes('pageProductsByAdminName')) continue;
      const file = relative(PACKAGES, path);
      const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
      const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'pageProductsByAdminName') {
          calls += 1;
          callers.add(file);
          const arg = node.arguments[0];
          const named =
            arg !== undefined &&
            ts.isObjectLiteralExpression(arg) &&
            arg.properties.some((p) => p.name !== undefined && ts.isIdentifier(p.name) && p.name.text === 'scope');
          if (!named) findings.push(`${file}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`);
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
    }
    // Not vacuous: the walk reaches price_lists' own caller.
    expect(calls).toBeGreaterThan(0);
    expect([...callers]).toContain(join('modules', 'price_lists', 'src', 'backend', 'services', 'price-book-reads.ts'));
    expect(findings, 'calls that leave the scope out').toEqual([]);
  });
});
