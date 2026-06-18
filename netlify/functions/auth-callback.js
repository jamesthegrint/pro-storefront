/**
 * Netlify Function: auth-callback
 * Shopify redirects here after the user approves the OAuth install.
 * Exchanges the code for a permanent access token and displays it.
 *
 * Required env vars:
 *   SHOPIFY_CLIENT_ID      Your Partners app Client ID
 *   SHOPIFY_CLIENT_SECRET  Your Partners app Secret
 *   SHOPIFY_STORE_DOMAIN   e.g. af0140-2.myshopify.com
 */
exports.handler = async function (event) {
  const { SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET, SHOPIFY_STORE_DOMAIN } = process.env;
  const { code } = event.queryStringParameters || {};

  if (!code) {
    return { statusCode: 400, body: 'Missing code parameter' };
  }

  try {
    const res = await fetch(
      `https://${SHOPIFY_STORE_DOMAIN}/admin/oauth/access_token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: SHOPIFY_CLIENT_ID,
          client_secret: SHOPIFY_CLIENT_SECRET,
          code,
        }),
      }
    );

    const data = await res.json();
    const token = data.access_token;

    if (!token) {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'text/html' },
        body: `<pre>Error: ${JSON.stringify(data)}</pre>`,
      };
    }

    // Display the token — copy it into Netlify env vars as SHOPIFY_ADMIN_TOKEN
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/html' },
      body: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: monospace; background: #1a1f1c; color: #fff; padding: 40px; }
            h2 { color: #c9a84c; }
            .token { background: #2a322c; padding: 20px; border-radius: 8px; word-break: break-all;
                     border: 1px solid #c9a84c; font-size: 14px; margin: 16px 0; }
            .instructions { color: #aaa; font-size: 13px; line-height: 1.8; }
            button { background: #c9a84c; color: #1a1f1c; border: none; padding: 10px 20px;
                     border-radius: 6px; font-weight: bold; cursor: pointer; margin-top: 12px; }
          </style>
        </head>
        <body>
          <h2>✅ Token captured successfully</h2>
          <p class="instructions">Copy the token below and paste it into Netlify as <strong>SHOPIFY_ADMIN_TOKEN</strong>:</p>
          <div class="token" id="token">${token}</div>
          <button onclick="navigator.clipboard.writeText('${token}').then(() => this.textContent = 'Copied!')">
            Copy to clipboard
          </button>
          <p class="instructions" style="margin-top:24px">
            1. Go to <strong>Netlify → Site Settings → Environment Variables</strong><br>
            2. Edit <strong>SHOPIFY_ADMIN_TOKEN</strong> → paste this token → Save<br>
            3. Go to <strong>Deploys → Trigger deploy</strong><br>
            4. Done — you can close this page.
          </p>
        </body>
        </html>
      `,
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'text/html' },
      body: `<pre>Unexpected error: ${err.message}</pre>`,
    };
  }
};
