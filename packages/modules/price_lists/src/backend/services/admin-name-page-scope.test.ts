import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Spec 193 T043 — `CatalogAdminNamePageQuery.scope` is optional on the published port (absent =
 * the system scope, so the change is compatible), which makes it this module's job to never leave
 * it out: every `pageProductsByAdminName({ … })` call here names `scope` explicitly.
 */
const BACKEND = dirname(dirname(fileURLToPath(import.meta.url)));
const FILES = ['services/price-book-reads.ts'];

describe('price_lists always passes the admin product scope to pageProductsByAdminName (spec 193 T043)', () => {
  it('every call names `scope`', () => {
    const findings: string[] = [];
    let calls = 0;
    for (const file of FILES) {
      const sf = ts.createSourceFile(file, readFileSync(join(BACKEND, file), 'utf8'), ts.ScriptTarget.Latest, true);
      const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'pageProductsByAdminName') {
          calls += 1;
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
    expect(calls).toBeGreaterThan(0);
    expect(findings, 'calls that leave the scope out').toEqual([]);
  });
});
