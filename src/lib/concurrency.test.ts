import { clampSearchConcurrency, mapWithConcurrency } from './concurrency';

describe('search source concurrency', () => {
  it('clamps untrusted input and defaults missing or invalid settings', () => {
    for (const value of [null, undefined, '', 'bad', 0, -1, Infinity]) {
      expect(clampSearchConcurrency(value)).toBe(6);
    }
    expect(clampSearchConcurrency('999')).toBe(20);
    expect(clampSearchConcurrency('2.9')).toBe(2);
  });

  it('bounds active tasks and preserves result order', async () => {
    let active = 0;
    let peak = 0;
    const result = await mapWithConcurrency([0, 1, 2, 3, 4], 2, async (n) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, (5 - n) * 2));
      active -= 1;
      return n * 2;
    });
    expect(peak).toBe(2);
    expect(result).toEqual([0, 2, 4, 6, 8]);
  });
});
