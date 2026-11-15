/** Bound the complete request, including response-body and streaming reads. */
export async function withPlaybackDeadline<T>(
  run: (signal: AbortSignal) => Promise<T>,
  signal: AbortSignal,
  timeoutMs: number,
  timeoutMessage: string
): Promise<T> {
  const controller = new AbortController();
  let rejectAbort!: (reason: Error) => void;
  const interrupted = new Promise<never>((_, reject) => {
    rejectAbort = reject;
  });
  const abort = () => {
    rejectAbort(new DOMException('Playback request cancelled', 'AbortError'));
    controller.abort();
  };
  signal.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => {
    rejectAbort(new Error(timeoutMessage));
    controller.abort();
  }, timeoutMs);
  try {
    if (signal.aborted) {
      abort();
      return await interrupted;
    }
    return await Promise.race([run(controller.signal), interrupted]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
    controller.abort();
  }
}
