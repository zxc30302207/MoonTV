/** Bound decoded upstream data while streaming; Content-Length alone is untrusted. */
export async function readBoundedText(
  response: Response,
  maxBytes: number,
  timeoutMs = 15000
): Promise<string> {
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > maxBytes) {
    void response.body?.cancel().catch(() => undefined);
    throw new Error('上游回應超過大小限制');
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new DOMException('上游回應逾時', 'TimeoutError')),
      timeoutMs
    );
  });
  let bytes = 0;
  let text = '';
  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), deadline]);
      if (done) return text + decoder.decode();
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new Error('上游回應超過大小限制');
      text += decoder.decode(value, { stream: true });
    }
  } catch (error) {
    void reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    reader.releaseLock();
  }
}
