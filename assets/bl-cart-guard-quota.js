(function () {
  window.BL = window.BL || {};
  const BL = window.BL;

  // =========================
  // CONFIG — adjust these
  // =========================
  const CFG = {
    // Best signal: line-item property on add-on lines
    propIsAddon: '_bl_is_addon', // value must be "1"

    // Optional fallback: add-on product handle (only if you have one dedicated add-on product)
    addonHandle: 'mystery-add-on',

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
  function isAddonItem(item) {
    if (!item) return false;

    // 1) Strong signal: property
    const props = item.properties || {};
    if (String(props[CFG.propIsAddon] || '') === '1') return true;

    // 2) Fallback: URL contains /products/<handle>
    const url = String(item.url || '');
    if (CFG.addonHandle && url.includes('/products/' + CFG.addonHandle)) return true;

    return false;
  }

  async function getCart() {
    const res = await fetch('/cart.js', {
      credentials: 'same-origin',
      headers: { 'X-BL-INTERNAL': '1' }
    });
    return res.json();
  }

  async function changeLineByKey(lineKey, quantity) {
    await fetch('/cart/change.js', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        [CFG.internalHeader]: '1'
      },
      body: JSON.stringify({ id: lineKey, quantity })
    });
  }

  // Build an action plan based on current cart snapshot
  function buildPlan(cart) {
    const items = (cart && cart.items) ? cart.items : [];

    let parentUnits = 0;
    let addonLines = []; // { key, qty, url }

    for (let i = 0; i < items.length; i++) {
      const it = items[i];

      if (isAddonItem(it)) {
        addonLines.push({ key: it.key, qty: Number(it.quantity || 0), url: it.url || '' });
      } else {
        parentUnits += Number(it.quantity || 0);
      }
    }

    const addonUnits = addonLines.reduce((s, x) => s + (x.qty || 0), 0);

    // Core rule: addonUnits <= parentUnits
    if (addonUnits <= parentUnits) {
      return {
        parentUnits,
        addonUnits,
        changes: [],
        message: null
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
      message: `Add-ons cannot exceed the number of items in your cart.`
    };
  }

  async function applyPlan(plan) {
    if (!plan.changes || !plan.changes.length) return false;

    // Important: applying changes triggers cart mutation requests -> stable -> guard again
    // We mute internal stable events briefly to avoid loops.
    muteInternal();

    // Apply sequentially to avoid race conditions with line indexing
    for (const ch of plan.changes) {
      log('changeLine', ch);
      await changeLineByKey(ch.key, ch.quantity);
    }
    return true;
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
        setTimeout(() => runGuard('queued'), 180);
      }
    }
  }

  // Run only at the correct time: after cart mutation + drawer settled
  document.addEventListener('bl:cart:stable', (e) => {
    const reason = (e && e.detail && e.detail.reason) || 'stable';
    const txnId = (e && e.detail && e.detail.txnId) ? Number(e.detail.txnId) : 0;
    runGuard(reason, txnId);
  });

})();
