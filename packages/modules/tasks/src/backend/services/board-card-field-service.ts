import {
  ERROR_CODES,
  TASK_BOARD_CARD_MAX_FIELDS,
  TaskCardFieldValueSchema,
  type CustomFieldDefinitionReadPort,
  type SettingsAdminPort,
  type TaskBoardCardConfig,
  type TaskBoardCardField,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import type { SettingsReadPort } from '@endora-commerce/platform/kernel';
import {
  builtinBoardCardFields,
  customBoardCardField,
  namesCustomBoardField,
  resolveBoardCardFields,
  storedBoardCardFieldRefs,
} from '../domain/board-card-fields.js';
import { actingAdminUserId } from './task-access.js';

export interface TaskBoardCardFieldServiceDeps {
  /** Ports of other modules — lazy, resolved per call, never captured. */
  settings: SettingsReadPort;
  settingsAdmin: SettingsAdminPort;
  definitions: CustomFieldDefinitionReadPort;
}

/** The setting the choice is kept under (`T/manifest.ts`). */
export const TASK_BOARD_CARD_FIELDS_SETTING = 'tasks.board_card_fields';

/**
 * Anything (the contract's `z.unknown()`, borrowed so this package needs no
 * `zod` of its own): what the stored value means is decided by
 * `storedBoardCardFieldRefs`.
 */
const STORED = TaskCardFieldValueSchema.shape.value;

/**
 * Which fields a Task board card shows (`specs/165-task-management/` FR-022,
 * research R-11) — CRM's `board-card-field-service.ts`, the model.
 *
 * The choice is one Setting, `tasks.board_card_fields`: an ordered list of
 * field references, platform-wide. It is written through `settings`' own
 * audited write and read through the kernel's settings port, so it has the
 * cache, the audit entry and the place on the Settings screen every other
 * setting has — CRM's precedent, rather than a Tasks Command of its own.
 *
 * **A reference is resolved every time it is read.** A custom field whose
 * definition is gone resolves to nothing and drops out of the card and of what
 * is offered; the stored list is left as it is until somebody saves it again.
 */
export class TaskBoardCardFieldService {
  constructor(private readonly deps: TaskBoardCardFieldServiceDeps) {}

  /** The fields a card shows, in order — what the board fills in. */
  async selected(): Promise<TaskBoardCardField[]> {
    const refs = await this.#storedRefs();
    // A card of built-in fields alone asks `custom_fields` nothing.
    return resolveBoardCardFields(refs, await this.#offered(namesCustomBoardField(refs)));
  }

  /** `GET /tasks/board/card-fields`. */
  async config(): Promise<TaskBoardCardConfig> {
    const [refs, available] = await Promise.all([this.#storedRefs(), this.#offered(true)]);
    return { fields: resolveBoardCardFields(refs, available), available, maxFields: TASK_BOARD_CARD_MAX_FIELDS };
  }

  /** `PUT /tasks/board/card-fields`. Every reference must be one that is offered now (422). */
  async set(refs: readonly string[]): Promise<TaskBoardCardConfig> {
    const offered = new Set((await this.#offered(true)).map((field) => field.ref));
    const unknown = refs.filter((ref) => !offered.has(ref));
    if (unknown.length > 0) {
      throw new HttpError(
        422,
        ERROR_CODES.VALIDATION_FAILED,
        'A board card cannot show a field that does not exist.',
        unknown.map((ref) => ({ path: 'fields', issue: `Unknown field: ${ref}` })),
      );
    }
    await this.deps.settingsAdmin.setValueForAllChannels(TASK_BOARD_CARD_FIELDS_SETTING, [...refs], null, {
      actorAdminUserId: actingAdminUserId(),
    });
    return this.config();
  }

  async #storedRefs(): Promise<string[]> {
    return storedBoardCardFieldRefs(await this.deps.settings.get(TASK_BOARD_CARD_FIELDS_SETTING, null, STORED));
  }

  async #offered(withCustom: boolean): Promise<TaskBoardCardField[]> {
    const builtin = builtinBoardCardFields();
    if (!withCustom) return builtin;
    const definitions = await this.deps.definitions.listForEntity('task');
    return [
      ...builtin,
      ...[...definitions]
        .sort(
          (a, b) =>
            a.definition.sortOrder - b.definition.sortOrder || a.definition.key.localeCompare(b.definition.key),
        )
        .map(customBoardCardField),
    ];
  }
}
