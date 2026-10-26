import { Inflate } from 'pako';

/** Limit decompressed backup size too; encrypted/upload limits do not stop zip bombs. */
export function inflateBackup(
  compressed: Uint8Array,
  maxBytes = 64 * 1024 * 1024
): string {
  const inflater = new Inflate({ chunkSize: 64 * 1024 });
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  inflater.onData = (chunk) => {
    if (typeof chunk === 'string')
      throw new Error('Unexpected inflater output');
    bytes += chunk.byteLength;
    if (bytes > maxBytes) throw new Error('解壓縮備份超過大小限制');
    text += decoder.decode(chunk, { stream: true });
  };
  if (!inflater.push(compressed, true) || inflater.err)
    throw new Error('無效壓縮備份');
  return text + decoder.decode();
}
