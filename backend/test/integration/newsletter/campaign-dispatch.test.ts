import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { NewsletterTokenHelper } from '../../../../packages/modules/newsletter/src/backend/services/token.helper.js';
import { NewsletterOptInService } from '../../../../packages/modules/newsletter/src/backend/services/opt-in.service.js';
import { NewsletterAudienceResolver } from '../../../../packages/modules/newsletter/src/backend/services/audience-resolver.js';
import { NewsletterContentService } from '../../../../packages/modules/newsletter/src/backend/services/content.service.js';
import { NewsletterCampaignDispatchService } from '../../../../packages/modules/newsletter/src/backend/services/campaign-dispatch.service.js';
import {
  newsletterTrackingLinks,
  type EngagementTrackingSwitches,
} from '../../../../packages/modules/newsletter/src/backend/services/engagement-tracking.js';
import { InMemoryNewsletterProvider } from '../../../../packages/modules/newsletter/src/backend/services/provider/console-provider.js';
import type { SettingsService } from '../../../src/kernel/settings/settings.service.js';
import { NewsletterCampaign, NewsletterSendRecord, NewsletterSubscriber, NewsletterSubscriberTag, NewsletterSuppression, NewsletterTag } from '../../helpers/package-entities.js';

function textTree(text: string): Record<string, unknown> {
  return { root: { props: {} }, content: [{ type: 'transactional_emails.EmailText', props: { id: 't', text } }], zones: {} };
}

const DEAL = 'https://shop.test/deal';
const API = 'https://api.shop.test';

function buttonTree(href: string): Record<string, unknown> {
  return {
    root: { props: {} },
    content: [
      { type: 'transactional_emails.EmailButton', props: { id: 'b', label: 'Deal', href } },
      { type: 'transactional_emails.EmailFooterLegal', props: { id: 'f' } },
    ],
    zones: {},
  };
}

describe('newsletter campaign dispatch (US2)', () => {
  let db: TestDb;
  let provider: InMemoryNewsletterProvider;
  let service: NewsletterCampaignDispatchService;
  let tokens: NewsletterTokenHelper;
  let switches: EngagementTrackingSwitches;
  let switchChannels: Array<string | null>;

  beforeAll(async () => {
    db = await setupTestDb();
  });
  afterAll(async () => {
    await db.close();
  });
  beforeEach(async () => {
    await db.beginTx();
    provider = new InMemoryNewsletterProvider();
    tokens = new NewsletterTokenHelper('test-secret');
    switches = { opens: true, clicks: true };
    switchChannels = [];
    const optIn = new NewsletterOptInService({} as unknown as SettingsService, tokens);
    service = new NewsletterCampaignDispatchService({
      emFactory: () => db.em(),
      audience: new NewsletterAudienceResolver(() => db.em()),
      content: new NewsletterContentService(),
      optIn,
      links: {
        confirm: (t) => `${API}/api/v1/newsletter/confirm?token=${t}`,
        unsubscribe: (t) => `${API}/api/v1/newsletter/unsubscribe?token=${t}`,
      },
      resolveProvider: async () => provider,
      resolveSender: async () => ({ fromEmail: 'news@shop.test', fromName: 'Shop' }),
      tracking: {
        tokens,
        links: newsletterTrackingLinks(API),
        resolveSwitches: async (channelId) => {
          switchChannels.push(channelId);
          return switches;
        },
      },
    });
  });
  afterEach(async () => {
    await db.rollbackTx();
  });

  it('delivers exactly once to active tagged non-suppressed subscribers and excludes the rest', async () => {
    const em = db.em();
    const tag = em.create(NewsletterTag, { code: 'promo', name: 'Promo' });

    // Eligible: active + tagged + not suppressed.
    const a = em.create(NewsletterSubscriber, { email: 'a@x.test', status: 'active' });
    const b = em.create(NewsletterSubscriber, { email: 'b@x.test', status: 'active' });
    // Excluded: active + tagged but suppressed.
    const c = em.create(NewsletterSubscriber, { email: 'c@x.test', status: 'active' });
    // Excluded: pending + tagged.
    const d = em.create(NewsletterSubscriber, { email: 'd@x.test', status: 'pending' });
    // Excluded: active but untagged.
    const e = em.create(NewsletterSubscriber, { email: 'e@x.test', status: 'active' });
    await em.flush();

    for (const s of [a, b, c, d]) em.create(NewsletterSubscriberTag, { subscriberId: s.id, tagId: tag.id });
    em.create(NewsletterSuppression, { email: 'c@x.test', reason: 'complaint' });
    void e;

    const campaign = em.create(NewsletterCampaign, {
      name: 'Promo blast',
      subject: 'Hi {{var subscriber.email}}',
      content: textTree('Deals inside'),
      language: 'en-US',
      targetType: 'tag',
      targetTagIds: [tag.id],
    });
    await em.flush();

    const res = await service.dispatchCampaign(campaign.id);

    expect(res.claimed).toBe(2);
    expect(res.sent).toBe(2);
    const recipients = provider.sent.map((m) => m.to).sort();
    expect(recipients).toEqual(['a@x.test', 'b@x.test']);
    // Subject variable resolved per recipient.
    expect(provider.sent.every((m) => m.subject.startsWith('Hi '))).toBe(true);
    // Every message carries a List-Unsubscribe header.
    expect(provider.sent.every((m) => m.headers?.['List-Unsubscribe'])).toBe(true);
  });

  it('is idempotent — a second dispatch claims and sends nothing new', async () => {
    const em = db.em();
    const tag = em.create(NewsletterTag, { code: 'promo', name: 'Promo' });
    const a = em.create(NewsletterSubscriber, { email: 'a@x.test', status: 'active' });
    await em.flush();
    em.create(NewsletterSubscriberTag, { subscriberId: a.id, tagId: tag.id });
    const campaign = em.create(NewsletterCampaign, {
      name: 'C',
      subject: 'S',
      content: textTree('B'),
      language: 'en-US',
      targetType: 'tag',
      targetTagIds: [tag.id],
    });
    await em.flush();

    const first = await service.dispatchCampaign(campaign.id);
    const second = await service.dispatchCampaign(campaign.id);

    expect(first.sent).toBe(1);
    expect(second.claimed).toBe(0);
    expect(provider.sent).toHaveLength(1);
    const records = await db.em().find(NewsletterSendRecord, { campaignId: campaign.id });
    expect(records).toHaveLength(1);
    expect(records[0]?.status).toBe('sent');
  });

  async function sendOneCampaign(overrides: Partial<{ trackingEnabled: boolean }> = {}) {
    // The audience is a tag this test owns, not `all`: `setupTestDb` truncates
    // nothing, so `all` also reaches every active subscriber another file left
    // behind (`tenancy/scoped-empty-explains-itself.test.ts` seeds two), and
    // "the one e-mail sent" would count them. What is under test here is the
    // tracking in the message, which the targeting does not touch.
    const em = db.em();
    const tag = em.create(NewsletterTag, { code: 'tracked', name: 'Tracked' });
    const a = em.create(NewsletterSubscriber, { email: 'a@x.test', status: 'active' });
    await em.flush();
    em.create(NewsletterSubscriberTag, { subscriberId: a.id, tagId: tag.id });
    const campaign = em.create(NewsletterCampaign, {
      name: 'Tracked',
      subject: 'S',
      content: buttonTree(DEAL),
      language: 'en-US',
      targetType: 'tag',
      targetTagIds: [tag.id],
      ...overrides,
    });
    await em.flush();
    await service.dispatchCampaign(campaign.id);
    const record = await db.em().findOneOrFail(NewsletterSendRecord, { campaignId: campaign.id, subscriberId: a.id });
    expect(provider.sent).toHaveLength(1);
    return { record, message: provider.sent[0]! };
  }

  it('sends a campaign e-mail with an open pixel and its links routed through the click tracker', async () => {
    const { record, message } = await sendOneCampaign();

    const src = /<img src="([^"]+open\.gif[^"]*)"/.exec(message.html)?.[1];
    expect(src).toBeDefined();
    const openUrl = new URL((src ?? '').replace(/&amp;/g, '&'));
    expect(tokens.verify(openUrl.searchParams.get('token') ?? '', 'open')).toEqual({ id: record.id });

    const href = /<a href="([^"]+)"[^>]*>[^<]*Deal/.exec(message.html)?.[1] ?? '';
    const clickUrl = new URL(href.replace(/&amp;/g, '&'));
    expect(`${clickUrl.origin}${clickUrl.pathname}`).toBe(`${API}/api/v1/newsletter/click`);
    expect(clickUrl.searchParams.get('u')).toBe(DEAL);
    expect(tokens.verify(clickUrl.searchParams.get('token') ?? '', 'click')?.id).toBe(record.id);

    // The unsubscribe link is never routed through the tracker.
    expect(message.html).toContain(`href="${API}/api/v1/newsletter/unsubscribe?token=`);
    // A campaign with no sales channel reads the platform-wide switches.
    expect(switchChannels).toEqual([null]);
  });

  it('sends the e-mail untouched when the operator switched both kinds of tracking off', async () => {
    switches = { opens: false, clicks: false };
    const { message } = await sendOneCampaign();
    expect(message.html).not.toContain('open.gif');
    expect(message.html).not.toContain('/api/v1/newsletter/click');
    expect(message.html).toContain(`href="${DEAL}"`);
  });

  it('sends the e-mail untouched when tracking is off for the campaign', async () => {
    const { message } = await sendOneCampaign({ trackingEnabled: false });
    expect(message.html).not.toContain('open.gif');
    expect(message.html).toContain(`href="${DEAL}"`);
    expect(switchChannels).toEqual([]);
  });

  it('leaves the plain-text part unchanged', async () => {
    const { message } = await sendOneCampaign();
    expect(message.text).toContain(DEAL);
    expect(message.text).not.toContain('/api/v1/newsletter/click');
  });
});
