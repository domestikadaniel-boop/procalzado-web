// SITEMAP DINÁMICO - lista todas las páginas del sitio
import type { APIRoute } from 'astro';
import { getProducts } from '../lib/supabase';

export const GET: APIRoute = async () => {
  const site = 'https://procalzado.com';
  const today = new Date().toISOString().split('T')[0];

  const products = await getProducts();

  const staticPages = [
    { url: '/', priority: '1.0', changefreq: 'daily' },
  ];

  const productPages = products.map(p => ({
    url: `/productos/${p.slug}`,
    priority: '0.8',
    changefreq: 'weekly',
    lastmod: today
  }));

  const allPages = [...staticPages, ...productPages];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${allPages.map(p => `  <url>
    <loc>${site}${p.url}</loc>
    <lastmod>${(p as any).lastmod || today}</lastmod>
    <changefreq>${p.changefreq}</changefreq>
    <priority>${p.priority}</priority>
  </url>`).join('\n')}
</urlset>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600'
    }
  });
};
