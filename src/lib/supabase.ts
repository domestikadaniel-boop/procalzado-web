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
      product_variants ( id, size, color, color_hex, stock, active )
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
      product_variants ( id, size, color, color_hex, stock, active )
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
