import { getRequestOrigin } from './request-origin';

function request(headers: Record<string, string>) {
  return {
    url: 'https://moontv.example/test',
    headers: { get: (key: string) => headers[key] || null },
  } as Request;
}

describe('reverse proxy origins', () => {
  it('supports canonical forwarded hosts and https', () => {
    expect(
      getRequestOrigin(
        request({
          'x-forwarded-host': 'tv.example:443',
          'x-forwarded-proto': 'https',
        })
      )
    ).toBe('https://tv.example:443');
  });
  it('rejects credential and path injection', () => {
    expect(
      getRequestOrigin(
        request({
          'x-forwarded-host': 'evil.example@moontv.example/path',
          'x-forwarded-proto': 'javascript',
        })
      )
    ).toBe('https://moontv.example');
  });
  it('does not emit script protocols', () => {
    expect(
      getRequestOrigin(
        request({
          'x-forwarded-host': 'tv.example',
          'x-forwarded-proto': 'javascript',
        })
      )
    ).toBe('https://tv.example');
  });
});
