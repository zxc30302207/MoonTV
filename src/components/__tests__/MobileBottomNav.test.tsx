import { act, fireEvent, render, screen } from '@testing-library/react';

import { getCustomCategories } from '@/lib/config.client';

import MobileBottomNav from '../MobileBottomNav';

const startLoading = jest.fn();
jest.mock('next/navigation', () => ({ usePathname: () => '/' }));
jest.mock('../NavigationLoadingProvider', () => ({
  useNavigationLoading: () => ({ startLoading }),
}));
jest.mock('@/lib/config.client', () => ({ getCustomCategories: jest.fn() }));

beforeEach(() => {
  localStorage.clear();
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
