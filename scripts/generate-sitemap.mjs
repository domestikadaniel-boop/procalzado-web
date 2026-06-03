// scripts/generate-sitemap.mjs
// Genera public/sitemap.xml automáticamente con todos los productos
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'fs';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SUPABASE_URL = process.env.PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.PUBLIC_SUPABASE_ANON_KEY;
const SITE = 'https://procalzado.com';

async function generateSitemap() {
  const today = new Date().toISOString().split('T')[0];

  const pages = [
    { url: '/', priority: '1.0', changefreq: 'daily' }
  ];

  if (SUPABASE_URL && SUPABASE_KEY) {
    try {
      const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
      const { data: products, error } = await supabase
        .from('products')
        .select('slug, updated_at')
        .eq('active', true)
        .order('slug');

      if (error) {
        console.warn('⚠️  Error al cargar productos:', error.message);
      } else if (products) {
        products.forEach(p => {
          pages.push({
            url: `/productos/${p.slug}`,
            priority: '0.8',
            changefreq: 'weekly'
          });
        });
        console.log(`✓ Sitemap generado con ${products.length} productos`);
      }
    } catch (err) {
      console.warn('⚠️  No se pudo conectar a Supabase, generando sitemap básico');
    }
  } else {
    console.warn('⚠️  Faltan variables de Supabase, generando sitemap básico');
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages.map(p => `  <url>
    <loc>${SITE}${p.url}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${p.changefreq}</changefreq>
    <priority>${p.priority}</priority>
  </url>`).join('\n')}
</urlset>`;

  writeFileSync('./public/sitemap.xml', xml, 'utf-8');
  console.log(`✓ Escrito en ./public/sitemap.xml (${pages.length} URLs)`);
}

generateSitemap().catch(err => {
  console.error('Error generando sitemap:', err);
  process.exit(0);
});