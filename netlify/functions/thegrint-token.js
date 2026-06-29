/**
 * Netlify Function: thegrint-token
 *
 * Exchanges a TheGrint OAuth PKCE authorization code for an access token,
 * then calls /V4/users/current to verify the user is authenticated.
 *
 * Required env vars:
 *   THEGRINT_CLIENT_ID   TheGrint OAuth client ID
 */

const THEGRINT_BASE = 'https://api-sandbox.thegrint.com';
const API_VERSION = 'V4';

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

  const { THEGRINT_CLIENT_ID } = process.env;
  if (!THEGRINT_CLIENT_ID) {
    console.error('Missing THEGRINT_CLIENT_ID env var');
    return respond(500, { error: 'Server misconfiguration' });
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

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      console.error('Token exchange failed:', tokenRes.status, err);
      return respond(401, { error: 'Token exchange failed' });
    }

    tokenData = await tokenRes.json();
  } catch (err) {
    console.error('Token exchange error:', err);
    return respond(502, { error: 'Failed to reach TheGrint API' });
  }

  const accessToken = tokenData.access_token;
  if (!accessToken) {
    console.error('No access_token in response:', tokenData);
    return respond(401, { error: 'Authentication failed' });
  }

  // Step 2: Verify user profile
  let userData;
  try {
    const userRes = await fetch(`${THEGRINT_BASE}/${API_VERSION}/users/current`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    });

    if (!userRes.ok) {
      console.error('User verification failed:', userRes.status);
      return respond(401, { error: 'User verification failed' });
    }

    userData = await userRes.json();
  } catch (err) {
    console.error('User fetch error:', err);
    return respond(502, { error: 'Failed to verify user' });
  }

  // Check PRO membership status.
  // TODO: Confirm exact field name with TheGrint team once /V4/users/current
  //       200 response schema is documented. Update the isPro check below.
  //       Common candidates: user.isPro, user.is_pro, user.membershipType === 'pro'
  const user = userData.data || userData;
  const isPro =
    user.isPro === true ||
    user.is_pro === true ||
    user.proMember === true ||
    (typeof user.membershipType === 'string' && user.membershipType.toLowerCase() === 'pro') ||
    (typeof user.membership === 'string' && user.membership.toLowerCase() === 'pro');

  return respond(200, {
    isPro,
    accessToken,
    expiresIn: tokenData.expires_in,
  });
};
