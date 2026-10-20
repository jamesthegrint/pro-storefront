# PRO Storefront — Project Context

Last updated: 2026-10-13

## What this is
"TheGrint Shop PRO" — a members-only storefront (`index.html`, single-page vanilla JS/CSS,
~2000 lines) gated behind a TheGrint PRO-membership login. Deployed on Netlify at
`https://pro-storefront.netlify.app`. Backed by Netlify Functions that talk to two separate
external APIs: **TheGrint** (membership/auth) and **Shopify** (catalog, pricing, checkout).

## Architecture at a glance

```
Browser (index.html)
 ├─ TheGrint OAuth (PKCE) ──► thegrint-token.js ──► api.thegrint.com
 │                                                   (/oauth/token, /v6/users/membership-status)
 ├─ Product listing ────────► get-products.js ─────► Shopify Storefront API (GraphQL)
 │                                               └──► Shopify Admin API (tag fallback)
 │                                               └──► judge.me (reviews)
 ├─ Discount code mint ──────► get-discount.js ────► Shopify Admin API (price_rules)
 └─ Checkout ─────────────────► create-checkout.js ─► Shopify Admin API (draft_orders)

(One-time setup only)
auth.js / auth-callback.js — Shopify Partners-app OAuth install flow, used ONCE to mint
the static SHOPIFY_ADMIN_TOKEN that get-products/get-discount/create-checkout use.
Not part of the customer-facing flow.
```

## Two separate auth systems — don't confuse them
1. **Shopify Admin OAuth** (`auth.js` → `auth-callback.js`)
   Visited manually by the dev to generate a permanent `SHOPIFY_ADMIN_TOKEN`, then pasted
   into Netlify env vars. Not used at runtime by customers.
2. **TheGrint PRO membership OAuth** (`index.html` PKCE flow → `thegrint-token.js`)
   What gates every customer visit. This is the one relevant to "why can't I log in" issues.

## TheGrint PRO-membership login flow (customer-facing)
- Client ID: `a23a91be-bc8e-4787-b1ac-275dc111cf33` (hardcoded in both `index.html` and
  `thegrint-token.js`)
- Authorize URL: `https://api.thegrint.com/oauth/authorize`, scope `basic-user`
- Redirect URI: `https://pro-storefront.netlify.app` (top-level; handles both popup and
  non-popup/iframe cases — see `index.html` boot() around line 1940)
- PKCE: code_verifier/state stored in both `localStorage` and `sessionStorage` (redundant
  on purpose — Safari ITP blocks cross-site iframe localStorage writes, so when the
  storefront is embedded in an iframe it first navigates `window.top` to its own page with
  `?oauth_start=1` to regenerate PKCE as first-party before redirecting to TheGrint)
- Token exchange + membership check happen server-side in `thegrint-token.js`:
  1. POST `/oauth/token` with code + code_verifier → `access_token`
  2. GET `/v6/users/membership-status` with `Authorization: Bearer <access_token>` →
     `is_pro` boolean used to gate access
  3. `isPro` is **only** `membershipData.data.is_pro === true` — nothing else (no tour
     type, no expiration date) factors into the check currently.
- Known rough edge: there's a `// TODO: Tighten this check once TheGrint confirms the PRO
  membership field` comment at index.html:1882 — the `is_pro` field mapping has not been
  fully confirmed against TheGrint's real response shape.
- `REQUIRE_PRO_CHECK` env var — if not set to `"true"`, the PRO check is bypassed entirely
  and all authenticated users pass (`thegrint-token.js:89-94`).

## Known issues / open threads (as of this conversation)
- **"Members Only" shown despite account appearing PRO in TheGrint's own records.**
  The gate only trusts live `is_pro` from `/v6/users/membership-status` — if TheGrint's
  response shape doesn't match `data.is_pro` exactly, or if a "Tour" membership type isn't
  reflected in that field, valid PRO users get rejected. Need to capture the raw
  `membershipData` JSON (logged server-side at `thegrint-token.js:107`) to confirm.
- **Intermittent `{"message":"General Error","error_code":"server_error"}`** seen directly
  on `api.thegrint.com` in mobile Safari — this is TheGrint's raw API response, not
  something produced by this codebase. Appears to be an upstream TheGrint instability
  (possibly during `/oauth/authorize`, `/oauth/token`, or `/v6/users/membership-status`).
  Not fixable from this repo; needs the exact failing URL/endpoint to narrow down.

## Cart handoff contract (`tg_cart`)

Lets a theme forward the customer's main-store cart into this app so they don't
have to rebuild it after logging in. Implemented on the `feature/pro-cart-handoff`
branch (not yet merged/deployed) — dormant on `main` until a theme actually sends it.

- **Param:** `tg_cart=variantId:qty,variantId:qty,...` (plain Shopify numeric variant
  IDs, comma-separated pairs, colon-separated id:qty).
- **Entry point:** appended to the `/pages/pro-members-only` URL (e.g. from a cart-page
  "Unlock PRO pricing" link that reads `/cart.js` and builds the param). That page's
  embed script must forward `tg_cart` into the iframe `src` exactly the way it already
  forwards `tg_token`/`tg_expires`.
- **Round trip:** this app captures `tg_cart` into `localStorage` (`tg_pending_cart`) on
  boot, before any OAuth redirect. `handleCallback()` re-attaches it to the
  `tg_return_to` redirect so the Page gets it back alongside `tg_token`/`tg_expires`
  and can re-embed the iframe with all three.
- **Matching:** once products load, each variant ID is matched against the curated
  `pro-storefront`/`pro-storefront-full` catalogs. Matches are added to the cart
  (with the correct discounted/full-price flag) and the drawer opens automatically.
  Unmatched variants (not in either curated collection) are silently skipped and
  surfaced only in a toast count — they are never added at the wrong price.
- **Theme-agnostic by design:** the receiving logic doesn't care which theme sent the
  param, so this is also the intended switch-over path for the draft "TheGrint Shop
  2026 (WIP)" theme — its `snippets/tg-cart-extras.liquid` already has a `handoff_live`
  flag (currently `false`) anticipating this exact contract.
- **Sending side (live Dawn theme + `/pages/pro-members-only`):** drafted but not yet
  applied — Shopify Admin writes aren't pushed from here automatically. The exact
  files to paste in are in [`live-theme-patches/`](live-theme-patches/README.md).

## Netlify Functions reference

| Function | Purpose | Key env vars |
|---|---|---|
| `auth.js` | Kicks off Shopify Partners OAuth (one-time setup) | `SHOPIFY_CLIENT_ID`, `SHOPIFY_STORE_DOMAIN` |
| `auth-callback.js` | Exchanges Shopify OAuth code → displays Admin token to copy into env vars | `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET`, `SHOPIFY_STORE_DOMAIN` |
| `thegrint-token.js` | TheGrint PKCE token exchange + PRO membership check | `THEGRINT_CLIENT_ID` (hardcoded), `REQUIRE_PRO_CHECK` |
| `get-products.js` | Fetches products from two Shopify collections (`pro-storefront`, `pro-storefront-full`) via Storefront GraphQL + Admin API tag fallback; merges in Judge.me ratings | `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_STOREFRONT_TOKEN`, `SHOPIFY_ADMIN_TOKEN` |
| `get-discount.js` | Mints single-use 15% discount codes (`TGP-XXXXXXXX`) under a pre-created Price Rule | `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_ADMIN_TOKEN`, `SHOPIFY_PRICE_RULE_ID` |
| `create-checkout.js` | Creates a Shopify Draft Order with PRO discount applied directly (no visible code); returns `invoice_url` | `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_ADMIN_TOKEN` |

## Product/pricing logic (frontend, `index.html`)
- Products tagged `pro-storefront` → shown in PRO discounted section.
- Products tagged `pro-storefront-full` → shown in "Also in the Shop" (full price) section.
- Per-product discount override via tag `prodiscount-NN` (e.g. `prodiscount-20` → 20% off);
  falls back to `DEFAULT_DISCOUNT = 15` if no such tag.
- Country/currency selector: `US` (USD), `GB` (GBP), `CA` (CAD) in the UI dropdown
  (`COUNTRY_CONFIG`), though `get-products.js` also recognizes `MX` (MXN) server-side.
  Each country has its own free-shipping threshold (`freeShippingLocal`), all pegged to a
  $175 USD equivalent.
- Discount is applied two ways depending on flow: `get-discount.js` mints a code, while
  `create-checkout.js` applies the discount directly on draft-order line items (used by the
  main checkout path — no visible discount code to the customer).

## Security notes (observed, not yet actioned)
- `THEGRINT_CLIENT_ID` is hardcoded in both `index.html` and `thegrint-token.js` (not an
  env var) — low risk since OAuth client IDs for PKCE flows are not secret, but worth
  knowing it's not configurable without a code change.
- `JUDGEME_PRIVATE_TOKEN` is hardcoded directly in `get-products.js` (line 18) and committed
  to git. This one *is* a credential and is currently exposed in source control.

## Related repos (not detailed here — see memory)
- `grint-returns-flow` — separate custom-app returns flow project.
- `grint-shopify-app` — likely the source of the Shopify custom-app OAuth pattern reused in
  `auth.js`/`auth-callback.js` here.
- `grint-engraving-queue` — unrelated engraving order queue tool.
