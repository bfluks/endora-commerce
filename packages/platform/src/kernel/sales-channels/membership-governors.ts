import type { EntityManager } from '@mikro-orm/postgresql';
import type { ChannelMemberEntityType } from '@endora-commerce/contracts';

/**
 * Channel-membership governors — `specs/193-product-visibility-rules/` (research R-10,
 * contracts/ports.md §5, threat model TM-10).
 *
 * A module that decides which entities belong to a channel — the website rule of
 * `product_visibility_rules` — contributes a **governor**. `SalesChannelMembershipService`, the
 * single mutator of every bridge (Principle XII), asks the governors before it writes a (channel,
 * entity) pair: a governed pair is skipped by default (automatic writers — create, duplicate,
 * import, connectors — comply unchanged), refused when the caller says the write is manual
 * (`onGoverned: 'refuse'`), and applied only with the governing module's own write token.
 *
 * ## Why the token is an object checked by identity
 *
 * Every module can resolve the container's cradle, so anything placed there is anybody's. The
 * token is handed to the registering module once, as the return value of {@link register}, and
 * this registry recognises it by identity in a module-private `WeakMap`: a structurally identical
 * object is not a token. Its type is opaque — nothing on the `./kernel` barrel constructs one — and
 * the registering module keeps it in a closure, never in the container.
 *
 * ## Lifetime
 *
 * One registry per composition (`composeSalesChannelsKernel`), so a process composing the platform
 * more than once — the test harness — gets a fresh one each time. Registration is open while the
 * boot hooks run and closed by {@link seal}, which both composition roots call after
 * `runBootHooks()`; one governor per module id.
 *
 * ## Presence
 *
 * Asked per mutation through `isPresent` (the live effective state), as the command-hook registry
 * does: a governor whose module is switched off governs nothing, so switching it off or on needs
 * no restart (FR-073). The registering boot hook is a contribution and does not probe presence.
 */

/** What a governor says about one channel: the label its refusals name, or `null` (not governed). */
export interface ChannelMembershipGovernance {
  /** User-authored text (a rule name) — rendered as text only. */
  readonly ruleLabel: string;
}

export interface ChannelMembershipGovernor {
  readonly moduleId: string;
  /** The entity types it governs (`['product']` for the website rule); every other type is untouched. */
  readonly entityTypes: readonly ChannelMemberEntityType[];
  /**
   * Runs on the mutation's own `EntityManager`, inside its transaction. `null` = not governed.
   * Throwing refuses the mutation — it is never read as "not governed" (TM-10).
   */
  governs(em: EntityManager, channelId: string): Promise<ChannelMembershipGovernance | null>;
}

declare const governorWriteTokenBrand: unique symbol;

/**
 * The governing module's write token: opaque, issued by {@link ChannelMembershipGovernorRegistry.register}
 * and recognised by identity only. Not constructible from the kernel barrel.
 */
export interface GovernorWriteToken {
  readonly [governorWriteTokenBrand]: never;
}

/** The contribution side, as a module resolves it (`salesChannelMembershipGovernors`). */
export interface ChannelMembershipGovernorRegistryPort {
  /** Boot-time only, once per module id; returns this governor's write token. */
  register(governor: ChannelMembershipGovernor): GovernorWriteToken;
}

/** A governed channel, as the membership service sees it. */
export interface GovernedChannel extends ChannelMembershipGovernance {
  readonly moduleId: string;
}

export interface ChannelMembershipGovernorRegistryOptions {
  /** The live effective state; defaults to always-present for unit tests and bare harnesses. */
  readonly isPresent?: (moduleId: string) => boolean;
}

export class ChannelMembershipGovernorRegistry implements ChannelMembershipGovernorRegistryPort {
  readonly #isPresent: (moduleId: string) => boolean;
  readonly #governors: ChannelMembershipGovernor[] = [];
  readonly #tokens = new WeakMap<object, string>();
  #sealed = false;
  #registrationPort: ChannelMembershipGovernorRegistryPort | undefined;

  constructor(options: ChannelMembershipGovernorRegistryOptions = {}) {
    this.#isPresent = options.isPresent ?? ((): boolean => true);
  }

  get isSealed(): boolean {
    return this.#sealed;
  }

  register(governor: ChannelMembershipGovernor): GovernorWriteToken {
    if (this.#sealed) {
      throw new Error(
        `[sales-channels] the membership governor registry is sealed — module '${governor.moduleId}' ` +
          'tried to register a governor after boot. Register from a boot hook.',
      );
    }
    if (this.#governors.some((held) => held.moduleId === governor.moduleId)) {
      throw new Error(`[sales-channels] module '${governor.moduleId}' has already registered a membership governor.`);
    }
    this.#governors.push(governor);
    const token = Object.freeze(Object.create(null) as object);
    this.#tokens.set(token, governor.moduleId);
    return token as GovernorWriteToken;
  }

  /**
   * What a composition root contributes as `salesChannelMembershipGovernors`: a frozen object
   * holding `register` alone. The cradle is every module's, so `seal`, `tokenModule` and
   * `governing` stay on the registry, which only the composition and the membership service hold.
   *
   * The registering module's id is not checked against the caller: the contribution is one
   * platform-wide value, so the composition cannot tell which module resolved it.
   */
  registrationPort(): ChannelMembershipGovernorRegistryPort {
    this.#registrationPort ??= Object.freeze({
      register: (governor: ChannelMembershipGovernor): GovernorWriteToken => this.register(governor),
    });
    return this.#registrationPort;
  }

  /** Close registration. Called by the composition roots after the boot hooks ran. */
  seal(): void {
    this.#sealed = true;
  }

  /** The module a token was issued to, or `null` when it is not one of this registry's tokens. */
  tokenModule(token: GovernorWriteToken | undefined): string | null {
    if (token === undefined || token === null || typeof token !== 'object') return null;
    return this.#tokens.get(token) ?? null;
  }

  /** Whether any present governor declares `entityType` — a mutation of another type asks nothing. */
  governsType(entityType: ChannelMemberEntityType): boolean {
    return this.#governors.some((g) => g.entityTypes.includes(entityType) && this.#isPresent(g.moduleId));
  }

  /**
   * The present governor of `channelId` for `entityType`, or `null`. A governor that throws
   * propagates: the mutation is refused (TM-10).
   */
  async governing(em: EntityManager, entityType: ChannelMemberEntityType, channelId: string): Promise<GovernedChannel | null> {
    for (const governor of this.#governors) {
      if (!governor.entityTypes.includes(entityType) || !this.#isPresent(governor.moduleId)) continue;
      const governance = await governor.governs(em, channelId);
      if (governance !== null) return { moduleId: governor.moduleId, ruleLabel: governance.ruleLabel };
    }
    return null;
  }
}
