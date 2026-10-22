import { serializeRuntimeConfig } from './runtime-config';

it('keeps hostile configured URLs inside JSON rather than closing the script', () => {
  const config = {
    BANGUMI_PROXY: '</script><script>alert(1)</script>',
    BANGUMI_IMAGE_PROXY: 'https://example.com/?a=<value>&b=繁體',
  };
  const serialized = serializeRuntimeConfig(config);
  expect(serialized).not.toContain('<');
  expect(serialized).toContain('\\u003c/script>');
  expect(JSON.parse(serialized)).toEqual(config);
});
