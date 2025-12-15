/* =======================================================
   BLOCK LEGENDS — CART GUARD
   Enforce:
   - Add-on cannot exist without its parent (shared uid)
   - Add-on handle must match parent handle when provided
   - Add-on quantities cannot exceed parent quantity (optionally capped)
   Notes:
   - We only touch items that are explicitly marked as add-ons.
   ======================================================= */

(function () {
  window.BL = window.BL || {};
  window.BL.cartGuard = window.BL.cartGuard || {};

  var U = window.BL.utils;
  var G = window.BL.cartGuard;

  G.CFG = G.CFG || {
    addonHandle: 'mystery-add-on',
    propIsAddon: '_bl_is_addon',
    propParentHandle: '_bl_parent_handle',
    propParentUid: '_bl_parent_uid',
    // 0/null means unlimited, otherwise cap addons per uid to this AND parent quantity
    maxAddonsPerParent: 0,

    // throttling
    mutationDebounceMs: 250,
    networkDebounceMs: 200
  };

  function getProp(item, key) {
    try {
      if (!item || !item.properties) return '';
      return String(item.properties[key] || '').trim();
    } catch (e) { return ''; }
  }

  function maybeStr(v) {
    try { return String(v || '').trim(); } catch (e) { return ''; }
  }

  function isAddonLine(item) {
    try {
      // Most reliable: explicit line-item property
      if (getProp(item, G.CFG.propIsAddon) === '1') return true;

      // Next: handle fields (theme dependent)
      var h = maybeStr(item.handle || item.product_handle);
      if (h && h === G.CFG.addonHandle) return true;

      // Next: url (present in many cart.js payloads)
      var url = maybeStr(item.url);
      if (url && url.indexOf('/products/' + G.CFG.addonHandle) !== -1) return true;

      return false;
    } catch (e) { return false; }
  }

  function cartJson() {
    return fetch('/cart.js', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  function changeLine(lineKey, qty) {
    return fetch('/cart/change.js', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: lineKey, quantity: qty })
    }).catch(function () {});
  }

  function schedule(fn, ms) {
    var t = null;
    return function () {
      if (t) clearTimeout(t);
      var args = arguments;
      t = setTimeout(function () { t = null; fn.apply(null, args); }, ms);
    };
  }

  G.cleanup = function (reason) {
    if (G.__busy) return Promise.resolve(false);
    G.__busy = true;

    return cartJson()
      .then(function (cart) {
        if (!cart || !cart.items || !cart.items.length) return false;

        // index parents by uid (only lines that have uid property are eligible parents)
        var parentsByUid = {};
        cart.items.forEach(function (it) {
          if (!it || isAddonLine(it)) return;
          var uid = getProp(it, G.CFG.propParentUid);
          if (uid) {
            if (!parentsByUid[uid]) parentsByUid[uid] = { item: it, qty: 0 };
            parentsByUid[uid].qty += Number(it.quantity || 0);
          }
        });

        var addonsByUid = {};
        var changes = [];

        cart.items.forEach(function (it) {
          if (!it || !isAddonLine(it)) return;
          var uid = getProp(it, G.CFG.propParentUid);
          var parentHandle = getProp(it, G.CFG.propParentHandle);
          var parentInfo = uid ? parentsByUid[uid] : null;

          if (!addonsByUid[uid || '__missing__']) addonsByUid[uid || '__missing__'] = [];

          addonsByUid[uid || '__missing__'].push({
            item: it,
            uid: uid,
            parentHandle: parentHandle,
            parentInfo: parentInfo
          });
        });

        Object.keys(addonsByUid).forEach(function (uid) {
          var items = addonsByUid[uid];
          var parentInfo = items[0] ? items[0].parentInfo : null;
          items.forEach(function (entry) {
            var it = entry.item;

            // missing uid OR missing parent => remove
            if (!entry.uid || !parentInfo) {
              changes.push({ key: it.key, qty: 0 });
              return;
            }

            // enforce matching handle if provided
            if (entry.parentHandle) {
              var ph = maybeStr(parentInfo.item.handle || parentInfo.item.product_handle);
              if (ph && ph !== entry.parentHandle) {
                changes.push({ key: it.key, qty: 0 });
                return;
              }
            }
          });

          // enforce addon quantity does not exceed parent quantity (and optional cap)
          var parentQty = parentInfo ? Number(parentInfo.qty || 0) : 0;
          var limit = parentQty;
          if (G.CFG.maxAddonsPerParent && G.CFG.maxAddonsPerParent > 0) {
            limit = Math.min(limit, G.CFG.maxAddonsPerParent);
          }

          var used = 0;
          items.forEach(function (entry) {
            var it = entry.item;
            var qty = Number(it.quantity || 0);
            if (qty < 0) qty = 0;

            var remaining = limit - used;
            if (remaining <= 0) {
              changes.push({ key: it.key, qty: 0 });
              return;
            }

            var desired = Math.min(qty, remaining);
            if (desired !== qty) {
              changes.push({ key: it.key, qty: desired });
            }

            used += desired;
          });
        });

        if (!changes.length) return false;

        // apply sequentially
        var p = Promise.resolve();
        changes.forEach(function (c) { p = p.then(function () { return changeLine(c.key, c.qty); }); });
        return p.then(function () { return true; });
      })
      .catch(function () { return false; })
      .finally(function () {
        G.__busy = false;
        try { if (U && U.log) U.log('[BL CartGuard] cleanup done', reason || ''); } catch (e) {}
      });
  };

  G._scheduleCleanupNetwork = schedule(function (reason) {
    G.cleanup(reason || 'network');
  }, G.CFG.networkDebounceMs);

  G._scheduleCleanupMutation = schedule(function (reason) {
    G.cleanup(reason || 'mutation');
  }, G.CFG.mutationDebounceMs);

  G.patchNetwork = function () {
    if (G.__patched) return;
    G.__patched = true;

    // fetch
    if (window.fetch) {
      var origFetch = window.fetch;
      window.fetch = function (input, init) {
        var url = '';
        try { url = (typeof input === 'string') ? input : (input && input.url) ? input.url : ''; } catch (e) {}
        var isMutation = /\/cart\/(add|change|update)\.js(\?|$)/.test(url);

        return origFetch(input, init).then(function (res) {
          if (isMutation) G._scheduleCleanupNetwork('fetch');
          return res;
        });
      };
    }

    // xhr
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
            if (/\/cart\/(add|change|update)\.js(\?|$)/.test(u)) G._scheduleCleanupNetwork('xhr');
          } catch (e) {}
        }
        xhr.addEventListener('load', done);
        xhr.addEventListener('error', done);
        return send.apply(this, arguments);
      };
    } catch (e2) {}
  };

  G.observeCartDrawer = function () {
    if (G.__obs) return;
    G.__obs = true;

    // try common cart drawer nodes; if none, observe body
    var target =
      document.querySelector('cart-drawer') ||
      document.querySelector('#CartDrawer') ||
      document.querySelector('[data-cart-drawer]') ||
      document.body;

    if (!target || !window.MutationObserver) return;

    var obs = new MutationObserver(function () {
      G._scheduleCleanupMutation('dom');
    });

    obs.observe(target, { childList: true, subtree: true });
  };

  G.bindThemeEvents = function () {
    if (G.__events) return;
    G.__events = true;

    ['cart:updated', 'cart:change', 'cart:refresh', 'cart-drawer:refresh', 'theme:cart:updated'].forEach(function (evt) {
      document.addEventListener(evt, function () { G._scheduleCleanupNetwork(evt); }, true);
    });
  };

  // Also run cleanup when user clicks checkout
  G.guardCheckout = function () {
    var btns = document.querySelectorAll('button[name="checkout"], input[name="checkout"], [href^="/checkout"]');
    if (!btns.length) return;

    btns.forEach(function (b) {
      b.addEventListener('click', function (e) {
        G.cleanup('checkout').then(function (didChange) {
          if (didChange) {
            e.preventDefault();
            e.stopImmediatePropagation();
            try { alert('We removed invalid Mystery Add-Ons that were not attached to their parent item.'); } catch (e2) {}
          }
        });
      }, true);
    });
  };

  G.init = function () {
    if (G.__inited) return;
    G.__inited = true;

    G.patchNetwork();
    G.bindThemeEvents();
    G.observeCartDrawer();
    G.guardCheckout();

    // initial cleanup
    setTimeout(function () { G.cleanup('init'); }, 200);

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) setTimeout(function () { G.cleanup('visibility'); }, 300);
    });
  };
})();