import { normalizeUsername } from './username';

describe('normalizeUsername', () => {
  it.each(['alice', 'alice_01', '使用者-01', '測試帳號'])(
    'accepts %s',
    (value) => {
      expect(normalizeUsername(value)).toBe(value);
    }
  );

  it('normalizes and trims safe input', () => {
    expect(normalizeUsername('  Ａlice_01  ')).toBe('Alice_01');
  });

  it.each([
    '',
    "' OR 1=1--",
    'name with spaces',
    'name@example.com',
    '../admin',
    'a'.repeat(65),
    null,
    123,
  ])('rejects unsafe input %p', (value) => {
    expect(normalizeUsername(value)).toBeNull();
  });
});
