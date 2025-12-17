(function () {
  window.BL = window.BL || {};
  const BL = window.BL;

  // Toggle logs via ?cart_guard_debug=1
  const debug = (() => {
    try { return new URL(location.href).searchParams.get('cart_guard_debug') === '1'; }
    catch (e) { return false; }
  })();
  const log = (...a) => { if (debug) console.log('[BL:stable]', ...a); };

  const DRAWER_QUIET_MS = 300;
  const STABLE_DELAY_MS = 150;
  const INTERNAL_HEADER = 'X-BL-CART-GUARD';
  const INTERNAL_HEADER_VALUE = '1';

  // Cart request tracking
  let inFlight = 0;
  let stableTimer = null;

  // Only emit stable after a real cart mutation finishes
  let pendingCartUpdate = false;
  let pendingExpireTimer = null;
  let pendingTxnId = 0;
  let mutationTxnCounter = 0;

  // Drawer DOM quiet detection (covers section re-render timing)
  let drawerQuiet = true;
  let drawerQuietTimer = null;

  // Drawer node tracking (drawer can be re-rendered/replaced)
  const drawerSelectors = [
    '#CartDrawer',
    'cart-drawer',
    '[data-cart-drawer]',
    '.cart-drawer'
  ];
  let drawerObserver = null;
  let drawerObservedEl = null;
  let bodyObserver = null;

  function isCartMutationUrl(url) {
    url = String(url || '');
    // ignore the read-only cart snapshot endpoint
    if (/\/cart\.js(\?|$)/i.test(url)) return false;

    // match both JS and non-JS mutation endpoints
    return /\/cart\/(add|change|update|clear)(\.js)?(\?|$)/i.test(url);
  }

  function markPending(txnId, internal) {
    if (!internal) {
      pendingCartUpdate = true;
      if (txnId) pendingTxnId = txnId;
    }

    if (pendingCartUpdate) {
      clearTimeout(pendingExpireTimer);
      // Safety: drop pending state if something goes wrong
      pendingExpireTimer = setTimeout(() => {
        pendingCartUpdate = false;
        pendingTxnId = 0;
      }, 4000);
    }
  }

  function markDrawerDirty() {
    // Ignore drawer churn (e.g., timers) unless a cart mutation is pending
    if (!pendingCartUpdate && inFlight === 0) return;

    drawerQuiet = false;
    clearTimeout(drawerQuietTimer);
    // Quiet window: when no mutations for X ms, assume drawer finished re-render
    drawerQuietTimer = setTimeout(() => {
      drawerQuiet = true;
      scheduleStable('drawer_quiet');
    }, DRAWER_QUIET_MS);
  }

  function scheduleStable(reason) {
    clearTimeout(stableTimer);
    const txnId = pendingTxnId || mutationTxnCounter;

    stableTimer = setTimeout(() => {
      if (inFlight !== 0) return;
      if (!drawerQuiet) return;

      // Only emit stable if we are finishing a real cart mutation
      if (!pendingCartUpdate) return;

      pendingCartUpdate = false;
      clearTimeout(pendingExpireTimer);

      const detailTxn = pendingTxnId || txnId;
      pendingTxnId = 0;

      log('stable', { reason, txnId: detailTxn });
      document.dispatchEvent(new CustomEvent('bl:cart:stable', { detail: { reason, txnId: detailTxn } }));
    }, STABLE_DELAY_MS);
  }

  function isInternalMutation(init) {
    const headers = (init && init.headers) || {};

    try {
      if (typeof Headers !== 'undefined' && headers instanceof Headers) {
        return headers.get(INTERNAL_HEADER) === INTERNAL_HEADER_VALUE;
      }
    } catch (e) {}

    const lower = (obj, key) => obj[key] || obj[String(key || '').toLowerCase()];
    const val = lower(headers, INTERNAL_HEADER) || lower(headers, INTERNAL_HEADER.toLowerCase());
    return String(val || '') === INTERNAL_HEADER_VALUE;
  }

  function findDrawerEl() {
    for (const sel of drawerSelectors) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  // Observe cart drawer DOM changes (works even if theme does sections rendering)
  function attachDrawerObserver() {
    const el = findDrawerEl();
    if (!el) return;

    if (drawerObservedEl === el && drawerObserver) return;

    if (drawerObserver) drawerObserver.disconnect();

    drawerObservedEl = el;
    drawerObserver = new MutationObserver(() => markDrawerDirty());
    drawerObserver.observe(el, { subtree: true, childList: true, attributes: true, characterData: true });
    log('drawer observer attached', el);
  }

  function watchDrawerMount() {
    if (bodyObserver || !window.MutationObserver) return;

    bodyObserver = new MutationObserver(() => {
      const candidate = findDrawerEl();

      if (candidate && candidate !== drawerObservedEl) {
        attachDrawerObserver();
        return;
      }

      if (drawerObservedEl && !document.body.contains(drawerObservedEl)) {
        attachDrawerObserver();
      }
    });

    bodyObserver.observe(document.body, { childList: true, subtree: true });
    attachDrawerObserver();
  }

  // Wrap fetch
  if (window.fetch && !BL.__blFetchWrapped) {
    BL.__blFetchWrapped = true;
    const origFetch = window.fetch.bind(window);

    window.fetch = function (input, init) {
      let url = '';
      try { url = typeof input === 'string' ? input : (input && input.url) || ''; } catch (e) {}

      if (!isCartMutationUrl(url)) return origFetch(input, init);

      const txnId = ++mutationTxnCounter;
      const internal = isInternalMutation(init);
      inFlight++;
      markPending(txnId, internal);
      log('cart fetch start', { inFlight, url, txnId, internal });

      return origFetch(input, init)
        .finally(() => {
          inFlight = Math.max(0, inFlight - 1);
          log('cart fetch done', { inFlight, url, txnId, internal });
          // After cart request completes, the theme may still be re-rendering drawer sections.
          // Our drawer observer (if present) will extend the quiet window as needed.
          scheduleStable('cart_fetch_done');
        });
    };
  }

  // Wrap XHR (in case Shrine uses it)
  if (window.XMLHttpRequest && !BL.__blXHRWrapped) {
    BL.__blXHRWrapped = true;

    const XHR = window.XMLHttpRequest;
    const origOpen = XHR.prototype.open;
    const origSend = XHR.prototype.send;

    XHR.prototype.open = function (method, url) {
      this.__bl_url = url;
      this.__bl_method = method;
      return origOpen.apply(this, arguments);
    };

    XHR.prototype.send = function () {
      const url = this.__bl_url || '';
      if (!isCartMutationUrl(url)) return origSend.apply(this, arguments);

      const internal = isInternalMutation(this.__bl_init || this.__bl_headers);

      const txnId = ++mutationTxnCounter;
      inFlight++;
      markPending(txnId, internal);
      log('cart xhr start', { inFlight, method: this.__bl_method, url, txnId, internal });

      this.addEventListener('loadend', () => {
        inFlight = Math.max(0, inFlight - 1);
        log('cart xhr done', { inFlight, method: this.__bl_method, url, txnId, internal });
        scheduleStable('cart_xhr_done');
      });

      return origSend.apply(this, arguments);
    };
  }

  // Start observer after DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', watchDrawerMount, { once: true });
  } else {
    watchDrawerMount();
  }

  // Allow manual poke from other scripts if needed
  BL.cartStablePoke = function (reason) {
    scheduleStable(reason || 'poke');
  };
})();
