/**
 * The formatted-text grammar of an Opportunity's free text, under the names CRM
 * has always exported (`specs/158-crm-opportunity-inline-editing/`).
 *
 * The grammar itself lives in `record-rich-text.ts` since
 * `specs/163-projects-and-tasks/` (research R-14): Projects read and write the
 * same formatted text, so it moved under neutral names and every name below is
 * an **alias** of the shared one — the same function, the same type — widened to
 * the five reference types of `record-references.ts`. A text CRM stored before
 * reads exactly as it did.
 */

export {
  formatRecordRichText as formatOpportunityRichText,
  isSafeRecordRichHref as isSafeOpportunityRichHref,
  parseRecordRichText as parseOpportunityRichText,
  recordRichTextToPlain as opportunityRichTextToPlain,
  type RecordRichBlock as OpportunityRichBlock,
  type RecordRichInline as OpportunityRichInline,
  type RecordRichMark as OpportunityRichMark,
} from './record-rich-text.js';
