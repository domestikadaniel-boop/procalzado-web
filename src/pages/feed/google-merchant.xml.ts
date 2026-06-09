import type { APIRoute } from 'astro';
import { supabase } from '../../lib/supabase';

export const prerender = true;

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
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
  const hasKids = g.includes('nino') || g.includes('nina');
  const hasAdult = g.includes('hombre') || g.includes('mujer') || g.includes('unisex');
  if (hasKids && !hasAdult) return 'kids';
  return 'adult';
}

export const GET: APIRoute = async () => {
  const { data: products } = await supabase
    .from('products')
    .select(`
      id, slug, name, short_description, description, price, sale_price, show_price, genders, active,
      brands ( name ),
      categories ( name ),
      product_images ( url, is_primary, display_order, color ),
      product_variants ( size, color, active )
    `)
    .eq('active', true);

  if (!products || products.length === 0) {
    return new Response('<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"></rss>', {
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
    const additionalImages = images.filter((i: any) => i !== primary).slice(0, 10);

    const variants = (p.product_variants || []).filter((v: any) => v.active);
    const sizes = [...new Set(variants.map((v: any) => v.size))].sort();
    const colors = [...new Set(variants.map((v: any) => v.color).filter(Boolean))].sort();

    const gender = mapGender(p.genders);
    const ageGroup = mapAgeGroup(p.genders);

    const price = p.show_price && p.price ? `${Math.round(p.price)} COP` : '';
    const salePrice = p.show_price && p.sale_price ? `${Math.round(p.sale_price)} COP` : '';

    return `    <item>
      <g:id>${escapeXml(p.id)}</g:id>
      <g:title>${escapeXml(title)}</g:title>
      <g:description>${escapeXml(desc)}</g:description>
      <g:link>${escapeXml(link)}</g:link>
      <g:image_link>${escapeXml(imageLink)}</g:image_link>
${additionalImages.map((img: any) => `      <g:additional_image_link>${escapeXml(img.url)}</g:additional_image_link>`).join('\n')}
      <g:availability>in_stock</g:availability>
${price ? `      <g:price>${price}</g:price>` : ''}
${salePrice ? `      <g:sale_price>${salePrice}</g:sale_price>` : ''}
      <g:brand>${escapeXml(brand)}</g:brand>
      <g:condition>new</g:condition>
      <g:google_product_category>166</g:google_product_category>
      <g:product_type>${escapeXml(`Calzado > ${category}`)}</g:product_type>
      <g:gender>${gender}</g:gender>
      <g:age_group>${ageGroup}</g:age_group>
${sizes.length ? `      <g:size>${escapeXml(sizes.join(', '))}</g:size>` : ''}
${colors.length ? `      <g:color>${escapeXml(colors.join(' / '))}</g:color>` : ''}
      <g:shipping>
        <g:country>CO</g:country>
        <g:service>Envio Nacional</g:service>
      </g:shipping>
    </item>`;
  });

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title>Procalzado - Calzado en Colombia</title>
    <link>https://procalzado.com</link>
    <description>Catalogo de calzado Procalzado. Botas, sandalias, calzado industrial y mas.</description>
${items.join('\n')}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
};
