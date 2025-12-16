(function () {
  window.BL = window.BL || {};
  const BL = window.BL;

  // Toggle logs via ?cart_guard_debug=1
  const debug = (() => {
    try { return new URL(location.href).searchParams.get('cart_guard_debug') === '1'; }
    catch (e) { return false; }
  })();
  const log = (...a) => { if (debug) console.log('[BL:stable]', ...a); };

  // Cart request tracking
  let inFlight = 0;
  let stableTimer = null;

  // Only emit stable after a real cart mutation finishes
  let pendingCartUpdate = false;
  let pendingExpireTimer = null;

  // Drawer DOM quiet detection (covers section re-render timing)
  let drawerQuiet = true;
  let drawerQuietTimer = null;

  function isCartMutationUrl(url) {
    url = String(url || '');
    // ignore the read-only cart snapshot endpoint
    if (/\/cart\.js(\?|$)/i.test(url)) return false;

    // treat mutating endpoints as “updates”
    return /\/cart\/(add|change|update|clear)\.js(\?|$)/i.test(url);
  }

  function markPending() {
    pendingCartUpdate = true;
    clearTimeout(pendingExpireTimer);
    // Safety: drop pending state if something goes wrong
    pendingExpireTimer = setTimeout(() => {
      pendingCartUpdate = false;
    }, 4000);
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
    }, 140);
  }

  function scheduleStable(reason) {
    clearTimeout(stableTimer);
    stableTimer = setTimeout(() => {
      if (inFlight !== 0) return;
      if (!drawerQuiet) return;

      // Only emit stable if we are finishing a real cart mutation
      if (!pendingCartUpdate) return;

      pendingCartUpdate = false;
      clearTimeout(pendingExpireTimer);

      log('stable', { reason });
      document.dispatchEvent(new CustomEvent('bl:cart:stable', { detail: { reason } }));
    }, 80);
  }

  // Observe cart drawer DOM changes (works even if theme does sections rendering)
  function setupDrawerObserver() {
    // Try common drawer containers; adjust selectors if your theme differs.
    const selectors = [
      '#CartDrawer',
      'cart-drawer',
      '[data-cart-drawer]',
      '.cart-drawer'
    ];

    let el = null;
    for (const sel of selectors) {
      el = document.querySelector(sel);
      if (el) break;
    }
    if (!el) return; // not fatal; fetch tracking still works

    const mo = new MutationObserver(() => markDrawerDirty());
    mo.observe(el, { subtree: true, childList: true, attributes: true, characterData: true });
    log('drawer observer attached', el);
  }

  // Wrap fetch
  if (window.fetch && !BL.__blFetchWrapped) {
    BL.__blFetchWrapped = true;
    const origFetch = window.fetch.bind(window);

    window.fetch = function (input, init) {
      let url = '';
      try { url = typeof input === 'string' ? input : (input && input.url) || ''; } catch (e) {}

      if (!isCartMutationUrl(url)) return origFetch(input, init);

      inFlight++;
      log('cart fetch start', inFlight, url);

      return origFetch(input, init)
        .finally(() => {
          inFlight = Math.max(0, inFlight - 1);
          log('cart fetch done', inFlight, url);
          markPending();
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

      inFlight++;
      log('cart xhr start', inFlight, this.__bl_method, url);

      this.addEventListener('loadend', () => {
        inFlight = Math.max(0, inFlight - 1);
        log('cart xhr done', inFlight, this.__bl_method, url);
        markPending();
        scheduleStable('cart_xhr_done');
      });

      return origSend.apply(this, arguments);
    };
  }

  // Start observer after DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupDrawerObserver, { once: true });
  } else {
    setupDrawerObserver();
  }

  // Allow manual poke from other scripts if needed
  BL.cartStablePoke = function (reason) {
    scheduleStable(reason || 'poke');
  };
})();
