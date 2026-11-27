import type { TransactionalEmailSender } from '@endora-commerce/contracts';
import { rethrowIfModuleDisabled } from '@endora-commerce/platform/kernel';
import { STAGE_ALERT_EMAIL_CODE } from '../email-templates/stage-alert-defaults.js';

/**
 * Why the alert e-mail did not go out. Every one of them is logged and costs
 * nothing else: the bell entry, when there is one, stands.
 */
export type StageAlertEmailNotSentReason =
  /** No transactional sender is wired in this composition. */
  | 'no_sender'
  /** The recipient has no address. */
  | 'no_address'
  /** The operator switched the alert e-mail off on the templates screen. */
  | 'deactivated'
  /** No mailer is wired behind the sender. */
  | 'no_transport'
  /** No `projects_stage_deadline_alert` definition exists yet. */
  | 'no_definition'
  /** No mail server is configured: the message was only written to the log. */
  | 'logged'
  /** The send raised. */
  | 'failed';

export type StageAlertEmailResult = { sent: true } | { sent: false; reason: StageAlertEmailNotSentReason };

export interface StageAlertEmailInput {
  /** The claimed alert this message is one of — with the recipient, its message id. */
  deliveryId: string;
  projectId: string;
  adminUserId: string;
  to: string;
  /** The recipient's Admin UI language preference, as `admin_users` stores it. */
  preferredLanguage: string | null;
  number: string;
  stageName: string;
  /** `YYYY-MM-DD`. */
  deadlineOn: string;
  daysLeft: number;
}

export interface StageAlertEmail {
  send(input: StageAlertEmailInput): Promise<StageAlertEmailResult>;
}

export interface StageAlertEmailDeps {
  /**
   * `transactional_emails`' late-bound sender, read per send: it answers
   * `undefined` until that module has announced it.
   */
  sender: () => TransactionalEmailSender | undefined;
  /** Where a send that did not happen is reported. */
  log: (message: string, context: Record<string, unknown>) => void;
}

/**
 * The language an alert e-mail is written in: the recipient's Admin UI
 * language — Polish for a Polish preference, English for everything else, read
 * by the primary subtag (CRM's `reminderEmailLanguage`, copied: a module's
 * internals are not another module's to import).
 */
export function stageAlertEmailLanguage(preferredLanguage: string | null): 'en-US' | 'pl-PL' {
  const primary = preferredLanguage?.split('-', 1)[0]?.trim().toLowerCase();
  return primary === 'pl' ? 'pl-PL' : 'en-US';
}

/** A calendar day (`YYYY-MM-DD`) as the recipient's language writes it — the date alone, no zone. */
export function stageAlertDeadlineWords(deadlineOn: string, language: 'en-US' | 'pl-PL'): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(deadlineOn);
  if (!match) return deadlineOn;
  const day = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return new Intl.DateTimeFormat(language, { timeZone: 'UTC', dateStyle: 'long' }).format(day);
}

/**
 * One Stage deadline alert, as an e-mail to one Member (research R-12: "in the
 * Admin UI and by e-mail" for every alert).
 *
 * Sent with **no Sales Channel** — an administrator is not a channel's
 * customer — and in the recipient's own language. It **answers what happened
 * and never throws for a message that did not go out**: the alert was claimed
 * before this was tried and is delivered at most once, so there is no retry to
 * hand a failure to. A module switched off is not contained: it is a presence
 * answer about the capability, not a failed message.
 *
 * A function rather than a literal at the composition site: `check:port-catches`
 * follows the port through the value.
 */
export function createStageAlertEmail(deps: StageAlertEmailDeps): StageAlertEmail {
  const notSent = (
    input: StageAlertEmailInput,
    reason: StageAlertEmailNotSentReason,
    error?: unknown,
  ): StageAlertEmailResult => {
    deps.log('projects: the stage deadline alert e-mail was not sent', {
      projectId: input.projectId,
      deliveryId: input.deliveryId,
      reason,
      ...(error === undefined ? {} : { error: error instanceof Error ? error.message : String(error) }),
    });
    return { sent: false, reason };
  };

  return {
    async send(input: StageAlertEmailInput): Promise<StageAlertEmailResult> {
      if (!input.to) return notSent(input, 'no_address');
      const sender = deps.sender();
      if (!sender) return notSent(input, 'no_sender');
      const language = stageAlertEmailLanguage(input.preferredLanguage);
      try {
        const outcome = await sender.send({
          code: STAGE_ALERT_EMAIL_CODE,
          salesChannelId: null,
          language,
          to: input.to,
          // One message per alert and recipient: a transport asked twice for the same one sends it once.
          messageId: `${STAGE_ALERT_EMAIL_CODE}:${input.deliveryId}:${input.adminUserId}`,
          document: { type: 'project', id: input.projectId },
          variables: {
            project: { number: input.number },
            stage: { name: input.stageName, deadline: stageAlertDeadlineWords(input.deadlineOn, language) },
            alert: { daysLeft: String(input.daysLeft) },
          },
          meta: { kind: STAGE_ALERT_EMAIL_CODE, projectId: input.projectId, deliveryId: input.deliveryId },
        });
        return outcome.status === 'sent' ? { sent: true } : notSent(input, outcome.status);
      } catch (error) {
        rethrowIfModuleDisabled(error);
        return notSent(input, 'failed', error);
      }
    },
  };
}
