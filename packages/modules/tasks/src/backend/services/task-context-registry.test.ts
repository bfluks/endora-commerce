import { describe, expect, it } from 'vitest';
import type { TaskContextDescriptor } from '@endora-commerce/contracts';
import { TaskContextRegistry } from './task-context-registry.js';

function descriptor(contextType: string, ownerModuleId: string): TaskContextDescriptor {
  return {
    contextType,
    ownerModuleId,
    allVisibleContextIds: async () => [],
    visibleContextIds: async () => new Set(),
    canSeeAs: async () => false,
    canChangeTasks: async () => false,
    describe: async () => new Map(),
  };
}

describe('TaskContextRegistry', () => {
  it('enumerates only descriptors whose owner is present, and keeps the others for when it is back', () => {
    const present = new Set(['projects']);
    const registry = new TaskContextRegistry((id) => present.has(id));
    const project = descriptor('project', 'projects');
    const other = descriptor('other', 'elsewhere');
    registry.register(project);
    registry.register(other);

    expect(registry.present()).toEqual([project]);
    expect(registry.presentFor('project')).toBe(project);
    expect(registry.presentFor('other')).toBeNull();
    expect(registry.presentFor('never_registered')).toBeNull();

    present.add('elsewhere');
    expect(registry.present()).toEqual([project, other]);
    present.delete('projects');
    expect(registry.presentFor('project')).toBeNull();
  });

  it('takes the same descriptor twice as once, and refuses a second owner for a type', () => {
    const registry = new TaskContextRegistry(() => true);
    const project = descriptor('project', 'projects');
    registry.register(project);
    registry.register(project);
    expect(registry.present()).toHaveLength(1);
    expect(() => registry.register(descriptor('project', 'intruder'))).toThrow(/already registered by "projects"/);
  });
});
