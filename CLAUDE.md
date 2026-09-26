# Procalzado Web — Instrucciones para Claude

## ⚠️ REGLAS CRÍTICAS — LEER ANTES DE HACER CUALQUIER CAMBIO

### MercadoLibre — NO borrar conexiones
**NUNCA elimines ni pongas a NULL los campos `ml_item_id` o `ml_variation_id` de la tabla `product_variants`.**

Estos campos conectan cada variante del inventario con su publicación en MercadoLibre. Si se borran:
- El stock en ML deja de sincronizarse
- Las ventas de ML no descontarán del inventario
- Habrá sobreventa y daño a la reputación del vendedor

Si necesitas limpiar datos "huérfanos" de ML, primero verifica que la publicación en ML ya no exista. Nunca hagas `UPDATE product_variants SET ml_item_id = NULL` en bulk.

### Inventario — NO reducir stock sin confirmación explícita
**NUNCA descontes, elimines ni modifiques el stock (`stock_almacen`) sin que el usuario lo pida explícitamente.**

Si el usuario dice "bórralo" en el contexto del inventario, interpretar como poner el stock a 0, no eliminar la fila.

---

## Arquitectura

- **Frontend**: Astro 6 (SSR via Cloudflare Workers) — deploy en Cloudflare Pages
- **Backend**: Supabase (PostgreSQL)
- **Pagos**: Wompi
- **Marketplace**: MercadoLibre Colombia

## MercadoLibre — cómo funciona

### Token
El token se guarda en la tabla `ml_credentials` y se auto-refresca en cada uso (`src/lib/mercadolibre.ts`). El refresh_token dura 6 meses. **No se necesita intervención manual mientras haya ventas en ML al menos cada 6 meses.**

Si el token expira por completo (sin actividad en 6 meses), ir a `https://procalzado.com/api/ml/auth` para re-autorizar.

### Webhook
- URL: `https://procalzado.com/api/webhooks/ml`
- Topic: `orders_v2`
- Permiso requerido en ML Developer Center: "Venta y envios de un producto" → Lectura y escritura
- Al recibir una orden `paid`: descuenta stock, registra en `inventory_movements`, actualiza ML

### Sync de stock
- Items planos (sin variaciones): `PUT /items/{ml_item_id}` con `available_quantity`
- Items con variaciones (ej: Ipanema): `PUT /items/{ml_item_id}/variations/{ml_variation_id}` con `available_quantity`
- La función `syncVariantToML` en `src/lib/mercadolibre.ts` maneja ambos casos automáticamente

### Conexiones activas
- **344 variantes** vinculadas a ML (campo `ml_item_id` en `product_variants`)
- Las 2000+ variantes restantes son de productos que no están publicados en ML — es correcto que no tengan `ml_item_id`
