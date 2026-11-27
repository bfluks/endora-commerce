import { toScopeChannel, type ChannelUrlFacts } from '@endora-commerce/contracts';

/**
 * The URL-language facts of a channel as catalog holds it (feature 167,
 * `specs/167-storefront-locale-path/`) — what `productPath` needs to put the language
 * prefix on a product URL: the channel's languages (default included), its default
 * language and whether that default is prefixed.
 *
 * `prefixDefaultLanguage` is optional only for fixtures that predate the column; an
 * absent value is the column default, on (OR-1). Every production caller passes the
 * resolved or stored channel, which always carries it.
 */
export function channelUrlFactsOf(channel: {
  languages?: readonly string[] | undefined;
  defaultLanguage: string;
  prefixDefaultLanguage?: boolean | undefined;
}): ChannelUrlFacts {
  return {
    languages: toScopeChannel({ id: '', languages: channel.languages, defaultLanguage: channel.defaultLanguage })
      .languages,
    defaultLanguage: channel.defaultLanguage,
    prefixDefaultLanguage: channel.prefixDefaultLanguage ?? true,
  };
}
