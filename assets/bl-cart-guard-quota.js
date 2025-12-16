(function () {
  window.BL = window.BL || {};
  const BL = window.BL;

  // Identify add-ons (choose ONE primary signal and keep it consistent)
  const CFG = {
    // Most reliable: line item property set when add-on is added
    propIsAddon: '_bl_is_addon',   // value "1"
    // Fallback: handle match (only if you truly have a dedicated add-on product)
    addonHandle: 'mystery-add-on',
    // Debug toggle
    debugParam: 'cart_guard_debug'
  };

  const debug = (() => {
    try { return new URL(location.href).searchParams.get(CFG.debugParam) === '1'; }
    catch (e) { return false; }
  })();
  const log = (...a) => { if (debug) console.log('[BL:guard]', ...a); };

  let running = false;
  let queued = false;

  function isAddonItem(item) {
    if (!item) return false;

    // Ajax cart returns properties as object under `properties`
    const p = item.properties || {};
    if (String(p[CFG.propIsAddon] || '') === '1') return true;

    // Fallback handle-based (item.handle can be missing in some themes; item.url usually exists)
    const url = String(item.url || '');
    if (url.includes('/products/' + CFG.addonHandle)) return true;

    return false;
  }

  async function getCart() {
    const res = await fetch('/cart.js', {
      credentials: 'same-origin',
      headers: { 'X-BL-INTERNAL': '1' }
    });
    return res.json();
  }

  async function changeLine(lineIndex1Based, quantity) {
    // IMPORTANT: use line numbers from cart.items order (1-based)
    await fetch('/cart/change.js', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'X-BL-CART-GUARD': '1'
      },
      body: JSON.stringify({ line: lineIndex1Based, quantity: quantity })
    });
  }

  async function enforceQuota(cart) {
    const items = cart && cart.items ? cart.items : [];

    let parentUnits = 0;
    let addonLines = []; // { line, qty }

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const line = i + 1;

      if (isAddonItem(it)) {
        addonLines.push({ line, qty: it.quantity });
      } else {
        parentUnits += (it.quantity || 0);
      }
    }

    const addonUnits = addonLines.reduce((s, x) => s + (x.qty || 0), 0);

    log({ parentUnits, addonUnits, addonLines });

    if (addonUnits <= parentUnits) return { changed: false };

    // Need to reduce add-ons down to parentUnits
    let toRemove = addonUnits - parentUnits;

    // Deterministic policy: remove from the last add-on line backward
    for (let i = addonLines.length - 1; i >= 0 && toRemove > 0; i--) {
      const ln = addonLines[i];
      const canReduce = Math.min(ln.qty, toRemove);
      const newQty = ln.qty - canReduce;

      log('reduce addon line', ln.line, 'from', ln.qty, 'to', newQty);

      await changeLine(ln.line, newQty);
      toRemove -= canReduce;
    }

    return { changed: true };
  }

  async function runGuard(reason) {
    if (running) { queued = true; return; }
    running = true;
    queued = false;

    try {
      const cart = await getCart();
      const res = await enforceQuota(cart);
      if (res.changed) {
        // Optional: emit a message event for UI (toast/banner)
        document.dispatchEvent(new CustomEvent('bl:cartguard:message', {
          detail: { type: 'warning', text: 'Add-ons cannot exceed the number of items in your cart.' }
        }));
      }
    } catch (e) {
      console.warn('[BL:guard] error', e);
    } finally {
      running = false;
      if (queued) {
        // If updates happened while we were running, run again once
        setTimeout(() => runGuard('queued'), 120);
      }
    }
  }

  document.addEventListener('bl:cart:stable', (e) => {
    runGuard((e && e.detail && e.detail.reason) || 'stable');
  });
})();
