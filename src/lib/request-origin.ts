function getForwardedValue(forwarded: string | null, key: 'host' | 'proto') {
  if (!forwarded) {
    return '';
  }

  const match = forwarded.match(new RegExp(`${key}=([^;,\\s]+)`, 'i'));
  if (!match) {
    return '';
  }

  return match[1]?.replace(/^"|"$/g, '').trim() || '';
}

function pickHeaderValue(value: string | null) {
  if (!value) {
    return '';
  }

  return (
    value
      .split(',')
      .map((item) => item.trim())
      .find(Boolean) || ''
  );
}

export function getRequestOrigin(request: Request) {
  const url = new URL(request.url);
  const forwarded = request.headers.get('forwarded');

  const forwardedHost = getForwardedValue(forwarded, 'host');
  const forwardedProto = getForwardedValue(forwarded, 'proto');
  const xForwardedHost = pickHeaderValue(
    request.headers.get('x-forwarded-host')
  );
  const xForwardedProto = pickHeaderValue(
    request.headers.get('x-forwarded-proto')
  );
  const host = pickHeaderValue(request.headers.get('host'));

  const resolvedHost = [forwardedHost, xForwardedHost, host, url.host].find(
    (candidate) => {
      if (!candidate || /^0\.0\.0\.0(?::\d+)?$/.test(candidate)) return false;
      try {
        const parsed = new URL(`https://${candidate}`);
        return (
          !parsed.username &&
          !parsed.password &&
          parsed.host === candidate.toLowerCase().replace(/:443$/, '') &&
          parsed.pathname === '/' &&
          !parsed.search &&
          !parsed.hash
        );
      } catch {
        return false;
      }
    }
  );

  if (!resolvedHost) {
    return url.origin;
  }

  const resolvedProto = [
    forwardedProto,
    xForwardedProto,
    url.protocol.replace(':', ''),
    'http',
  ].find((candidate) => candidate === 'https' || candidate === 'http');

  return `${resolvedProto}://${resolvedHost}`;
}
