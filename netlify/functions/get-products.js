/**
 * Netlify Function: get-products
 *
 * Returns two product lists ordered by Shopify collection manual sort:
 *   - proProducts:  collection "pro-storefront"      → shown with 15% PRO discount
 *   - alsoProducts: collection "pro-storefront-full" → shown at full price
 *
 * Tags are used as a secondary filter — a product must have the matching tag
 * AND be in the collection to appear. This lets you control order via the
 * collection's drag-to-reorder and control visibility via tags.
 *
 * Setup in Shopify Admin:
 *   1. Products → Collections → Create collection
 *      - Title: "PRO Storefront", Handle: pro-storefront, Sort: Manual
 *   2. Create another: "PRO Storefront Full", Handle: pro-storefront-full, Sort: Manual
 *   3. Add products to each collection and drag to desired order
 *   4. Also tag each product with the matching tag (pro-storefront / pro-storefront-full)
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

const shopifyFetch = (path, token) =>
  fetch(`https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}${path}`, {
    headers: { 'X-Shopify-Access-Token': token },
  });

async function getCollectionId(handle, token) {
  // custom_collections covers manually-sorted collections
  const res = await shopifyFetch(`/custom_collections.json?handle=${handle}&limit=1`, token);
  if (res.ok) {
    const data = await res.json();
    if (data.custom_collections?.length) return data.custom_collections[0].id;
  }
  return null;
}

async function fetchByCollection(handle, tag, token) {
  try {
    const collectionId = await getCollectionId(handle, token);
    if (collectionId) {
      const res = await shopifyFetch(
        `/collections/${collectionId}/products.json?limit=50`,
        token
      );
      if (res.ok) {
        const data = await res.json();
        const filtered = data.products.filter(p =>
          p.tags.split(',').map(t => t.trim().toLowerCase()).includes(tag)
        );
        if (filtered.length > 0) return filtered;
      }
    }
  } catch (err) {
    console.warn(`Collection fetch failed for "${handle}":`, err.message);
  }

  // Fallback: fetch by tag only
  console.warn(`Falling back to tag-only fetch for "${tag}"`);
  const res = await shopifyFetch(
    `/products.json?tag=${encodeURIComponent(tag)}&limit=50&status=active`,
    token
  );
  if (!res.ok) throw new Error(`Shopify tag fetch failed: ${res.status}`);
  const data = await res.json();
  return data.products.filter(p =>
    p.tags.split(',').map(t => t.trim().toLowerCase()).includes(tag)
  );
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
    // Sequential to avoid hitting Shopify's rate limit (429)
    const proRaw   = await fetchByCollection('pro-storefront', 'pro-storefront', SHOPIFY_ADMIN_TOKEN);
    const alsoRaw  = await fetchByCollection('pro-storefront-full', 'pro-storefront-full', SHOPIFY_ADMIN_TOKEN);

    const mapProduct = (p) => {
      const firstVariant = p.variants[0];
      const hasVariants = p.variants.length > 1;

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

    return respond(200, {
      proProducts:  proRaw.map(mapProduct),
      alsoProducts: alsoRaw.map(mapProduct),
    });
  } catch (err) {
    console.error('Unexpected error:', err);
    return respond(500, { error: 'Internal server error' });
  }
};
