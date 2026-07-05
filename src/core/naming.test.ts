import { describe, expect, it } from 'vitest';
import { capsuleName, longDate, monthDay } from './naming.js';
import { REGISTRY, REGISTRY_BY_ID, type QueryDescriptor } from './registry.js';

const d = (id: string): QueryDescriptor => {
  const found = REGISTRY_BY_ID.get(id);
  if (!found) throw new Error(`no descriptor ${id}`);
  return found;
};

describe('capsuleName', () => {
  it('names the day-of-year phrase "Throwbacks from <Month Day>"', () => {
    expect(capsuleName(d('this-day'), undefined, new Date(2026, 6, 4))).toBe(
      'Throwbacks from July 4',
    );
  });

  it('carries the year param', () => {
    expect(capsuleName(d('from-year'), 2021)).toBe('Back in 2021');
    expect(capsuleName(d('top-year'), 2019)).toBe('Heavy rotation, 2019');
  });

  it('carries the date param as a long date', () => {
    expect(capsuleName(d('on-date'), '2023-06-15')).toBe('Time capsule — June 15, 2023');
    expect(capsuleName(d('discovered-on'), '2020-01-02')).toBe('Discovered January 2, 2020');
  });

  it('renders duration params as words, articles handled', () => {
    expect(capsuleName(d('dormant'), 365)).toBe('Untouched for a year');
    expect(capsuleName(d('new-find'), 30)).toBe('Fresh finds — past month');
    expect(capsuleName(d('new-find'), 91)).toBe('Fresh finds — past three months');
  });

  it('names choice params from their labels', () => {
    expect(capsuleName(d('weekday'), '1')).toBe('Made for Mondays');
    expect(capsuleName(d('daypart'), 'late-night')).toBe('Late-night soundtrack');
    expect(capsuleName(d('season'), 'summer')).toBe('Summer soundtrack');
    expect(capsuleName(d('platform'), 'phone')).toBe('Phone favorites');
  });

  it('gives every registered criterion a specific title (no generic fallback)', () => {
    for (const desc of REGISTRY) {
      const name = capsuleName(desc, undefined, new Date(2026, 6, 4));
      expect(name, desc.id).not.toMatch(/^Serendipity · /);
      expect(name.length, desc.id).toBeGreaterThan(0);
      expect(name.length, desc.id).toBeLessThanOrEqual(100);
    }
  });
});

describe('date helpers', () => {
  it('monthDay formats the local calendar day', () => {
    expect(monthDay(new Date(2026, 0, 31))).toBe('January 31');
  });

  it('longDate reads YYYY-MM-DD as UTC (no off-by-one across timezones)', () => {
    expect(longDate('2023-12-31')).toBe('December 31, 2023');
    expect(longDate('not-a-date')).toBe('not-a-date');
  });
});
