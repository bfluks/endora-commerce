import {
  channelUrlLanguageAliases,
  channelUrlLanguages,
  type ChannelUrlFacts,
} from '@endora-commerce/contracts';

/**
 * Feature 167 (FR-040, FR-041) — every storefront language prefix and split alias of
 * the given channels, each with the codes of the channels that use it. A CMS page slug
 * starting with one of these is refused, and an existing page whose first segment is
 * one is marked as shadowed: `/<prefix>/…` is that language's storefront page.
 */
export function channelLanguagePrefixes(
  channels: ReadonlyArray<ChannelUrlFacts & { readonly code: string }>,
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const add = (segment: string, code: string): void => {
    const codes = out.get(segment) ?? [];
    if (!codes.includes(code)) codes.push(code);
    out.set(segment, codes);
  };
  for (const channel of channels) {
    for (const language of channelUrlLanguages(channel)) add(language.prefix, channel.code);
    for (const alias of channelUrlLanguageAliases(channel)) add(alias.alias, channel.code);
  }
  return out;
}
