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
  meta_title: string | null;
  meta_description: string | null;
  active: boolean;
}

export interface Product {
  id: string;
  slug: string;
  name: string;
  brand_id: string | null;
  category_id: string | null;
  gender: string | null;
  short_description: string | null;
  description: string | null;
  price: number | null;
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
  product_images?: ProductImage[];
  product_variants?: ProductVariant[];
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
      categories ( id, slug, name ),
      product_images ( id, color, url, alt_text, is_primary, display_order ),
      product_variants ( id, size, color, color_hex, stock, active )
    `)
    .eq('active', true)
    .order('featured', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) { console.error('Error fetching products:', error); return []; }
  return (data as Product[]) || [];
}

export async function getProductBySlug(slug: string) {
  const { data, error } = await supabase
    .from('products')
    .select(`
      *,
      brands ( id, slug, name, logo_url ),
      categories ( id, slug, name, meta_title, meta_description ),
      product_images ( id, color, url, alt_text, is_primary, display_order ),
      product_variants ( id, size, color, color_hex, stock, active )
    `)
    .eq('slug', slug)
    .eq('active', true)
    .single();

  if (error) { console.error('Error fetching product:', error); return null; }
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
