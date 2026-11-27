import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Spec 193 T039 — threat model TM-3 (1): **the admin product scope is a required parameter**.
 *
 * Every read the catalog admin routes, the assistant tools and the price book grid use to answer
 * "which products" takes an {@link AdminProductReadScope} as its **first** parameter, never
 * optional and never defaulted. A forgotten scope is then a compile error at every call site —
 * this file holds the signatures, so the parameter cannot be loosened (made optional, defaulted,
 * moved behind an options bag) without a red test, and it reads every call site in this module to
 * hold that each one passes one.
 *
 * The list is two-way: a method named here that no longer exists fails too.
 */

const BACKEND = dirname(dirname(fileURLToPath(import.meta.url)));

/** `<file under backend/>` → the methods whose first parameter is the scope. */
const SCOPED_METHODS: Readonly<Record<string, readonly string[]>> = {
  'services/catalog-admin.service.ts': [
    'listProducts',
    'resolveProductIds',
    'listProductsByIds',
    'listVariants',
    'narrowProductIds',
    'isProductHidden',
  ],
  'services/catalog-admin-search.service.ts': ['searchProducts'],
  'services/catalog-bulk-update.service.ts': ['bulkUpdate'],
  'services/bulk-operation.service.ts': ['list', 'get', 'undo'],
};

/** Names too common to find their call sites by name alone (`Map.get`); their signatures are held above. */
const CALL_SITE_SCAN_SKIPS: ReadonlySet<string> = new Set(['list', 'get', 'undo']);

const SCOPE_TYPE = 'AdminProductReadScope';

function sourceOf(file: string): ts.SourceFile {
  return ts.createSourceFile(file, readFileSync(join(BACKEND, file), 'utf8'), ts.ScriptTarget.Latest, true);
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) out.push(relative(BACKEND, full).split(sep).join('/'));
  }
  return out;
}

describe('the admin product scope is required (spec 193 T039, TM-3 (1))', () => {
  it('each scoped method takes the scope first: named type, not optional, no default', () => {
    const findings: string[] = [];
    for (const [file, methods] of Object.entries(SCOPED_METHODS)) {
      const sf = sourceOf(file);
      const seen = new Set<string>();
      const visit = (node: ts.Node): void => {
        if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name) && methods.includes(node.name.text)) {
          seen.add(node.name.text);
          const first = node.parameters[0];
          const where = `${file}:${node.name.text}`;
          if (!first) findings.push(`${where} takes no parameter`);
          else {
            if (first.type?.getText(sf) !== SCOPE_TYPE) findings.push(`${where}: first parameter is not ${SCOPE_TYPE}`);
            if (first.questionToken) findings.push(`${where}: the scope is optional`);
            if (first.initializer) findings.push(`${where}: the scope has a default`);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
      for (const method of methods) if (!seen.has(method)) findings.push(`${file}:${method} no longer exists`);
    }
    expect(findings).toEqual([]);
  });

  it('every call site in this module passes a scope first', () => {
    const scoped = new Set(Object.values(SCOPED_METHODS).flat().filter((m) => !CALL_SITE_SCAN_SKIPS.has(m)));
    const findings: string[] = [];
    let calls = 0;
    for (const file of walk(BACKEND)) {
      const sf = sourceOf(file);
      const visit = (node: ts.Node): void => {
        if (
          ts.isCallExpression(node) &&
          ts.isPropertyAccessExpression(node.expression) &&
          scoped.has(node.expression.name.text) &&
          // `queryService.listProducts` (the storefront listing) is another class's method.
          !/queryService|searchQueryService/i.test(node.expression.expression.getText(sf))
        ) {
          calls += 1;
          const first = node.arguments[0];
          const text = first?.getText(sf) ?? '';
          // A scope is a value resolved for the caller or the explicit system constant — never an object literal.
          if (!first || first.kind === ts.SyntaxKind.ObjectLiteralExpression || /^undefined$|^null$/.test(text)) {
            const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
            findings.push(`${file}:${line + 1} ${node.expression.getText(sf)}(${text.slice(0, 40)})`);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
    }
    expect(calls).toBeGreaterThan(0);
    expect(findings, 'call sites that pass no scope').toEqual([]);
  });
});
