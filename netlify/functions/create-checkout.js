/**
 * Netlify Function: create-checkout
 *
 * Creates a Shopify Draft Order with a 15% PRO Member discount
 * applied directly — no discount code, no code visible anywhere.
 * Returns a one-time invoice_url (the checkout link).
 *
 * Required env vars (Netlify → Site Settings → Environment Variables):
 *   SHOPIFY_STORE_DOMAIN   e.g. af0140-2.myshopify.com
 *   SHOPIFY_ADMIN_TOKEN    Admin API access token (shpat_...)
 */

const SHOPIFY_API_VERSION = '2024-04';

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(), body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return respond(405, { error: 'Method not allowed' });
  }

  const { SHOPIFY_STORE_DOMAIN, SHOPIFY_ADMIN_TOKEN } = process.env;
  if (!SHOPIFY_STORE_DOMAIN || !SHOPIFY_ADMIN_TOKEN) {
    console.error('Missing env vars');
    return respond(500, { error: 'Server misconfiguration' });
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return respond(400, { error: 'Invalid request body' });
  }

  const { items } = body; // [{ variantId, quantity }, ...]
  if (!items || !items.length) {
    return respond(400, { error: 'No items provided' });
  }

  const lineItems = items.map(({ variantId, quantity }) => ({
    variant_id: variantId,
    quantity,
  }));

  const draftOrder = {
    line_items: lineItems,
    applied_discount: {
      description: 'PRO Member Discount',
      value_type: 'percentage',
      value: '15.0',
      title: 'PRO Member Discount',
      amount: null, // Shopify calculates this
    },
    use_customer_default_address: false,
  };

  try {
    const url = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/draft_orders.json`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': SHOPIFY_ADMIN_TOKEN,
      },
      body: JSON.stringify({ draft_order: draftOrder }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('Shopify Draft Order error:', res.status, err);
      return respond(502, { error: 'Failed to create checkout' });
    }

    const data = await res.json();
    const invoiceUrl = data.draft_order?.invoice_url;

    if (!invoiceUrl) {
      return respond(502, { error: 'No checkout URL returned' });
    }

    return respond(200, { checkoutUrl: invoiceUrl });

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
