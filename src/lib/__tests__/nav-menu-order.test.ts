import {
  applyNavMenuOrder,
  loadNavMenuOrder,
  NAV_ORDER_STORAGE_KEY,
  NAV_ORDER_UPDATED_EVENT,
  saveNavMenuOrder,
} from '../nav-settings';

beforeEach(() => localStorage.clear());

it('ignores malformed storage and deduplicates valid keys', () => {
  localStorage.setItem(NAV_ORDER_STORAGE_KEY, '{');
  expect(loadNavMenuOrder()).toEqual([]);
  localStorage.setItem(
    NAV_ORDER_STORAGE_KEY,
    JSON.stringify(['/search', 7, '/search', '', '/watch-room'])
  );
  expect(loadNavMenuOrder()).toEqual(['/search', '/watch-room']);
});

it('retains mobile-only and custom destinations when desktop saves a new order', () => {
  localStorage.setItem(
    NAV_ORDER_STORAGE_KEY,
    JSON.stringify(['/', '/search', '/douban?type=custom', '/watch-room'])
  );
  const listener = jest.fn();
  window.addEventListener(NAV_ORDER_UPDATED_EVENT, listener);
  saveNavMenuOrder(['/watch-room', '/', '/']);
  expect(loadNavMenuOrder()).toEqual([
    '/search',
    '/douban?type=custom',
    '/watch-room',
    '/',
  ]);
  expect(listener).toHaveBeenCalledTimes(1);
  window.removeEventListener(NAV_ORDER_UPDATED_EVENT, listener);
});

it('applies shared ordering without dropping new destinations or mutating input', () => {
  const items = ['/', '/douban?type=custom', '/watch-room', '/search'];
  expect(applyNavMenuOrder(items, (key) => key, ['/search', '/'])).toEqual([
    '/search',
    '/',
    '/douban?type=custom',
    '/watch-room',
  ]);
  expect(items).toEqual(['/', '/douban?type=custom', '/watch-room', '/search']);
});

it('handles inaccessible storage without breaking navigation', () => {
  const read = jest
    .spyOn(Storage.prototype, 'getItem')
    .mockImplementation(() => {
      throw new Error('Unavailable');
    });
  expect(loadNavMenuOrder()).toEqual([]);
  read.mockRestore();
});
