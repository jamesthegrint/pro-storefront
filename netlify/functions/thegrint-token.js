/**
 * Netlify Function: thegrint-token
 *
 * Exchanges a TheGrint OAuth PKCE authorization code for an access token,
 * then calls /v6/users/membership-status to verify PRO membership.
 * The membership endpoint resolves the user from the Bearer token — no email needed.
 *
 * Required env vars:
 *   THEGRINT_CLIENT_ID   TheGrint OAuth client ID
 *   REQUIRE_PRO_CHECK    Set to "true" to enforce PRO-only access
 */

const THEGRINT_BASE = 'https://api.thegrint.com';
const THEGRINT_CLIENT_ID = 'a23a91be-bc8e-4787-b1ac-275dc111cf33';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
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
  if (event.httpMethod !== 'POST') {
    return respond(405, { error: 'Method not allowed' });
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return respond(400, { error: 'Invalid request body' });
  }

  const { code, code_verifier, redirect_uri } = body;
  if (!code || !code_verifier || !redirect_uri) {
    return respond(400, { error: 'Missing required fields: code, code_verifier, redirect_uri' });
  }

  // Step 1: Exchange authorization code for access token
  const params = new URLSearchParams({
    client_id: THEGRINT_CLIENT_ID,
    redirect_uri,
    grant_type: 'authorization_code',
    code_verifier,
    code,
  });

  let tokenData;
  try {
    const tokenRes = await fetch(`${THEGRINT_BASE}/oauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: params.toString(),
    });

    const tokenText = await tokenRes.text();
    console.log('Token exchange status:', tokenRes.status, tokenText);

    if (!tokenRes.ok) {
      return respond(401, { error: 'Token exchange failed', detail: tokenText, step: 'token' });
    }

    tokenData = JSON.parse(tokenText);
  } catch (err) {
    console.error('Token exchange error:', err);
    return respond(502, { error: 'Failed to reach TheGrint API', step: 'token' });
  }

  const accessToken = tokenData.access_token;
  if (!accessToken) {
    return respond(401, { error: 'No access token returned', detail: JSON.stringify(tokenData), step: 'token' });
  }

  // Step 2: Check PRO membership — backend resolves user from Bearer token
  const requireProCheck = process.env.REQUIRE_PRO_CHECK === 'true';

  if (!requireProCheck) {
    console.log('PRO check bypassed — granting access');
    return respond(200, { isPro: true, accessToken, expiresIn: tokenData.expires_in });
  }

  let membershipData;
  try {
    const memberRes = await fetch(`${THEGRINT_BASE}/v6/users/membership-status`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    });

    const memberText = await memberRes.text();
    console.log('Membership status:', memberRes.status, memberText);

    if (!memberRes.ok) {
      return respond(401, { error: 'Membership check failed', detail: memberText, step: 'membership' });
    }

    membershipData = JSON.parse(memberText);
  } catch (err) {
    console.error('Membership fetch error:', err);
    return respond(502, { error: 'Failed to verify membership', step: 'membership' });
  }

  const isPro = membershipData?.data?.is_pro === true;
  console.log('is_pro:', isPro);

  return respond(200, { isPro, accessToken, expiresIn: tokenData.expires_in });
};
