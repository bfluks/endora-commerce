import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Every call this storefront makes to the backend names the sales channel it is
 * on (`specs/154-sales-channel-access/contracts/storefront-ux.md` §1.7, owner
 * decision D1).
 *
 * The backend decides who may use a channel from the channel the request names.
 * A call that names none is answered on the system default — a different store,
 * with a different access rule and different prices — so a forgotten header is
 * not a harmless omission any more. It used to be one, which is how five direct
 * `fetch` sites and the browser-side helpers came to send nothing.
 *
 * The rule this file holds: a `fetch` whose address is built from the backend's
 * origin takes its headers from one of the two channel helpers —
 * `activeChannelHeaders` (server: the request's channel) or `channelHeaders`
 * (an explicit channel argument, which is what browser code and route handlers
 * forwarding a request use). The literal header name is spelled in those helpers
 * and nowhere else, so "builds its own header" is not a third way to pass.
 *
 * It parses the source rather than running it: the point is that a call site
 * added next month cannot skip the channel, and only a reading of every call
 * site says that.
 */

const ROOT = resolve(import.meta.dirname, '../..');
const SCANNED = ['lib', 'app', 'components'] as const;

/**
 * Backend calls that deliberately name no channel, with the reason. A health
 * probe asks whether the process answers at all; it is not a question about
 * any store.
 */
const NO_CHANNEL_BY_DESIGN: Readonly<Record<string, string>> = {
  'lib/api/backend-reachability.ts': 'the reachability probe asks the process, not a store',
};

/** The modules that are allowed to spell the header name. */
const HEADER_HELPERS = new Set(['lib/channel/channel-header.ts', 'lib/api/channel-headers.ts']);

/** An address built from one of the backend's origins. */
const BACKEND_ADDRESS =
  /\b(backendBaseUrl|baseUrl|apiBase|apiBaseUrl|browserBaseUrl|base)\b/;

const CHANNEL_HELPER_CALL = /\b(activeChannelHeaders|channelHeaders)\(/;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name === 'node_modules' || name === '.next') continue;
      out.push(...sourceFiles(path));
    } else if (/\.(ts|tsx|mjs)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(path);
    }
  }
  return out;
}

function isFunctionLike(node: ts.Node): node is ts.SignatureDeclaration {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node)
  );
}

interface BackendFetch {
  file: string;
  line: number;
  /** The text of the function the call sits in — where its headers are built. */
  scope: string;
  /**
   * The functions of the same file that build a channel header themselves. A
   * call whose scope calls one of them is covered — one level, the shape of a
   * route handler's `forwardHeaders(request)`.
   */
  channelBuilders: readonly string[];
}

/** Named functions of `source` whose body calls a channel helper. */
function channelBuildersOf(source: ts.SourceFile): string[] {
  const names: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name && CHANNEL_HELPER_CALL.test(node.getText(source))) {
      names.push(node.name.text);
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)) &&
      CHANNEL_HELPER_CALL.test(node.initializer.getText(source))
    ) {
      names.push(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return names;
}

function isCovered(call: BackendFetch): boolean {
  if (CHANNEL_HELPER_CALL.test(call.scope)) return true;
  return call.channelBuilders.some((name) => new RegExp(`\\b${name}\\(`).test(call.scope));
}

function backendFetches(): BackendFetch[] {
  const found: BackendFetch[] = [];
  for (const dir of SCANNED) {
    for (const path of sourceFiles(join(ROOT, dir))) {
      const file = relative(ROOT, path);
      const text = readFileSync(path, 'utf8');
      const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
      const channelBuilders = channelBuildersOf(source);
      const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node)) {
          const callee = node.expression;
          const isFetch =
            (ts.isIdentifier(callee) && callee.text === 'fetch') ||
            (ts.isPropertyAccessExpression(callee) && callee.name.text === 'fetch');
          const address = node.arguments[0];
          if (isFetch && address !== undefined && BACKEND_ADDRESS.test(address.getText(source))) {
            let scope: ts.Node = node;
            while (scope.parent !== undefined && !isFunctionLike(scope)) scope = scope.parent;
            found.push({
              file,
              line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
              scope: scope.getText(source),
              channelBuilders,
            });
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
  }
  return found;
}

describe('backend calls carry the active sales channel', () => {
  const calls = backendFetches();

  it('finds the backend calls it is about', () => {
    // A scan that finds nothing passes everything; the transport alone has three.
    expect(calls.length).toBeGreaterThan(10);
    expect(calls.map((c) => c.file)).toContain('lib/api/client.ts');
  });

  it('builds every backend call’s headers with a channel helper', () => {
    const missing = calls
      .filter((c) => !(c.file in NO_CHANNEL_BY_DESIGN))
      .filter((c) => !isCovered(c))
      .map((c) => `${c.file}:${c.line}`);
    expect(missing).toEqual([]);
  });

  it('keeps the no-channel ledger to calls that still exist', () => {
    const files = new Set(calls.map((c) => c.file));
    expect(Object.keys(NO_CHANNEL_BY_DESIGN).filter((file) => !files.has(file))).toEqual([]);
  });

  it('spells the header name only in the channel helpers', () => {
    const spelled: string[] = [];
    for (const dir of SCANNED) {
      for (const path of sourceFiles(join(ROOT, dir))) {
        const file = relative(ROOT, path);
        if (HEADER_HELPERS.has(file)) continue;
        // Reading the inbound request's header (`headers.get('x-sales-channel')`)
        // is not sending one, and is how the channel is learnt in the first place.
        const text = readFileSync(path, 'utf8').replace(/\.get\(\s*'x-sales-channel'\s*\)/gi, '');
        const code = text.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
        if (/['"`]x-sales-channel['"`]/i.test(code)) spelled.push(file);
      }
    }
    expect(spelled.sort()).toEqual([]);
  });
});
