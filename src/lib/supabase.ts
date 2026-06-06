import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Tipos TypeScript
export interface Brand {
  id: string;
  slug: string;
  name: string;
  logo_url: string | null;
  active: boolean;
}

export interface Category {
  id: string;
  slug: string;
  name: string;
  parent_id: string | null;
  meta_title: string | null;
  meta_description: string | null;
  display_order: number;
  active: boolean;
}

export interface Product {
  id: string;
  slug: string;
  name: string;
  brand_id: string | null;
  category_id: string | null;
  gender: string | null;
  genders: string[] | null;
  short_description: string | null;
  description: string | null;
  price: number | null;
  sale_price: number | null;
  show_price: boolean;
  price_note: string | null;
  specs: Record<string, string>;
  meta_title: string | null;
  meta_description: string | null;
  featured: boolean;
  active: boolean;
  // Joins
  brands?: Brand;
  categories?: Category;
  product_categories?: ProductCategory[];
  product_images?: ProductImage[];
  product_variants?: ProductVariant[];
}

export interface ProductCategory {
  category_id: string;
  is_primary: boolean;
  categories?: Category;
}

export interface ProductImage {
  id: string;
  product_id: string;
  color: string | null;
  url: string;
  alt_text: string | null;
  is_primary: boolean;
  display_order: number;
}

export interface ProductVariant {
  id: string;
  product_id: string;
  size: string;
  color: string;
  color_hex: string | null;
  color_hex_2: string | null;
  stock: number;
  sku: string | null;
  active: boolean;
}

// ── Funciones de consulta ──

export async function getProducts() {
  const { data, error } = await supabase
    .from('products')
    .select(`
      *,
      brands ( id, slug, name, logo_url ),
      categories!products_category_id_fkey ( id, slug, name ),
      product_images ( id, color, url, alt_text, is_primary, display_order ),
      product_variants ( id, size, color, color_hex, color_hex_2, stock, active )
    `)
    .eq('active', true)
    .order('display_order', { ascending: true })
    .order('created_at', { ascending: false });

  if (error) { console.error('Error fetching products:', error); return []; }
  if (!data || data.length === 0) return [];

  // Cargar categorías múltiples por aparte (no rompe si falla)
  const productIds = data.map((p: any) => p.id);
  const { data: pcData } = await supabase
    .from('product_categories')
    .select('product_id, category_id, is_primary, categories ( id, slug, name )')
    .in('product_id', productIds);

  // Asociar a cada producto
  if (pcData) {
    data.forEach((p: any) => {
      p.product_categories = pcData.filter((pc: any) => pc.product_id === p.id);
    });
  }

  return (data as Product[]) || [];
}

export async function getProductBySlug(slug: string) {
  const { data, error } = await supabase
    .from('products')
    .select(`
      *,
      brands ( id, slug, name, logo_url ),
      categories!products_category_id_fkey ( id, slug, name, meta_title, meta_description ),
      product_images ( id, color, url, alt_text, is_primary, display_order ),
      product_variants ( id, size, color, color_hex, color_hex_2, stock, active )
    `)
    .eq('slug', slug)
    .eq('active', true)
    .single();

  if (error) { console.error('Error fetching product:', error); return null; }
  if (!data) return null;

  // Cargar categorías múltiples por aparte
  const { data: pcData } = await supabase
    .from('product_categories')
    .select('product_id, category_id, is_primary, categories ( id, slug, name, meta_title, meta_description )')
    .eq('product_id', (data as any).id);

  if (pcData) (data as any).product_categories = pcData;

  return data as Product;
}

export async function getCategories() {
  const { data, error } = await supabase
    .from('categories')
    .select('*')
    .eq('active', true)
    .order('display_order');

  if (error) { console.error('Error fetching categories:', error); return []; }
  return (data as Category[]) || [];
}

export async function getBrands() {
  const { data, error } = await supabase
    .from('brands')
    .select('*')
    .eq('active', true)
    .order('display_order');

  if (error) { console.error('Error fetching brands:', error); return []; }
  return (data as Brand[]) || [];
}

export async function getSiteSetting(key: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('site_settings')
    .select('value')
    .eq('key', key)
    .maybeSingle();

  if (error) { console.error('Error fetching setting:', error); return null; }
  return data?.value || null;
}

// ── FASE 1B: Tarjetas de categoría por página de género ──

export interface GenderCategoryCard {
  id: string;
  gender: string;
  category_id: string | null;
  title: string | null;
  image_url: string | null;
  display_order: number;
  active: boolean;
  categories?: Category;
}

// Trae las tarjetas activas de un género, con su categoría
export async function getGenderCards(gender: string): Promise<GenderCategoryCard[]> {
  const { data, error } = await supabase
    .from('gender_category_cards')
    .select('*, categories ( id, slug, name )')
    .eq('gender', gender)
    .eq('active', true)
    .order('display_order', { ascending: true });
  if (error) { console.error('Error fetching gender cards:', error); return []; }
  return (data as GenderCategoryCard[]) || [];
}

// Trae TODAS las tarjetas (para el admin)
export async function getAllGenderCards(): Promise<GenderCategoryCard[]> {
  const { data, error } = await supabase
    .from('gender_category_cards')
    .select('*, categories ( id, slug, name )')
    .order('display_order', { ascending: true });
  if (error) { console.error('Error fetching all gender cards:', error); return []; }
  return (data as GenderCategoryCard[]) || [];
}

// ── Recomendaciones: productos seleccionados manualmente ──
export async function getRecommendedProductIds(): Promise<string[]> {
  const { data, error } = await supabase
    .from('recommended_products')
    .select('product_id, display_order')
    .order('display_order', { ascending: true });
  if (error) { console.error('Error fetching recommended:', error); return []; }
  return (data || []).map((r: any) => r.product_id).filter(Boolean);
}

// ── FASE 2: Productos recomendados ──

export interface RecommendedProduct {
  id: string;
  product_id: string | null;
  reason: string | null;
  display_order: number;
  active: boolean;
  products?: Product;
}

// Recomendados activos con su producto completo (para la página pública)
export async function getRecommended(): Promise<RecommendedProduct[]> {
  const { data, error } = await supabase
    .from('recommended_products')
    .select(`
      *,
      products (
        *,
        brands ( id, slug, name ),
        categories!products_category_id_fkey ( id, slug, name ),
        product_images ( id, color, url, alt_text, is_primary, display_order ),
        product_variants ( id, size, color, color_hex, color_hex_2, stock, active )
      )
    `)
    .eq('active', true)
    .order('display_order', { ascending: true });
  if (error) { console.error('Error fetching recommended:', error); return []; }
  return (data as RecommendedProduct[]) || [];
}

// ── FASE 3: Bloques promocionales ──

export interface PromoBlock {
  id: string;
  slot: string;
  active: boolean;
  eyebrow: string | null;
  title: string | null;
  subtitle: string | null;
  cta_label: string | null;
  cta_href: string | null;
  image_url: string | null;
  text_color: string | null;
  overlay: number | null;
}

export async function getPromoBlocks(): Promise<Record<string, PromoBlock>> {
  const { data, error } = await supabase.from('promo_blocks').select('*');
  if (error) { console.error('Error fetching promo blocks:', error); return {}; }
  const map: Record<string, PromoBlock> = {};
  (data || []).forEach((b: any) => { map[b.slot] = b; });
  return map;
}
