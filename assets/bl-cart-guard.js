/* =======================================================
   BLOCK LEGENDS — CART GUARD
   Enforce:
   - Add-on cannot exist without its parent (shared UID or parent handle fallback)
   - Total add-on quantity per parent group cannot exceed parent quantity (per-unit multiplier)
   - Optionally "fills" missing add-on quantity ONLY when there is exactly 1 add-on line in the group
     (safe auto-sync for stacked identical add-ons; avoids guessing across multiple variants)
   Notes:
   - We only touch items that are explicitly marked as add-ons.
   ======================================================= */

(function () {
  window.BL = window.BL || {};
  window.BL.cartGuard = window.BL.cartGuard || {};

  var U = window.BL.utils;
  var G = window.BL.cartGuard;

  function isDebug() {
    try {
      if (typeof localStorage !== 'undefined' && localStorage.getItem('bl_mystery_debug') === '1') return true;
    } catch (e) {}
    try {
      if (typeof window !== 'undefined' && window.location && window.location.search.indexOf('mystery_debug=1') !== -1) return true;
    } catch (e2) {}
    return false;
  }

  function debugLog() {
    if (!isDebug()) return;
    var args = Array.prototype.slice.call(arguments);
    try { console.log.apply(console, ['[BL CartGuard][debug]'].concat(args)); } catch (e) {}
  }

  G.CFG = G.CFG || {
    addonHandle: 'mystery-add-on',
    propIsAddon: '_bl_is_addon',
    propParentHandle: '_bl_parent_handle',
    propParentUid: '_bl_parent_uid',

    // add-ons per parent unit (1 means 1 add-on per 1 parent quantity)
    maxAddonsPerParent: 1,

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

  function changeLine(change) {
    if (!change) return Promise.resolve();

    var body = { quantity: change.qty };

    // Prefer the line-item key when available; fall back to numeric line position.
    if (change.key) {
      body.id = change.key;
    } else if (change.line) {
      body.line = change.line;
    } else {
      return Promise.resolve();
    }

    return fetch('/cart/change.js', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
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

        // index parents by uid (only lines that have uid property are eligible uid-parents)
        var parentsByUid = {};
        var parentsByHandle = {};

        cart.items.forEach(function (it) {
          if (!it || isAddonLine(it)) return;

          var qty = Number(it.quantity || 0);
          var handle = maybeStr(it.handle || it.product_handle);
          var uid = getProp(it, G.CFG.propParentUid);

          // Handle totals for fallback matching
          if (handle) {
            parentsByHandle[handle] = (parentsByHandle[handle] || 0) + qty;
          }

          // UID-backed parent grouping
          if (!uid) return;

          var existing = parentsByUid[uid];
          if (!existing) {
            parentsByUid[uid] = { item: it, qty: qty };
          } else {
            existing.qty += qty;
            existing.item = existing.item || it;
          }
        });

        var addonMetaByKey = {};
        var changes = [];

        cart.items.forEach(function (it, idx) {
          if (!it || !isAddonLine(it)) return;

          var lineNumber = Number(it.line || (idx + 1));

          var uid = getProp(it, G.CFG.propParentUid);
          var parentHandle = getProp(it, G.CFG.propParentHandle);

          var parent = uid ? parentsByUid[uid] : null;
          var handleQty = parentHandle ? Number(parentsByHandle[parentHandle] || 0) : 0;

          // orphaned if no uid and no handle fallback
          if (!uid && !handleQty) {
            changes.push({ key: it.key, line: lineNumber, qty: 0 });
            debugLog('remove-addon-orphan-no-uid-handle', { key: it.key });
            return;
          }

          // enforce matching handle if provided and uid-parent exists
          if (parent && parentHandle) {
            var ph = maybeStr(parent.item.handle || parent.item.product_handle);
            if (ph && ph !== parentHandle) {
              changes.push({ key: it.key, line: lineNumber, qty: 0 });
              debugLog('remove-addon-parent-handle-mismatch', { key: it.key, expected: ph, got: parentHandle });
              return;
            }
          }

          var parentQty = parent ? Number(parent.qty || 0) : 0;
          var perParent = Math.max(1, Number(G.CFG.maxAddonsPerParent || 1));
          var allowed = Math.max(0, Math.max(parentQty * perParent, handleQty * perParent));

          // Group by UID when present; otherwise by parent handle.
          var metaKey = uid || (parentHandle ? ('handle:' + parentHandle) : '');
          if (!metaKey) {
            changes.push({ key: it.key, line: lineNumber, qty: 0 });
            debugLog('remove-addon-no-metaKey', { key: it.key });
            return;
          }

          var meta = addonMetaByKey[metaKey];
          if (!meta) {
            meta = { allowed: allowed, lines: [], count: 0 };
            addonMetaByKey[metaKey] = meta;
          } else {
            meta.allowed = Math.max(meta.allowed, allowed);
          }

          it.__bl_line_number = lineNumber;
          meta.lines.push(it);
          meta.count += Number(it.quantity || 0);
        });

        Object.keys(addonMetaByKey).forEach(function (k) {
          var meta = addonMetaByKey[k];
          var allowed = meta.allowed;

          if (allowed <= 0) {
            meta.lines.forEach(function (line) {
              changes.push({ key: line.key, line: line.__bl_line_number, qty: 0 });
            });
            debugLog('remove-addon-no-parent', { key: k });
            return;
          }

          // Never allow more add-ons than allowed
          if (meta.count > allowed) {
            var remaining = allowed;

            // Preserve earlier lines first; reduce later lines.
            meta.lines.forEach(function (line) {
              var cur = Number(line.quantity || 0);
              var desired = Math.min(cur, Math.max(0, remaining));
              remaining -= desired;

              if (desired !== cur) {
                changes.push({ key: line.key, line: line.__bl_line_number, qty: desired });
              }
            });

            debugLog('trim-addon-qty', { key: k, allowed: allowed, count: meta.count });
            return;
          }

          // Only auto-fill missing add-on quantity when there is exactly 1 add-on line.
          // This keeps stacked identical add-ons in sync with parent qty (common case),
          // but avoids guessing which variant to add when multiple add-on lines exist.
          if (meta.count < allowed && meta.lines.length === 1) {
            var line0 = meta.lines[0];
            var targetQty = allowed; // force exact sync
            if (Number(line0.quantity || 0) !== targetQty) {
              changes.push({ key: line0.key, line: line0.__bl_line_number, qty: targetQty });
              debugLog('raise-addon-qty', { key: k, target: targetQty, allowed: allowed });
            }
          }
        });

        if (!changes.length) return false;

        // Apply sequentially
        var p = Promise.resolve();
        changes.forEach(function (c) { p = p.then(function () { return changeLine(c); }); });
        debugLog('changes-applied', changes);
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

    [
      'cart:updated',
      'cart:change',
      'cart:refresh',
      'cart-drawer:refresh',
      'theme:cart:updated',
      'cartQuantityUpdated'
    ].forEach(function (evt) {
      document.addEventListener(evt, function () { G._scheduleCleanupNetwork(evt); }, true);
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

      function proceedToCheckout() {
        try {
          if (target.tagName === 'A' && target.href) {
            window.location.href = target.href;
            return;
          }

          var form = target.closest('form');
          if (form) {
            form.submit();
            return;
          }

          window.location.href = '/checkout';
        } catch (err) {
          window.location.href = '/checkout';
        }
      }

      G.cleanup('checkout').then(function (didChange) {
        if (didChange) {
          try { alert('We removed invalid Mystery Add-Ons that were not attached to their parent item.'); } catch (e2) {}
        }
      }).finally(function () {
        proceedToCheckout();
      });
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
      if (!document.hidden) setTimeout(function () { G.cleanup('visibility'); }, 300);
    });
  };
})();