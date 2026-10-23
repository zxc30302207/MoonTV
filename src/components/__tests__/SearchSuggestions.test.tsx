import { act, fireEvent, render, screen } from '@testing-library/react';
import { TextDecoder } from 'util';

import SearchSuggestions from '../SearchSuggestions';

const originalFetch = global.fetch;
const originalDecoder = global.TextDecoder;

beforeEach(() => {
  localStorage.clear();
  jest.useFakeTimers();
  global.TextDecoder = TextDecoder as typeof global.TextDecoder;
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    body: {
      getReader: () => ({
        read: jest
          .fn()
          .mockResolvedValueOnce({
            value: Buffer.from('{"suggestions":[{"text":"Selected title"}]}\n'),
            done: false,
          })
          .mockResolvedValue({ done: true }),
      }),
    },
  });
});

afterEach(() => {
  jest.useRealTimers();
  global.fetch = originalFetch;
  global.TextDecoder = originalDecoder;
});

it('selects a suggestion without submitting the enclosing search form', async () => {
  const onSelect = jest.fn();
  const onSubmit = jest.fn((event) => event.preventDefault());
  render(
    <form onSubmit={onSubmit}>
      <input aria-label='Search' />
      <SearchSuggestions
        query='Selected'
        isVisible
        onSelect={onSelect}
        onClose={jest.fn()}
      />
    </form>
  );
  await act(async () => {
    jest.advanceTimersByTime(300);
  });
  fireEvent.click(screen.getByRole('button', { name: 'Selected title' }));
  expect(onSelect).toHaveBeenCalledWith('Selected title');
  expect(onSubmit).not.toHaveBeenCalled();
});

it('does not intercept Enter in an unrelated form or during IME composition', async () => {
  const onSelect = jest.fn();
  render(
    <>
      <form>
        <input aria-label='Search' />
        <SearchSuggestions
          query='Selected'
          isVisible
          onSelect={onSelect}
          onClose={jest.fn()}
        />
      </form>
      <input aria-label='Unrelated input' />
    </>
  );
  await act(async () => {
    jest.advanceTimersByTime(300);
  });
  fireEvent.keyDown(screen.getByLabelText('Unrelated input'), { key: 'Enter' });
  fireEvent.keyDown(screen.getByLabelText('Search'), {
    key: 'Enter',
    isComposing: true,
  });
  expect(onSelect).not.toHaveBeenCalled();
  fireEvent.keyDown(screen.getByLabelText('Search'), { key: 'ArrowDown' });
  fireEvent.keyDown(screen.getByLabelText('Search'), { key: 'Enter' });
  expect(onSelect).toHaveBeenCalledWith('Selected title');
});
