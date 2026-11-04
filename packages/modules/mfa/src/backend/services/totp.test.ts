import { describe, expect, it } from 'vitest';
import { generateSecret } from './totp.js';

describe('generateSecret', () => {
  it('answers the manual key, the otpauth URI and a QR code of that URI as SVG', () => {
    const enrolment = generateSecret('someone@example.com');
    expect(enrolment.secret).toMatch(/^[A-Z2-7]+$/);
    expect(enrolment.otpauthUri).toContain('otpauth://totp/');
    expect(enrolment.otpauthUri).toContain(`secret=${enrolment.secret}`);
    expect(enrolment.qrSvg.startsWith('<svg')).toBe(true);
    expect(enrolment.qrSvg).toContain('viewBox=');
    expect(enrolment.qrSvg.trimEnd().endsWith('</svg>')).toBe(true);
  });

  it('draws a different QR code for a different secret', () => {
    const first = generateSecret('someone@example.com');
    const second = generateSecret('someone@example.com');
    expect(first.qrSvg).not.toBe(second.qrSvg);
  });

  it('carries no script and no external reference in the SVG', () => {
    const { qrSvg } = generateSecret('<script>alert(1)</script>@example.com');
    expect(qrSvg).not.toMatch(/<script|href=|javascript:/i);
  });
});
