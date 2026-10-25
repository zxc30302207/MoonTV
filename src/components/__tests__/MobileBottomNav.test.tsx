import { act, fireEvent, render, screen } from '@testing-library/react';

import { getCustomCategories } from '@/lib/config.client';

import MobileBottomNav from '../MobileBottomNav';

const startLoading = jest.fn();
let mockPathname = '/';
let mockQuery = '';
jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useSearchParams: () => new URLSearchParams(mockQuery),
}));
jest.mock('../NavigationLoadingProvider', () => ({
  useNavigationLoading: () => ({ startLoading }),
}));
jest.mock('@/lib/config.client', () => ({ getCustomCategories: jest.fn() }));

beforeEach(() => {
  localStorage.clear();
  mockPathname = '/';
  mockQuery = '';
  jest.clearAllMocks();
  (getCustomCategories as jest.Mock).mockResolvedValue([]);
});

it('preserves all destinations, marks current page and offers explicit horizontal controls', async () => {
  await act(async () => {
    render(<MobileBottomNav activePath='/ranking' />);
  });
  expect(screen.getAllByRole('link')).toHaveLength(9);
  expect(screen.getByRole('link', { name: '榜單' })).toHaveAttribute(
    'aria-current',
    'page'
  );
  const list = screen.getByRole('list');
  Object.defineProperties(list, {
    clientWidth: { value: 300 },
    scrollWidth: { value: 700 },
  });
  fireEvent.scroll(list);
  const right = screen.getByRole('button', { name: '向右捲動，查看更多導覽' });
  expect(right).toBeEnabled();
  fireEvent.click(right);
  expect(list.scrollLeft).toBe(300);
  fireEvent.click(screen.getByRole('button', { name: '向左捲動導覽' }));
  expect(list.scrollLeft).toBe(0);
  const currentLink = screen.getByRole('link', { name: '榜單' });
  currentLink.addEventListener('click', (event) => event.preventDefault(), {
    once: true,
  });
  fireEvent.click(currentLink);
  expect(startLoading).not.toHaveBeenCalled();
});

it('scrolls the active destination into the visible strip on navigation', async () => {
  const view = render(<MobileBottomNav />);
  await act(async () => undefined);
  const list = screen.getByRole('list');
  const item = screen.getByRole('link', { name: '榜單' })
    .parentElement as HTMLElement;
  Object.defineProperties(list, {
    clientWidth: { value: 300 },
    scrollWidth: { value: 700 },
  });
  Object.defineProperties(item, {
    offsetLeft: { value: 600 },
    offsetWidth: { value: 75 },
  });
  view.rerender(<MobileBottomNav activePath='/ranking' />);
  expect(list.scrollLeft).toBe(375);
});

it('retains simple mode without overflow controls and supports custom categories', async () => {
  localStorage.setItem('simpleMode', 'true');
  const first = render(<MobileBottomNav />);
  await act(async () => undefined);
  expect(screen.getAllByRole('link')).toHaveLength(2);
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  first.unmount();
  localStorage.clear();
  (getCustomCategories as jest.Mock).mockResolvedValue([{ name: 'Custom' }]);
  await act(async () => {
    render(<MobileBottomNav activePath='/douban?type=custom' />);
  });
  expect(screen.getAllByRole('link')).toHaveLength(10);
  expect(screen.getByRole('link', { name: '自定義' })).toHaveAttribute(
    'aria-current',
    'page'
  );
});

it.each([
  ['type=tv&sort=rating', '劇集'],
  ['sort=rating&type=movie', '電影'],
  ['', '電影'],
  ['type=movie-extra', null],
  ['notype=tv', '電影'],
  ['type=%74v', '劇集'],
  ['type=%E0%A4%A', null],
])(
  'matches exact category from query %s without substring or decoding errors',
  async (query, label) => {
    mockPathname = '/douban';
    mockQuery = query;
    await act(async () => {
      render(<MobileBottomNav />);
    });
    const active = screen
      .getAllByRole('link')
      .filter((link) => link.getAttribute('aria-current') === 'page');
    expect(active).toHaveLength(label ? 1 : 0);
    if (label) expect(active[0]).toHaveTextContent(label);
  }
);

it('updates selected category on query-only navigation and retains explicit overrides', async () => {
  mockPathname = '/douban';
  mockQuery = 'type=tv';
  const view = render(<MobileBottomNav />);
  await act(async () => undefined);
  expect(screen.getByRole('link', { name: '劇集' })).toHaveAttribute(
    'aria-current',
    'page'
  );
  mockQuery = 'type=movie';
  view.rerender(<MobileBottomNav activePath={undefined} key='movie' />);
  await act(async () => undefined);
  expect(screen.getByRole('link', { name: '電影' })).toHaveAttribute(
    'aria-current',
    'page'
  );
  expect(screen.getByRole('link', { name: '劇集' })).not.toHaveAttribute(
    'aria-current'
  );
  view.rerender(<MobileBottomNav activePath='/ranking?sort=rating' />);
  expect(screen.getByRole('link', { name: '榜單' })).toHaveAttribute(
    'aria-current',
    'page'
  );
});
