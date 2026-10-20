# Live theme patches (not deployed via git/Netlify)

These mirror the live Shopify theme's file paths and are meant to be pasted
directly into Shopify Admin — they are **not** part of this repo's build or
deploy pipeline:

- `pages/pro-members-only.html` → Online Store → Pages → "PRO Members Only" → edit body
- `snippets/cart-drawer.liquid` → Theme Code Editor → full replacement
- `sections/main-cart-footer.liquid` → Theme Code Editor → full replacement

Each only adds `tg_cart` forwarding on top of the current live content —
verified diff-clean against the live originals before being written here.
See "Cart handoff contract" in [`../CONTEXT.md`](../CONTEXT.md) for the full
design. Safe to apply independently of (before or after) merging
`feature/pro-cart-handoff` to `main` — the two sides degrade gracefully
until both are live.

## Native cart drawer upgrade (free shipping bar + recommendations)

Built so the live store can drop the third-party "Wizz" cart drawer app and
use Dawn's own `<cart-drawer>` instead (it's already present in the DOM,
just overridden/hidden by that app).

- `snippets/cart-drawer.liquid` → same file as above; this revision adds a
  free-shipping progress bar (pure Liquid, $175 USD threshold hardcoded —
  **not currency-converted for GBP/CAD**) and a recommendations placeholder,
  on top of the `tg_cart` forwarding
- `sections/cart-drawer-recommendations.liquid` → **new file**, add via
  Theme Code Editor → Add a new section. Only ever rendered through the
  Product Recommendations API, never as a real section
- `assets/cart-recommendations.js` → **new file**, add via Theme Code Editor
  → Add a new asset. Fetches recommendations for the most recently added
  item and hooks the theme's actual `cart.js`/`pubsub.js` update events
  (read from the live source, not guessed) so it refreshes correctly after
  quantity changes and new adds

Rollout order: apply all four cart-drawer-related files first, then disable
the Wizz app, then test live (add item → check progress bar + recs show →
change quantity → confirm recs refresh). Re-enabling Wizz is instant if
anything looks wrong — no data loss risk either way.

**Known app conflict:** the actual app causing stale cart-drawer content on
add-to-cart is **Snap Cart Drawer** (`shopify://apps/snap-cart-drawer`) — its
app embed block was found still `"disabled": false` in
`config/settings_data.json` even after the visible popup was turned off.
Disable it from Theme Customize → App embeds, not just the Apps list.

Recommendations render as a horizontal swipe row (CSS `scroll-snap`, no JS)
capped to roughly one item's height, so they never push cart contents off
the visible area on mobile.
