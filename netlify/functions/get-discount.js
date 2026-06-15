/**
 * Netlify Function: get-discount
 *
 * Mints a single-use 15% discount code via the Shopify Admin API
 * under a pre-created Price Rule, then returns it to the frontend.
 *
 * Required environment variables (set in Netlify → Site Settings → Env Variables):
 *   SHOPIFY_STORE_DOMAIN   e.g.  thegrint.myshopify.com
 *   SHOPIFY_ADMIN_TOKEN    Admin API access token (keep secret — never in frontend)
 *   SHOPIFY_PRICE_RULE_ID  Numeric ID of your "PRO 15% off" price rule
 */

const SHOPIFY_API_VERSION = '2024-04';

export async function handler(event) {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: corsHeaders(),
      body: '',
    };
  }

  if (event.httpMethod !== 'POST') {
    return respond(405, { error: 'Method not allowed' });
  }

  const { SHOPIFY_STORE_DOMAIN, SHOPIFY_ADMIN_TOKEN, SHOPIFY_PRICE_RULE_ID } = process.env;

  if (!SHOPIFY_STORE_DOMAIN || !SHOPIFY_ADMIN_TOKEN || !SHOPIFY_PRICE_RULE_ID) {
    console.error('Missing required environment variables');
    return respond(500, { error: 'Server misconfiguration' });
  }

  try {
    // Generate a random single-use code: TGP-XXXXXXXX
    const randomSuffix = Math.random().toString(36).substring(2, 10).toUpperCase();
    const code = `TGP-${randomSuffix}`;

    const url = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/price_rules/${SHOPIFY_PRICE_RULE_ID}/discount_codes.json`;

    const shopifyRes = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': SHOPIFY_ADMIN_TOKEN,
      },
      body: JSON.stringify({ discount_code: { code } }),
    });

    if (!shopifyRes.ok) {
      const err = await shopifyRes.text();
      console.error('Shopify API error:', shopifyRes.status, err);
      return respond(502, { error: 'Failed to generate discount code' });
    }

    const data = await shopifyRes.json();
    const discountCode = data.discount_code?.code;

    if (!discountCode) {
      return respond(502, { error: 'Unexpected response from Shopify' });
    }

    return respond(200, { code: discountCode });

  } catch (err) {
    console.error('Unexpected error:', err);
    return respond(500, { error: 'Internal server error' });
  }
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function respond(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    body: JSON.stringify(body),
  };
}
