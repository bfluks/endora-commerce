import { describe, expect, it } from 'vitest';
import { TASK_BOARD_DEFAULT_CARD_FIELDS } from '@endora-commerce/contracts';
import { manifest } from '../manifest.js';

describe('tasks manifest', () => {
  it('is an operator-toggleable module, on by default', () => {
    expect(manifest.id).toBe('tasks');
    expect(manifest.activation).toEqual({ settingCode: 'tasks.enabled', default: true });
  });

  it('declares its activation control as a boolean setting of its own group', () => {
    const control = manifest.settings?.settings.find((s) => s.code === 'tasks.enabled');
    expect(control).toMatchObject({ groupCode: 'tasks', valueType: 'boolean', defaultValue: true });
  });

  it('declares tasks:configure and tasks:see_private, each requiring tasks:read (165 R-20)', () => {
    for (const code of ['tasks:configure', 'tasks:see_private']) {
      expect(manifest.permissions?.find((p) => p.code === code)).toMatchObject({
        module: 'tasks',
        requires: ['tasks:read'],
      });
    }
  });

  it('declares the board card fields and the time zone settings with their defaults (165 data-model §4)', () => {
    const settings = manifest.settings?.settings ?? [];
    expect(settings.find((s) => s.code === 'tasks.board_card_fields')).toMatchObject({
      groupCode: 'tasks',
      valueType: 'json',
      defaultValue: [...TASK_BOARD_DEFAULT_CARD_FIELDS],
    });
    expect(settings.find((s) => s.code === 'tasks.time_zone')).toMatchObject({
      groupCode: 'tasks',
      valueType: 'string',
      defaultValue: 'Europe/Warsaw',
    });
  });

  it('degrades without crm, quote_requests and projects, each with an operator sentence (165 R-16)', () => {
    const edges = manifest.nonBindingDependencies ?? [];
    for (const [moduleId, name] of [
      ['crm', 'opportunityReadPort'],
      ['quote_requests', 'quoteRequestReadPort'],
      ['projects', 'projectReadPort'],
    ] as const) {
      const edge = edges.find((e) => e.moduleId === moduleId);
      expect(edge).toMatchObject({ name, kind: 'degrades-without' });
      expect(edge && 'whenAbsent' in edge ? edge.whenAbsent : '').not.toBe('');
    }
  });

  it('declares the reminder and digest e-mails (165 R-17, R-18)', () => {
    expect((manifest.transactionalEmails ?? []).map((e) => e.code)).toEqual([
      'tasks_task_reminder',
      'tasks_daily_digest',
    ]);
  });
});
