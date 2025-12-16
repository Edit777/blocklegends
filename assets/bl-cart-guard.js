/* =======================================================
   BLOCK LEGENDS — CART GUARD (ONE-TO-ONE)
   - Enforces a strict 1:1 relationship between parent lines and add-ons
   - Each parent UID may have at most one parent line (qty forced to 1)
   - Each parent UID may have at most one add-on line (qty forced to 1)
   - Orphaned add-ons are removed
   - Runs after cart mutations and before checkout
   ======================================================= */

(function () {
  window.BL = window.BL || {};
  window.BL.cartGuard = window.BL.cartGuard || {};

  var U = window.BL.utils || {};
  var G = window.BL.cartGuard;

  G.CFG = G.CFG || {
    addonHandle: 'mystery-add-on',
    propIsAddon: '_bl_is_addon',
    propParentHandle: '_bl_parent_handle',
    propParentUid: '_bl_parent_uid',
    networkDebounceMs: 200,
    mutationDebounceMs: 250
  };

  function toStr(value) {
    try { return String(value || '').trim(); } catch (e) { return ''; }
  }

  function toNumber(value) {
    var n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  function debugLog() {
    try {
      if (typeof localStorage !== 'undefined' && localStorage.getItem('bl_mystery_debug') !== '1') return;
    } catch (e) {}
    var args = Array.prototype.slice.call(arguments);
    try { console.log.apply(console, ['[BL CartGuard][debug]'].concat(args)); } catch (e2) {}
  }

  function isAddon(item) {
    if (!item) return false;
    try {
      if (toStr(item.properties && item.properties[G.CFG.propIsAddon]) === '1') return true;
      var handle = toStr(item.handle || item.product_handle);
      if (handle && handle === G.CFG.addonHandle) return true;
      var url = toStr(item.url);
      if (url && url.indexOf('/products/' + G.CFG.addonHandle) !== -1) return true;
    } catch (e) {}
    return false;
  }

  function cartJson() {
    return fetch('/cart.js', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  function changeLine(change) {
    if (!change) return Promise.resolve();
    var body = { quantity: change.qty };
    if (change.key) body.id = change.key; else body.line = change.line;

    return fetch('/cart/change.js', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).catch(function () {});
  }

  function computeChanges(cart) {
    if (!cart || !cart.items || !cart.items.length) return [];

    var parents = {};
    var duplicateParents = [];
    var addonGroups = {};
    var changes = [];

    (cart.items || []).forEach(function (item, idx) {
      if (!item) return;

      var lineNumber = toNumber(item.line || idx + 1);
      var qty = Math.max(0, toNumber(item.quantity));
      var uid = toStr(item.properties && item.properties[G.CFG.propParentUid]);
      var parentHandle = toStr(item.properties && item.properties[G.CFG.propParentHandle]);
      var meta = { key: item.key, line: lineNumber, qty: qty, uid: uid, handle: parentHandle };

      if (isAddon(item)) {
        if (!uid) {
          changes.push({ key: item.key, line: lineNumber, qty: 0 });
          debugLog('remove-orphan-addon-no-uid', meta);
          return;
        }
        if (!addonGroups[uid]) addonGroups[uid] = [];
        addonGroups[uid].push(meta);
        return;
      }

      if (!uid) return; // only guard parents participating in the 1:1 contract

      if (!parents[uid]) {
        parents[uid] = meta;
      } else {
        duplicateParents.push(meta);
      }

      if (qty !== 1) {
        changes.push({ key: item.key, line: lineNumber, qty: 1 });
        debugLog('normalize-parent-qty', { uid: uid, from: qty, to: 1 });
      }
    });

    // Remove duplicate parents, keep the first instance per UID
    duplicateParents.forEach(function (meta) {
      changes.push({ key: meta.key, line: meta.line, qty: 0 });
      debugLog('remove-duplicate-parent', meta);
    });

    // Validate add-ons per parent UID
    Object.keys(addonGroups).forEach(function (uid) {
      var addons = addonGroups[uid];
      var parent = parents[uid];

      if (!parent) {
        addons.forEach(function (meta) {
          changes.push({ key: meta.key, line: meta.line, qty: 0 });
          debugLog('remove-orphan-addon', meta);
        });
        return;
      }

      addons.forEach(function (meta, index) {
        if (index > 0) {
          changes.push({ key: meta.key, line: meta.line, qty: 0 });
          debugLog('remove-extra-addon', meta);
          return;
        }

        if (meta.qty !== 1) {
          changes.push({ key: meta.key, line: meta.line, qty: 1 });
          debugLog('normalize-addon-qty', { uid: uid, from: meta.qty, to: 1 });
        }
      });
    });

    return changes;
  }

  G.cleanup = function (reason) {
    if (G.__busy) {
      G.__queued = true;
      return Promise.resolve(false);
    }
    G.__busy = true;

    return cartJson()
      .then(function (cart) {
        var changes = computeChanges(cart);
        if (!changes || !changes.length) return false;

        var p = Promise.resolve();
        G.__silentNetwork = true;
        changes.forEach(function (change) { p = p.then(function () { return changeLine(change); }); });
        debugLog('changes-applied', { reason: reason, count: changes.length });
        return p.then(function () { return true; });
      })
      .catch(function () { return false; })
      .finally(function () {
        G.__silentNetwork = false;
        G.__busy = false;
        if (G.__queued) {
          G.__queued = false;
          G.cleanup('queued');
        }
        try { if (U && U.log) U.log('[BL CartGuard] cleanup done', reason || ''); } catch (e) {}
      });
  };

  function schedule(fn, ms) {
    var timer = null;
    return function () {
      if (timer) clearTimeout(timer);
      var args = arguments;
      timer = setTimeout(function () {
        timer = null;
        fn.apply(null, args);
      }, ms);
    };
  }

  G._scheduleNetwork = schedule(function (reason) { G.cleanup(reason || 'network'); }, G.CFG.networkDebounceMs);
  G._scheduleMutation = schedule(function (reason) { G.cleanup(reason || 'mutation'); }, G.CFG.mutationDebounceMs);

  G.patchNetwork = function () {
    if (G.__patched) return;
    G.__patched = true;

    if (window.fetch) {
      var origFetch = window.fetch;
      window.fetch = function (input, init) {
        var url = '';
        try { url = typeof input === 'string' ? input : (input && input.url) ? input.url : ''; } catch (e) {}
        var isMutation = /\/cart\/(add|change|update)\.js(\?|$)/.test(url);
        return origFetch(input, init).then(function (res) {
          if (isMutation && !G.__silentNetwork) G._scheduleNetwork('fetch');
          return res;
        });
      };
    }

    try {
      var open = XMLHttpRequest.prototype.open;
      var send = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function (method, url) {
        this.__bl_url = url;
        return open.apply(this, arguments);
      };
      XMLHttpRequest.prototype.send = function () {
        var xhr = this;
        function done() {
          try {
            var u = String(xhr.__bl_url || '');
            if (/\/cart\/(add|change|update)\.js(\?|$)/.test(u) && !G.__silentNetwork) G._scheduleNetwork('xhr');
          } catch (e) {}
        }
        xhr.addEventListener('load', done);
        xhr.addEventListener('error', done);
        return send.apply(this, arguments);
      };
    } catch (e2) {}
  };

  G.observeCartDrawer = function () {
    if (G.__obs || !window.MutationObserver) return;

    var target =
      document.querySelector('[data-cart-items]') ||
      document.querySelector('[data-cart-drawer]') ||
      document.querySelector('#CartDrawer') ||
      document.querySelector('cart-drawer');

    if (!target) return;

    var obs = new MutationObserver(function () { G._scheduleMutation('dom'); });
    obs.observe(target, { childList: true, subtree: true });
    G.__obs = obs;
  };

  G.bindThemeEvents = function () {
    if (G.__events) return;
    G.__events = true;

    [
      'cart:updated',
      'cart:change',
      'cart:refresh',
      'cart-drawer:rendered'
    ].forEach(function (evt) {
      document.addEventListener(evt, function () { G._scheduleNetwork(evt); }, true);
    });
  };

  G.guardCheckout = function () {
    if (G.__checkoutBound) return;
    G.__checkoutBound = true;

    var selector = 'button[name="checkout"], input[name="checkout"], [href^="/checkout"]';

    document.addEventListener('click', function (e) {
      var target = e.target ? e.target.closest(selector) : null;
      if (!target) return;

      e.preventDefault();
      e.stopImmediatePropagation();

      function proceed() {
        try {
          if (target.tagName === 'A' && target.href) return (window.location.href = target.href);
          var form = target.closest('form');
          if (form) return form.submit();
        } catch (err) {}
        window.location.href = '/checkout';
      }

      G.cleanup('checkout').then(function (changed) {
        if (changed) {
          try { alert('We adjusted your add-ons to match the items in your cart.'); } catch (e2) {}
        }
      }).finally(proceed);
    }, true);
  };

  G.init = function () {
    if (G.__inited) return;
    G.__inited = true;

    G.patchNetwork();
    G.bindThemeEvents();
    G.observeCartDrawer();
    G.guardCheckout();

    setTimeout(function () { G.cleanup('init'); }, 200);

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) setTimeout(function () { G.cleanup('visibility'); }, 150);
    });
  };
})();
