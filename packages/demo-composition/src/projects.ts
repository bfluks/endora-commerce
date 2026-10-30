/**
 * The demo Projects — the composition steps that give Projects and Tasks
 * something to show (`specs/163-projects-and-tasks/` T134, research R-20).
 *
 * A Project is `projects`' row and little in it is `projects`' alone: it is
 * for an Organization (`organizations`), run by administrators (`admin_users`),
 * holds Orders (`orders`) and its Stages hold Tasks (`tasks`). So the demo
 * Projects are a composition step and no module's demo data (§5.1) — the
 * finding of the sales pipeline, one module over. `projects`' own manifest
 * says `demo: false`, and so does `tasks'`: their own demo bodies seed nothing.
 *
 * ## What is seeded
 *
 * One Template, *Showroom fit-out*, whose first Stage is gated by two Stage
 * Tasks — the Template `quickstart.md`'s manual walk creates a Project from —
 * and four Projects made from it: one open in that gated first Stage, one
 * completed, one lost, and one internal (no Organization), each walked along
 * the Template's workflow over the last weeks, with the demo administrator as
 * Project Manager and the demo Sales Reps as Members.
 *
 * ## Two steps, because Tasks may be absent
 *
 * The Projects need `projects`; their Tasks need `tasks` as well, which an
 * operator may switch off and an instance may not install. The guard is per
 * step (§5.4), so the Tasks are a step of their own: where `tasks` is absent it
 * is a reported skip naming it, and the Projects are seeded all the same.
 *
 * ## The rows are written, not commanded
 *
 * As the sales pipeline's (its header says why): a Command stamps `now` and a
 * Project walked in one second has no Stage history worth reading. The
 * numbers are asked for — `nextProjectNumber` and `nextTaskNumber` are the two
 * modules' own doors to their sequences — and every row a person creates names
 * the demo administrator as its creator: `created_by_admin_user_id` is not
 * null on either table. The **History** tab is empty for the same reason as
 * an Opportunity's: no Command ran.
 *
 * ## Orders, where there are any
 *
 * No module seeds an Order. The open and the completed Project each hold one of
 * the demo organisation's Orders if it has one nobody has linked yet — an
 * instance the demo was used on — and none otherwise.
 *
 * ## Idempotent per row, withdrawn by id
 *
 * The Template, each Project and each Task has a fixed id. One that is there is
 * left exactly as it is; one that is missing is created whole in one
 * transaction. The withdrawal deletes by those ids; what hangs on a Project or
 * the Template goes through `projects`' own `on delete cascade` keys.
 */
import type { EntityManager } from '@mikro-orm/postgresql';
import type { CompositionStep } from './composition.js';

// ── the demo shop's own vocabulary ─────────────────────────────────────────

const DEMO_ORG_TAX_ID = 'PL5210000099';

/** The people of the demo, by the e-mail address `admin_users`' demo data gives each. */
const DEMO_PEOPLE = {
  admin: 'admin@demo.local',
  anna: 'sales-rep@demo.local',
  tomasz: 'sales-rep-other@demo.local',
} as const;
type DemoPerson = keyof typeof DEMO_PEOPLE;

/** The Project Roles `projects`' init migration seeds, by code. */
type DemoRole = 'project_manager' | 'sales_rep';

const DEMO_CURRENCY = 'PLN';
const DAY_MS = 24 * 60 * 60 * 1000;

/** `0c2a0163-<kind>-4000-8000-<ordinal>`: one namespace per kind of row. */
const fixedId = (kind: number, ordinal: number): string =>
  `0c2a0163-${String(kind).padStart(4, '0')}-4000-8000-${String(ordinal).padStart(12, '0')}`;

// ── the Template ───────────────────────────────────────────────────────────

export interface DemoStageTask {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly role: DemoRole | null;
  readonly dueOffsetDays: number;
}

export interface DemoTemplateStage {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly color: string;
  readonly plannedDurationDays: number;
  readonly responsibleRoles: readonly DemoRole[];
  readonly completionGate: boolean;
  readonly completionPermitted: boolean;
  readonly tasks: readonly DemoStageTask[];
}

export interface DemoTemplate {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly roles: readonly DemoRole[];
  readonly stages: readonly DemoTemplateStage[];
  /** Which Stage may follow which, by key. */
  readonly moves: readonly (readonly [string, string])[];
}

/**
 * *Showroom fit-out* — the demo distributor fits out a customer's showroom:
 * survey, order, install, hand over. Survey cannot be left while its two Stage
 * Tasks are open; a Project completes in Handover only.
 */
export const DEMO_PROJECT_TEMPLATE: DemoTemplate = {
  id: fixedId(1, 1),
  name: 'Showroom fit-out',
  description:
    'Fitting out a customer’s showroom with our shelving, lighting and signage: a survey on site, ' +
    'the order, the installation and the handover.',
  roles: ['project_manager', 'sales_rep'],
  stages: [
    {
      id: fixedId(2, 1),
      key: 'survey',
      name: 'Survey and design',
      color: '#3b82f6',
      plannedDurationDays: 10,
      responsibleRoles: ['project_manager'],
      completionGate: true,
      completionPermitted: false,
      tasks: [
        {
          id: fixedId(3, 1),
          title: 'Measure the showroom on site',
          description: 'Floor plan, wall heights, power points and the delivery entrance.',
          role: 'project_manager',
          dueOffsetDays: 3,
        },
        {
          id: fixedId(3, 2),
          title: 'Agree the layout with the customer',
          description: 'Send the layout drawing and get it signed off.',
          role: 'sales_rep',
          dueOffsetDays: 8,
        },
      ],
    },
    {
      id: fixedId(2, 2),
      key: 'order',
      name: 'Order and delivery',
      color: '#f59e0b',
      plannedDurationDays: 14,
      responsibleRoles: ['sales_rep'],
      completionGate: false,
      completionPermitted: false,
      tasks: [
        {
          id: fixedId(3, 3),
          title: 'Place the order for the fixtures',
          description: 'One order for the whole showroom, delivered in one drop.',
          role: 'sales_rep',
          dueOffsetDays: 2,
        },
      ],
    },
    {
      id: fixedId(2, 3),
      key: 'installation',
      name: 'Installation',
      color: '#8b5cf6',
      plannedDurationDays: 7,
      responsibleRoles: ['project_manager'],
      completionGate: false,
      completionPermitted: false,
      tasks: [
        {
          id: fixedId(3, 4),
          title: 'Book the installation crew',
          description: '',
          role: 'project_manager',
          dueOffsetDays: 1,
        },
      ],
    },
    {
      id: fixedId(2, 4),
      key: 'handover',
      name: 'Handover',
      color: '#22c55e',
      plannedDurationDays: 3,
      responsibleRoles: ['project_manager'],
      completionGate: false,
      completionPermitted: true,
      tasks: [],
    },
  ],
  moves: [
    ['survey', 'order'],
    ['order', 'installation'],
    ['installation', 'handover'],
    // A delivery that does not fit sends the Project back to the drawing board.
    ['order', 'survey'],
  ],
};

// ── the Projects ───────────────────────────────────────────────────────────

export interface DemoProjectMember {
  readonly person: DemoPerson;
  readonly roles: readonly DemoRole[];
}

export interface DemoProject {
  /** Fixed: what a second seed probes for and what the withdrawal deletes by. */
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly state: 'open' | 'completed' | 'lost';
  /** No Organization: only administrators who reach every Organization see it. */
  readonly internal?: boolean;
  /** Every Stage it entered, oldest first, and how many days before the seed. The first is its creation. */
  readonly path: readonly { readonly stage: string; readonly daysAgo: number }[];
  readonly closed?: { readonly daysAgo: number; readonly lossReason?: string; readonly lossComment?: string };
  readonly value: string | null;
  readonly members: readonly DemoProjectMember[];
  /** Holds one of the demo organisation's Orders, if one is there to hold. */
  readonly linksAnOrder?: boolean;
}

export const DEMO_PROJECTS: readonly DemoProject[] = [
  {
    id: fixedId(4, 1),
    title: 'Kraków showroom fit-out',
    description: 'New showroom on the ground floor of the Kraków branch, opening before the spring fair.',
    state: 'open',
    path: [{ stage: 'survey', daysAgo: 6 }],
    value: '86000.00',
    members: [
      { person: 'admin', roles: ['project_manager'] },
      { person: 'anna', roles: ['sales_rep'] },
    ],
    linksAnOrder: true,
  },
  {
    id: fixedId(4, 2),
    title: 'Warehouse trade counter refit',
    description: 'The trade counter and its display wall, refitted over one weekend.',
    state: 'completed',
    path: [
      { stage: 'survey', daysAgo: 62 },
      { stage: 'order', daysAgo: 51 },
      { stage: 'installation', daysAgo: 37 },
      { stage: 'handover', daysAgo: 30 },
    ],
    closed: { daysAgo: 27 },
    value: '42500.00',
    members: [
      { person: 'admin', roles: ['project_manager'] },
      { person: 'tomasz', roles: ['sales_rep'] },
    ],
    linksAnOrder: true,
  },
  {
    id: fixedId(4, 3),
    title: 'Trade fair stand',
    description: 'A modular stand for the autumn trade fair.',
    state: 'lost',
    path: [
      { stage: 'survey', daysAgo: 44 },
      { stage: 'order', daysAgo: 35 },
    ],
    closed: { daysAgo: 29, lossReason: 'price', lossComment: 'The customer chose a cheaper rental stand.' },
    value: '19900.00',
    members: [
      { person: 'admin', roles: ['project_manager'] },
      { person: 'anna', roles: ['sales_rep'] },
    ],
  },
  {
    id: fixedId(4, 4),
    title: 'Head office meeting room',
    description: 'Our own meeting room, refitted as a sample showroom for customer visits.',
    state: 'open',
    internal: true,
    path: [
      { stage: 'survey', daysAgo: 20 },
      { stage: 'order', daysAgo: 9 },
    ],
    value: null,
    members: [{ person: 'admin', roles: ['project_manager'] }],
  },
];

export const DEMO_PROJECT_IDS: readonly string[] = DEMO_PROJECTS.map((project) => project.id);

/** The id of a Project's own copy of a Template Stage — fixed, so the Tasks step can name it. */
export function demoProjectStageId(projectId: string, stageKey: string): string {
  const project = DEMO_PROJECTS.findIndex((candidate) => candidate.id === projectId);
  const stage = DEMO_PROJECT_TEMPLATE.stages.findIndex((candidate) => candidate.key === stageKey);
  if (project < 0 || stage < 0) throw new Error(`[demo] no demo Stage "${stageKey}" on Project ${projectId}.`);
  return fixedId(5, (project + 1) * 10 + stage + 1);
}

// ── the Tasks ──────────────────────────────────────────────────────────────

export interface DemoProjectTask {
  readonly id: string;
  readonly projectId: string;
  readonly stage: string;
  /** The Template's Stage Task this one was made from, by title. */
  readonly title: string;
  readonly status: 'todo' | 'in_progress' | 'done' | 'cancelled';
  readonly assignee: DemoPerson | null;
}

/**
 * The Stage Tasks each Project's entered Stages made, as their materialisation
 * would have: one per definition of an entered Stage. The open Project's gated
 * Survey keeps one open, so moving on is refused naming it.
 */
export const DEMO_PROJECT_TASKS: readonly DemoProjectTask[] = (() => {
  const plan: Record<string, Record<string, DemoProjectTask['status']>> = {
    [fixedId(4, 1)]: { survey: 'done' },
    [fixedId(4, 2)]: { survey: 'done', order: 'done', installation: 'done' },
    [fixedId(4, 3)]: { survey: 'done', order: 'cancelled' },
    [fixedId(4, 4)]: { survey: 'done', order: 'in_progress' },
  };
  const tasks: DemoProjectTask[] = [];
  let ordinal = 0;
  for (const project of DEMO_PROJECTS) {
    const holder = (role: DemoRole | null): DemoPerson | null =>
      role === null ? null : (project.members.find((member) => member.roles.includes(role))?.person ?? null);
    for (const step of project.path) {
      const stage = DEMO_PROJECT_TEMPLATE.stages.find((candidate) => candidate.key === step.stage)!;
      for (const [index, definition] of stage.tasks.entries()) {
        ordinal += 1;
        const planned = plan[project.id]?.[step.stage] ?? 'todo';
        // In the open Project's gated first Stage, the second Task is still to do.
        const status = project.id === fixedId(4, 1) && index > 0 ? 'todo' : planned;
        tasks.push({
          id: fixedId(6, ordinal),
          projectId: project.id,
          stage: step.stage,
          title: definition.title,
          status,
          assignee: holder(definition.role),
        });
      }
    }
  }
  return tasks;
})();

export const DEMO_PROJECT_TASK_IDS: readonly string[] = DEMO_PROJECT_TASKS.map((task) => task.id);

// ── the steps ──────────────────────────────────────────────────────────────

export const DEMO_PROJECTS_STEP_NAME = 'projects for the demo organisation, and a Template';
export const DEMO_PROJECT_TASKS_STEP_NAME = 'stage tasks of the demo projects';

/**
 * Every module whose rows the Projects step reads or writes. `orders` is
 * there because a Project may hold one of the demo organisation's Orders; it
 * cannot be switched off, and `projects` depends on it.
 */
export const DEMO_PROJECTS_MODULES: readonly string[] = ['projects', 'organizations', 'admin_users', 'orders'];
/** The Tasks step writes `tasks`' rows into the Projects' Stages. */
export const DEMO_PROJECT_TASKS_MODULES: readonly string[] = ['tasks', 'projects', 'admin_users'];

const placeholders = (count: number): string => new Array(count).fill('?').join(', ');
/** A Postgres array literal of uuids, for `?::uuid[]`. */
const uuidArray = (ids: readonly string[]): string => `{${ids.join(',')}}`;

function dayOf(at: Date): string {
  return at.toISOString().slice(0, 10);
}

function addDays(day: string, days: number): string {
  return dayOf(new Date(Date.parse(`${day}T00:00:00.000Z`) + days * DAY_MS));
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

async function rolesOf(em: EntityManager): Promise<Map<string, string>> {
  const rows = (await em.execute(`select id, code from project_roles`)) as Array<{ id: string; code: string }>;
  return new Map(rows.map((row) => [row.code, row.id]));
}

async function applyTemplate(em: EntityManager, roles: Map<string, string>, creator: string | null): Promise<void> {
  const template = DEMO_PROJECT_TEMPLATE;
  const held = (await em.execute(`select 1 as one from project_templates where id = ?`, [template.id])) as unknown[];
  if (held.length > 0) return;
  const roleIds = (wanted: readonly DemoRole[]): string[] =>
    wanted.map((role) => roles.get(role)).filter((id): id is string => id !== undefined);
  await em.transactional(async (tx) => {
    await tx.execute(
      `insert into project_templates (id, name, description, created_by_admin_user_id) values (?, ?, ?, ?)`,
      [template.id, template.name, template.description, creator],
    );
    for (const roleId of roleIds(template.roles)) {
      await tx.execute(`insert into project_template_roles (template_id, role_id) values (?, ?)`, [template.id, roleId]);
    }
    for (const [position, stage] of template.stages.entries()) {
      await tx.execute(
        `insert into project_template_stages
           (id, template_id, name, color, position, planned_duration_days, responsible_role_ids,
            completion_gate, completion_permitted)
         values (?, ?, ?, ?, ?, ?, ?::uuid[], ?, ?)`,
        [
          stage.id,
          template.id,
          stage.name,
          stage.color,
          position,
          stage.plannedDurationDays,
          uuidArray(roleIds(stage.responsibleRoles)),
          stage.completionGate,
          stage.completionPermitted,
        ],
      );
      for (const [taskPosition, task] of stage.tasks.entries()) {
        await tx.execute(
          `insert into project_template_stage_tasks
             (id, template_stage_id, title, description, responsible_role_id, due_offset_days, position)
           values (?, ?, ?, ?, ?, ?, ?)`,
          [
            task.id,
            stage.id,
            task.title,
            task.description,
            task.role ? (roles.get(task.role) ?? null) : null,
            task.dueOffsetDays,
            taskPosition,
          ],
        );
      }
    }
    const stageId = (key: string): string => template.stages.find((stage) => stage.key === key)!.id;
    for (const [from, to] of template.moves) {
      await tx.execute(
        `insert into project_template_stage_moves (template_id, from_stage_id, to_stage_id) values (?, ?, ?)`,
        [template.id, stageId(from), stageId(to)],
      );
    }
  });
}

export const demoProjectsStep: CompositionStep = {
  name: DEMO_PROJECTS_STEP_NAME,
  modules: DEMO_PROJECTS_MODULES,
  async apply(em) {
    const { nextProjectNumber } = await import('@endora-commerce/mod-projects/backend');
    const people = await peopleOf(em);
    const admin = people.get('admin');
    // A Project is somebody's: without the demo administrator there is nobody
    // to have created one (`created_by_admin_user_id` is not null).
    if (admin === undefined) return;
    const roles = await rolesOf(em);
    await applyTemplate(em, roles, admin);

    const organizations = (await em.execute(`select id from organizations where tax_id = ?`, [DEMO_ORG_TAX_ID])) as Array<{
      id: string;
    }>;
    const organization = organizations[0]?.id ?? null;
    const held = new Set(
      (
        (await em.execute(`select id from projects where id in (${placeholders(DEMO_PROJECT_IDS.length)})`, [
          ...DEMO_PROJECT_IDS,
        ])) as Array<{ id: string }>
      ).map((row) => row.id),
    );
    const lossReasons = new Map(
      ((await em.execute(`select id, code from project_loss_reasons`)) as Array<{ id: string; code: string }>).map(
        (row) => [row.code, row.id],
      ),
    );

    const now = Date.now();
    const ago = (days: number): Date => new Date(now - days * DAY_MS);
    const template = DEMO_PROJECT_TEMPLATE;

    for (const project of DEMO_PROJECTS) {
      if (held.has(project.id)) continue;
      // A Project for the demo organisation needs it; the internal one does not.
      if (project.internal !== true && organization === null) continue;
      const created = project.path[0]!;
      const last = project.path.at(-1)!;
      const lossReasonId = project.closed?.lossReason ? (lossReasons.get(project.closed.lossReason) ?? null) : null;
      // An operator may have deleted the seeded loss reason; a lost Project
      // without one is not a state the schema has.
      if (project.state === 'lost' && lossReasonId === null) continue;
      const updatedAt = ago(project.closed?.daysAgo ?? last.daysAgo);

      await em.transactional(async (tx) => {
        const stageId = (key: string): string => demoProjectStageId(project.id, key);
        await tx.execute(
          `insert into projects
             (id, number, title, description, value_amount, value_currency, start_on, state, visibility,
              template_id, created_by_admin_user_id, created_at, updated_at)
           values (?, ?, ?, ?, ?, ?, ?, 'open', 'inherit', ?, ?, ?, ?)`,
          [
            project.id,
            await nextProjectNumber(tx),
            project.title,
            project.description,
            project.value,
            project.value === null ? null : DEMO_CURRENCY,
            dayOf(ago(created.daysAgo)),
            template.id,
            admin,
            ago(created.daysAgo),
            updatedAt,
          ],
        );
        if (project.internal !== true && organization !== null) {
          await tx.execute(`insert into project_organizations (project_id, organization_id) values (?, ?)`, [
            project.id,
            organization,
          ]);
        }
        for (const member of project.members) {
          const adminUserId = people.get(member.person);
          if (adminUserId === undefined) continue;
          const [row] = (await tx.execute(
            `insert into project_members (project_id, admin_user_id, added_at) values (?, ?, ?) returning id`,
            [project.id, adminUserId, ago(created.daysAgo)],
          )) as Array<{ id: string }>;
          for (const role of member.roles) {
            const roleId = roles.get(role);
            if (roleId === undefined) continue;
            await tx.execute(`insert into project_member_roles (member_id, role_id) values (?, ?)`, [row!.id, roleId]);
          }
        }

        // The Project's own copy of the Template (R-7: copied, never referenced),
        // dated by when each Stage was last entered.
        const enteredOn = new Map<string, string>();
        for (const step of project.path) enteredOn.set(step.stage, dayOf(ago(step.daysAgo)));
        for (const [position, stage] of template.stages.entries()) {
          const startedOn = enteredOn.get(stage.key) ?? null;
          await tx.execute(
            `insert into project_stages
               (id, project_id, name, color, position, planned_duration_days, responsible_role_ids,
                completion_gate, completion_permitted, started_on, deadline_on, created_at, updated_at)
             values (?, ?, ?, ?, ?, ?, ?::uuid[], ?, ?, ?, ?, ?, ?)`,
            [
              stageId(stage.key),
              project.id,
              stage.name,
              stage.color,
              position,
              stage.plannedDurationDays,
              uuidArray(stage.responsibleRoles.map((role) => roles.get(role)).filter((id): id is string => !!id)),
              stage.completionGate,
              stage.completionPermitted,
              startedOn,
              startedOn === null ? null : addDays(startedOn, stage.plannedDurationDays),
              ago(created.daysAgo),
              updatedAt,
            ],
          );
          for (const [taskPosition, task] of stage.tasks.entries()) {
            await tx.execute(
              `insert into project_stage_tasks
                 (stage_id, title, description, responsible_role_id, due_offset_days, position)
               values (?, ?, ?, ?, ?, ?)`,
              [
                stageId(stage.key),
                task.title,
                task.description,
                task.role ? (roles.get(task.role) ?? null) : null,
                task.dueOffsetDays,
                taskPosition,
              ],
            );
          }
        }
        for (const [from, to] of template.moves) {
          await tx.execute(`insert into project_stage_moves (project_id, from_stage_id, to_stage_id) values (?, ?, ?)`, [
            project.id,
            stageId(from),
            stageId(to),
          ]);
        }

        // The Stage history: created into the first Stage, each move, the close.
        for (const [index, step] of project.path.entries()) {
          const from = index === 0 ? null : project.path[index - 1]!.stage;
          const fromStage = from === null ? null : template.stages.find((stage) => stage.key === from)!;
          const toStage = template.stages.find((stage) => stage.key === step.stage)!;
          await tx.execute(
            `insert into project_stage_entries
               (project_id, from_stage_id, to_stage_id, kind, from_stage_name, to_stage_name, actor_admin_user_id, at)
             values (?, ?, ?, 'enter', ?, ?, ?, ?)`,
            [
              project.id,
              fromStage === null ? null : stageId(fromStage.key),
              stageId(toStage.key),
              fromStage?.name ?? null,
              toStage.name,
              admin,
              ago(step.daysAgo),
            ],
          );
        }
        const current = template.stages.find((stage) => stage.key === last.stage)!;
        if (project.closed) {
          await tx.execute(
            `insert into project_stage_entries
               (project_id, from_stage_id, to_stage_id, kind, from_stage_name, to_stage_name, actor_admin_user_id, at)
             values (?, ?, null, ?, ?, null, ?, ?)`,
            [
              project.id,
              stageId(current.key),
              project.state === 'lost' ? 'close_lost' : 'close_completed',
              current.name,
              admin,
              ago(project.closed.daysAgo),
            ],
          );
        }
        // One statement, so every check on `projects` holds at its end; the
        // current Stage is the one the Project stands in, closed or not.
        await tx.execute(
          `update projects set state = ?, current_stage_id = ?, closed_at = ?, lost_stage_id = ?,
                  loss_reason_id = ?, loss_comment = ?
            where id = ?`,
          [
            project.state,
            stageId(current.key),
            project.closed ? ago(project.closed.daysAgo) : null,
            project.state === 'lost' ? stageId(current.key) : null,
            project.state === 'lost' ? lossReasonId : null,
            project.state === 'lost' ? (project.closed?.lossComment ?? null) : null,
            project.id,
          ],
        );

        if (project.linksAnOrder === true && organization !== null) {
          const orders = (await tx.execute(
            `select o.id from orders o
              where o.organization_id = ?
                and not exists (select 1 from project_links l where l.record_kind = 'order' and l.record_id = o.id)
              order by o.created_at desc, o.id
              limit 1`,
            [organization],
          )) as Array<{ id: string }>;
          for (const order of orders) {
            await tx.execute(
              `insert into project_links (project_id, record_kind, record_id, organization_id, linked_by_admin_user_id, linked_at)
               values (?, 'order', ?, ?, ?, ?)`,
              [project.id, order.id, organization, admin, ago(created.daysAgo)],
            );
          }
        }
      });
    }
  },
  async withdraw(em) {
    // By the ids this step assigned. Stages, Members, Organizations, moves,
    // history and links follow through `projects`' own cascades; Projects an
    // operator created from the Template keep their copy (R-7) and lose only
    // the reference (`on delete set null`).
    await em.execute(`delete from projects where id in (${placeholders(DEMO_PROJECT_IDS.length)})`, [
      ...DEMO_PROJECT_IDS,
    ]);
    await em.execute(`delete from project_templates where id = ?`, [DEMO_PROJECT_TEMPLATE.id]);
  },
};

export const demoProjectTasksStep: CompositionStep = {
  name: DEMO_PROJECT_TASKS_STEP_NAME,
  modules: DEMO_PROJECT_TASKS_MODULES,
  async apply(em) {
    const { nextTaskNumber } = await import('@endora-commerce/mod-tasks/backend');
    const people = await peopleOf(em);
    const admin = people.get('admin');
    // `created_by_admin_user_id` is not null: every demo Task is the demo administrator's.
    if (admin === undefined) return;
    const projects = new Set(
      (
        (await em.execute(`select id from projects where id in (${placeholders(DEMO_PROJECT_IDS.length)})`, [
          ...DEMO_PROJECT_IDS,
        ])) as Array<{ id: string }>
      ).map((row) => row.id),
    );
    const held = new Set(
      (
        (await em.execute(`select id from tasks where id in (${placeholders(DEMO_PROJECT_TASK_IDS.length)})`, [
          ...DEMO_PROJECT_TASK_IDS,
        ])) as Array<{ id: string }>
      ).map((row) => row.id),
    );
    const missing = DEMO_PROJECT_TASKS.filter((task) => projects.has(task.projectId) && !held.has(task.id));
    if (missing.length === 0) return;

    const now = Date.now();
    const ago = (days: number): Date => new Date(now - days * DAY_MS);
    await em.transactional(async (tx) => {
      const materialized = new Map<string, Date>();
      for (const task of missing) {
        const project = DEMO_PROJECTS.find((candidate) => candidate.id === task.projectId)!;
        const entered = project.path.find((step) => step.stage === task.stage)!;
        const stage = DEMO_PROJECT_TEMPLATE.stages.find((candidate) => candidate.key === task.stage)!;
        const definition = stage.tasks.find((candidate) => candidate.title === task.title)!;
        const createdAt = ago(entered.daysAgo);
        const closedAfter = Math.max(1, entered.daysAgo - definition.dueOffsetDays);
        const stageId = demoProjectStageId(project.id, stage.key);
        // The Stage's own copy of the definition: its id is the Task's source
        // key, as a materialisation writes it (`specs/165-task-management/`
        // research R-19) — without it the Stage's retry would make the Task again.
        const [copy] = (await tx.execute(
          `select id from project_stage_tasks where stage_id = ? and position = ?`,
          [stageId, stage.tasks.indexOf(definition)],
        )) as Array<{ id: string }>;
        // A Task is published when it is created (`specs/165-task-management/`
        // research R-3); its assignees are rows of `task_assignees` (R-2).
        await tx.execute(
          `insert into tasks
             (id, number, title, description, status, due_on, completed_at, created_by_admin_user_id,
              context_type, context_id, context_group_id, source_key, published_at, created_at, updated_at)
           values (?, ?, ?, ?, ?, ?, ?, ?, 'project', ?, ?, ?, ?, ?, ?)`,
          [
            task.id,
            await nextTaskNumber(tx),
            definition.title,
            definition.description,
            task.status,
            addDays(dayOf(createdAt), definition.dueOffsetDays),
            task.status === 'done' ? ago(closedAfter) : null,
            admin,
            project.id,
            stageId,
            copy?.id ?? null,
            createdAt,
            createdAt,
            task.status === 'todo' ? createdAt : ago(closedAfter),
          ],
        );
        const assignee = task.assignee === null ? null : (people.get(task.assignee) ?? null);
        if (assignee !== null) {
          await tx.execute(
            `insert into task_assignees (task_id, admin_user_id, assigned_at, assigned_by_admin_user_id) values (?, ?, ?, ?)`,
            [task.id, assignee, createdAt, admin],
          );
        }
        if (!materialized.has(stageId)) materialized.set(stageId, createdAt);
      }
      // The Stages these Tasks were made for say so, as a materialisation does.
      for (const [stageId, at] of materialized) {
        await tx.execute(
          `update project_stages set tasks_materialized_at = ? where id = ? and tasks_materialized_at is null`,
          [at, stageId],
        );
      }
    });
  },
  async withdraw(em) {
    await em.execute(`delete from tasks where id in (${placeholders(DEMO_PROJECT_TASK_IDS.length)})`, [
      ...DEMO_PROJECT_TASK_IDS,
    ]);
  },
};
