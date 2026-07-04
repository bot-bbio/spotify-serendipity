import { describe, expect, it } from 'vitest';
import { CSP_DIRECTIVES, CSP_HEADER_DIRECTIVES } from './csp.js';
import { isFramed } from './framebust.js';

describe('Content-Security-Policy', () => {
  it('keeps frame-ancestors for header deployments (VULN-011: no fallback to default-src)', () => {
    expect(CSP_HEADER_DIRECTIVES).toContain("frame-ancestors 'none'");
  });

  it('omits frame-ancestors from the <meta> policy (spec: ignored there, logs a console error)', () => {
    expect(CSP_DIRECTIVES.some((d) => d.startsWith('frame-ancestors'))).toBe(false);
  });

  it('has no unsafe-inline/unsafe-eval in script-src', () => {
    const scriptSrc = CSP_DIRECTIVES.find((d) => d.startsWith('script-src'));
    expect(scriptSrc).toBeDefined();
    expect(scriptSrc).not.toMatch(/unsafe-inline|unsafe-eval/);
  });

  it('disallows plugins and tightens base-uri', () => {
    expect(CSP_DIRECTIVES).toContain("object-src 'none'");
    expect(CSP_DIRECTIVES).toContain("base-uri 'none'");
  });
});

describe('frame guard (the working clickjacking control on header-less hosting)', () => {
  it('detects an embedded (framed) context', () => {
    const self = {};
    const top = {};
    expect(isFramed({ top, self })).toBe(true);
    expect(isFramed({ top: self, self })).toBe(false);
  });
});
