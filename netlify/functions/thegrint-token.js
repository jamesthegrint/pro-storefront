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
const API_VERSION = 'V6';

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

  // Step 2: Decode JWT to extract the user's email (payload is base64url, no signature verification needed here)
  let email;
  try {
    const payload = JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64').toString('utf8'));
    email = payload.email || payload.sub;
  } catch (err) {
    console.error('JWT decode error:', err);
    return respond(500, { error: 'Failed to decode access token' });
  }

  if (!email) {
    console.error('No email in JWT payload');
    return respond(500, { error: 'Could not determine user email from token' });
  }

  // Step 3: Check PRO membership status
  let membershipData;
  try {
    const memberRes = await fetch(
      `${THEGRINT_BASE}/${API_VERSION}/users/membership-status?email=${encodeURIComponent(email)}`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
      }
    );

    if (!memberRes.ok) {
      console.error('Membership check failed:', memberRes.status);
      return respond(401, { error: 'Membership verification failed' });
    }

    membershipData = await memberRes.json();
  } catch (err) {
    console.error('Membership fetch error:', err);
    return respond(502, { error: 'Failed to verify membership' });
  }

  const isPro = membershipData?.data?.is_pro === true;

  return respond(200, {
    isPro,
    accessToken,
    expiresIn: tokenData.expires_in,
  });
};
