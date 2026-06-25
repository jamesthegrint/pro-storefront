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
 */

const STOREFRONT_API_VERSION = '2024-04';

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
                  quantityAvailable
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
        available: v.availableForSale,
        image: v.image?.url || null,
      };
    });

    const images = p.images.edges.map(({ node: img }) => img.url);
    const mainImage = images[0] || '';
    const firstVariant = variants[0];
    const hasVariants = variants.length > 1;

    return {
      id: parseInt(p.id.replace('gid://shopify/Product/', '')),
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

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }

  const { SHOPIFY_STORE_DOMAIN, SHOPIFY_STOREFRONT_TOKEN } = process.env;
  if (!SHOPIFY_STORE_DOMAIN || !SHOPIFY_STOREFRONT_TOKEN) {
    console.error('Missing env vars');
    return respond(500, { error: 'Server misconfiguration' });
  }

  try {
    const [proProducts, alsoProducts] = await Promise.all([
      fetchCollection('pro-storefront', SHOPIFY_STOREFRONT_TOKEN, SHOPIFY_STORE_DOMAIN),
      fetchCollection('pro-storefront-full', SHOPIFY_STOREFRONT_TOKEN, SHOPIFY_STORE_DOMAIN),
    ]);

    return respond(200, { proProducts, alsoProducts });
  } catch (err) {
    console.error('Unexpected error:', err);
    return respond(500, { error: 'Internal server error' });
  }
};
