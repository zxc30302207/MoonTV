import {
  getFallbackSearchQuery,
  matchesFullSearchTitle,
  matchesSearchTitle,
} from './search-title';

describe('search titles with punctuation', () => {
  it('uses the longest title fragment without changing full source matching', () => {
    expect(getFallbackSearchQuery('Example Movie (2026)')).toBe(
      'Example Movie'
    );
    expect(matchesSearchTitle('Example Movie（2026）', 'Example Movie')).toBe(
      true
    );
    expect(
      matchesFullSearchTitle('Example Movie（2026）', 'Example Movie (2026)')
    ).toBe(true);
    expect(
      matchesFullSearchTitle('Example Movie（2025）', 'Example Movie (2026)')
    ).toBe(false);
  });
  it('preserves Traditional/Simplified matching while keeping distinct suffixes', () => {
    expect(matchesFullSearchTitle('电影（2026）', '電影 (2026)')).toBe(true);
    expect(matchesSearchTitle('电影（2026）', '電影')).toBe(true);
    expect(matchesFullSearchTitle('电影（2025）', '電影（2026）')).toBe(false);
  });
  it('keeps plain queries and handles blank input safely', () => {
    expect(getFallbackSearchQuery('普通電影')).toBeNull();
    expect(getFallbackSearchQuery('  ')).toBeNull();
    expect(matchesSearchTitle('普通電影', '')).toBe(false);
    expect(matchesFullSearchTitle('', '')).toBe(false);
  });
  it('distinguishes exact main-title matching from relevance matching', () => {
    expect(matchesSearchTitle('Movie Extra', 'Movie')).toBe(true);
    expect(matchesSearchTitle('Movie Extra', 'Movie', true)).toBe(false);
    expect(matchesSearchTitle('Movie（2026）', 'Movie', true)).toBe(true);
  });
});
