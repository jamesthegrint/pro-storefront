/**
 * Netlify Function: auth
 * Kicks off the Shopify OAuth flow.
 * Visit: https://pro-storefront.netlify.app/.netlify/functions/auth
 *
 * Required env vars:
 *   SHOPIFY_CLIENT_ID      Your Partners app Client ID
 *   SHOPIFY_STORE_DOMAIN   e.g. af0140-2.myshopify.com
 */
exports.handler = async function (event) {
  const { SHOPIFY_CLIENT_ID, SHOPIFY_STORE_DOMAIN } = process.env;

  const redirectUri = 'https://pro-storefront.netlify.app/.netlify/functions/auth-callback';
  const scopes = 'write_draft_orders,read_draft_orders,write_discounts,read_discounts';

  const authUrl =
    `https://${SHOPIFY_STORE_DOMAIN}/admin/oauth/authorize` +
    `?client_id=${SHOPIFY_CLIENT_ID}` +
    `&scope=${scopes}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}`;

  return {
    statusCode: 302,
    headers: { Location: authUrl },
    body: '',
  };
};
