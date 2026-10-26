import { createCipheriv } from 'crypto';
import { WritableStream } from 'stream/web';

import { aesDecrypt, downloadM3U8Video, parseM3U8 } from './m3u8-downloader';

let mockStream: WritableStream<Uint8Array> | undefined;
const mockWriter = { write: jest.fn(), close: jest.fn(), abort: jest.fn() };
jest.mock('./stream-saver', () => ({
  createWriteStream: () => mockStream ?? { getWriter: () => mockWriter },
}));
jest.mock('./mp4-transmuxer', () => ({
  StreamingTransmuxer: jest.fn(),
  transmuxTSToMP4: jest.fn(),
}));

function response(data: string | Uint8Array, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 404,
    text: async () => data,
    arrayBuffer: async () => (data as Uint8Array).buffer,
  } as Response;
}

const keyA = new Uint8Array(16).fill(11);
const keyB = new Uint8Array(16).fill(22);
const base = 'https://cdn.test/index.m3u8';
const manifest =
  '#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:42\n#EXT-X-KEY:METHOD=AES-128,URI="a.key"\n#EXTINF:4,\na.ts\n#EXT-X-KEY:METHOD=AES-128,URI="b.key",IV=0x2b\n#EXTINF:4,\nb.ts\n#EXT-X-KEY:METHOD=NONE\n#EXTINF:4,\nc.ts\n#EXT-X-ENDLIST';
const parse = (text = manifest) =>
  parseM3U8(base, {
    fetcher: async (url) =>
      response(
        url.endsWith('a.key') ? keyA : url.endsWith('b.key') ? keyB : text
      ),
  });

describe('download integrity', () => {
  const originalFetch = global.fetch;
  beforeEach(() => {
    mockStream = undefined;
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });
  it('decrypts actual AES ciphertext with rotating keys and original implicit media sequence', async () => {
    const task = await parse();
    expect(task.segmentEncryption?.[0]?.iv).toBe(
      '0x0000000000000000000000000000002a'
    );
    expect(task.segmentEncryption?.[2]).toBeNull();
    for (const [index, key] of [keyA, keyB].entries()) {
      const encryption = task.segmentEncryption?.[index];
      expect(encryption).toBeTruthy();
      if (!encryption) throw new Error('Missing encryption');
      const cleartext = Buffer.from(`real encrypted segment ${index}`);
      const cipher = createCipheriv(
        'aes-128-cbc',
        key,
        Buffer.from(encryption.iv.slice(2), 'hex')
      );
      const ciphertext = Buffer.concat([
        cipher.update(cleartext),
        cipher.final(),
      ]);
      const bytes = Uint8Array.from(ciphertext).buffer;
      expect(
        Buffer.from(aesDecrypt(bytes, encryption.key, encryption.iv))
      ).toEqual(cleartext);
    }
  });
  it('downloads a selected range with per-segment keys and keeps METHOD=NONE bytes clear', async () => {
    const task = await parse();
    task.rangeDownload = { startSegment: 2, endSegment: 3, targetSegment: 2 };
    const encryption = task.segmentEncryption?.[1];
    if (!encryption) throw new Error('Missing encryption');
    const plaintext = Buffer.from('second segment');
    const cipher = createCipheriv(
      'aes-128-cbc',
      keyB,
      Buffer.from(encryption.iv.slice(2), 'hex')
    );
    const encrypted = Uint8Array.from(
      Buffer.concat([cipher.update(plaintext), cipher.final()])
    );
    const clear = new Uint8Array([11, 12, 13]);
    global.fetch = jest.fn(async (url) =>
      response(url === task.tsUrlList[1] ? encrypted : clear)
    );
    await downloadM3U8Video(
      task,
      undefined,
      undefined,
      undefined,
      1,
      'service-worker',
      0
    );
    expect(mockWriter.write.mock.calls.map(([bytes]) => [...bytes])).toEqual([
      [...plaintext],
      [...clear],
    ]);
    expect(mockWriter.close).toHaveBeenCalledTimes(1);
  });
  it('re-downloads persisted successes into a newly opened stream', async () => {
    const task = await parse('#EXTM3U\n#EXTINF:4,\na.ts\n#EXT-X-ENDLIST');
    task.finishList[0].status = 'success';
    task.finishNum = 1;
    global.fetch = jest.fn(async () => response(new Uint8Array([7, 8])));
    await downloadM3U8Video(
      task,
      undefined,
      undefined,
      undefined,
      1,
      'service-worker',
      0
    );
    expect(mockWriter.write).toHaveBeenCalledWith(new Uint8Array([7, 8]));
    expect(task.finishNum).toBe(1);
  });
  it('does not mark a cancelled download complete', async () => {
    const task = await parse('#EXTM3U\n#EXTINF:4,\na.ts\n#EXT-X-ENDLIST');
    const controller = new AbortController();
    global.fetch = jest.fn(async () => {
      controller.abort();
      return response(new Uint8Array([7]));
    });
    const progress = jest.fn();
    await expect(
      downloadM3U8Video(
        task,
        progress,
        controller.signal,
        undefined,
        1,
        'service-worker',
        0
      )
    ).rejects.toThrow('下載已取消');
    expect(mockWriter.abort).toHaveBeenCalled();
    expect(mockWriter.close).not.toHaveBeenCalled();
    expect(progress.mock.calls.some(([p]) => p.status === 'done')).toBe(false);
  });
  it('explicitly saves a partial real stream without aborting or pretending it is complete', async () => {
    const task = await parse(
      '#EXTM3U\n#EXTINF:4,\na.ts\n#EXTINF:4,\nb.ts\n#EXTINF:4,\nc.ts\n#EXT-X-ENDLIST'
    );
    const chunks: number[][] = [];
    const close = jest.fn();
    const abort = jest.fn();
    mockStream = new WritableStream({
      write: (bytes) => {
        chunks.push([...bytes]);
      },
      close,
      abort,
    });
    global.fetch = jest.fn((url, init) =>
      url === task.tsUrlList[0]
        ? Promise.resolve(response(new Uint8Array([9, 8])))
        : new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              'abort',
              () => reject(new DOMException('Aborted', 'AbortError')),
              { once: true }
            );
          })
    );
    let firstWritten!: () => void;
    const ready = new Promise<void>((resolve) => {
      firstWritten = resolve;
    });
    const progress = jest.fn((value) => {
      if (value.current === 1) firstWritten();
    });
    const complete = { current: null as (() => Promise<void>) | null };
    const download = downloadM3U8Video(
      task,
      progress,
      undefined,
      undefined,
      1,
      'service-worker',
      0,
      complete
    );
    await ready;
    if (!complete.current) throw new Error('Missing partial save callback');
    await complete.current();
    await download;
    expect(chunks).toEqual([[9, 8]]);
    expect(close).toHaveBeenCalledTimes(1);
    expect(abort).not.toHaveBeenCalled();
    expect(progress).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: 'partial',
        current: 1,
        total: 3,
        percentage: 33,
      })
    );
    expect(progress.mock.calls.some(([value]) => value.status === 'done')).toBe(
      false
    );
  });
  it('never interprets MAP URI as an encryption key and refuses unsupported output before fetching media', async () => {
    const task = await parse(
      '#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXT-X-KEY:METHOD=AES-128,URI="a.key",IV=0x01\n#EXTINF:4,\na.m4s\n#EXT-X-ENDLIST'
    );
    expect(task.aesConf.uri).toBe('https://cdn.test/a.key');
    global.fetch = jest.fn();
    await expect(downloadM3U8Video(task)).rejects.toThrow('fMP4');
    expect(global.fetch).not.toHaveBeenCalled();
  });
  it.each([0, 1, 2])(
    'aborts an incomplete stream when segment %i fails, never reports done',
    async (failed) => {
      const task = await parse(
        '#EXTM3U\n#EXTINF:4,\na.ts\n#EXTINF:4,\nb.ts\n#EXTINF:4,\nc.ts\n#EXT-X-ENDLIST'
      );
      global.fetch = jest.fn(async (url) =>
        response(new Uint8Array([1, 2]), url !== task.tsUrlList[failed])
      );
      const progress = jest.fn();
      await expect(
        downloadM3U8Video(
          task,
          progress,
          undefined,
          undefined,
          2,
          'service-worker',
          0
        )
      ).rejects.toThrow('下載不完整');
      expect(mockWriter.abort).toHaveBeenCalled();
      expect(mockWriter.close).not.toHaveBeenCalled();
      expect(progress.mock.calls.some(([p]) => p.status === 'done')).toBe(
        false
      );
    }
  );
  it('commits a complete stream', async () => {
    const task = await parse('#EXTM3U\n#EXTINF:4,\na.ts\n#EXT-X-ENDLIST');
    global.fetch = jest.fn(async () => response(new Uint8Array([1, 2])));
    const progress = jest.fn();
    await downloadM3U8Video(
      task,
      progress,
      undefined,
      undefined,
      1,
      'service-worker',
      0
    );
    expect(mockWriter.close).toHaveBeenCalledTimes(1);
    expect(mockWriter.abort).not.toHaveBeenCalled();
    expect(progress).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'done', percentage: 100 })
    );
  });
});

describe('playlist request lifecycle', () => {
  afterEach(() => jest.useRealTimers());
  it('times out a fetch that never settles and aborts its request', async () => {
    jest.useFakeTimers();
    let signal: AbortSignal | undefined;
    const pending = parseM3U8(base, {
      fetcher: (_url, init) => {
        signal = init?.signal as AbortSignal;
        return new Promise(() => undefined);
      },
    });
    const assertion = expect(pending).rejects.toThrow('stalled');
    jest.advanceTimersByTime(15_001);
    await assertion;
    expect(signal?.aborted).toBe(true);
  });
  it('propagates parent cancellation through a custom fetcher that ignores abort', async () => {
    const controller = new AbortController();
    const pending = parseM3U8(base, {
      signal: controller.signal,
      fetcher: () => new Promise(() => undefined),
    });
    const assertion = expect(pending).rejects.toThrow('Aborted');
    controller.abort();
    await assertion;
  });
  it('times out a playlist body that never settles', async () => {
    jest.useFakeTimers();
    const pending = parseM3U8(base, {
      fetcher: async () =>
        ({ ok: true, text: () => new Promise(() => undefined) } as Response),
    });
    const assertion = expect(pending).rejects.toThrow('stalled');
    // Let fetch resolution reach the body deadline before advancing timers.
    for (let i = 0; i < 5; i++) await Promise.resolve();
    jest.advanceTimersByTime(15_001);
    await assertion;
  });
});
