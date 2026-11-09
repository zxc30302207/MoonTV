/** @jest-environment jsdom */
import { cachedMemberId, cacheMemberId, clearCachedMemberId } from '../client';

describe('shared watch room member cache', () => {
  beforeEach(() => window.sessionStorage.clear());
  afterEach(() => jest.restoreAllMocks());

  it('shares the existing room-scoped key and clears only the selected room', () => {
    cacheMemberId('ABC123', 'host');
    cacheMemberId('DEF456', 'guest');
    expect(
      window.sessionStorage.getItem('moontv:watchroom:member:ABC123')
    ).toBe('host');
    expect(cachedMemberId('ABC123')).toBe('host');
    clearCachedMemberId('ABC123');
    expect(cachedMemberId('ABC123')).toBe('');
    expect(cachedMemberId('DEF456')).toBe('guest');
  });
  it('does not overwrite a cached member with an empty response', () => {
    cacheMemberId('ABC123', 'host');
    cacheMemberId('ABC123', '');
    expect(cachedMemberId('ABC123')).toBe('host');
  });
  it('tolerates unavailable browser storage', () => {
    for (const method of ['getItem', 'setItem', 'removeItem'] as const) {
      jest.spyOn(Storage.prototype, method).mockImplementation(() => {
        throw new Error('Storage unavailable');
      });
    }
    expect(cachedMemberId('ABC123')).toBe('');
    expect(() => cacheMemberId('ABC123', 'host')).not.toThrow();
    expect(() => clearCachedMemberId('ABC123')).not.toThrow();
  });
});
