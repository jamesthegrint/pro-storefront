/**
 * Netlify Function: get-products
 *
 * Returns two product lists:
 *   - proProducts:  tagged "pro-storefront"      → shown with 15% PRO discount
 *   - alsoProducts: tagged "pro-storefront-full" → shown at full price
 *
 * Tag products in Shopify Admin → Products → Tags.
 *
 * Required env vars:
 *   SHOPIFY_STORE_DOMAIN   e.g. af0140-2.myshopify.com
 *   SHOPIFY_ADMIN_TOKEN    Admin API access token (shpat_...)
 */

const SHOPIFY_API_VERSION = '2024-04';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function respond(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
    body: JSON.stringify(body),
  };
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }

  const { SHOPIFY_STORE_DOMAIN, SHOPIFY_ADMIN_TOKEN } = process.env;
  if (!SHOPIFY_STORE_DOMAIN || !SHOPIFY_ADMIN_TOKEN) {
    console.error('Missing env vars');
    return respond(500, { error: 'Server misconfiguration' });
  }

  try {
    const fetchTag = async (tag) => {
      const url = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/products.json?tag=${encodeURIComponent(tag)}&limit=50&status=active`;
      const res = await fetch(url, { headers: { 'X-Shopify-Access-Token': SHOPIFY_ADMIN_TOKEN } });
      if (!res.ok) throw new Error(`Shopify ${res.status}`);
      const data = await res.json();
      return data.products.filter(p =>
        p.tags.split(',').map(t => t.trim().toLowerCase()).includes(tag)
      );
    };

    const [proRaw, alsoRaw] = await Promise.all([
      fetchTag('pro-storefront'),
      fetchTag('pro-storefront-full'),
    ]);

    const mapProduct = (p) => {
      const firstVariant = p.variants[0];
      const hasVariants = p.variants.length > 1;

      // Build image lookup by image_id for variant-specific images
      const imageById = {};
      p.images.forEach(img => { imageById[img.id] = img.src; });
      const mainImage = p.image?.src || p.images[0]?.src || '';

      let variants = null;
      if (hasVariants) {
        variants = p.variants.map(v => ({
          id: v.id,
          label: v.title,
          option1: v.option1 || null,
          option2: v.option2 || null,
          option3: v.option3 || null,
          price: parseFloat(v.price),
          available: !v.inventory_management || v.inventory_quantity > 0 || v.inventory_policy === 'continue',
          image: v.image_id ? (imageById[v.image_id] || mainImage) : mainImage,
        }));
      }

      return {
        id: p.id,
        name: p.title,
        description: p.body_html || '',
        price: parseFloat(firstVariant.price),
        available: p.variants.some(v => !v.inventory_management || v.inventory_quantity > 0 || v.inventory_policy === 'continue'),
        image: mainImage,
        images: p.images.map(img => img.src),
        variantId: firstVariant.id,
        variants,
        options: p.options.map(o => o.name),
      };
    };

    const proProducts  = proRaw.map(mapProduct);
    const alsoProducts = alsoRaw.map(mapProduct);

    return respond(200, { proProducts, alsoProducts });
  } catch (err) {
    console.error('Unexpected error:', err);
    return respond(500, { error: 'Internal server error' });
  }
};
