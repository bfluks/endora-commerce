import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SalesChannel } from '@endora-commerce/platform/kernel';

/**
 * Anchor refusals on the three content writes
 * (`specs/163-page-builder-marketing-pages/` T037; data-model §6;
 * `contracts/storefront-and-admin-api.md` §2): a page, a block and a template
 * `PUT …/content/:language` whose tree repeats an anchor, or takes one the
 * storefront layout renders, answers 422 naming the anchor.
 */
const RUN = `pb163_${randomUUID().slice(0, 8)}`;
// The anchor grammar has no underscore.
const ANCHOR = RUN.replace('_', '-');

type Kind = 'pages' | 'blocks' | 'templates';

describe('CMS content anchors contract (feature 163, T037)', () => {
  let h: BackendServerHandle;
  let channelId: string;
  const adminCookie = { b2b_session: 'stub-admin-session' };
  const created: Array<{ kind: Kind; id: string }> = [];

  beforeAll(async () => {
    h = await setupBackendServer({ seed: 'none' });
    const channel = await h.em().findOneOrFail(SalesChannel, { systemDefault: true });
    channelId = channel.id;
  });

  afterAll(async () => {
    for (const { kind, id } of created) {
      await h.app.inject({ method: 'DELETE', url: `/api/v1/admin/cms/${kind}/${id}`, cookies: adminCookie });
    }
    await teardownBackendServer(h);
  });

  async function create(kind: Kind): Promise<{ id: string; version: number }> {
    const key = `${RUN}-${kind}-${created.length}`;
    const base = { name: `Anchors ${key}`, description: null, salesChannelIds: [channelId], languages: ['en-US'] };
    const body =
      kind === 'pages'
        ? { ...base, slug: key, active: true }
        : kind === 'blocks'
          ? { ...base, code: key, active: true }
          : { ...base, code: key };
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/cms/${kind}`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify(body),
    });
    expect(res.statusCode).toBe(201);
    const data = (res.json() as { data: { id: string; version: number } }).data;
    created.push({ kind, id: data.id });
    return data;
  }

  function putContent(kind: Kind, id: string, data: unknown, version: number) {
    return h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/cms/${kind}/${id}/content/en-US`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ data, version }),
    });
  }

  function tree(...anchors: string[]) {
    return {
      root: { props: {} },
      content: [
        // The section anchor lives on a top-level `cms.Section` (plan § Owner ruling 2026-10-23).
        {
          type: 'cms.Section',
          props: {
            id: 's-1',
            anchor: anchors[0],
            content: [{ type: 'cms.Heading', props: { id: 'h-1', level: 'h2', text: 'Intro' } }],
          },
        },
        {
          type: 'cms.Row',
          props: {
            id: 'row-1',
            columns: [
              {
                content: [
                  {
                    type: 'cms.RichContent',
                    props: {
                      id: 'rc-1',
                      content: {
                        type: 'doc',
                        content: anchors.slice(1).map((anchor) => ({
                          type: 'heading',
                          attrs: { level: 2, anchor },
                          content: [{ type: 'text', text: 'Details' }],
                        })),
                      },
                      html: '',
                    },
                  },
                ],
              },
            ],
          },
        },
      ],
    };
  }

  it.each<Kind>(['pages', 'blocks', 'templates'])(
    'refuses a %s content write that repeats an anchor, naming it, and saves nothing',
    async (kind) => {
      const entity = await create(kind);

      const res = await putContent(kind, entity.id, tree(ANCHOR, ANCHOR), entity.version);

      expect(res.statusCode).toBe(422);
      expect(res.json()).toMatchObject({
        error: { code: ERROR_CODES.CMS_DUPLICATE_ANCHOR, details: { anchor: ANCHOR } },
      });
      expect(String(res.json().error.message)).toContain(ANCHOR);

      // Nothing was written: the version is unchanged and the save goes through once fixed.
      const ok = await putContent(kind, entity.id, tree(ANCHOR, `${ANCHOR}-details`), entity.version);
      expect(ok.statusCode).toBe(200);
    },
  );

  // T158: a top-level Section group's anchor and those of its Sections count too.
  it('refuses a page whose Section group repeats an anchor in one of its Sections, and saves the fixed one', async () => {
    const entity = await create('pages');
    const grouped = (inner: string) => ({
      root: { props: {} },
      content: [
        {
          type: 'cms.SectionGroup',
          props: {
            id: 'g-1',
            anchor: ANCHOR,
            content: [{ type: 'cms.Section', props: { id: 's-1', anchor: inner, content: [] } }],
          },
        },
      ],
    });

    const res = await putContent('pages', entity.id, grouped(ANCHOR), entity.version);
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({
      error: { code: ERROR_CODES.CMS_DUPLICATE_ANCHOR, details: { anchor: ANCHOR } },
    });

    const ok = await putContent('pages', entity.id, grouped(`${ANCHOR}-inner`), entity.version);
    expect(ok.statusCode).toBe(200);
  });

  it.each<Kind>(['pages', 'blocks', 'templates'])(
    'refuses a %s content write that takes a reserved anchor',
    async (kind) => {
      const entity = await create(kind);

      const res = await putContent(kind, entity.id, tree(`${ANCHOR}-ok`, 'main-content'), entity.version);

      expect(res.statusCode).toBe(422);
      expect(res.json()).toMatchObject({
        error: { code: ERROR_CODES.CMS_RESERVED_ANCHOR, details: { anchor: 'main-content' } },
      });
    },
  );
});
