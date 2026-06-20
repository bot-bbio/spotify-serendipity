import { describe, expect, it } from 'vitest';
import { CSP_DIRECTIVES } from './csp.js';

describe('Content-Security-Policy', () => {
  it('declares frame-ancestors (VULN-011: clickjacking — no fallback to default-src)', () => {
    expect(CSP_DIRECTIVES).toContain("frame-ancestors 'none'");
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
