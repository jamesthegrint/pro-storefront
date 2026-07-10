/**
 * Netlify Function: get-products
 *
 * Uses Shopify Storefront API (GraphQL) to fetch products in collection
 * manual sort order — one query per collection, full product data included.
 *
 *   - proProducts:  collection handle "pro-storefront"      → 15% PRO discount
 *   - alsoProducts: collection handle "pro-storefront-full" → full price
 *
 * Required env vars:
 *   SHOPIFY_STORE_DOMAIN      e.g. af0140-2.myshopify.com
 *   SHOPIFY_STOREFRONT_TOKEN  Storefront API public access token
 *   SHOPIFY_ADMIN_TOKEN       Admin API token (shpat_...) — for bundle products
 */

const STOREFRONT_API_VERSION = '2024-04';
const ADMIN_API_VERSION = '2024-04';
const JUDGEME_API_TOKEN = 'lND8Xp-zV-RWnfGwYpq8106c37I';
const SHOP_DOMAIN = 'thegrint.shop';

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

const COLLECTION_QUERY = `
  query GetCollection($handle: String!) {
    collection(handle: $handle) {
      products(first: 50, sortKey: COLLECTION_DEFAULT) {
        edges {
          node {
            id
            title
            handle
            descriptionHtml
            tags
            images(first: 10) {
              edges { node { url } }
            }
            options { name }
            variants(first: 50) {
              edges {
                node {
                  id
                  title
                  priceV2 { amount }
                  selectedOptions { name value }
                  image { url }
                  availableForSale
                }
              }
            }
          }
        }
      }
    }
  }
`;

async function fetchCollection(handle, storefrontToken, domain) {
  const res = await fetch(
    `https://${domain}/api/${STOREFRONT_API_VERSION}/graphql.json`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Storefront-Access-Token': storefrontToken,
      },
      body: JSON.stringify({ query: COLLECTION_QUERY, variables: { handle } }),
    }
  );

  if (!res.ok) throw new Error(`Storefront API error: ${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error(json.errors[0].message);

  const products = json.data?.collection?.products?.edges || [];
  return products.map(({ node: p }) => {
    const variants = p.variants.edges.map(({ node: v }) => {
      const opt = (name) => v.selectedOptions.find(o => o.name.toLowerCase() === name.toLowerCase())?.value || null;
      return {
        id: parseInt(v.id.replace('gid://shopify/ProductVariant/', '')),
        label: v.title,
        option1: v.selectedOptions[0]?.value || null,
        option2: v.selectedOptions[1]?.value || null,
        option3: v.selectedOptions[2]?.value || null,
        price: parseFloat(v.priceV2.amount),
        available: v.availableForSale ?? true,
        image: v.image?.url || null,
      };
    });

    const images = p.images.edges.map(({ node: img }) => img.url);
    const mainImage = images[0] || '';
    const firstVariant = variants[0];
    const hasVariants = variants.length > 1;

    return {
      id: parseInt(p.id.replace('gid://shopify/Product/', '')),
      handle: p.handle,
      name: p.title,
      description: p.descriptionHtml || '',
      price: firstVariant?.price || 0,
      available: variants.some(v => v.available),
      image: mainImage,
      images,
      variantId: firstVariant?.id,
      variants: hasVariants ? variants : null,
      options: p.options.map(o => o.name),
    };
  });
}

async function fetchByTagAdmin(tag, domain, adminToken) {
  const res = await fetch(
    `https://${domain}/admin/api/${ADMIN_API_VERSION}/products.json?tag=${encodeURIComponent(tag)}&limit=50&status=active`,
    { headers: { 'X-Shopify-Access-Token': adminToken } }
  );
  if (!res.ok) return [];
  const data = await res.json();
  return data.products.filter(p =>
    p.tags.split(',').map(t => t.trim().toLowerCase()).includes(tag)
  ).map(p => {
    if (!p.variants?.length) return null;
    const firstVariant = p.variants[0];
    const imageById = {};
    p.images.forEach(img => { imageById[img.id] = img.src; });
    const mainImage = p.image?.src || p.images[0]?.src || '';
    const hasVariants = p.variants.length > 1;
    return {
      id: p.id,
      name: p.title,
      description: p.body_html || '',
      price: parseFloat(firstVariant.price),
      available: p.variants.some(v => !v.inventory_management || v.inventory_quantity > 0 || v.inventory_policy === 'continue'),
      image: mainImage,
      images: p.images.map(img => img.src),
      variantId: firstVariant.id,
      variants: hasVariants ? p.variants.map(v => ({
        id: v.id,
        label: v.title,
        option1: v.option1 || null,
        option2: v.option2 || null,
        option3: v.option3 || null,
        price: parseFloat(v.price),
        available: !v.inventory_management || v.inventory_quantity > 0 || v.inventory_policy === 'continue',
        image: v.image_id ? (imageById[v.image_id] || mainImage) : mainImage,
      })) : null,
      options: p.options.map(o => o.name),
    };
  }).filter(Boolean);
}

// Fetch Judge.me ratings for a list of products (by handle)
async function fetchRatings(products) {
  const results = await Promise.allSettled(
    products.map(async (p) => {
      if (!p.handle) return { id: p.id, rating: null, reviewCount: 0 };
      try {
        const url = `https://judge.me/api/v1/products/-1?url=https://${SHOP_DOMAIN}/products/${p.handle}&api_token=${JUDGEME_API_TOKEN}`;
        const res = await fetch(url);
        if (!res.ok) return { id: p.id, rating: null, reviewCount: 0 };
        const data = await res.json();
        console.log(`Judge.me [${p.handle}]:`, JSON.stringify(data.product));
        return {
          id: p.id,
          rating: data.product?.average_rating ?? null,
          reviewCount: data.product?.review_count ?? 0,
        };
      } catch {
        return { id: p.id, rating: null, reviewCount: 0 };
      }
    })
  );
  const map = {};
  results.forEach(r => { if (r.value) map[r.value.id] = r.value; });
  return map;
}

// Merge: keep Storefront order, append any products missing from it (e.g. bundles)
function mergeProducts(storefrontProducts, adminProducts) {
  const seen = new Set(storefrontProducts.map(p => p.id));
  const missing = adminProducts.filter(p => !seen.has(p.id));
  return [...storefrontProducts, ...missing];
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }

  const { SHOPIFY_STORE_DOMAIN, SHOPIFY_STOREFRONT_TOKEN, SHOPIFY_ADMIN_TOKEN } = process.env;
  if (!SHOPIFY_STORE_DOMAIN || !SHOPIFY_STOREFRONT_TOKEN || !SHOPIFY_ADMIN_TOKEN) {
    console.error('Missing env vars');
    return respond(500, { error: 'Server misconfiguration' });
  }

  try {
    // Fetch from both APIs in parallel
    const [proStorefront, alsoStorefront, proAdmin, alsoAdmin] = await Promise.all([
      fetchCollection('pro-storefront', SHOPIFY_STOREFRONT_TOKEN, SHOPIFY_STORE_DOMAIN),
      fetchCollection('pro-storefront-full', SHOPIFY_STOREFRONT_TOKEN, SHOPIFY_STORE_DOMAIN),
      fetchByTagAdmin('pro-storefront', SHOPIFY_STORE_DOMAIN, SHOPIFY_ADMIN_TOKEN),
      fetchByTagAdmin('pro-storefront-full', SHOPIFY_STORE_DOMAIN, SHOPIFY_ADMIN_TOKEN),
    ]);

    const proProducts  = mergeProducts(proStorefront, proAdmin);
    const alsoProducts = mergeProducts(alsoStorefront, alsoAdmin);
    const allProducts  = [...proProducts, ...alsoProducts];

    const ratings = await fetchRatings(allProducts);
    const attachRatings = (products) => products.map(p => ({
      ...p,
      rating: ratings[p.id]?.rating ?? null,
      reviewCount: ratings[p.id]?.reviewCount ?? 0,
    }));

    return respond(200, {
      proProducts:  attachRatings(proProducts),
      alsoProducts: attachRatings(alsoProducts),
    });
  } catch (err) {
    console.error('Unexpected error:', err);
    return respond(500, { error: 'Internal server error' });
  }
};
