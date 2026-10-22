/** Escape HTML delimiters before embedding JSON in an inline script element. */
export function serializeRuntimeConfig(
  config: Record<string, unknown>
): string {
  return JSON.stringify(config).replace(/</g, '\\u003c');
}
