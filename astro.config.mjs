// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

export default defineConfig({
  site: 'https://procalzado.com',
  output: 'static',
  adapter: cloudflare({
    imageService: 'passthrough',
    platformProxy: { enabled: true },
    sessionKVBindingName: undefined,
  }),
});
