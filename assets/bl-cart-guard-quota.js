(function () {
  window.BL = window.BL || {};
  const BL = window.BL;

  // =========================
  // CONFIG — adjust these
  // =========================
  const CFG = {
    // Best signal: line-item property on add-on lines
    propIsAddon: '_bl_is_addon', // value must be "1"

    // Optional fallback: add-on product handles (dedicated add-on product(s))
    addonHandle: 'mystery-add-on',
    addonHandles: [],

    // Debug toggle: ?cart_guard_debug=1
    debugParam: 'cart_guard_debug',

    // Internal header to tag guard-driven requests
    internalHeader: 'X-BL-CART-GUARD',

    // How long to ignore stable events after guard itself mutates the cart (ms)
    internalMuteMs: 1200,

    // Removal policy when too many add-ons:
    // 'last' removes from last add-on line backwards (deterministic)
    removePolicy: 'last',
  };

  const debug = (() => {
    try { return new URL(location.href).searchParams.get(CFG.debugParam) === '1'; }
    catch (e) { return false; }
  })();
  const log = (...a) => { if (debug) console.log('[BL:guard]', ...a); };

  // =========================
  // INTERNAL STATE / SAFETY
  // =========================
  let running = false;
  let queued = false;
  let rerunTimer = null;
  let internalMuteUntil = 0;
  let lastStableTxnId = 0;

  function muteInternal() {
    internalMuteUntil = Date.now() + CFG.internalMuteMs;
  }
  function isMuted() {
    return Date.now() < internalMuteUntil;
  }

  // =========================
  // HELPERS
  // =========================
  const addonHandleList = (() => {
    const handles = [];
    if (CFG.addonHandle) handles.push(CFG.addonHandle);
    if (Array.isArray(CFG.addonHandles)) handles.push(...CFG.addonHandles);
    return handles
      .filter(Boolean)
      .map((h) => String(h).toLowerCase());
  })();

  function extractHandle(url) {
    const m = /\/products\/([^?/]+)/i.exec(String(url || ''));
    return m ? decodeURIComponent(m[1]).toLowerCase() : '';
  }

  function summarizeProps(props) {
    if (!props) return '';
    try {
      return Object.keys(props)
        .filter((k) => props[k] !== undefined && props[k] !== null && props[k] !== '')
        .map((k) => `${k}:${props[k]}`)
        .join(',');
    } catch (e) { return ''; }
  }

  function classifyItem(item) {
    const props = item && item.properties ? item.properties : {};
    const url = String((item && item.url) || '');
    const handle = extractHandle(url);
    const isAddonByProp = String(props[CFG.propIsAddon] || '') === '1';
    const isAddonByHandle = addonHandleList.length ? addonHandleList.includes(handle) : false;
    const isAddonFinal = isAddonByProp || isAddonByHandle;

    if (debug && isAddonByProp && handle && addonHandleList.length && !isAddonByHandle) {
      log('WARNING: item marked as add-on via property but handle mismatch (data corruption?)', {
        key: item && item.key,
        handle,
        url,
        props
      });
    }

    return {
      key: item && item.key,
      quantity: Number((item && item.quantity) || 0),
      url,
      handleExtracted: handle,
      isAddonByProp,
      isAddonByHandle,
      isAddonFinal,
      propsSummary: summarizeProps(props)
    };
  }

  async function getCart() {
    const res = await fetch('/cart.js', {
      credentials: 'same-origin',
      headers: { 'X-BL-INTERNAL': '1' }
    });
    return res.json();
  }

  function getSectionsPayload() {
    const payload = { sections: [], sections_url: window.location ? window.location.pathname : '/' };

    const cartDrawerId = document.getElementById('cart-drawer');
    const drawerEl = cartDrawerId || document.querySelector('#CartDrawer') || document.querySelector('cart-drawer');
    if (drawerEl) payload.sections.push('cart-drawer');

    if (document.getElementById('cart-icon-bubble')) payload.sections.push('cart-icon-bubble');

    // Cart page support
    if (document.getElementById('main-cart-items')) payload.sections.push('main-cart-items');
    if (document.getElementById('main-cart-footer')) payload.sections.push('main-cart-footer');
    if (document.getElementById('cart-live-region-text')) payload.sections.push('cart-live-region-text');

    return payload.sections.length ? payload : null;
  }

  async function changeLineByKey(lineKey, quantity, sectionsPayload) {
    const body = Object.assign({ id: lineKey, quantity }, sectionsPayload || {});

    const res = await fetch('/cart/change.js', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        [CFG.internalHeader]: '1'
      },
      body: JSON.stringify(body)
    });

    if (!res.ok && debug) {
      try {
        const txt = await res.text();
        log('changeLineByKey failed', { status: res.status, statusText: res.statusText, body: txt });
      } catch (e) {
        log('changeLineByKey failed (no body)', { status: res.status, statusText: res.statusText });
      }
    }

    return res;
  }

  async function changeLineByIndex(lineIndex, quantity, sectionsPayload) {
    const body = Object.assign({ line: lineIndex, quantity }, sectionsPayload || {});

    const res = await fetch('/cart/change.js', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        [CFG.internalHeader]: '1'
      },
      body: JSON.stringify(body)
    });

    if (!res.ok && debug) {
      try {
        const txt = await res.text();
        log('changeLineByIndex failed', { status: res.status, statusText: res.statusText, body: txt });
      } catch (e) {
        log('changeLineByIndex failed (no body)', { status: res.status, statusText: res.statusText });
      }
    }

    return res;
  }

  function mapKeyToLine(cart) {
    const map = {};
    if (!cart || !Array.isArray(cart.items)) return map;
    cart.items.forEach((item, idx) => {
      map[item && item.key] = idx + 1; // Shopify line index is 1-based
    });
    return map;
  }

  // Build an action plan based on current cart snapshot
  function buildPlan(cart) {
    const items = (cart && cart.items) ? cart.items : [];
    const classifications = items.map((it) => classifyItem(it));

    let parentUnits = 0;
    let addonLines = []; // { key, qty, url }

    classifications.forEach((c, idx) => {
      const src = items[idx] || {};
      if (c.isAddonFinal) {
        addonLines.push({ key: src.key, qty: c.quantity, url: c.url || '' });
      } else {
        parentUnits += c.quantity;
      }
    });

    const addonUnits = addonLines.reduce((s, x) => s + (x.qty || 0), 0);

    // Core rule: addonUnits <= parentUnits
    if (addonUnits <= parentUnits) {
      return {
        parentUnits,
        addonUnits,
        changes: [],
        message: null,
        classifications
      };
    }

    let toRemove = addonUnits - parentUnits;
    let changes = [];

    // Deterministic removal policy
    const ordered = (CFG.removePolicy === 'last')
      ? addonLines.slice().reverse()
      : addonLines.slice(); // 'first'

    for (const ln of ordered) {
      if (toRemove <= 0) break;
      if (!ln.qty) continue;

      const reduceBy = Math.min(ln.qty, toRemove);
      const newQty = ln.qty - reduceBy;

      changes.push({ key: ln.key, quantity: newQty });
      toRemove -= reduceBy;
    }

    return {
      parentUnits,
      addonUnits,
      changes,
      message: `Add-ons cannot exceed the number of items in your cart.`,
      classifications
    };
  }

  async function applyPlan(plan) {
    if (!plan.changes || !plan.changes.length) return false;

    const sectionsPayload = getSectionsPayload();

    // Important: applying changes triggers cart mutation requests -> stable -> guard again
    // We mute internal stable events briefly to avoid loops.
    muteInternal();

    // Apply sequentially to avoid race conditions with line indexing
    for (const ch of plan.changes) {
      log('changeLine', ch);
      await changeLineByKey(ch.key, ch.quantity, sectionsPayload);
    }

    const verified = await verifyAndRepair({ usedFallback: false, sectionsPayload });
    return verified;
  }

  async function applyPlanWithLineIndexes(plan, keyToLine, sectionsPayload) {
    if (!plan.changes || !plan.changes.length) return false;

    muteInternal();

    for (const ch of plan.changes) {
      const line = keyToLine[ch.key];
      if (!line) continue;
      log('changeLine(fallback)', { line, quantity: ch.quantity, key: ch.key });
      await changeLineByIndex(line, ch.quantity, sectionsPayload);
    }

    return true;
  }

  async function verifyAndRepair(opts) {
    const options = Object.assign({ usedFallback: false, sectionsPayload: null }, opts || {});
    const cartAfter = await getCart();
    const postPlan = buildPlan(cartAfter);

    if (postPlan.addonUnits <= postPlan.parentUnits || !postPlan.changes.length) {
      return true;
    }

    if (options.usedFallback) {
      log('post-mutation quota still violated after fallback; giving up to avoid loop', postPlan);
      return false;
    }

    // Retry once using line indexes from freshest cart snapshot
    const keyToLine = mapKeyToLine(cartAfter);
    const filteredChanges = postPlan.changes.filter((ch) => keyToLine[ch.key]);
    if (!filteredChanges.length) return false;

    log('retrying with line indexes', { filteredChanges, keyToLine });
    await applyPlanWithLineIndexes(Object.assign({}, postPlan, { changes: filteredChanges }), keyToLine, options.sectionsPayload || getSectionsPayload());

    // Verify once more and stop (no further retries to avoid loops)
    return verifyAndRepair({ usedFallback: true, sectionsPayload: options.sectionsPayload });
  }

  function emitMessage(text) {
    if (!text) return;
    document.dispatchEvent(new CustomEvent('bl:cartguard:message', {
      detail: { type: 'warning', text }
    }));
  }

  // =========================
  // MAIN GUARD RUNNER
  // =========================
  async function runGuard(reason, txnId) {
    // Ignore stable events immediately after the guard itself changed the cart
    if (isMuted() && reason !== 'queued') {
      if (!rerunTimer) {
        const delay = Math.max(80, internalMuteUntil - Date.now() + 30);
        rerunTimer = setTimeout(() => {
          rerunTimer = null;
          runGuard('queued', txnId || lastStableTxnId);
        }, delay);
      }
      return;
    }

    if (txnId && txnId < lastStableTxnId) {
      return;
    }
    if (txnId) {
      lastStableTxnId = txnId;
    }

    if (running) { queued = true; return; }
    running = true;
    queued = false;

    try {
      const cart = await getCart();
      const plan = buildPlan(cart);

      log('cart classification', plan.classifications);
      log({ reason, txnId, parentUnits: plan.parentUnits, addonUnits: plan.addonUnits, changes: plan.changes });

      if (plan.changes.length) {
        emitMessage(plan.message);
        await applyPlan(plan);
      }
    } catch (e) {
      console.warn('[BL:guard] error', e);
    } finally {
      running = false;
      if (queued) {
        // Run once more after queued changes settle
        setTimeout(() => runGuard('queued', lastStableTxnId), 180);
      }
    }
  }

  // Run only at the correct time: after cart mutation + drawer settled
  document.addEventListener('bl:cart:stable', (e) => {
    const reason = (e && e.detail && e.detail.reason) || 'stable';
    const txnId = (e && e.detail && e.detail.txnId) ? Number(e.detail.txnId) : 0;
    runGuard(reason, txnId);
  });

  /*
   * How to test (with ?cart_guard_debug=1 for console logs)
   * 1) Add a parent product with qty=3 and add-on qty=3.
   * 2) Increase add-on to qty=4; expect guard to log changeLine + fallback retry (if needed) and final qty clamped to 3.
   * 3) Repeat with multiple add-on lines; last lines should be reduced first.
   * 4) If a change request fails, debug log will include status/body; guard retries once using line indexes.
   */

})();
