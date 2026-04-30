// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import cloudflare from '@astrojs/cloudflare';

export default defineConfig({
  site: 'https://procalzado.com',
  output: 'server', // <--- AGREGA ESTA LÍNEA
  integrations: [sitemap()],
  adapter: cloudflare(),
});