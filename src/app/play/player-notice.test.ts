import { clearPlayerNotices, pushPlayerNotice } from './player-notice';

describe('player notice queue', () => {
  let player: HTMLDivElement;
  beforeEach(() => {
    jest.useFakeTimers();
    player = document.createElement('div');
  });
  afterEach(() => jest.useRealTimers());
  const target = () => ({ template: { $player: player } });
  const items = () =>
    Array.from(player.querySelectorAll('.moontv-notice-item'));

  it('renders untrusted text literally, deduplicates keys and renews expiry', () => {
    pushPlayerNotice(target(), '<img src=x onerror=alert(1)>', {
      key: 'status',
    });
    expect(player.querySelector('img')).toBeNull();
    jest.advanceTimersByTime(3000);
    pushPlayerNotice(target(), 'updated', { key: 'status' });
    expect(items()).toHaveLength(1);
    jest.advanceTimersByTime(1001);
    expect(items()[0].textContent).toBe('updated');
    jest.advanceTimersByTime(3000);
    expect(items()).toHaveLength(0);
  });

  it('limits visible notices and drains queued deduplicated notices in order', () => {
    for (let i = 0; i < 6; i++)
      pushPlayerNotice(target(), String(i), { key: String(i), durationMs: 0 });
    pushPlayerNotice(target(), 'updated fifth', { key: '4', durationMs: 0 });
    expect(items().map((item) => item.textContent)).toEqual([
      '0',
      '1',
      '2',
      '3',
    ]);
    clearPlayerNotices(target(), '0');
    expect(items().map((item) => item.textContent)).toEqual([
      '1',
      '2',
      '3',
      'updated fifth',
    ]);
    clearPlayerNotices(target());
    jest.runAllTimers();
    expect(items()).toHaveLength(0);
  });

  it('uses builtin notice if the player DOM is unavailable', () => {
    const art = { notice: { show: '' } };
    pushPlayerNotice(art, 'loading');
    expect(art.notice.show).toBe('loading');
  });
});
