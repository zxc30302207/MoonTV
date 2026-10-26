import { WritableStream } from 'stream/web';

import { StreamingTransmuxer } from './mp4-transmuxer';

const mockMuxers: Array<{
  emit: (data: { initSegment: Uint8Array; data: Uint8Array }) => void;
}> = [];
jest.mock('mux.js', () => ({
  __esModule: true,
  default: {
    mp4: {
      Transmuxer: jest.fn().mockImplementation(() => {
        let listener: (data: {
          initSegment: Uint8Array;
          data: Uint8Array;
        }) => void;
        const muxer = {
          on: (_name: string, callback: typeof listener) => {
            listener = callback;
          },
          emit: (data: Parameters<typeof listener>[0]) => listener(data),
          push: jest.fn(),
          flush: jest.fn(),
        };
        mockMuxers.push(muxer);
        return muxer;
      }),
    },
  },
}));

it('waits for slow init/data writes and serializes them before close', async () => {
  const bytes: number[] = [];
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const close = jest.fn();
  const stream = new WritableStream<Uint8Array>({
    write: async (data) => {
      if (data[0] === 1) await barrier;
      bytes.push(...data);
    },
    close,
  });
  const transmuxer = new StreamingTransmuxer(
    stream.getWriter() as unknown as WritableStreamDefaultWriter<Uint8Array>
  );
  mockMuxers[mockMuxers.length - 1].emit({
    initSegment: new Uint8Array([1]),
    data: new Uint8Array([2]),
  });
  mockMuxers[mockMuxers.length - 1].emit({
    initSegment: new Uint8Array([1]),
    data: new Uint8Array([3]),
  });
  const finishing = transmuxer.finish();
  await Promise.resolve();
  expect(close).not.toHaveBeenCalled();
  release();
  await finishing;
  expect(bytes).toEqual([1, 2, 3]);
  expect(close).toHaveBeenCalledTimes(1);
  expect(transmuxer.getSegmentCount()).toBe(2);
});
it('propagates close failure instead of reporting a successful MP4', async () => {
  const stream = new WritableStream<Uint8Array>({
    close: () => {
      throw new Error('disk full');
    },
  });
  const transmuxer = new StreamingTransmuxer(
    stream.getWriter() as unknown as WritableStreamDefaultWriter<Uint8Array>
  );
  await expect(transmuxer.finish()).rejects.toThrow('disk full');
});
it('propagates delayed write failure without unhandled listener rejections', async () => {
  const stream = new WritableStream<Uint8Array>({
    write: async () => {
      throw new Error('write failed');
    },
  });
  const transmuxer = new StreamingTransmuxer(
    stream.getWriter() as unknown as WritableStreamDefaultWriter<Uint8Array>
  );
  mockMuxers[mockMuxers.length - 1].emit({
    initSegment: new Uint8Array([1]),
    data: new Uint8Array([2]),
  });
  await expect(transmuxer.pushAndTransmux(new Uint8Array())).rejects.toThrow(
    'write failed'
  );
  await expect(transmuxer.finish()).rejects.toThrow('write failed');
});
