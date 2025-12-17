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

    lastAddonKeyStorage: 'BL_LAST_ADDON_KEY',
    lastAddonTsStorage: 'BL_LAST_ADDON_TS',
    lastAddonMetaStorage: 'BL_LAST_ADDON_META'
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
  let lastTxnId = 0;
  let prevAddonKeys = new Set();
  let lastMsgTs = 0;
  let lastMsgSig = '';
  let lastTouchedAddonKey = null;
  let latestCartSnapshot = null;
  let latestClassificationsByKey = {};

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

  function readLastAddonKey() {
    try {
      const key = localStorage.getItem(CFG.lastAddonKeyStorage);
      lastTouchedAddonKey = key || null;
      return lastTouchedAddonKey;
    } catch (e) {
      return null;
    }
  }

  function writeLastAddonKey(key, meta) {
    try {
      if (!key) return;
      const ts = Date.now();
      localStorage.setItem(CFG.lastAddonKeyStorage, key);
      localStorage.setItem(CFG.lastAddonTsStorage, String(ts));
      const payload = Object.assign({ ts, key }, meta || {});
      localStorage.setItem(CFG.lastAddonMetaStorage, JSON.stringify(payload));
      lastTouchedAddonKey = key;
    } catch (e) {}
  }

  function getLastTouchedAddonKey() {
    return lastTouchedAddonKey || readLastAddonKey();
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

  function getDrawerElement() {
    return document.querySelector('cart-drawer') || document.getElementById('CartDrawer');
  }

  function getDrawerItemsElement() {
    return document.querySelector('cart-drawer-items');
  }

  function resolveSectionIdFromDom(el, fallbackId) {
    if (!el) return fallbackId;
    const sectionEl = el.closest('section[id^="shopify-section-"]');
    if (!sectionEl || !sectionEl.id) return fallbackId;
    return sectionEl.id.replace('shopify-section-', '') || fallbackId;
  }

  function collectSectionTargets() {
    const targets = [];
    const seen = new Set();
    const sectionsUrl = window.location ? window.location.pathname + window.location.search : '/';

    function addTarget(entry) {
      if (!entry) return;
      const id = entry.id || entry.section;
      const section = entry.section || entry.id;
      if (!id || !section || seen.has(id)) return;
      const selector = entry.selector || null;
      let target = entry.target || null;

      if (!target && selector) {
        target = (document.getElementById(id) && document.getElementById(id).querySelector(selector)) || document.querySelector(selector);
      }
      if (!target) {
        target = document.getElementById(`shopify-section-${id}`) || document.getElementById(id);
      }

      targets.push({ id, section, selector, target });
      seen.add(id);
    }

    function importFrom(owner, label) {
      if (!owner || typeof owner.getSectionsToRender !== 'function') return;
      try {
        const arr = owner.getSectionsToRender();
        if (!Array.isArray(arr)) return;
        arr.forEach((entry) => addTarget(entry));
      } catch (e) {
        log('collectSectionTargets error from', label, e);
      }
    }

    importFrom(getDrawerItemsElement(), 'cart-drawer-items');
    importFrom(getDrawerElement(), 'cart-drawer');

    if (!targets.length) {
      const drawer = getDrawerElement();
      const drawerId = resolveSectionIdFromDom(drawer, 'cart-drawer');
      if (drawer) {
        const selector = drawer.id ? `#${drawer.id}` : null;
        addTarget({ id: drawerId, section: drawerId, selector, target: drawer });
      }

      const bubble = document.getElementById('cart-icon-bubble');
      if (bubble) {
        const bubbleId = resolveSectionIdFromDom(bubble, 'cart-icon-bubble');
        const selector = bubble.id ? `#${bubble.id}` : null;
        addTarget({ id: bubbleId, section: bubbleId, selector, target: bubble });
      }
    }

    return { sections: targets, sectionsUrl };
  }

  function patchSections(sectionHtmls, sections) {
    if (!sectionHtmls || !sections || !sections.length) return false;

    let applied = false;
    sections.forEach((entry) => {
      const secId = entry.section || entry.id;
      const html = sectionHtmls[secId];
      if (!html) return;

      const liveContainer = entry.target
        || (entry.selector && ((document.getElementById(entry.id) && document.getElementById(entry.id).querySelector(entry.selector)) || document.querySelector(entry.selector)))
        || document.getElementById(`shopify-section-${entry.id}`)
        || document.getElementById(entry.id);
      if (!liveContainer) return;

      const dom = new DOMParser().parseFromString(html, 'text/html');
      const parsed = entry.selector ? dom.querySelector(entry.selector) : dom.body.firstElementChild;
      if (!parsed) {
        log('refreshCartUI selector missing in HTML', { selector: entry.selector, id: entry.id, secId });
        console.warn('[BL:guard] cart UI refresh skipped; selector not found', entry.selector);
        return;
      }

      const targetTag = (liveContainer.tagName || '').toLowerCase();
      const isDrawerItems = targetTag === 'cart-drawer-items' || liveContainer.classList?.contains('cart-items');
      const isBubble = liveContainer.id === 'cart-icon-bubble';
      const isDrawer = targetTag === 'cart-drawer';

      if (entry.selector && liveContainer.matches && liveContainer.matches(entry.selector)) {
        liveContainer.replaceWith(parsed);
        applied = true;
        return;
      }

      if (entry.selector) {
        liveContainer.innerHTML = parsed.innerHTML || '';
        applied = true;
        return;
      }

      if (isDrawerItems || isBubble || isDrawer) {
        liveContainer.innerHTML = parsed.innerHTML || html;
        applied = true;
      }
    });

    return applied;
  }

  async function refreshCartUI(reason) {
    const reasonLabel = reason || 'guard';

    const apiCandidates = [
      { el: getDrawerItemsElement(), label: 'cart-drawer-items', methods: ['updateCart', 'renderContents', 'refresh'] },
      { el: getDrawerElement(), label: 'cart-drawer', methods: ['updateCart', 'renderContents', 'refresh'] }
    ];

    for (const candidate of apiCandidates) {
      if (!candidate.el) continue;
      const fnName = candidate.methods.find((m) => typeof candidate.el[m] === 'function');
      if (!fnName) continue;
      try {
        log('refreshCartUI via theme API', { reason: reasonLabel, target: candidate.label, fn: fnName });
        candidate.el[fnName]();
        return true;
      } catch (e) {
        log('theme API refresh failed', e);
      }
    }

    const { sections, sectionsUrl } = collectSectionTargets();
    if (!sections.length) return false;

    const sectionIds = sections.map((s) => s.section || s.id).filter(Boolean);
    const urlBase = sectionsUrl || (window.location ? window.location.pathname + window.location.search : '/');
    const joiner = urlBase.includes('?') ? '&' : '?';
    const fetchUrl = `${urlBase}${joiner}sections=${sectionIds.join(',')}`;

    let data = null;
    try {
      const res = await fetch(fetchUrl, {
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          'X-BL-INTERNAL': '1',
          [CFG.internalHeader]: '1'
        }
      });
      if (res.ok) data = await res.json();
    } catch (e) {
      log('refreshCartUI GET error', e);
    }

    const sectionHtmls = data && (data.sections || data);
    if (!sectionHtmls) return false;

    const applied = patchSections(sectionHtmls, sections);

    return applied;
  }

  BL.refreshCartUI = refreshCartUI;

  function getDrawerQtyByKey(lineKey) {
    const drawer = getDrawerElement();
    if (!drawer || !lineKey) return null;

    const safeKey = window.CSS && window.CSS.escape ? window.CSS.escape(lineKey) : lineKey;
    const item = drawer.querySelector(`[data-line-key="${safeKey}"]`);
    if (!item) return null;

    const input = item.querySelector('input[name="updates[]"], input[name="updates"]');
    if (!input) return null;

    const parsed = Number(input.value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function logAndHandleDrawerDesync(cart, reason) {
    if (!debug || !cart || !Array.isArray(cart.items)) return false;

    let desynced = false;
    cart.items.forEach((item) => {
      const cls = classifyItem(item);
      if (!cls.isAddonFinal) return;

      const cartQty = Number(item.quantity || 0);
      const drawerQty = getDrawerQtyByKey(item.key);
      log('post-verify qty check', { key: item.key, cartQty, drawerQty });

      if (drawerQty !== null && drawerQty !== cartQty) {
        desynced = true;
        console.warn('[BL:guard] UI DESYNC: drawer shows', drawerQty, 'cart.js shows', cartQty, { key: item.key });
      }
    });

    if (desynced) {
      log('UI desync detected; refreshing drawer UI');
      refreshCartUI(reason || 'desync');
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
  function getPreferredAddonKeyFromCart(cart, addonLines) {
    const storedKey = getLastTouchedAddonKey();
    if (!storedKey) return null;
    return addonLines.some((ln) => ln.key === storedKey) ? storedKey : null;
  }

  function buildPlan(cart, preClassifications) {
    const items = (cart && cart.items) ? cart.items : [];
    const classifications = preClassifications || items.map((it) => classifyItem(it));

    let parentUnits = 0;
    let addonLines = []; // { key, qty, url, title }
    const keyToItem = {};

    classifications.forEach((c, idx) => {
      const src = items[idx] || {};
      if (src && src.key) keyToItem[src.key] = src;
      if (c.isAddonFinal) {
        addonLines.push({ key: src.key, qty: c.quantity, url: c.url || '', title: src.title || '' });
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
        classifications,
        addonUnitsAfter: addonUnits,
        preferredKeyUsed: false,
        removed: []
      };
    }

    let toRemove = addonUnits - parentUnits;
    let changes = [];

    const preferredKey = getPreferredAddonKeyFromCart(cart, addonLines);

    // Deterministic removal policy
    let ordered = (CFG.removePolicy === 'last')
      ? addonLines.slice().reverse()
      : addonLines.slice(); // 'first'

    if (preferredKey) {
      const preferred = addonLines.find((l) => l.key === preferredKey);
      ordered = [preferred, ...ordered.filter((l) => l && l.key !== preferredKey)];
    }

    for (const ln of ordered) {
      if (toRemove <= 0) break;
      if (!ln.qty) continue;

      const reduceBy = Math.min(ln.qty, toRemove);
      const newQty = ln.qty - reduceBy;

      changes.push({
        key: ln.key,
        quantity: newQty,
        fromQty: ln.qty,
        toQty: newQty,
        title: ln.title
      });
      toRemove -= reduceBy;
    }

    const removedUnits = (addonUnits - parentUnits) - toRemove;
    const addonUnitsAfter = addonUnits - removedUnits;
    const removed = changes.map((ch) => ({ key: ch.key, title: ch.title, fromQty: ch.fromQty, toQty: ch.toQty }));

    let message = WARNING_TEXT;

    return {
      parentUnits,
      addonUnits,
      changes,
      message,
      classifications,
      addonUnitsAfter,
      preferredKeyUsed: !!preferredKey,
      removed
    };
  }

  async function applyPlan(plan) {
    if (!plan.changes || !plan.changes.length) return false;

    // Important: applying changes triggers cart mutation requests -> stable -> guard again
    // We mute internal stable events briefly to avoid loops.
    muteInternal();

    const changeResults = [];
    log('mutation payload', { changes: plan.changes });

    const { sections, sectionsUrl } = collectSectionTargets();
    const sectionIds = sections.map((s) => s.section || s.id).filter(Boolean);
    const sectionsPayload = sectionIds.length ? { sections: sectionIds, sections_url: sectionsUrl } : null;
    let patchedSections = false;

    // Apply sequentially to avoid race conditions with line indexing
    for (let i = 0; i < plan.changes.length; i++) {
      const ch = plan.changes[i];
      log('changeLine', ch);
      const res = await changeLineByKey(ch.key, ch.quantity, (i === plan.changes.length - 1) ? sectionsPayload : null);
      changeResults.push({ key: ch.key, ok: !!(res && res.ok), status: res && res.status });

      if (res && res.ok && res.data && res.data.sections && sectionsPayload && !patchedSections) {
        const applied = patchSections(res.data.sections, sections);
        patchedSections = applied || patchedSections;
      }
    }

    const verified = await verifyAndRepair({ usedFallback: false, changeResults });
    if (verified && !patchedSections) {
      await refreshCartUI('applied_plan');
    }

    return verified;
  }

  async function applyPlanWithLineIndexes(plan, keyToLine) {
    if (!plan.changes || !plan.changes.length) return false;

    muteInternal();

    for (const ch of plan.changes) {
      const line = keyToLine[ch.key];
      if (!line) continue;
      log('changeLine(fallback)', { line, quantity: ch.quantity, key: ch.key });
      await changeLineByIndex(line, ch.quantity);
    }

    return true;
  }

  async function verifyAndRepair(opts) {
    const options = Object.assign({ usedFallback: false, changeResults: [] }, opts || {});
    const cartAfter = await getCart();
    latestCartSnapshot = cartAfter;
    const postPlan = buildPlan(cartAfter);

    if (cartAfter && Array.isArray(cartAfter.items)) {
      latestClassificationsByKey = {};
      cartAfter.items.forEach((it) => {
        const cls = classifyItem(it);
        if (it && it.key) latestClassificationsByKey[it.key] = cls;
      });
    }

    summarizePlan(postPlan, 'post-mutation snapshot');

    if (postPlan.addonUnits <= postPlan.parentUnits || !postPlan.changes.length) {
      log('post-mutation verified');
      logAndHandleDrawerDesync(cartAfter, options.reason || 'verify');
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
    await applyPlanWithLineIndexes(Object.assign({}, postPlan, { changes: filteredChanges }), keyToLine);
    await refreshCartUI('fallback_apply');

    // Verify once more and stop (no further retries to avoid loops)
    return verifyAndRepair({ usedFallback: true });
  }

  function emitMessage(text, plan) {
    if (!text) return;

    const planData = plan || {};
    const sig = JSON.stringify({
      parentUnits: planData.parentUnits,
      addonBefore: planData.addonUnits,
      addonAfter: planData.addonUnitsAfter,
      removedKeys: (planData.removed || []).map((r) => r.key)
    });

    const now = Date.now();
    if ((now - lastMsgTs < 1500) && sig === lastMsgSig) return;
    lastMsgTs = now;
    lastMsgSig = sig;

    document.dispatchEvent(new CustomEvent('bl:cartguard:message', {
      detail: {
        type: 'warning',
        text,
        parentUnits: planData.parentUnits,
        addonUnitsBefore: planData.addonUnits,
        addonUnitsAfter: planData.addonUnitsAfter,
        removed: planData.removed || [],
        reason: 'quota_exceeded',
        preferredKeyUsed: !!planData.preferredKeyUsed
      }
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
          runGuard('queued', txnId || lastTxnId);
        }, delay);
      }
      return;
    }

    if (txnId && txnId < lastTxnId) {
      return;
    }
    if (txnId) {
      lastTxnId = txnId;
    }

    if (running) { queued = true; return; }
    running = true;
    queued = false;

    try {
      const cart = await getCart();
      const classifications = (cart && cart.items ? cart.items : []).map((it) => classifyItem(it));
      latestCartSnapshot = cart;
      latestClassificationsByKey = {};
      classifications.forEach((cls, idx) => {
        const item = cart && cart.items ? cart.items[idx] : null;
        if (item && item.key) latestClassificationsByKey[item.key] = cls;
      });

      const currentAddonKeys = [];
      classifications.forEach((cls, idx) => {
        if (!cls || !cls.isAddonFinal) return;
        const item = cart.items[idx];
        if (item && item.key) currentAddonKeys.push(item.key);
      });

      const currentAddonSet = new Set(currentAddonKeys);
      const newKeys = currentAddonKeys.filter((k) => !prevAddonKeys.has(k));
      if (newKeys.length) {
        for (let i = currentAddonKeys.length - 1; i >= 0; i--) {
          const candidate = currentAddonKeys[i];
          if (newKeys.includes(candidate)) {
            writeLastAddonKey(candidate, { source: 'cart_new_line', action: 'add' });
            break;
          }
        }
      }
      prevAddonKeys = currentAddonSet;

      const plan = buildPlan(cart, classifications);

      summarizePlan(plan, 'cart snapshot');
      log({ reason, txnId, parentUnits: plan.parentUnits, addonUnits: plan.addonUnits, changes: plan.changes });

      if (plan.changes.length) {
        emitMessage(plan.message, plan);
        await applyPlan(plan);
      }
    } catch (e) {
      console.warn('[BL:guard] error', e);
    } finally {
      running = false;
      if (queued) {
        // Run once more after queued changes settle
        setTimeout(() => runGuard('queued', lastTxnId), 180);
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

  document.addEventListener('bl:cart:mutated', (e) => {
    const detail = (e && e.detail) || {};
    if (detail.internal) return;

    const reason = detail.reason || 'mutated';
    const txnId = detail.txnId ? Number(detail.txnId) : 0;
    runGuard(reason, txnId);
  });

  function findLineKeyWrapper(target) {
    if (!target || !target.closest) return null;
    return target.closest('[data-line-key]');
  }

  function deriveActionFromButton(el) {
    if (!el) return null;
    const name = (el.getAttribute && el.getAttribute('name')) || '';
    const aria = (el.getAttribute && el.getAttribute('aria-label')) || '';
    const label = `${name} ${aria}`.toLowerCase();

    if (label.includes('plus') || label.includes('increase') || label.includes('add') || label.includes('increment')) return 'inc';
    if (label.includes('minus') || label.includes('decrease') || label.includes('remove') || label.includes('decrement')) return 'dec';
    return null;
  }

  function recordAddonIntent(lineKey, meta, wrapper) {
    if (!lineKey) return;
    if (isAddonWrapper(wrapper, lineKey)) {
      writeLastAddonKey(lineKey, Object.assign({ ts: Date.now() }, meta));
    }
  }

  function onAnyClickCapture(event) {
    try {
      const target = event.target;
      const wrapper = findLineKeyWrapper(target);
      if (!wrapper) return;

      const drawer = getDrawerElement();
      if (!drawer || !drawer.contains(wrapper)) return;

      const btn = target && target.closest ? target.closest('button') : null;
      const action = deriveActionFromButton(btn);

      const lineKey = wrapper.getAttribute('data-line-key');
      const meta = { source: 'drawer_click', action: action || 'set' };
      recordAddonIntent(lineKey, meta, wrapper);
    } catch (e) {}
  }

  function onAnyChangeCapture(event) {
    try {
      const target = event.target;
      const wrapper = findLineKeyWrapper(target);
      if (!wrapper) return;

      const drawer = getDrawerElement();
      if (!drawer || !drawer.contains(wrapper)) return;

      const lineKey = wrapper.getAttribute('data-line-key');
      const meta = { source: 'drawer_change', action: 'set' };
      recordAddonIntent(lineKey, meta, wrapper);
    } catch (e) {}
  }

  document.addEventListener('click', onAnyClickCapture, true);
  document.addEventListener('change', onAnyChangeCapture, true);

  // =========================
  // PREFLIGHT & UI HELPERS
  // =========================
  function isAddonKey(lineKey) {
    if (!lineKey) return false;
    const cls = latestClassificationsByKey[lineKey];
    return !!(cls && cls.isAddonFinal);
  }

  function isAddonWrapper(wrapper, lineKey) {
    if (!wrapper) return false;
    if (isAddonKey(lineKey)) return true;

    const clsName = wrapper.className || '';
    if (addonHandleList.length) {
      const handleMatch = clsName.match(/cart-item--product-([\w-]+)/);
      const handle = handleMatch ? handleMatch[1].toLowerCase() : '';
      if (handle && addonHandleList.includes(handle)) return true;
    }

    return false;
  }

  function getDrawerQtyFromInput(wrapper) {
    if (!wrapper) return null;
    const input = wrapper.querySelector('input[name="updates[]"], input[name="updates"]');
    if (!input) return null;
    const parsed = Number(input.value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function calculatePreflightTotals(lineKey, currentQty) {
    if (!latestCartSnapshot || !Array.isArray(latestCartSnapshot.items)) return null;
    let parentUnits = 0;
    let addonUnits = 0;
    latestCartSnapshot.items.forEach((it) => {
      const cls = latestClassificationsByKey[it.key];
      if (!cls) return;
      const qty = it.quantity || 0;
      if (cls.isAddonFinal) {
        addonUnits += qty;
      } else {
        parentUnits += qty;
      }
    });

    if (lineKey && Number.isFinite(currentQty)) {
      const cls = latestClassificationsByKey[lineKey];
      if (cls && cls.isAddonFinal) {
        const recordedQty = latestCartSnapshot.items.find((i) => i && i.key === lineKey)?.quantity || 0;
        addonUnits = addonUnits - recordedQty + currentQty;
      }
    }

    return { parentUnits, addonUnits };
  }

  const WARNING_TEXT = 'Add-ons can’t exceed the number of figures in your cart. Add another figure to increase add-ons.';

  function findDrawerMessageHost() {
    const drawer = getDrawerElement();
    if (!drawer) return null;

    let host = drawer.querySelector('.bl-cart-guard-banner');
    if (host) return host;

    host = drawer.querySelector('.bl-cart-guard-msg');
    if (host) return host;

    host = document.createElement('div');
    host.className = 'bl-cart-guard-banner bl-cart-guard-msg';
    host.style.display = 'none';
    host.style.padding = '8px 12px';
    host.style.background = '#fff3cd';
    host.style.color = '#664d03';
    host.style.fontSize = '0.9rem';
    host.style.border = '1px solid #ffe69c';
    host.style.borderRadius = '6px';
    host.style.margin = '8px 16px';
    host.style.opacity = '0';
    host.style.transition = 'opacity 200ms ease';
    host.setAttribute('aria-live', 'polite');

    const totals = drawer.querySelector('.cart-drawer__totals');
    const parent = (totals && totals.parentElement) || drawer.querySelector('.drawer__footer') || drawer.querySelector('.drawer__inner') || drawer;
    const anchor = totals ? totals.nextElementSibling : parent.firstElementChild;
    parent.insertBefore(host, anchor || parent.firstChild);
    return host;
  }

  let guardMsgTimer = null;
  function showDrawerMessage(text) {
    const host = findDrawerMessageHost();
    if (!host || !text) return;

    host.textContent = text;
    host.style.display = 'block';
    requestAnimationFrame(() => { host.classList?.add('is-visible'); host.style.opacity = '1'; });

    if (guardMsgTimer) clearTimeout(guardMsgTimer);
    guardMsgTimer = setTimeout(() => {
      host.classList?.remove('is-visible');
      host.style.opacity = '0';
      setTimeout(() => {
        host.style.display = 'none';
        host.textContent = '';
      }, 250);
    }, 3800);
  }

  document.addEventListener('bl:cartguard:message', (e) => {
    const detail = (e && e.detail) || {};
    if (detail && detail.text) {
      showDrawerMessage(detail.text);
    }
  });

  document.addEventListener('bl:cart:stable', () => {
    const host = findDrawerMessageHost();
    if (host) {
      host.classList?.remove('is-visible');
      host.style.display = 'none';
      host.style.opacity = '0';
      host.textContent = '';
    }
  });

  function warnAndBlock(event, payload) {
    log('preflight block', payload || {});
    event.preventDefault();
    if (event.stopImmediatePropagation) event.stopImmediatePropagation();
    const text = WARNING_TEXT;
    document.dispatchEvent(new CustomEvent('bl:cartguard:message', { detail: { type: 'warning', text } }));
    showDrawerMessage(text);
  }

  function preflightIntercept(event) {
    try {
      const target = event.target;
      const wrapper = findLineKeyWrapper(target);
      if (!wrapper) return;
      const drawer = getDrawerElement();
      if (!drawer || !drawer.contains(wrapper)) return;

      const lineKey = wrapper.getAttribute('data-line-key');
      if (!isAddonWrapper(wrapper, lineKey)) return;

      if (event.type === 'click') {
        const btn = target && target.closest ? target.closest('button') : null;
        const action = deriveActionFromButton(btn);
        if (action !== 'inc') return;

        const qty = getDrawerQtyFromInput(wrapper);
        const totals = calculatePreflightTotals(lineKey, qty);
        if (!totals) return;
        const projectedAddonUnits = totals.addonUnits + 1;

        if (projectedAddonUnits > totals.parentUnits) {
          recordAddonIntent(lineKey, { source: 'preflight_click', action: 'inc_blocked' }, wrapper);
          warnAndBlock(event, { lineKey, projectedAddonUnits, parentUnits: totals.parentUnits });
        }
      } else if (event.type === 'change') {
        const input = target;
        if (!input || input.tagName?.toLowerCase() !== 'input') return;
        const newQty = Number(input.value);
        if (!Number.isFinite(newQty)) return;

        const totals = calculatePreflightTotals(lineKey, newQty);
        if (!totals) return;
        if (totals.addonUnits > totals.parentUnits) {
          const otherAddonUnits = totals.addonUnits - newQty;
          const allowedQty = Math.max(0, totals.parentUnits - otherAddonUnits);
          if (newQty > allowedQty) {
            input.value = allowedQty;
            recordAddonIntent(lineKey, { source: 'preflight_change', action: 'set_blocked' }, wrapper);
            warnAndBlock(event, { lineKey, newQty, allowedQty, parentUnits: totals.parentUnits });
          }
        }
      }
    } catch (e) {}
  }

  document.addEventListener('click', preflightIntercept, true);
  document.addEventListener('change', preflightIntercept, true);

  /*
   * How to test (with ?cart_guard_debug=1 for console logs)
   * 1) Add a parent product with qty=3 and add-on qty=3.
   * 2) Increase add-on to qty=4; expect guard to log changeLine + fallback retry (if needed) and final qty clamped to 3.
   * 3) Repeat with multiple add-on lines; last lines should be reduced first.
   * 4) If a change request fails, debug log will include status/body; guard retries once using line indexes.
   */

})();
