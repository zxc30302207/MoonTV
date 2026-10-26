/* eslint-disable @typescript-eslint/no-var-requires */
import { readBoundedText } from './bounded-response';

beforeAll(() => {
  const { MessageChannel, MessagePort } = require('worker_threads');
  Object.assign(globalThis, { MessageChannel, MessagePort });
  const { Response, Headers } = require('undici');
  const { ReadableStream } = require('stream/web');
  Object.assign(globalThis, { Response, Headers, ReadableStream });
});

test('counts bytes, not characters, and retains split multibyte unicode', async () => {
  const bytes = new TextEncoder().encode('繁體中文');
  const stream = new ReadableStream({
    start(c) {
      c.enqueue(bytes.slice(0, 2));
      c.enqueue(bytes.slice(2));
      c.close();
    },
  });
  expect(await readBoundedText(new Response(stream), 12)).toBe('繁體中文');
  await expect(readBoundedText(new Response('繁體中文'), 11)).rejects.toThrow(
    '大小限制'
  );
});

test('rejects advertised oversized responses and cancels oversized streaming bodies', async () => {
  await expect(
    readBoundedText(
      new Response('ok', { headers: { 'content-length': '999' } }),
      3
    )
  ).rejects.toThrow();
  const cancel = jest.fn();
  const stream = new ReadableStream({
    start(c) {
      c.enqueue(new Uint8Array(5));
    },
    cancel,
  });
  await expect(readBoundedText(new Response(stream), 4)).rejects.toThrow();
  expect(cancel).toHaveBeenCalled();
});

test('cancels a stalled body at its deadline', async () => {
  const cancel = jest.fn();
  const stream = new ReadableStream({ cancel });
  await expect(
    readBoundedText(new Response(stream), 100, 5)
  ).rejects.toMatchObject({ name: 'TimeoutError' });
  expect(cancel).toHaveBeenCalled();
});

test('a non-settling stream cancellation cannot defeat size or timeout limits', async () => {
  const never = () => new Promise<void>(() => undefined);
  const timed = new ReadableStream({ pull: never, cancel: never });
  await expect(
    readBoundedText(new Response(timed), 100, 5)
  ).rejects.toMatchObject({ name: 'TimeoutError' });
  const oversized = new ReadableStream({ cancel: never });
  await expect(
    readBoundedText(
      new Response(oversized, { headers: { 'content-length': '1000' } }),
      10
    )
  ).rejects.toThrow('大小限制');
});
