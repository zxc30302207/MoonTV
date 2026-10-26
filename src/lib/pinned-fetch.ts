import type { LookupFunction } from 'node:net';

export type PinnedAddress = { address: string; family: number };

/** No resolver is consulted by the socket after the caller validates this set. */
export function createPinnedLookup(
  hostname: string,
  addresses: PinnedAddress[]
): LookupFunction {
  const pinned = addresses.map((record) => ({ ...record }));
  return (requested, options, callback) => {
    if (requested.replace(/^\[|\]$/g, '').toLowerCase() !== hostname) {
      callback(new Error('Pinned hostname mismatch'), '', 4);
      return;
    }
    const family = typeof options === 'number' ? options : options.family;
    const selected = pinned.filter(
      (record) => !family || record.family === family
    );
    if (!selected.length) {
      callback(new Error('No validated address for requested family'), '', 4);
      return;
    }
    if (typeof options === 'object' && options.all) {
      callback(null, selected);
    } else {
      callback(null, selected[0].address, selected[0].family);
    }
  };
}

/** A dedicated, direct dispatcher: never inherits a global/proxy dispatcher. */
export async function pinnedFetch(
  url: URL,
  addresses: PinnedAddress[],
  init: RequestInit
): Promise<Response> {
  const { Agent, fetch: fetchDirect } = await import('undici');
  const dispatcher = new Agent({
    connect: {
      lookup: createPinnedLookup(
        url.hostname.replace(/^\[|\]$/g, '').toLowerCase(),
        addresses
      ),
      autoSelectFamily: true,
      autoSelectFamilyAttemptTimeout: 250,
      timeout: 10_000,
      // Never disable normal TLS certificate / hostname checks.
      rejectUnauthorized: true,
    },
    connections: 1,
    pipelining: 1,
    headersTimeout: 30_000,
    bodyTimeout: 30_000,
  });
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    init.signal?.removeEventListener('abort', cleanup);
    void dispatcher.destroy().catch(() => undefined);
  };
  init.signal?.addEventListener('abort', cleanup, { once: true });
  try {
    if (init.signal?.aborted) throw init.signal.reason || new Error('Aborted');
    const upstream = await fetchDirect(url, {
      method: init.method,
      headers: init.headers as import('undici').HeadersInit,
      signal: init.signal,
      redirect: 'manual',
      dispatcher,
    });
    if (!upstream.body) {
      cleanup();
      return upstream as unknown as Response;
    }
    const reader = upstream.body.getReader();
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const next = await reader.read();
          if (next.done) {
            controller.close();
            cleanup();
          } else controller.enqueue(next.value);
        } catch (error) {
          controller.error(error);
          cleanup();
        }
      },
      cancel(reason) {
        // Socket cleanup must not wait on a potentially stalled cancel promise.
        void reader.cancel(reason).catch(() => undefined);
        cleanup();
      },
    });
    const response = new Response(body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: upstream.headers as unknown as HeadersInit,
    });
    Object.defineProperty(response, 'url', { value: upstream.url });
    return response;
  } catch (error) {
    cleanup();
    throw error;
  }
}
