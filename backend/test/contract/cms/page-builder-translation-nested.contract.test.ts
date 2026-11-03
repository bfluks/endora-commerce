import { randomBytes } from 'crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cmsPageBuilderTranslateResponseSchema } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  ScriptedTranslator,
  resetTranslationSettings,
  seedTranslationSettings,
} from '../../helpers/cms-translation.js';

/**
 * Feature 163, T060 — `specs/163-page-builder-marketing-pages/` US5 independent
 * test, FR-023, research R-13: tab and accordion panels hold blocks, and the
 * existing translate action translates the texts inside them.
 *
 * A Tabs block whose panel holds a `cms.RichContent` and an Accordion whose
 * panel holds a `cms.Heading` come back with every nested text translated and
 * the structure unchanged: the same string leaves at the same paths, the same
 * block types and ids. A panel still stored as HTML is translated too. The
 * model is `ScriptedTranslator` echoing `[en] …`; no request leaves the process.
 */

const ADMIN = { b2b_session: 'stub-admin-session' };
const TRANSLATE = '/api/v1/admin/cms/page-builder/translate';

const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

function canvas() {
  return {
    root: { props: { title: 'Strona' } },
    content: [
      {
        type: 'cms.Tabs',
        props: {
          id: 'tabs',
          variant: 'pills',
          effect: 'fade',
          items: [
            {
              label: 'Dla kupujących',
              panel: [{ type: 'cms.RichContent', props: { id: 'tab-rich', content: doc('Treść dla kupujących'), html: '<p>stale</p>' } }],
            },
            { label: 'Dla sprzedawców', content: '<p>Zapisany panel</p>' },
          ],
        },
      },
      {
        type: 'cms.Accordion',
        props: {
          id: 'faq',
          allowMultiple: false,
          items: [
            {
              title: 'Jak zamówić?',
              panel: [{ type: 'cms.Heading', props: { id: 'faq-heading', text: doc('Zamówienie w trzech krokach'), level: 'h3' } }],
            },
          ],
        },
      },
    ],
  };
}

/** Every string leaf, keyed by its path. */
function stringLeaves(value: unknown, path = '$', out = new Map<string, string>()): Map<string, string> {
  if (typeof value === 'string') out.set(path, value);
  else if (Array.isArray(value)) value.forEach((v, i) => stringLeaves(v, `${path}[${i}]`, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) stringLeaves(v, `${path}.${k}`, out);
  }
  return out;
}

describe('Page Builder translation — nested panels (feature 163, T060)', () => {
  let h: BackendServerHandle;
  const model = new ScriptedTranslator();

  beforeAll(async () => {
    process.env['SETTINGS_SECRET_ENCRYPTION_KEY'] = randomBytes(32).toString('base64');
    h = await setupBackendServer({ registrations: { cmsTranslationLlmFetch: model.fetch } });
    await seedTranslationSettings(h);
  }, 120_000);

  afterAll(async () => {
    await resetTranslationSettings(h);
    await teardownBackendServer(h);
    delete process.env['SETTINGS_SECRET_ENCRYPTION_KEY'];
  });

  beforeEach(() => {
    model.requests.length = 0;
    model.answer = { kind: 'echo' };
  });

  it('translates the texts inside tab and accordion panels and leaves the structure as it was', async () => {
    const r = await h.app.inject({
      method: 'POST',
      url: TRANSLATE,
      cookies: ADMIN,
      payload: { targetLanguage: 'en-US', sourceLanguage: null, context: 'cms', data: canvas() },
    });
    expect(r.statusCode).toBe(200);
    const { data, report } = cmsPageBuilderTranslateResponseSchema.parse(r.json().data);

    const before = stringLeaves(canvas());
    const after = stringLeaves(data);
    expect([...after.keys()].sort()).toEqual([...before.keys()].sort());

    expect(after.get('$.content[0].props.items[0].label')).toBe('[en] Dla kupujących');
    expect(after.get('$.content[0].props.items[0].panel[0].props.content.content[0].content[0].text')).toBe('[en] Treść dla kupujących');
    expect(after.get('$.content[0].props.items[1].label')).toBe('[en] Dla sprzedawców');
    expect(after.get('$.content[0].props.items[1].content')).toBe('[en] <p>Zapisany panel</p>');
    expect(after.get('$.content[1].props.items[0].title')).toBe('[en] Jak zamówić?');
    expect(after.get('$.content[1].props.items[0].panel[0].props.text.content[0].content[0].text')).toBe('[en] Zamówienie w trzech krokach');

    // Nothing but those six texts moved: types, ids, options and the synced HTML are as sent.
    const changed = [...before].filter(([path, value]) => after.get(path) !== value).map(([path]) => path);
    expect(changed.sort()).toEqual(
      [
        '$.content[0].props.items[0].label',
        '$.content[0].props.items[0].panel[0].props.content.content[0].content[0].text',
        '$.content[0].props.items[1].label',
        '$.content[0].props.items[1].content',
        '$.content[1].props.items[0].title',
        '$.content[1].props.items[0].panel[0].props.text.content[0].content[0].text',
      ].sort(),
    );
    expect(report.untranslatableBlocks).toEqual([]);
  });
});
