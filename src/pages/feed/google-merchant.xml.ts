import type { APIRoute } from 'astro';
import { getProducts } from '../../lib/supabase';

export const prerender = true;

function esc(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function mapGender(genders: string[] | null): string {
  if (!genders || genders.length === 0) return 'unisex';
  const g = genders.map(x => x.toLowerCase());
  if (g.includes('hombre') && !g.includes('mujer') && !g.includes('nino') && !g.includes('nina')) return 'male';
  if (g.includes('mujer') && !g.includes('hombre') && !g.includes('nino') && !g.includes('nina')) return 'female';
  return 'unisex';
}

function mapAgeGroup(genders: string[] | null): string {
  if (!genders || genders.length === 0) return 'adult';
  const g = genders.map(x => x.toLowerCase());
  if ((g.includes('nino') || g.includes('nina')) && !g.includes('hombre') && !g.includes('mujer')) return 'kids';
  return 'adult';
}

export const GET: APIRoute = async () => {
  const products = await getProducts();

  if (!products || products.length === 0) {
    return new Response('<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:g="http://base.google.com/ns/1.0"><channel></channel></rss>', {
      headers: { 'Content-Type': 'application/xml' },
    });
  }

  const items = products.map((p: any) => {
    const brand = p.brands?.name || 'Procalzado';
    const category = p.categories?.name || 'Calzado';
    const title = `${brand} ${p.name}`;
    const desc = p.short_description || (p.description || '').slice(0, 500);
    const link = `https://procalzado.com/productos/${p.slug}`;

    const images = (p.product_images || []).sort((a: any, b: any) => a.display_order - b.display_order);
    const primary = images.find((i: any) => i.is_primary) || images[0];
    const imageLink = primary?.url || '';
    const additional = images.filter((i: any) => i !== primary).slice(0, 10);

    const variants = (p.product_variants || []).filter((v: any) => v.active);
    const sizes = [...new Set(variants.map((v: any) => v.size))].sort();
    const colors = [...new Set(variants.map((v: any) => v.color).filter(Boolean))].sort();

    const gender = mapGender(p.genders);
    const ageGroup = mapAgeGroup(p.genders);

    const price = p.show_price && p.price ? `${Math.round(p.price)} COP` : '';
    const salePrice = p.show_price && p.sale_price ? `${Math.round(p.sale_price)} COP` : '';

    let xml = `    <item>
      <g:id>${esc(p.id)}</g:id>
      <g:title>${esc(title)}</g:title>
      <g:description>${esc(desc)}</g:description>
      <g:link>${esc(link)}</g:link>
      <g:image_link>${esc(imageLink)}</g:image_link>\n`;

    additional.forEach((img: any) => {
      xml += `      <g:additional_image_link>${esc(img.url)}</g:additional_image_link>\n`;
    });

    xml += `      <g:availability>in_stock</g:availability>\n`;
    if (price) xml += `      <g:price>${price}</g:price>\n`;
    if (salePrice) xml += `      <g:sale_price>${salePrice}</g:sale_price>\n`;
    xml += `      <g:brand>${esc(brand)}</g:brand>
      <g:condition>new</g:condition>
      <g:google_product_category>166</g:google_product_category>
      <g:product_type>${esc('Calzado > ' + category)}</g:product_type>
      <g:gender>${gender}</g:gender>
      <g:age_group>${ageGroup}</g:age_group>\n`;
    if (sizes.length) xml += `      <g:size>${esc(sizes.join(', '))}</g:size>\n`;
    if (colors.length) xml += `      <g:color>${esc(colors.join(' / '))}</g:color>\n`;
    xml += `      <g:shipping>
        <g:country>CO</g:country>
        <g:service>Envio Nacional</g:service>
      </g:shipping>
    </item>`;

    return xml;
  });

  const feed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title>Procalzado - Calzado en Colombia</title>
    <link>https://procalzado.com</link>
    <description>Catalogo de calzado Procalzado</description>
${items.join('\n')}
  </channel>
</rss>`;

  return new Response(feed, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
};
