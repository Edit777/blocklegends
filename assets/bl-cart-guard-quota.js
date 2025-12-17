/* =======================================================
   BLOCK LEGENDS — CARD GUARD (CART QUOTA ENFORCER)
   Enforces: sum(add-on qty) <= sum(parent qty)
   Deterministic reduction (last add-on lines first)
   Debug: ?cart_guard_debug=1
   ======================================================= */

(function () {
  const CFG = {
    propIsAddon: '_bl_is_addon',
    addonHandle: 'mystery-add-on',
    addonHandles: [],
    debugParam: 'cart_guard_debug',
    internalHeader: 'X-BL-CART-GUARD',
    internalHeaderValue: '1',
    muteAfterEnforceMs: 1400,
    drawerSections: ['cart-drawer', 'cart-icon-bubble', 'main-cart-items', 'main-cart-footer', 'cart-live-region-text'],
    quotaMessage: 'Add-ons cannot exceed the number of parent items in your cart.'
  };

  const debug = (() => {
    try { return new URL(location.href).searchParams.get(CFG.debugParam) === '1'; }
    catch (e) { return false; }
  })();
  const log = (...args) => { if (debug) console.log('[BL:CardGuard]', ...args); };

  const state = {
    isRunning: false,
    queued: false,
    muteUntil: 0,
    lastTxnId: 0,
    cycleCounter: 0,
    rerunTimer: null
  };

  const addonHandleList = (() => {
    const handles = [];
    if (CFG.addonHandle) handles.push(CFG.addonHandle);
    if (Array.isArray(CFG.addonHandles)) handles.push(...CFG.addonHandles);
    return handles.filter(Boolean).map((h) => String(h).toLowerCase());
  })();

  function nextCycleId() {
    state.cycleCounter += 1;
    return `${Date.now()}-${state.cycleCounter}`;
  }

  function isMuted() {
    return Date.now() < state.muteUntil;
  }

  function muteGuard() {
    state.muteUntil = Date.now() + CFG.muteAfterEnforceMs;
  }

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

  function classifyLine(item, index) {
    const props = (item && item.properties) || {};
    const url = String((item && item.url) || '');
    const handle = extractHandle(url);
    const isAddonByProp = String(props[CFG.propIsAddon] || '') === '1';
    const isAddonByHandle = addonHandleList.length ? addonHandleList.includes(handle) : false;
    const isAddon = isAddonByProp || isAddonByHandle;

    return {
      index,
      key: item && item.key,
      quantity: Number((item && item.quantity) || 0),
      title: (item && item.title) || '',
      url,
      handle,
      propsSummary: summarizeProps(props),
      isAddon,
      addonReason: isAddonByProp ? 'prop' : (isAddonByHandle ? 'url' : ''),
    };
  }

  function buildPlan(cart) {
    const items = Array.isArray(cart && cart.items) ? cart.items : [];
    const classifications = items.map((item, idx) => classifyLine(item, idx + 1));

    let parentUnits = 0;
    const addonLines = [];

    classifications.forEach((c) => {
      if (c.isAddon) {
        addonLines.push(c);
      } else {
        parentUnits += c.quantity;
      }
    });

    const addonUnits = addonLines.reduce((s, x) => s + (x.quantity || 0), 0);

    if (addonUnits <= parentUnits) {
      return {
        parentUnits,
        addonUnits,
        changes: [],
        classifications,
        message: null,
        excess: 0
      };
    }

    let remaining = addonUnits - parentUnits;
    const changes = [];

    const ordered = addonLines.slice().sort((a, b) => b.index - a.index);
    for (const ln of ordered) {
      if (remaining <= 0) break;
      if (!ln.quantity) continue;
      const reduceBy = Math.min(ln.quantity, remaining);
      const newQty = ln.quantity - reduceBy;
      remaining -= reduceBy;
      changes.push({
        line: ln.index,
        key: ln.key,
        from: ln.quantity,
        to: newQty,
        reduceBy,
        title: ln.title,
        url: ln.url
      });
    }

    return {
      parentUnits,
      addonUnits,
      changes,
      classifications,
      message: CFG.quotaMessage,
      excess: addonUnits - parentUnits
    };
  }

  function getSectionsPayload() {
    const payload = { sections: [], sections_url: (window.location && window.location.pathname) || '/' };

    CFG.drawerSections.forEach((id) => {
      if (document.getElementById(id)) payload.sections.push(id);
    });

    return payload.sections.length ? payload : null;
  }

  async function fetchCart() {
    const res = await fetch('/cart.js', {
      credentials: 'same-origin',
      headers: { 'X-BL-CARDGUARD': '1' }
    });
    return res.json();
  }

  async function changeLineQuantity(change, sectionsPayload, cycleId) {
    const body = Object.assign({ line: change.line, quantity: change.to }, sectionsPayload || {});
    const payloadStr = JSON.stringify(body);

    log('request/change', { cycleId, line: change.line, quantity: change.to, key: change.key, payload: body });

    const res = await fetch('/cart/change.js', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        [CFG.internalHeader]: CFG.internalHeaderValue
      },
      body: payloadStr
    });

    if (!res.ok && debug) {
      let txt = '';
      try { txt = await res.text(); } catch (e) { txt = '[no body]'; }
      console.warn('[BL:CardGuard] change failed', { status: res.status, statusText: res.statusText, body: txt });
    }
    return res.ok;
  }

  function emitMessage(text) {
    if (!text) return;
    document.dispatchEvent(new CustomEvent('bl:cartguard:message', {
      detail: { type: 'warning', text }
    }));
  }

  async function enforcePlan(plan, cycleId, attempt) {
    attempt = attempt || 0;
    if (!plan.changes.length) return { ok: true, attempt };

    muteGuard();
    const sectionsPayload = getSectionsPayload();

    for (const change of plan.changes) {
      await changeLineQuantity(change, sectionsPayload, cycleId);
    }

    const freshCart = await fetchCart();
    const freshPlan = buildPlan(freshCart);

    if (freshPlan.addonUnits <= freshPlan.parentUnits || !freshPlan.changes.length) {
      return { ok: true, attempt };
    }

    if (attempt >= 1) {
      log('verification failed after retry', { cycleId, plan: freshPlan });
      return { ok: false, attempt };
    }

    log('verification detected remaining excess; retrying once', { cycleId, nextChanges: freshPlan.changes });
    return enforcePlan(freshPlan, cycleId, attempt + 1);
  }

  async function runGuard(reason, txnId, source) {
    if (txnId && txnId < state.lastTxnId) return;
    if (txnId) state.lastTxnId = txnId;

    if (isMuted() && reason !== 'queued') {
      clearTimeout(state.rerunTimer);
      const waitMs = Math.max(120, state.muteUntil - Date.now() + 50);
      state.rerunTimer = setTimeout(() => runGuard('queued', txnId || state.lastTxnId, source), waitMs);
      return;
    }

    if (state.isRunning) {
      state.queued = true;
      return;
    }

    state.isRunning = true;
    state.queued = false;

    const cycleId = nextCycleId();

    try {
      const cart = await fetchCart();
      const plan = buildPlan(cart);

      if (debug) {
        log('cycle:start', { cycleId, reason, txnId, source });
        log('classification', plan.classifications.map((c) => ({
          line: c.index,
          qty: c.quantity,
          key: c.key,
          isAddon: c.isAddon,
          reason: c.addonReason,
          handle: c.handle,
          props: c.propsSummary
        })));
        log('totals', { parentUnits: plan.parentUnits, addonUnits: plan.addonUnits, excess: plan.excess });
      }

      if (plan.changes.length) {
        log('action-plan', { cycleId, changes: plan.changes });
        emitMessage(plan.message);
        const result = await enforcePlan(plan, cycleId, 0);
        log('cycle:end', { cycleId, result });
      } else {
        log('cycle:end (no-op)', { cycleId, reason, txnId });
      }
    } catch (e) {
      console.warn('[BL:CardGuard] error', e);
    } finally {
      state.isRunning = false;
      if (state.queued) {
        state.queued = false;
        setTimeout(() => runGuard('queued', state.lastTxnId), 160);
      }
    }
  }

  document.addEventListener('bl:cart:stable', (event) => {
    const detail = (event && event.detail) || {};
    runGuard(detail.reason || 'stable', Number(detail.txnId) || 0, detail.source || 'external');
  });
})();
