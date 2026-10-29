import {
  ERROR_CODES,
  type ProjectStageGuard,
  type ProjectStageGuardContext,
  type ProjectStageGuardRegistryPort,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';

/**
 * The guards other modules — and deployments — register on a Stage move, a
 * close and a reopen: the seam that can **refuse** one (FR-014, research R-6;
 * CRM's `opportunityTransitionGuardRegistry`, the same principle).
 *
 * A contribution seam: registered ungated, pushed into from a contributor's
 * contribution-only boot hook. `register` and `owners` are the published half
 * (`ProjectStageGuardRegistryPort`); `run` is this module's own, called by the
 * move service before anything is written.
 *
 * **Enumeration policy, applied at dispatch and not at registration**: a guard
 * whose owner module is not effectively present is skipped, so a switched-off
 * module does not veto — and switching it back on takes effect without a
 * restart.
 */
export class ProjectStageGuardRegistry implements ProjectStageGuardRegistryPort {
  private readonly guards: ProjectStageGuard[] = [];

  constructor(private readonly isModulePresent: (moduleId: string) => boolean) {}

  register(guard: ProjectStageGuard): void {
    if (this.guards.includes(guard)) return;
    this.guards.push(guard);
  }

  owners(): readonly string[] {
    return this.guards.map((guard) => guard.ownerModuleId);
  }

  /**
   * Ask every present guard, in registration order. The first refusal ends the
   * run as a 409 `PROJECT_GUARD_REFUSED` whose sentence is the guard's own; it
   * travels in `details.reason` too, because the error envelope answers a
   * declared code with its bundle sentence and this code's sentence is that
   * placeholder alone. Anything a guard throws is its defect and surfaces as
   * one.
   */
  async run(ctx: ProjectStageGuardContext): Promise<void> {
    for (const guard of this.guards) {
      if (!this.isModulePresent(guard.ownerModuleId)) continue;
      const decision = await guard.before(ctx);
      if (!decision.allow) {
        throw new HttpError(409, ERROR_CODES.PROJECT_GUARD_REFUSED, decision.reason, {
          reason: decision.reason,
          kind: ctx.kind,
        });
      }
    }
  }
}
