/**
 * Feature 163 (owner decision 2026-10-29 "A") — the answer the *Create quote
 * request* screen reads for the customer's Organization's channels, for the
 * screen's tests that are not about the channel. The server checks the channel
 * of every on-behalf request, named or not, so the screen sends nothing until
 * it has read the Organization's channels; these fixtures answer one active
 * channel, which the screen preselects and sends as `salesChannelId`.
 */

/** The Organization's one active channel, preselected and sent. */
export const ORGANIZATION_CHANNEL_ID = '00000000-0000-4000-8000-00000000ccc1';

/**
 * The `GET /api/v1/admin/organizations/:id/sales-channels` answer for `path`,
 * or `null` when `path` is another read.
 */
export function organizationSalesChannelsAnswer(path: string): Promise<unknown> | null {
  const match = /^\/api\/v1\/admin\/organizations\/([^/?]+)\/sales-channels$/.exec(path);
  if (!match) return null;
  return Promise.resolve({
    data: {
      organizationId: match[1],
      assignedSalesChannelIds: [ORGANIZATION_CHANNEL_ID],
      options: [
        { id: ORGANIZATION_CHANNEL_ID, code: 'b2b', name: { 'en-US': 'Wholesale' }, active: true, systemDefault: true },
      ],
    },
  });
}
