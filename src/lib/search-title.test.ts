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

describe('4.7 title relevance with custom Chinese normalization', () => {
  it('matches subtitles without confusing release years for a title', () => {
    expect(matchesSearchTitle('名侦探柯南：黑铁的鱼影', '黑鐵的魚影')).toBe(
      true
    );
    expect(matchesSearchTitle('三体（2024）', '三體', true)).toBe(true);
    expect(matchesSearchTitle('三體（2024）', '2024')).toBe(false);
    expect(matchesSearchTitle('2024', '2024', true)).toBe(true);
  });
  it('preserves the custom edition-note exclusion and full source identity', () => {
    expect(getFallbackSearchQuery('三體（電視動畫完整版）')).toBe('三體');
    expect(matchesFullSearchTitle('三体（2024）', '三體（2025）')).toBe(false);
    expect(matchesFullSearchTitle('三体（完整版）', '三體')).toBe(false);
  });
});
