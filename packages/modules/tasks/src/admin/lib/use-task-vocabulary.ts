import { useEffect, useState } from 'react';
import type { TaskPriorityConfig, TaskTag, TaskWorkflow } from '@endora-commerce/contracts';
import { tasksApi } from '../api.js';

/** The configuration the Tasks screens filter by, each `null` until read (or when the read failed). */
export interface TaskVocabulary {
  workflow: TaskWorkflow | null;
  priorities: TaskPriorityConfig[] | null;
  tags: TaskTag[] | null;
}

/**
 * The workflow, the priority list and the tag list, read once per mount —
 * the filters' options, the board's lanes and moves, and what a saved view is
 * checked against (`specs/165-task-management/` research R-13). A list that
 * cannot be read stays `null`: its filter offers less, and nothing breaks.
 */
export function useTaskVocabulary(): TaskVocabulary {
  const [vocabulary, setVocabulary] = useState<TaskVocabulary>({ workflow: null, priorities: null, tags: null });
  useEffect(() => {
    let alive = true;
    const keep = <K extends keyof TaskVocabulary>(key: K) => (value: TaskVocabulary[K]): void => {
      if (alive) setVocabulary((previous) => ({ ...previous, [key]: value }));
    };
    tasksApi.workflow().then(keep('workflow'), () => undefined);
    tasksApi.priorities().then(keep('priorities'), () => undefined);
    tasksApi.listTags().then(keep('tags'), () => undefined);
    return (): void => {
      alive = false;
    };
  }, []);
  return vocabulary;
}
