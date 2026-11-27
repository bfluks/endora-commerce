import type { TaskContextDescriptor, TaskContextRegistryPort } from '@endora-commerce/contracts';

/**
 * The Task contexts other modules own — the seam through which a module makes
 * Tasks its own without `tasks` knowing it exists (research R-1, R-9).
 *
 * A **contribution seam**: registered ungated (`ctx.di.register`, never
 * `providePort`), pushed into from a contributor's contribution-only boot hook
 * with no presence probe, declared by the contributor as a `contributes-to`
 * edge. `register` is the published half ({@link TaskContextRegistryPort});
 * `present` and `presentFor` are this module's own.
 *
 * **Absent-owner policy: fail-closed, applied at enumeration and not at
 * registration.** A descriptor whose owner module is not effectively present
 * is never returned, so the Tasks of its context type are hidden — from lists,
 * counts and by id — exactly as the Tasks of a type nobody registered are; and
 * they reappear unchanged when the owner is back, without a restart, because
 * the descriptor stayed registered. Nothing in this module calls a descriptor
 * of an absent owner.
 *
 * One context type has one owner. A second, different descriptor for a type
 * already registered is a wiring defect and is refused at boot rather than
 * letting two modules answer for the same Tasks.
 */
export class TaskContextRegistry implements TaskContextRegistryPort {
  private readonly descriptors = new Map<string, TaskContextDescriptor>();

  constructor(private readonly isModulePresent: (moduleId: string) => boolean) {}

  register(descriptor: TaskContextDescriptor): void {
    const existing = this.descriptors.get(descriptor.contextType);
    if (existing === descriptor) return;
    if (existing) {
      throw new Error(
        `tasks: the Task context type "${descriptor.contextType}" is already registered by ` +
          `"${existing.ownerModuleId}"; "${descriptor.ownerModuleId}" cannot register it again.`,
      );
    }
    this.descriptors.set(descriptor.contextType, descriptor);
  }

  /** Every descriptor whose owner is effectively present, in registration order. */
  present(): TaskContextDescriptor[] {
    return [...this.descriptors.values()].filter((d) => this.isModulePresent(d.ownerModuleId));
  }

  /** The descriptor of `contextType`, or `null` when nobody registered it or its owner is absent. */
  presentFor(contextType: string): TaskContextDescriptor | null {
    const descriptor = this.descriptors.get(contextType);
    return descriptor && this.isModulePresent(descriptor.ownerModuleId) ? descriptor : null;
  }
}
