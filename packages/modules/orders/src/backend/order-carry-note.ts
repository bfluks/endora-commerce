import type { EntityManager } from '@mikro-orm/postgresql';
import {
  customFieldCarrySkipRecord,
  type CustomFieldCarrySkip,
  type CustomFieldCarrySkipReason,
  type OrderCommentSystemNote,
} from '@endora-commerce/contracts';
import { OrderComment } from './entities/order-comment.entity.js';

/**
 * The Order's record of custom-field values not carried into it
 * (`specs/162-custom-fields-value-carry/`, research R-8): one author-less,
 * internal, non-notifying **system note** per conversion, naming every skipped
 * key once with its reason.
 *
 * Shared by placement (Quote Request → Order) and the order receiver
 * (Opportunity → Order). Written on the caller's `EntityManager` — the
 * placement transaction or the receiver Command's — never through
 * `OrderCommentService.addByAdmin`, whose open-order check and notification
 * path do not apply to it.
 *
 * The note is read later by any number of administrators in their own
 * languages, so it carries its structured shape for the reader to translate;
 * `body` is the English fallback.
 */

const SOURCE_NOUN: Record<OrderCommentSystemNote['source']['entityType'], string> = {
  quote_request: 'quote request',
  opportunity: 'sales opportunity',
};

const REASON_PHRASE: Record<CustomFieldCarrySkipReason, string> = {
  target_missing: 'there is no field with this key on orders',
  value_type_mismatch: 'the fields have different types',
  audience_mismatch: 'the value is internal and this field is visible to customers',
  value_invalid: 'the value is not valid for this field',
};

/** The English fallback sentence of a note. */
export function carrySkipNoteBody(note: OrderCommentSystemNote): string {
  const listed = note.skipped.map(({ key, reason }) => `${key} (${REASON_PHRASE[reason]})`).join(', ');
  return (
    `Custom field values were not carried from ${SOURCE_NOUN[note.source.entityType]} ` +
    `${note.source.reference}: ${listed}.`
  );
}

/** Create the note on `em` (persisted with the caller's flush). `skipped` must not be empty. */
export function buildCarrySkipNote(
  em: EntityManager,
  input: {
    orderId: string;
    source: OrderCommentSystemNote['source'];
    skipped: readonly CustomFieldCarrySkip[];
  },
): OrderComment {
  // command-coverage-ignore: order comments are an append-only communication
  // thread, not audited domain-state (order-comment-service.ts); this note is
  // written inside the placement transaction or a receiver Command's write.
  const systemNote: OrderCommentSystemNote = {
    kind: 'custom_field_carry_skipped',
    source: { ...input.source },
    skipped: input.skipped.map(customFieldCarrySkipRecord),
  };
  return em.create(OrderComment, {
    orderId: input.orderId,
    authorAdminUserId: null,
    authorCustomerAccountId: null,
    body: carrySkipNoteBody(systemNote),
    isCustomerVisible: false,
    notifyCustomer: false,
    systemNote,
  });
}
