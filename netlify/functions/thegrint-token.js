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
    console.error('No access_token in response:', tokenData);
    return respond(401, { error: 'No access token returned', detail: JSON.stringify(tokenData), step: 'token' });
  }

  // Step 2: Get user profile to retrieve email
  let email;
  try {
    const profileRes = await fetch(`${THEGRINT_BASE}/${API_VERSION}/users/current`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    });
    const profileText = await profileRes.text();
    console.log('Profile status:', profileRes.status, profileText);
    if (!profileRes.ok) {
      return respond(401, { error: 'Profile fetch failed', detail: profileText, step: 'profile' });
    }
    const profileData = JSON.parse(profileText);
    email = profileData?.data?.user?.email || profileData?.data?.email || profileData?.email;
  } catch (err) {
    console.error('Profile fetch error:', err);
    return respond(502, { error: 'Failed to fetch user profile', step: 'profile' });
  }

  if (!email) {
    return respond(500, { error: 'Could not find email in profile', step: 'profile' });
  }

  console.log('Checking membership for:', email);

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
  console.log('is_pro:', isPro, 'raw data:', JSON.stringify(membershipData?.data));

  return respond(200, {
    isPro,
    accessToken,
    expiresIn: tokenData.expires_in,
  });
};
