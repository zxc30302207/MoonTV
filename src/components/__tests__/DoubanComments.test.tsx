import { act, fireEvent, render, screen } from '@testing-library/react';

import DoubanComments from '../DoubanComments';

const originalFetch = global.fetch;
function response(content: string) {
  return {
    ok: true,
    json: async () => ({
      comments: [
        { id: content, content, userName: 'Reviewer', rating: null, votes: 0 },
      ],
      total: 1,
      hasMore: false,
    }),
  } as Response;
}

afterEach(() => {
  global.fetch = originalFetch;
});

it('ignores an old title response after switching titles', async () => {
  let resolveOld!: (value: Response) => void;
  global.fetch = jest
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveOld = resolve;
        })
    )
    .mockResolvedValueOnce(response('Current title comment'));
  const { rerender } = render(<DoubanComments doubanId={1} />);
  fireEvent.click(screen.getByRole('button', { name: '查看豆瓣短評' }));
  rerender(<DoubanComments doubanId={2} />);
  fireEvent.click(screen.getByRole('button', { name: '查看豆瓣短評' }));
  await screen.findByText('Current title comment');
  await act(async () => {
    resolveOld(response('Stale title comment'));
  });
  expect(screen.getByText('Current title comment')).toBeInTheDocument();
  expect(screen.queryByText('Stale title comment')).not.toBeInTheDocument();
});

it('aborts requests when changing titles and unmounting', () => {
  const signals: AbortSignal[] = [];
  global.fetch = jest.fn((_url, options) => {
    if (!options?.signal) throw new Error('Expected request abort signal');
    signals.push(options.signal);
    return new Promise<Response>(() => undefined);
  });
  const { rerender, unmount } = render(<DoubanComments doubanId={1} />);
  fireEvent.click(screen.getByRole('button', { name: '查看豆瓣短評' }));
  expect(signals[0].aborted).toBe(false);
  rerender(<DoubanComments doubanId={2} />);
  expect(signals[0].aborted).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '查看豆瓣短評' }));
  expect(signals[1].aborted).toBe(false);
  unmount();
  expect(signals[1].aborted).toBe(true);
});
