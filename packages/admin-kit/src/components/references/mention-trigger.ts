import { formatRecordReferenceToken, splitRecordReferenceText } from '@endora-commerce/contracts';
import { REFERENCE_TRIGGER_KINDS, REFERENCE_TRIGGER_LENGTH, type ReferenceTriggerKind } from './reference-kinds.js';

/**
 * What a person types to refer to something while writing
 * (`specs/163-projects-and-tasks/` research R-14; first CRM's, User Story 18,
 * FR-082): a run of one to three `@`s and what follows it.
 *
 * **This is the composer's and is never stored.** What is stored is the token
 * of `@endora-commerce/contracts` — the `@`s and the letters after them are
 * replaced by it the moment a result is chosen, and left exactly as typed when
 * none is.
 */

/** Longer than a full name or a document number; past it, it is a sentence. */
export const MENTION_QUERY_LIMIT = 40;

export interface MentionTrigger {
  /** What the run asks for — the kind of `kinds` its length answers. */
  kind: ReferenceTriggerKind;
  /** Where the first `@` is, and where the caret is: the stretch a choice replaces. */
  start: number;
  end: number;
  /** What was typed after the `@`s. */
  query: string;
}

/**
 * The run of `@`s the caret is typing after, or `null`.
 *
 * A run opens only at the start of the text or after white space, so the `@`
 * of an e-mail address opens nothing; it holds one to three `@`s, so a fourth
 * closes it; what follows must not begin with a space, so `@ ` is the
 * character it is; and it stays on one line. The expression is anchored at the
 * caret and has one bounded quantifier, so it is linear in the text.
 */
const TRIGGER = new RegExp(`(?:^|\\s)(@{1,3})((?:[^\\s@][^\\n@]{0,${MENTION_QUERY_LIMIT - 1}})?)$`);

/**
 * The run the caret is in, read against the trigger table `kinds` — the kinds
 * on offer. A run whose length no kind of the table answers is `null`, as if
 * nothing had been typed.
 */
export function findMentionTrigger(
  text: string,
  caret: number,
  kinds: readonly ReferenceTriggerKind[] = REFERENCE_TRIGGER_KINDS,
): MentionTrigger | null {
  const before = text.slice(0, caret);
  const match = TRIGGER.exec(before);
  if (!match) return null;
  const marks = match[1] ?? '';
  const query = match[2] ?? '';
  const start = before.length - query.length - marks.length;
  const kind = kinds.find((candidate) => REFERENCE_TRIGGER_LENGTH[candidate] === marks.length);
  return kind ? { kind, start, end: caret, query } : null;
}

/**
 * A long text cut for a place that shows only its beginning — a change
 * history — **without ever cutting a token in two**: half a token would be
 * shown as the code it is. A token counts as one character, since it is read
 * as a name.
 */
export function clipReferenceText(text: string, limit: number): string {
  let room = limit;
  let clipped = '';
  for (const part of splitRecordReferenceText(text)) {
    if (part.kind === 'reference') {
      if (room < 1) return `${clipped}…`;
      clipped += formatRecordReferenceToken(part.type, part.id);
      room -= 1;
      continue;
    }
    if (part.text.length > room) return `${clipped}${part.text.slice(0, room)}…`;
    clipped += part.text;
    room -= part.text.length;
  }
  return clipped;
}
