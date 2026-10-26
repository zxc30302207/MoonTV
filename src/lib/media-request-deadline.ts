/** A per-operation deadline, not a total download limit: progressing bodies may be large. */
export class MediaRequestDeadline {
  timedOut = false;

  constructor(
    private readonly controller: AbortController,
    private readonly timeoutMs = 15_000
  ) {}

  wait<T>(operation: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const signal = this.controller.signal;
      const aborted = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', aborted);
        reject(new DOMException('Aborted', 'AbortError'));
      };
      const timer = setTimeout(() => {
        this.timedOut = true;
        signal.removeEventListener('abort', aborted);
        reject(new DOMException('Media request stalled', 'TimeoutError'));
        this.controller.abort();
      }, this.timeoutMs);
      signal.addEventListener('abort', aborted, { once: true });
      if (signal.aborted) aborted();
      operation.then(
        (result) => {
          clearTimeout(timer);
          signal.removeEventListener('abort', aborted);
          resolve(result);
        },
        (error) => {
          clearTimeout(timer);
          signal.removeEventListener('abort', aborted);
          reject(error);
        }
      );
    });
  }

  async readBody(response: Response): Promise<ArrayBuffer> {
    // Some adapters and older browsers expose only arrayBuffer().
    if (!response.body?.getReader) return this.wait(response.arrayBuffer());
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      for (;;) {
        const { value, done } = await this.wait(reader.read());
        if (done) break;
        chunks.push(value);
        length += value.byteLength;
      }
      const result = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return result.buffer;
    } catch (error) {
      // Do not let a broken stream's cancellation block the retry slot.
      void reader.cancel().catch(() => undefined);
      throw error;
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // The aborted read may still be settling in a browser adapter.
      }
    }
  }
}
