import { MediaRequestDeadline } from './media-request-deadline';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

it('aborts never-returning headers and releases the caller even if fetch ignores abort', async () => {
  const controller = new AbortController();
  const deadline = new MediaRequestDeadline(controller, 100);
  const result = deadline.wait(new Promise(() => undefined));
  const assertion = expect(result).rejects.toMatchObject({
    name: 'TimeoutError',
  });
  jest.advanceTimersByTime(100);
  await assertion;
  expect(controller.signal.aborted).toBe(true);
  expect(deadline.timedOut).toBe(true);
});

it('times out a body that stops producing data', async () => {
  const controller = new AbortController();
  const cancel = jest.fn();
  const stream = new ReadableStream<Uint8Array>({ cancel });
  const result = new MediaRequestDeadline(controller, 100).readBody({
    body: stream,
  } as Response);
  const assertion = expect(result).rejects.toMatchObject({
    name: 'TimeoutError',
  });
  jest.advanceTimersByTime(100);
  await assertion;
  expect(cancel).toHaveBeenCalled();
});

it('allows a progressing body whose total time exceeds the timeout', async () => {
  let streamController!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller;
    },
  });
  const controller = new AbortController();
  const result = new MediaRequestDeadline(controller, 100).readBody({
    body: stream,
  } as Response);
  for (let i = 0; i < 4; i++) {
    jest.advanceTimersByTime(80);
    streamController.enqueue(new Uint8Array([i]));
    await flush();
  }
  streamController.close();
  expect(Array.from(new Uint8Array(await result))).toEqual([0, 1, 2, 3]);
  expect(controller.signal.aborted).toBe(false);
  expect(jest.getTimerCount()).toBe(0);
});

it('settles an externally cancelled pending request without waiting for deadline', async () => {
  const controller = new AbortController();
  const deadline = new MediaRequestDeadline(controller, 100);
  const result = deadline.wait(new Promise(() => undefined));
  const assertion = expect(result).rejects.toMatchObject({
    name: 'AbortError',
  });
  controller.abort();
  await assertion;
  expect(deadline.timedOut).toBe(false);
  expect(jest.getTimerCount()).toBe(0);
});
