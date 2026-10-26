import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { ReactNode } from 'react';

import SearchPage from '../page';

let mockParams = new URLSearchParams();
jest.mock('next/navigation', () => ({ useSearchParams: () => mockParams }));
jest.mock('@/lib/db.client', () => ({
  getSearchHistory: async () => [],
  addSearchHistory: jest.fn(),
  subscribeToDataUpdates: () => () => undefined,
}));
jest.mock('@/lib/utils', () => ({ getRequestTimeout: () => 10 }));
jest.mock('@/lib/concurrency', () => ({ getSearchConcurrency: () => 2 }));
jest.mock('@/components/PageLayout', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
jest.mock('@/components/VideoCard', () => ({
  __esModule: true,
  default: ({
    title,
    source,
    items,
  }: {
    title?: string;
    source?: string;
    items?: Array<{ title: string; source: string }>;
  }) => (
    <div>
      {items
        ? items.map((item) => `${item.title}:${item.source}`).join(',')
        : `${title}:${source}`}
    </div>
  ),
}));
jest.mock('@/components/SourceSelector', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/components/FilterOptions', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/components/SearchSuggestions', () => ({
  __esModule: true,
  default: () => null,
}));

const item = (source: string) => ({
  id: '1',
  title: '作品',
  year: '2026',
  episodes: ['one'],
  source,
  source_name: source,
  poster: '',
});
const jsonResponse = (results: unknown[]) => ({
  ok: true,
  json: async () => ({ results }),
});
describe('search request identity and failure state', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('defaultStreamSearch', 'false');
    mockParams = new URLSearchParams('q=作品&sources=a');
    global.fetch = jest.fn().mockResolvedValue(jsonResponse([item('a')]));
    window.IntersectionObserver = jest.fn().mockImplementation(() => ({
      observe: jest.fn(),
      disconnect: jest.fn(),
    }));
  });
  it('reissues the same query and follows source URL changes including removal', async () => {
    const view = render(<SearchPage />);
    await screen.findByText('作品:a');
    const form = screen.getByRole('textbox').closest('form');
    if (!form) throw new Error('Missing search form');
    fireEvent.submit(form);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    mockParams = new URLSearchParams('q=作品&sources=b');
    view.rerender(<SearchPage />);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    expect(String((fetch as jest.Mock).mock.calls[2][0])).toContain(
      'sources=b'
    );
    mockParams = new URLSearchParams('q=作品');
    view.rerender(<SearchPage />);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(4));
    expect(String((fetch as jest.Mock).mock.calls[3][0])).not.toContain(
      'sources='
    );
  });
  it('retains streamed results when transport fails and offers retry', async () => {
    localStorage.setItem('defaultStreamSearch', 'true');
    const reader = {
      read: jest
        .fn()
        .mockResolvedValueOnce({
          done: false,
          value: new TextEncoder().encode(
            JSON.stringify({ pageResults: [item('a')] }) + '\n'
          ),
        })
        .mockRejectedValueOnce(new Error('network')),
    };
    (fetch as jest.Mock).mockResolvedValue({
      ok: true,
      body: { getReader: () => reader },
    });
    render(<SearchPage />);
    expect(await screen.findByText('作品:a')).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent('搜尋未完成');
    expect(screen.getByText('重試')).toBeInTheDocument();
  });
  it('filters aggregate members, not just the group visibility', async () => {
    mockParams = new URLSearchParams('q=作品&filter_sources=b');
    (fetch as jest.Mock).mockResolvedValue(
      jsonResponse([item('a'), item('b')])
    );
    render(<SearchPage />);
    expect(await screen.findByText('作品:b')).toBeInTheDocument();
    expect(screen.queryByText('作品:a')).not.toBeInTheDocument();
  });
  it('does not let an old failed request overwrite a new result', async () => {
    let rejectOld!: (error: Error) => void;
    (fetch as jest.Mock)
      .mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            rejectOld = reject;
          })
      )
      .mockResolvedValueOnce(jsonResponse([item('b')]));
    const view = render(<SearchPage />);
    mockParams = new URLSearchParams('q=新作品&sources=b');
    view.rerender(<SearchPage />);
    await screen.findByText('作品:b');
    await act(async () => rejectOld(new Error('old')));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it.each([true, false])(
    'requires an explicit stream completion marker (present: %s)',
    async (complete) => {
      localStorage.setItem('defaultStreamSearch', 'true');
      const payload =
        JSON.stringify({ pageResults: [item('a')] }) +
        '\n' +
        (complete ? '{"complete":true}\n' : '');
      const read = jest
        .fn()
        .mockResolvedValueOnce({
          done: false,
          value: new TextEncoder().encode(payload),
        })
        .mockResolvedValueOnce({ done: true });
      (fetch as jest.Mock).mockResolvedValue({
        ok: true,
        body: { getReader: () => ({ read }) },
      });
      render(<SearchPage />);
      await screen.findByText('作品:a');
      await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
      if (complete) expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      else
        expect(await screen.findByRole('alert')).toHaveTextContent(
          '搜尋未完成'
        );
    }
  );
});
