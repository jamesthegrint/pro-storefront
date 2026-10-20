/**
 * Populates the "You may also like" block in the cart drawer via Shopify's
 * native product recommendations endpoint (routes.product_recommendations_url),
 * based on the most recently added cart item.
 *
 * Hooks two places the drawer's content gets replaced wholesale:
 *  - the native pubsub cart-update event (quantity changes, from cart.js)
 *  - a MutationObserver on <cart-drawer> (catches the add-to-cart path, which
 *    replaces #CartDrawer's innerHTML directly rather than publishing an event)
 */
(function () {
  function fetchRecommendations(container) {
    const productId = container.dataset.productId;
    const baseUrl = container.dataset.recommendationsUrl;
    const resultsEl = container.querySelector('.cart-drawer-recommendations__results');
    if (!productId || !baseUrl || !resultsEl) return;
    container.dataset.loaded = 'true';

    const url = `${baseUrl}?section_id=cart-drawer-recommendations&product_id=${encodeURIComponent(productId)}&limit=4&intent=related`;

    fetch(url)
      .then((res) => res.text())
      .then((html) => {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const fresh = doc.querySelector('.cart-drawer-recommendations__results');
        if (fresh) resultsEl.innerHTML = fresh.innerHTML;
      })
      .catch((e) => console.error('[cart-recommendations] fetch failed:', e));
  }

  function checkAndLoad() {
    document.querySelectorAll('.cart-drawer-recommendations[data-loaded="false"]').forEach(fetchRecommendations);
  }

  function addRecommendedItem(button) {
    const variantId = button.dataset.variantId;
    if (!variantId) return;
    button.disabled = true;

    const cartUrl = (window.routes && window.routes.cart_url) || '/cart';

    fetch('/cart/add.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ id: variantId, quantity: 1 }] }),
    })
      .then((res) => {
        if (!res.ok) throw new Error('add failed');
        // Deliberately NOT using cart-drawer-items.onCartUpdate() here — it only
        // swaps the items list and .cart-drawer__footer (totals), which misses
        // the shipping bar and this recommendations block entirely (both live
        // outside those two pieces). Replacing .drawer__inner wholesale matches
        // what quantity changes and page-level add-to-cart already do correctly.
        return fetch(`${cartUrl}?section_id=cart-drawer`);
      })
      .then((res) => res.text())
      .then((html) => {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const freshInner = doc.querySelector('.drawer__inner');
        const currentInner = document.querySelector('#CartDrawer .drawer__inner');
        if (freshInner && currentInner) {
          currentInner.innerHTML = freshInner.innerHTML;
        }
      })
      .catch((e) => {
        console.error('[cart-recommendations] add failed:', e);
        button.disabled = false;
      });
  }

  document.addEventListener('click', (event) => {
    const button = event.target.closest('.cart-drawer-recommendations__add');
    if (button) addRecommendedItem(button);
  });

  // Native Dawn pubsub (assets/pubsub.js, assets/constants.js) — plain globals,
  // not ES module exports, so this is safe to call directly once both have loaded.
  if (typeof subscribe === 'function' && typeof PUB_SUB_EVENTS !== 'undefined') {
    subscribe(PUB_SUB_EVENTS.cartUpdate, () => setTimeout(checkAndLoad, 50));
  }

  const drawer = document.querySelector('cart-drawer');
  if (drawer) {
    const observer = new MutationObserver(() => checkAndLoad());
    observer.observe(drawer, { childList: true, subtree: true });
  }

  checkAndLoad();
})();
