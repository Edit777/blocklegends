(function () {
  // Updated to harden quota enforcement: robust mutation responses, verification/retry with fallback, internal request tagging, and richer debug logging.
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
      headers: {
        'X-BL-INTERNAL': '1',
        [CFG.internalHeader]: '1'
      }
    });
    return res.json();
  }

  function getSectionsPayload() {
    const payload = { sections: [], sections_url: window.location ? window.location.pathname + window.location.search : '/' };

    const cartDrawerSection = document.getElementById('shopify-section-cart-drawer');
    const drawerEl = cartDrawerSection || document.getElementById('cart-drawer') || document.querySelector('#CartDrawer') || document.querySelector('cart-drawer');
    if (drawerEl) payload.sections.push('cart-drawer');

    if (document.getElementById('cart-icon-bubble')) payload.sections.push('cart-icon-bubble');

    // Cart page support
    if (document.getElementById('main-cart-items')) payload.sections.push('main-cart-items');
    if (document.getElementById('main-cart-footer')) payload.sections.push('main-cart-footer');
    if (document.getElementById('cart-live-region-text')) payload.sections.push('cart-live-region-text');

    return payload.sections.length ? payload : null;
  }

  async function refreshCartUI(sectionsPayload) {
    const payload = sectionsPayload || getSectionsPayload();
    if (!payload || !payload.sections || !payload.sections.length) return;

    const urlBase = payload.sections_url || (window.location ? window.location.pathname + window.location.search : '/');
    const joiner = urlBase.includes('?') ? '&' : '?';
    const fetchUrl = `${urlBase}${joiner}sections=${payload.sections.join(',')}`;

    try {
      const res = await fetch(fetchUrl, {
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          'X-BL-INTERNAL': '1',
          [CFG.internalHeader]: '1'
        }
      });
      const json = await res.json();

      payload.sections.forEach((sectionId) => {
        const html = json && json[sectionId];
        if (!html) return;

        if (sectionId === 'cart-icon-bubble') {
          const bubble = document.getElementById('cart-icon-bubble');
          if (bubble) bubble.innerHTML = html;
          return;
        }

        const wrapperId = `shopify-section-${sectionId}`;
        const container = document.getElementById(wrapperId) || document.getElementById(sectionId);
        if (container) {
          container.innerHTML = html;
        }
      });
    } catch (e) {
      log('refreshCartUI error', e);
    }
  }

  BL.refreshCartUI = refreshCartUI;

  function getDrawerQty(selectorHandle) {
    const drawer = document.querySelector('cart-drawer') || document.getElementById('CartDrawer');
    if (!drawer) return null;

    const safeHandle = window.CSS && window.CSS.escape ? window.CSS.escape(selectorHandle) : selectorHandle;
    const item = drawer.querySelector(`.cart-item--product-${safeHandle}`);
    if (!item) return null;

    const input = item.querySelector('input[name="updates[]"]');
    if (!input) return null;

    const parsed = Number(input.value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function checkDrawerDesync(cart, sectionsPayload) {
    if (!debug || !cart || !Array.isArray(cart.items)) return false;

    let desynced = false;
    cart.items.forEach((item) => {
      const cls = classifyItem(item);
      if (!cls.isAddonFinal || !cls.handleExtracted) return;
      const uiQty = getDrawerQty(cls.handleExtracted);
      if (uiQty === null) return;
      const cartQty = Number(item.quantity || 0);
      if (uiQty !== cartQty) {
        desynced = true;
        log('UI DESYNC: drawer shows', uiQty, 'cart.js shows', cartQty, { handle: cls.handleExtracted, key: item.key });
      }
    });

    if (desynced) {
      refreshCartUI(sectionsPayload);
    }

    return desynced;
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

    let data = null;
    if (res.ok) {
      try { data = await res.json(); } catch (e) {}
    } else {
      try {
        const txt = await res.text();
        log('changeLineByKey failed', { status: res.status, statusText: res.statusText, body: txt });
      } catch (e) {
        log('changeLineByKey failed (no body)', { status: res.status, statusText: res.statusText });
      }
    }

    log('changeLineByKey response', { key: lineKey, quantity, status: res.status, ok: res.ok });
    return { ok: res.ok, status: res.status, data };
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

    let data = null;
    if (res.ok) {
      try { data = await res.json(); } catch (e) {}
    } else {
      try {
        const txt = await res.text();
        log('changeLineByIndex failed', { status: res.status, statusText: res.statusText, body: txt });
      } catch (e) {
        log('changeLineByIndex failed (no body)', { status: res.status, statusText: res.statusText });
      }
    }

    log('changeLineByIndex response', { line: lineIndex, quantity, status: res.status, ok: res.ok });
    return { ok: res.ok, status: res.status, data };
  }

  function mapKeyToLine(cart) {
    const map = {};
    if (!cart || !Array.isArray(cart.items)) return map;
    cart.items.forEach((item, idx) => {
      map[item && item.key] = idx + 1; // Shopify line index is 1-based
    });
    return map;
  }

  function summarizePlan(plan, label) {
    if (!debug || !plan) return;
    log(label || 'plan', {
      parentUnits: plan.parentUnits,
      addonUnits: plan.addonUnits,
      changes: plan.changes
    });
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

    const changeResults = [];
    log('mutation payload', { changes: plan.changes, sectionsPayload: !!sectionsPayload });

    // Apply sequentially to avoid race conditions with line indexing
    for (const ch of plan.changes) {
      log('changeLine', ch);
      const res = await changeLineByKey(ch.key, ch.quantity, sectionsPayload);
      changeResults.push({ key: ch.key, ok: !!(res && res.ok), status: res && res.status });
    }

    const verified = await verifyAndRepair({ usedFallback: false, sectionsPayload, changeResults });
    await refreshCartUI(sectionsPayload);
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
    const options = Object.assign({ usedFallback: false, sectionsPayload: null, changeResults: [] }, opts || {});
    const cartAfter = await getCart();
    const postPlan = buildPlan(cartAfter);

    summarizePlan(postPlan, 'post-mutation snapshot');

    if (postPlan.addonUnits <= postPlan.parentUnits || !postPlan.changes.length) {
      log('post-mutation verified');
      checkDrawerDesync(cartAfter, options.sectionsPayload);
      return true;
    }

    const hadFailedMutation = Array.isArray(options.changeResults) && options.changeResults.some((r) => r && r.ok === false);

    if (options.usedFallback) {
      log('post-mutation quota still violated after fallback; giving up to avoid loop', postPlan);
      return false;
    }

    // Retry once using latest cart snapshot and line indexes
    const keyToLine = mapKeyToLine(cartAfter);
    const filteredChanges = postPlan.changes.filter((ch) => keyToLine[ch.key]);
    if (!filteredChanges.length) {
      log('no fallback candidates found; aborting retry');
      return false;
    }

    const fallbackReason = hadFailedMutation ? 'retry_after_failed_mutation' : 'retry_after_invalid_quota';
    log('retrying with line indexes', { filteredChanges, keyToLine, reason: fallbackReason });
    await applyPlanWithLineIndexes(Object.assign({}, postPlan, { changes: filteredChanges }), keyToLine, options.sectionsPayload || getSectionsPayload());
    await refreshCartUI(options.sectionsPayload || getSectionsPayload());

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

      summarizePlan(plan, 'cart snapshot');
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
    const detail = (e && e.detail) || {};
    const reason = detail.reason || 'stable';
    const txnId = detail.txnId ? Number(detail.txnId) : 0;

    if (detail.internal) {
      log('skip internal stable event', detail);
      return;
    }

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
