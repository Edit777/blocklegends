/* =======================================================
   BLOCK LEGENDS — CART STABLE HOOK
   Emits bl:cart:stable once cart mutations + drawer re-renders settle.
   Debug: ?cart_guard_debug=1
   ======================================================= */

(function () {
  window.BL = window.BL || {};

  const CFG = {
    debugParam: 'cart_guard_debug',
    guardHeader: 'X-BL-CART-GUARD',
    guardHeaderValue: '1',
    drawerQuietMs: 420,
    stableDelayMs: 160,
    pendingExpireMs: 5000,
    drawerSelectors: ['#CartDrawer', 'cart-drawer', '[data-cart-drawer]', '.cart-drawer']
  };

  const debug = (() => {
    try { return new URL(location.href).searchParams.get(CFG.debugParam) === '1'; }
    catch (e) { return false; }
  })();
  const log = (...args) => { if (debug) console.log('[BL:Stable]', ...args); };

  let inFlight = 0;
  let pendingCartUpdate = false;
  let pendingTxnId = 0;
  let mutationTxnCounter = 0;
  let pendingSource = 'external';
  let stableTimer = null;
  let pendingExpireTimer = null;

  let drawerQuiet = true;
  let drawerQuietTimer = null;
  let drawerObserver = null;
  let drawerObservedEl = null;
  let bodyObserver = null;

  function isCartMutationUrl(url) {
    url = String(url || '');
    if (/\/cart\.js(\?|$)/i.test(url)) return false;
    return /\/cart\/(add|change|update|clear)(\.js)?(\?|$)/i.test(url);
  }

  function isInternalMutation(init) {
    const headers = (init && init.headers) || {};

    try {
      if (typeof Headers !== 'undefined' && headers instanceof Headers) {
        return headers.get(CFG.guardHeader) === CFG.guardHeaderValue;
      }
    } catch (e) {}

    const lower = (obj, key) => obj && (obj[key] || obj[String(key || '').toLowerCase()]);
    const val = lower(headers, CFG.guardHeader) || lower(headers, CFG.guardHeader.toLowerCase());
    return String(val || '') === CFG.guardHeaderValue;
  }

  function markPending(txnId, source) {
    pendingCartUpdate = true;
    pendingTxnId = txnId || pendingTxnId || mutationTxnCounter;
    pendingSource = source || 'external';

    clearTimeout(pendingExpireTimer);
    pendingExpireTimer = setTimeout(() => {
      pendingCartUpdate = false;
      pendingTxnId = 0;
      pendingSource = 'external';
    }, CFG.pendingExpireMs);
  }

  function markDrawerDirty() {
    if (!pendingCartUpdate && inFlight === 0) return;
    drawerQuiet = false;
    clearTimeout(drawerQuietTimer);
    drawerQuietTimer = setTimeout(() => {
      drawerQuiet = true;
      scheduleStable('drawer_quiet');
    }, CFG.drawerQuietMs);
  }

  function scheduleStable(reason) {
    clearTimeout(stableTimer);
    const txnId = pendingTxnId || mutationTxnCounter;

    stableTimer = setTimeout(() => {
      if (inFlight !== 0) return;
      if (!drawerQuiet) return;
      if (!pendingCartUpdate) return;

      pendingCartUpdate = false;
      clearTimeout(pendingExpireTimer);

      const detailTxn = pendingTxnId || txnId;
      const detailSource = pendingSource || 'external';
      pendingTxnId = 0;
      pendingSource = 'external';

      log('stable', { reason, txnId: detailTxn, source: detailSource });
      document.dispatchEvent(new CustomEvent('bl:cart:stable', {
        detail: { reason, txnId: detailTxn, source: detailSource }
      }));
    }, CFG.stableDelayMs);
  }

  function findDrawerEl() {
    for (const sel of CFG.drawerSelectors) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  function attachDrawerObserver() {
    const el = findDrawerEl();
    if (!el) return;
    if (drawerObservedEl === el && drawerObserver) return;

    if (drawerObserver) drawerObserver.disconnect();

    drawerObservedEl = el;
    drawerObserver = new MutationObserver(markDrawerDirty);
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

  function onCartMutationStart(url, init, transport) {
    const internal = isInternalMutation(init);
    const txnId = ++mutationTxnCounter;
    inFlight++;
    markPending(txnId, internal ? 'guard' : 'external');
    markDrawerDirty();
    log(`cart ${transport} start`, { url, txnId, internal, inFlight });
  }

  function onCartMutationEnd(url, transport) {
    inFlight = Math.max(0, inFlight - 1);
    log(`cart ${transport} done`, { url, inFlight });
    scheduleStable('cart_mutation_done');
  }

  if (window.fetch && !window.BL.__blFetchWrapped) {
    window.BL.__blFetchWrapped = true;
    const origFetch = window.fetch.bind(window);

    window.fetch = function (input, init) {
      let url = '';
      try { url = typeof input === 'string' ? input : (input && input.url) || ''; } catch (e) {}

      if (!isCartMutationUrl(url)) return origFetch(input, init);

      onCartMutationStart(url, init, 'fetch');
      return origFetch(input, init).finally(() => onCartMutationEnd(url, 'fetch'));
    };
  }

  if (window.XMLHttpRequest && !window.BL.__blXHRWrapped) {
    window.BL.__blXHRWrapped = true;
    const XHR = window.XMLHttpRequest;
    const origOpen = XHR.prototype.open;
    const origSend = XHR.prototype.send;

    XHR.prototype.open = function (method, url) {
      this.__bl_url = url;
      this.__bl_method = method;
      return origOpen.apply(this, arguments);
    };

    XHR.prototype.send = function (body) {
      const url = this.__bl_url || '';
      if (!isCartMutationUrl(url)) return origSend.apply(this, arguments);

      const init = this.__bl_headers || this.__bl_init || {};
      onCartMutationStart(url, init, 'xhr');

      this.addEventListener('loadend', () => onCartMutationEnd(url, 'xhr'));
      return origSend.apply(this, arguments);
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', watchDrawerMount, { once: true });
  } else {
    watchDrawerMount();
  }

  document.addEventListener('shopify:section:load', markDrawerDirty);
  document.addEventListener('shopify:section:reorder', markDrawerDirty);

  window.BL.cartStablePoke = function (reason) {
    scheduleStable(reason || 'poke');
  };
})();
