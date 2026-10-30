/**
 * The standalone demo Tasks — work that belongs to no Project
 * (`specs/165-task-management/` T088, research R-23).
 *
 * The Project Tasks are `projects.ts`' second step. These are the rest of what
 * the Tasks screen shows on a fresh demo: ten Tasks of no context, covering
 * what the feature added — assignees, a start and a due date, a priority, two
 * tags, a parent with three sub-tasks, two comments whose bodies refer to a
 * person and to other Tasks, one private Task and one draft of the demo
 * administrator's. Every row names `admin_users`' rows, so this is a
 * composition step (§5.1), not `tasks`' own demo body — `tasks` keeps
 * `demo: false`.
 *
 * ## Written as rows, as the other demo steps are
 *
 * No Command runs, for the reason `sales-pipeline.ts` gives: a Command stamps
 * `now`. The **History** tab is therefore empty, and no event is emitted —
 * nobody is notified of a demo Task. The number is asked of `tasks`' own door
 * to its sequence, `nextTaskNumber`.
 *
 * ## Orders, where there are any
 *
 * No module seeds an Order. The call-back Task links the demo organisation's
 * newest Order if it has one — an instance the demo was used on — and none
 * otherwise, as the Projects do.
 *
 * ## What an operator changed is respected
 *
 * A priority an operator deleted is left off; a person whose account is gone
 * is not an assignee, and their mention reads as words. The step is
 * idempotent per Task: one that is there is left as it is.
 *
 * ## Withdrawn by id
 *
 * The Tasks and the two tags by their fixed ids; assignees, tag assignments,
 * comments, references and links go through `tasks`' own cascades.
 */
import type { EntityManager } from '@mikro-orm/postgresql';
import { formatRecordReferenceToken, type RecordReferenceType } from '@endora-commerce/contracts';
import type { CompositionStep } from './composition.js';

const DEMO_ORG_TAX_ID = 'PL5210000099';

/** The people of the demo, by the e-mail address `admin_users`' demo data gives each. */
const DEMO_PEOPLE = {
  admin: 'admin@demo.local',
  anna: 'sales-rep@demo.local',
  tomasz: 'sales-rep-other@demo.local',
} as const;
type DemoPerson = keyof typeof DEMO_PEOPLE;

const DAY_MS = 24 * 60 * 60 * 1000;

/** `0c2a0165-<kind>-4000-8000-<ordinal>`: one namespace per kind of row. */
const fixedId = (kind: number, ordinal: number): string =>
  `0c2a0165-${String(kind).padStart(4, '0')}-4000-8000-${String(ordinal).padStart(12, '0')}`;

// ── the tags ───────────────────────────────────────────────────────────────

export interface DemoTaskTag {
  readonly key: string;
  readonly id: string;
  readonly name: string;
  readonly color: string;
}

export const DEMO_TASK_TAGS: readonly DemoTaskTag[] = [
  { key: 'pricing', id: fixedId(2, 1), name: 'Pricing', color: '#0ea5e9' },
  { key: 'customer_care', id: fixedId(2, 2), name: 'Customer care', color: '#22c55e' },
];
export const DEMO_TAG_IDS: readonly string[] = DEMO_TASK_TAGS.map((tag) => tag.id);

// ── the Tasks ──────────────────────────────────────────────────────────────

/** A piece of a demo text: words, a person, or another demo Task. */
export type DemoTaskTextPart =
  | string
  | { readonly person: DemoPerson; readonly otherwise: string }
  | { readonly task: string };

export interface DemoTask {
  readonly id: string;
  readonly title: string;
  readonly description: readonly DemoTaskTextPart[];
  readonly status: 'todo' | 'in_progress' | 'done' | 'cancelled';
  readonly priority: 'urgent' | 'high' | 'normal' | 'low' | null;
  readonly tags: readonly string[];
  readonly assignees: readonly DemoPerson[];
  /** Days from today; negative is past. */
  readonly startInDays: number | null;
  readonly dueInDays: number | null;
  readonly createdDaysAgo: number;
  readonly parent: string | null;
  readonly private: boolean;
  readonly draft: boolean;
  readonly linksAnOrder: boolean;
}

const task = (ordinal: number): string => fixedId(1, ordinal);
const base = {
  description: [],
  priority: null,
  tags: [],
  assignees: [],
  startInDays: null,
  dueInDays: null,
  parent: null,
  private: false,
  draft: false,
  linksAnOrder: false,
} as const;

/**
 * The ten. English, as the rest of the demo's prose is; the business is the
 * industrial distributor the demo catalogue describes.
 */
export const DEMO_TASKS: readonly DemoTask[] = [
  {
    ...base,
    id: task(1),
    title: 'Review the Q4 price list',
    description: [
      'Collect the supplier changes, compare them with the market and send the new list to ',
      { person: 'anna', otherwise: 'the sales team' },
      ' for approval before the quarter starts.',
    ],
    status: 'in_progress',
    priority: 'high',
    tags: ['pricing'],
    assignees: ['admin', 'anna'],
    startInDays: -3,
    dueInDays: 7,
    createdDaysAgo: 5,
  },
  {
    ...base,
    id: task(2),
    title: 'Collect supplier price changes',
    status: 'done',
    assignees: ['anna'],
    dueInDays: -1,
    createdDaysAgo: 5,
    parent: task(1),
  },
  {
    ...base,
    id: task(3),
    title: 'Compare competitor prices',
    status: 'in_progress',
    tags: ['pricing'],
    assignees: ['tomasz'],
    dueInDays: 3,
    createdDaysAgo: 5,
    parent: task(1),
  },
  {
    ...base,
    id: task(4),
    title: 'Draft the new price list',
    status: 'todo',
    assignees: ['admin'],
    dueInDays: 6,
    createdDaysAgo: 5,
    parent: task(1),
  },
  {
    ...base,
    id: task(5),
    title: 'Call back about the delayed delivery',
    description: ['The customer asked for a new delivery date. Confirm it with the warehouse first.'],
    status: 'todo',
    priority: 'urgent',
    tags: ['customer_care'],
    assignees: ['anna'],
    dueInDays: 1,
    createdDaysAgo: 1,
    linksAnOrder: true,
  },
  {
    ...base,
    id: task(6),
    title: 'Update the customer onboarding checklist',
    status: 'todo',
    priority: 'normal',
    assignees: ['tomasz'],
    startInDays: 2,
    dueInDays: 14,
    createdDaysAgo: 2,
  },
  {
    ...base,
    id: task(7),
    title: 'Renew the forklift inspection',
    status: 'done',
    priority: 'low',
    dueInDays: -4,
    createdDaysAgo: 20,
  },
  {
    ...base,
    id: task(8),
    title: "Archive last year's tender documents",
    status: 'cancelled',
    createdDaysAgo: 30,
  },
  {
    ...base,
    id: task(9),
    title: 'Prepare my annual review notes',
    status: 'todo',
    assignees: ['admin'],
    dueInDays: 10,
    createdDaysAgo: 3,
    private: true,
  },
  {
    ...base,
    id: task(10),
    title: 'Plan the warehouse safety briefing',
    description: ['Not ready to share yet: agenda, room, and who has to attend.'],
    status: 'todo',
    assignees: ['admin'],
    createdDaysAgo: 1,
    draft: true,
  },
];

export const DEMO_TASK_IDS: readonly string[] = DEMO_TASKS.map((entry) => entry.id);

// ── the comments ───────────────────────────────────────────────────────────

export interface DemoTaskComment {
  readonly id: string;
  readonly taskId: string;
  readonly author: DemoPerson;
  readonly daysAgo: number;
  readonly body: readonly DemoTaskTextPart[];
}

export const DEMO_TASK_COMMENTS: readonly DemoTaskComment[] = [
  {
    id: fixedId(3, 1),
    taskId: task(1),
    author: 'anna',
    daysAgo: 2,
    body: ['The supplier changes are in, see ', { task: task(2) }, '.'],
  },
  {
    id: fixedId(3, 2),
    taskId: task(1),
    author: 'admin',
    daysAgo: 1,
    body: [
      { person: 'tomasz', otherwise: 'Tomasz' },
      ', please finish the comparison by Friday: ',
      { task: task(4) },
      ' waits for it.',
    ],
  },
];

// ── the step ───────────────────────────────────────────────────────────────

export const DEMO_TASKS_STEP_NAME = 'standalone tasks of the demo administrators';
/**
 * Every module whose rows the step reads or writes: `admin_users` for the
 * people, `orders` for the one link (it cannot be switched off).
 */
export const DEMO_TASKS_MODULES: readonly string[] = ['tasks', 'admin_users', 'orders'];

const placeholders = (count: number): string => new Array(count).fill('?').join(', ');

function dayOf(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/** A demo text as `tasks` stores one, and the targets it names — each once, in first-appearance order. */
function renderText(
  parts: readonly DemoTaskTextPart[],
  people: ReadonlyMap<DemoPerson, string>,
): { text: string; references: Array<{ type: RecordReferenceType; id: string }> } {
  const references: Array<{ type: RecordReferenceType; id: string }> = [];
  const name = (type: RecordReferenceType, id: string): string => {
    if (!references.some((held) => held.type === type && held.id === id)) references.push({ type, id });
    return formatRecordReferenceToken(type, id);
  };
  const text = parts
    .map((part) => {
      if (typeof part === 'string') return part;
      if ('task' in part) return name('task', part.task);
      const id = people.get(part.person);
      return id === undefined ? part.otherwise : name('admin_user', id);
    })
    .join('');
  return { text, references };
}

async function peopleOf(em: EntityManager): Promise<Map<DemoPerson, string>> {
  const rows = (await em.execute(
    `select id, email from admin_users where email in (${placeholders(Object.keys(DEMO_PEOPLE).length)})`,
    Object.values(DEMO_PEOPLE),
  )) as Array<{ id: string; email: string }>;
  const people = new Map<DemoPerson, string>();
  for (const [person, email] of Object.entries(DEMO_PEOPLE) as [DemoPerson, string][]) {
    const row = rows.find((candidate) => candidate.email === email);
    if (row) people.set(person, row.id);
  }
  return people;
}

export const demoTasksStep: CompositionStep = {
  name: DEMO_TASKS_STEP_NAME,
  modules: DEMO_TASKS_MODULES,
  async apply(em) {
    const { nextTaskNumber } = await import('@endora-commerce/mod-tasks/backend');
    const people = await peopleOf(em);
    const admin = people.get('admin');
    // `created_by_admin_user_id` is not null: every demo Task is the demo administrator's.
    if (admin === undefined) return;
    const held = new Set(
      (
        (await em.execute(`select id from tasks where id in (${placeholders(DEMO_TASK_IDS.length)})`, [
          ...DEMO_TASK_IDS,
        ])) as Array<{ id: string }>
      ).map((row) => row.id),
    );
    const missing = DEMO_TASKS.filter((entry) => !held.has(entry.id));
    if (missing.length === 0) return;
    const priorities = new Set(
      ((await em.execute(`select code from task_priorities`)) as Array<{ code: string }>).map((row) => row.code),
    );
    const orders = (await em.execute(
      `select o.id from orders o join organizations g on g.id = o.organization_id
        where g.tax_id = ?
        order by o.created_at desc, o.id
        limit 1`,
      [DEMO_ORG_TAX_ID],
    )) as Array<{ id: string }>;
    const order = orders[0]?.id ?? null;

    const now = Date.now();
    const ago = (days: number): Date => new Date(now - days * DAY_MS);
    const day = (inDays: number | null): string | null => (inDays === null ? null : dayOf(ago(-inDays)));

    await em.transactional(async (tx) => {
      // The tags the Tasks carry; an operator's own edit of one is kept.
      for (const tag of DEMO_TASK_TAGS) {
        await tx.execute(`insert into task_tags (id, name, color) values (?, ?, ?) on conflict (id) do nothing`, [
          tag.id,
          tag.name,
          tag.color,
        ]);
      }
      const tagIds = new Set(
        (
          (await tx.execute(`select id from task_tags where id in (${placeholders(DEMO_TAG_IDS.length)})`, [
            ...DEMO_TAG_IDS,
          ])) as Array<{ id: string }>
        ).map((row) => row.id),
      );
      const present = new Set([...held, ...missing.map((entry) => entry.id)]);

      for (const entry of missing) {
        const createdAt = ago(entry.createdDaysAgo);
        const closed = entry.status === 'done' || entry.status === 'cancelled';
        const closedAt = closed ? ago(Math.max(0, entry.createdDaysAgo - 1)) : null;
        const description = renderText(entry.description, people);
        // A sub-task whose parent an operator deleted stands on its own.
        const parent = entry.parent !== null && present.has(entry.parent) ? entry.parent : null;
        await tx.execute(
          `insert into tasks
             (id, number, title, description, status, priority_code, start_on, due_on, completed_at,
              created_by_admin_user_id, parent_task_id, is_private, is_draft, published_at, created_at, updated_at)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            entry.id,
            await nextTaskNumber(tx),
            entry.title,
            description.text,
            entry.status,
            entry.priority !== null && priorities.has(entry.priority) ? entry.priority : null,
            day(entry.startInDays),
            day(entry.dueInDays),
            entry.status === 'done' ? closedAt : null,
            admin,
            parent,
            entry.private,
            entry.draft,
            // A draft is published when its creator says so (research R-3).
            entry.draft ? null : createdAt,
            createdAt,
            closedAt ?? createdAt,
          ],
        );
        for (const person of entry.assignees) {
          const assignee = people.get(person);
          if (assignee === undefined) continue;
          await tx.execute(
            `insert into task_assignees (task_id, admin_user_id, assigned_at, assigned_by_admin_user_id) values (?, ?, ?, ?)`,
            [entry.id, assignee, createdAt, admin],
          );
        }
        for (const key of entry.tags) {
          const tag = DEMO_TASK_TAGS.find((candidate) => candidate.key === key)!;
          if (!tagIds.has(tag.id)) continue;
          await tx.execute(`insert into task_tag_assignments (task_id, tag_id) values (?, ?)`, [entry.id, tag.id]);
        }
        for (const reference of description.references) {
          if (reference.type === 'task' && !present.has(reference.id)) continue;
          await tx.execute(
            `insert into task_references (task_id, source_kind, source_id, target_type, target_id)
             values (?, 'description', null, ?, ?)`,
            [entry.id, reference.type, reference.id],
          );
        }
        if (entry.linksAnOrder && order !== null) {
          await tx.execute(
            `insert into task_record_links (task_id, record_kind, record_id, linked_by_admin_user_id, created_at)
             values (?, 'order', ?, ?, ?)`,
            [entry.id, order, admin, createdAt],
          );
        }
      }

      for (const comment of DEMO_TASK_COMMENTS) {
        if (!missing.some((entry) => entry.id === comment.taskId)) continue;
        const body = renderText(comment.body, people);
        await tx.execute(
          `insert into task_comments (id, task_id, body, author_admin_user_id, created_at) values (?, ?, ?, ?, ?)`,
          [comment.id, comment.taskId, body.text, people.get(comment.author) ?? admin, ago(comment.daysAgo)],
        );
        for (const reference of body.references) {
          if (reference.type === 'task' && !present.has(reference.id)) continue;
          await tx.execute(
            `insert into task_references (task_id, source_kind, source_id, target_type, target_id)
             values (?, 'comment', ?, ?, ?)`,
            [comment.taskId, comment.id, reference.type, reference.id],
          );
        }
      }
    });
  },
  async withdraw(em) {
    // By the ids this step assigned. Sub-tasks first is not needed: the parent
    // key is `on delete set null`, and every one of them goes in this statement.
    await em.execute(`delete from tasks where id in (${placeholders(DEMO_TASK_IDS.length)})`, [...DEMO_TASK_IDS]);
    await em.execute(`delete from task_tags where id in (${placeholders(DEMO_TAG_IDS.length)})`, [...DEMO_TAG_IDS]);
  },
};
