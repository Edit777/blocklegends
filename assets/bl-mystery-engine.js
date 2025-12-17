/* =======================================================
   BLOCK LEGENDS — MYSTERY ENGINE (SHARED)
   - Pool loading + filtering
   - VariantId -> (mode, rarity) mapping
   - Assign random product and inject line item properties
   - Lucky Box (Any Rarity / Full Collection Pool)
   ======================================================= */

(function () {
  window.BL = window.BL || {};
  window.BL.mysteryEngine = window.BL.mysteryEngine || {};

  var U = window.BL.utils;
  var M = window.BL.mysteryEngine;

  if (!U) {
    // Hard fail safely if core utils not loaded
    console.error('[BL Mystery] Missing BL.utils (core.js must load first)');
    return;
  }

  function isDebug() {
    try { return (window.BL && typeof window.BL.isDebug === 'function') ? window.BL.isDebug() : false; } catch (e) { return false; }
  }

  function debugLog() {
    if (!isDebug()) return;
    var args = Array.prototype.slice.call(arguments);
    try { console.log.apply(console, ['[BL Mystery][debug]'].concat(args)); } catch (e) {}
  }

  /* -----------------------------
     CONFIG
  ------------------------------ */
  M.CFG = M.CFG || {
    mysteryFigureHandle: 'mystery-figure',
    mysteryAddonHandle: 'mystery-add-on',

    poolView: 'mystery',
    defaultPoolCollectionHandle: 'all',

    allowedRarities: ['common', 'rare', 'epic', 'legendary'],
    hardExcludedRarities: ['special', 'mythical'],

    // Minimum per rarity to consider a rarity-tier "eligible" for a collection UI
    preferredMinPerRarity: 3,

    modeRandomLabel: 'Random Collection',
    modePreferredLabel: 'Preferred Collection',

    // Lucky Box / Any rarity
    anyRarityKey: 'any',
    anyRarityLabels: ['any', 'lucky box', 'any rarity', 'all rarities', 'full pool', 'lucky'],
    anyRarityWeights: {
  common: 0.60,
  rare: 0.25,
  epic: 0.10,
  legendary: 0.05
},

    // Internal properties (often hidden by themes if starting with "_")
    propAssignedHandle: '_assigned_handle',
    propAssignedTitle: '_assigned_title',
    propAssignedVariantId: '_assigned_variant_id',
    propAssignedRarity: '_assigned_rarity',
    propSelectedMode: '_selected_mode',
    propPreferredCollection: '_preferred_collection',
    propRequestedTier: '_requested_tier',

    // Add-on locked collection (written by Liquid)
    propLockedCollectionLegacy: '_bl_locked_collection',

    // Visible properties (for cart display; do NOT start with "_")
    propVisibleAssignedTitle: 'Assigned Figure',
    propVisibleAssignedRarity: 'Assigned Rarity',
    propVisibleRequestedTier: 'Requested Tier',
    propVisiblePoolUsed: 'Pool Used',
    propVisibleMode: 'Mode'
  };

  // Lucky Box rarity weights (must sum to 1.0 ideally)



  /* -----------------------------
     STATE
  ------------------------------ */
  var state = {
    pools: {},            // { collectionHandle: {common:[], rare:[], epic:[], legendary:[]} }
    poolPromises: {},     // { collectionHandle: Promise }
    variantIdToSelection: {},
    variantIdToSku: {},
    variantMapPromise: null
  };

  /* -----------------------------
     NORMALIZERS
  ------------------------------ */
  function normalizeRarity(r) {
    var s = String(r || '').trim().toLowerCase();
    if (s === M.CFG.anyRarityKey) return M.CFG.anyRarityKey;
    return M.CFG.allowedRarities.indexOf(s) !== -1 ? s : 'common';
  }

  function normalizeMode(m) {
    var s = String(m || '').trim().toLowerCase();
    var rand = M.CFG.modeRandomLabel.toLowerCase();
    var pref = M.CFG.modePreferredLabel.toLowerCase();

    if (s === pref) return M.CFG.modePreferredLabel;
    if (s === rand) return M.CFG.modeRandomLabel;
    if (s.indexOf('preferred') !== -1) return M.CFG.modePreferredLabel;
    if (s.indexOf('random') !== -1) return M.CFG.modeRandomLabel;

    return M.CFG.modeRandomLabel;
  }

  /* -----------------------------
     PARSING SELECTION
  ------------------------------ */
  function parseSelectionFromText(txt) {
    var s = String(txt || '').trim();
    if (!s) return null;

    // Detect Lucky Box / Any rarity first (simple, reliable)
    var sl0 = s.toLowerCase();
    for (var k = 0; k < M.CFG.anyRarityLabels.length; k++) {
      if (sl0.indexOf(M.CFG.anyRarityLabels[k]) !== -1) {
        // Mode can still be determined from text; default random
        var m0 = (sl0.indexOf('preferred') !== -1) ? M.CFG.modePreferredLabel
               : (sl0.indexOf('random') !== -1) ? M.CFG.modeRandomLabel
               : M.CFG.modeRandomLabel;
        return { rarity: M.CFG.anyRarityKey, mode: normalizeMode(m0) };
      }
    }

    var parts = s.split(/[,\/\|\u2013\u2014\-]+/g);
    var rarity = null;
    var mode = null;

    for (var i = 0; i < parts.length; i++) {
      var p = String(parts[i] || '').trim();
      if (!p) continue;
      var pl = p.toLowerCase();

      if (!rarity && M.CFG.allowedRarities.indexOf(pl) !== -1) rarity = pl;
      if (!mode && (pl === M.CFG.modeRandomLabel.toLowerCase() || pl === M.CFG.modePreferredLabel.toLowerCase())) {
        mode = (pl === M.CFG.modePreferredLabel.toLowerCase()) ? M.CFG.modePreferredLabel : M.CFG.modeRandomLabel;
      }
    }

    var sl = s.toLowerCase();
    if (!rarity) {
      for (var j = 0; j < M.CFG.allowedRarities.length; j++) {
        if (sl.indexOf(M.CFG.allowedRarities[j]) !== -1) { rarity = M.CFG.allowedRarities[j]; break; }
      }
    }
    if (!mode) {
      if (sl.indexOf('preferred') !== -1) mode = M.CFG.modePreferredLabel;
      else if (sl.indexOf('random') !== -1) mode = M.CFG.modeRandomLabel;
    }

    return { rarity: normalizeRarity(rarity), mode: normalizeMode(mode || M.CFG.modeRandomLabel) };
  }

  // Public helpers (used by UI + add-on modules)
  M.parseSelectionFromText = parseSelectionFromText;
  M.normalizeRarity = normalizeRarity;
  M.normalizeMode = normalizeMode;

  M.getVariantSelection = function (variantId) {
    try {
      var v = String(variantId || '').trim();
      if (!v) return null;
      var sel = state.variantIdToSelection[v];
      return sel ? { rarity: normalizeRarity(sel.rarity), mode: normalizeMode(sel.mode) } : null;
    } catch (e) { return null; }
  };

  M.getVariantSelectionMap = function () {
    return state.variantIdToSelection;
  };

  M.getPoolCounts = function (collectionHandle) {
    var h = String(collectionHandle || '').trim() || M.CFG.defaultPoolCollectionHandle;
    var idx = state.pools[h];
    if (!idx) return null;
    return {
      common: (idx.common || []).length,
      rare: (idx.rare || []).length,
      epic: (idx.epic || []).length,
      legendary: (idx.legendary || []).length,
      total: (idx.common || []).length + (idx.rare || []).length + (idx.epic || []).length + (idx.legendary || []).length
    };
  };

  M.isRarityEligibleForCollection = function (collectionHandle, rarity) {
    var r = normalizeRarity(rarity);
    if (r === M.CFG.anyRarityKey) return true;
    var c = M.getPoolCounts(collectionHandle);
    if (!c) return false;
    return Number(c[r] || 0) >= Number(M.CFG.preferredMinPerRarity || 0);
  };

  /* -----------------------------
     FORM HELPERS
  ------------------------------ */
  function getVariantTitleFromForm(form) {
    try {
      var sel =
        form.querySelector('select.variant-dropdown') ||
        form.querySelector('select.sticky-atc__variant-select') ||
        form.querySelector('select[name="id"]') ||
        form.querySelector('select[data-variant-select]') ||
        form.querySelector('select[data-options]');

      if (sel && sel.selectedOptions && sel.selectedOptions[0]) {
        var opt = sel.selectedOptions[0];
        var raw = (opt.getAttribute('data-options') || opt.getAttribute('data-variant-title') || opt.textContent || opt.value || '').trim();
        if (raw) return raw;
      }
    } catch (e) {}

    try {
      var checked = form.querySelector('input[type="radio"][name="id"]:checked');
      if (checked) {
        var lbl = form.querySelector('label[for="' + checked.id + '"]');
        if (lbl && lbl.textContent) return String(lbl.textContent).trim();
      }
    } catch (e) {}

    return '';
  }

  function getNumericVariantIdFromForm(form) {
    try {
      var idInput = form.querySelector('input[name="id"]') || form.querySelector('[name="id"]');
      if (!idInput) return null;
      var v = String(idInput.value || '').trim();
      if (/^\d+$/.test(v)) return v;
    } catch (e) {}
    return null;
  }

  function getPreferredCollectionFromForm(form) {
    // main mystery preferred collection property
    try {
      var a = form.querySelector('[name="properties[' + M.CFG.propPreferredCollection + ']"]');
      if (a && a.value) return String(a.value).trim();
    } catch (e) {}

    // addon locked collection (from Liquid)
    try {
      var b = form.querySelector('[name="properties[' + M.CFG.propLockedCollectionLegacy + ']"]');
      if (b && b.value) return String(b.value).trim();
    } catch (e) {}

    return '';
  }

  function upsertHidden(form, key, value) {
    if (!form) return;
    var name = 'properties[' + key + ']';
    var val = (value === null || typeof value === 'undefined') ? '' : String(value);

    var input = form.querySelector('input[type="hidden"][name="' + name.replace(/"/g, '\\"') + '"]');
    if (!input) {
      input = document.createElement('input');
      input.type = 'hidden';
      input.name = name;
      form.appendChild(input);
    }
    input.value = val;
  }

  function removeHidden(form, key) {
    if (!form) return;
    var name = 'properties[' + key + ']';
    var input = form.querySelector('input[type="hidden"][name="' + name.replace(/"/g, '\\"') + '"]');
    if (input && input.parentNode) input.parentNode.removeChild(input);
  }

  function getHandleForForm(form) {
    var host = null;
    try {
      var explicit = (form && (form.getAttribute('data-bl-handle') || (form.dataset && form.dataset.blHandle))) || '';
      if (explicit) return String(explicit || '').trim();
    } catch (err0) {}

    try {
      var selfHandle = (form && (form.getAttribute('data-handle') || (form.dataset && form.dataset.handle))) || '';
      if (selfHandle) return String(selfHandle || '').trim();
    } catch (err1) {}

    try { host = form.closest('[data-handle]'); } catch (err) {}
    var h = (host && host.getAttribute('data-handle')) ? host.getAttribute('data-handle') : (U.productHandleFromUrl() || '');
    return String(h || '').trim();
  }

  function isTargetHandle(handle) {
    return handle === M.CFG.mysteryFigureHandle || handle === M.CFG.mysteryAddonHandle;
  }

  function generateUid() {
    try {
      if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    } catch (e) {}
    return 'bl-uid-' + Math.random().toString(16).slice(2) + Date.now().toString(16);
  }

  function ensureAssignmentUid(form, signature) {
    var currentSig = '';
    var existing = '';
    try {
      currentSig = form.dataset.blAssignedSig || '';
      existing = form.dataset.blAssignmentUid || '';
    } catch (e) {}

    var uid = existing;
    if (!uid || currentSig !== signature) {
      uid = generateUid();
    }

    try {
      form.dataset.blAssignedSig = signature;
      form.dataset.blAssignmentUid = uid;
    } catch (e2) {}

    return uid;
  }

  function buildVariantGid(variantId) {
    if (!variantId) return '';
    return 'gid://shopify/ProductVariant/' + String(variantId);
  }

  function collectProperties(form) {
    var props = {};
    try {
      var inputs = form.querySelectorAll('input[name^="properties["]');
      Array.prototype.slice.call(inputs || []).forEach(function (input) {
        var name = input.getAttribute('name') || '';
        var m = name.match(/^properties\[(.*)\]$/);
        if (!m || m.length < 2) return;
        var key = m[1];
        props[key] = input.value || '';
      });
    } catch (e) {}
    return props;
  }

  function getAssignedSku(variantId, chosen) {
    if (chosen && chosen.sku) return chosen.sku;
    if (chosen && chosen.variant_sku) return chosen.variant_sku;
    var key = String(variantId || '');
    if (key && state.variantIdToSku[key]) return state.variantIdToSku[key];
    return '';
  }

  /* -----------------------------
     POOL LOADING
  ------------------------------ */
  function emptyPoolIndex() {
    return { common: [], rare: [], epic: [], legendary: [] };
  }

  function buildPoolIndex(poolJson) {
    var byR = emptyPoolIndex();
    var list = (poolJson && poolJson.products) ? poolJson.products : [];

    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (!p) continue;

      var excluded =
        p.exclude_from_mystery === true ||
        String(p.exclude_from_mystery).toLowerCase() === 'true';

      if (excluded) {
        U.warn('[BL Mystery] REJECT exclude_from_mystery:', p.handle);
        continue;
      }

      var rawR = String(p.rarity || '').trim().toLowerCase();
      if (!rawR) {
        U.warn('[BL Mystery] REJECT missing rarity:', p.handle);
        continue;
      }

      if (M.CFG.hardExcludedRarities.indexOf(rawR) !== -1) {
        U.warn('[BL Mystery] REJECT hard excluded rarity:', rawR, p.handle);
        continue;
      }

      if (M.CFG.allowedRarities.indexOf(rawR) === -1) {
        U.warn('[BL Mystery] REJECT not allowed rarity:', rawR, p.handle);
        continue;
      }

      var vid = String(p.variant_id || '').trim();
      if (!/^\d+$/.test(vid)) {
        U.warn('[BL Mystery] REJECT invalid variant_id:', p.handle, p.variant_id);
        continue;
      }

      var rarity = normalizeRarity(rawR);
      byR[rarity].push({
        handle: p.handle,
        title: p.title,
        variant_id: vid,
        rarity: rarity
      });
    }

    return byR;
  }

  function fetchPoolPage(collectionHandle, page) {
    var url = '/collections/' + encodeURIComponent(collectionHandle) +
      '?view=' + encodeURIComponent(M.CFG.poolView) +
      '&page=' + encodeURIComponent(page);

    return fetch(url, { credentials: 'same-origin' })
      .then(function (r) {
        if (!r.ok) throw new Error('Pool HTTP ' + r.status);
        return r.json();
      });
  }

  M.fetchPoolAllPages = function (collectionHandle) {
    var h = String(collectionHandle || '').trim();
    if (!h) h = M.CFG.defaultPoolCollectionHandle;

    if (state.poolPromises[h]) return state.poolPromises[h];

    state.poolPromises[h] = Promise.resolve()
      .then(function () {
        var all = [];
        var page = 1;

        function loop() {
          return fetchPoolPage(h, page)
            .then(function (json) {
              var list = (json && json.products) ? json.products : [];
              if (!list.length) return null;
              all = all.concat(list);
              page += 1;
              return loop();
            })
            .catch(function (err) {
              if (page === 1) throw err;
              return null;
            });
        }

        return loop().then(function () {
          var idx = buildPoolIndex({ products: all });
          state.pools[h] = idx;

          U.log('[BL Mystery] Pool loaded', h, {
            total: all.length,
            common: idx.common.length,
            rare: idx.rare.length,
            epic: idx.epic.length,
            legendary: idx.legendary.length
          });

          debugLog('pool-loaded', {
            handle: h,
            total: all.length,
            perRarity: {
              common: idx.common.length,
              rare: idx.rare.length,
              epic: idx.epic.length,
              legendary: idx.legendary.length
            }
          });

          return idx;
        });
      })
      .catch(function (err) {
        delete state.poolPromises[h];
        U.err('[BL Mystery] Pool error for ' + h, err);
        throw err;
      });

    return state.poolPromises[h];
  };

  /* -----------------------------
     POOL STATS (for UI)
  ------------------------------ */
  M.getPoolStats = function (collectionHandle) {
    var h = String(collectionHandle || '').trim() || M.CFG.defaultPoolCollectionHandle;
    return M.fetchPoolAllPages(h).then(function (idx) {
      var c = (idx && idx.common) ? idx.common.length : 0;
      var r = (idx && idx.rare) ? idx.rare.length : 0;
      var e = (idx && idx.epic) ? idx.epic.length : 0;
      var l = (idx && idx.legendary) ? idx.legendary.length : 0;

      return {
        handle: h,
        counts: { common: c, rare: r, epic: e, legendary: l },
        total: c + r + e + l,
        eligible: {
          common: c >= M.CFG.preferredMinPerRarity,
          rare: r >= M.CFG.preferredMinPerRarity,
          epic: e >= M.CFG.preferredMinPerRarity,
          legendary: l >= M.CFG.preferredMinPerRarity
        }
      };
    });
  };

  /* -----------------------------
     CHOOSING
  ------------------------------ */
  function randPick(arr) {
    if (!arr || !arr.length) return null;
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function chooseAssignedProduct(poolHandle, rarity) {
    var h = String(poolHandle || '').trim() || M.CFG.defaultPoolCollectionHandle;
    var r = normalizeRarity(rarity);
    var idx = state.pools[h];
    if (!idx || !idx[r] || !idx[r].length) return null;
    return randPick(idx[r]);
  }

  function flattenPool(idx) {
    var out = [];
    if (!idx) return out;
    for (var i = 0; i < M.CFG.allowedRarities.length; i++) {
      var r = M.CFG.allowedRarities[i];
      if (idx[r] && idx[r].length) out = out.concat(idx[r]);
    }
    return out;
  }

  function pickWeightedRarity(idx) {
  var rarities = M.CFG.allowedRarities.slice();
  var weights = M.CFG.anyRarityWeights || {};

  // Keep only rarities that actually exist in this pool
  var available = rarities.filter(function (r) {
    return idx && idx[r] && idx[r].length > 0;
  });

  if (!available.length) return null;

  // Sum weights only over available rarities
  var sum = 0;
  for (var i = 0; i < available.length; i++) {
    sum += Number(weights[available[i]] || 0);
  }

  // If weights are missing/misconfigured, fall back to uniform over available rarities
  if (sum <= 0) {
    return available[Math.floor(Math.random() * available.length)];
  }

  // Weighted roulette wheel
  var roll = Math.random() * sum;
  for (var j = 0; j < available.length; j++) {
    roll -= Number(weights[available[j]] || 0);
    if (roll <= 0) return available[j];
  }

  return available[available.length - 1];
}

function chooseAssignedProductAny(poolHandle) {
  var h = String(poolHandle || '').trim() || M.CFG.defaultPoolCollectionHandle;
  var idx = state.pools[h];
  if (!idx) return null;

  var r = pickWeightedRarity(idx);
  if (!r) return null;

  var chosen = randPick(idx[r] || []);
  if (U && U.log) U.log('[BL Mystery] Lucky Box pick', { pool: h, rarity: r, poolCounts: {
    common: (idx.common || []).length,
    rare: (idx.rare || []).length,
    epic: (idx.epic || []).length,
    legendary: (idx.legendary || []).length
  }});

  return chosen;
}


  /* -----------------------------
     VARIANT MAP
     Note: size can be > 8 if you have more variants than 4x2;
     it is NOT filtered by allowed rarities.
  ------------------------------ */
  M.fetchVariantMap = function () {
    if (state.variantMapPromise) return state.variantMapPromise;

    state.variantMapPromise = Promise.resolve()
      .then(function () {
        var urls = [
          '/products/' + encodeURIComponent(M.CFG.mysteryFigureHandle) + '.js',
          '/products/' + encodeURIComponent(M.CFG.mysteryAddonHandle) + '.js'
        ];
        return Promise.all(urls.map(function (u) {
          return fetch(u, { credentials: 'same-origin' })
            .then(function (r) { return r.ok ? r.json() : null; })
            .catch(function () { return null; });
        }));
      })
      .then(function (jsons) {
        jsons.forEach(function (j) {
          if (!j || !j.variants) return;

          j.variants.forEach(function (v) {
            if (!v || !v.id) return;

            var title = (v.public_title || v.title || '').trim();
            var sel = parseSelectionFromText(title) || { rarity: 'common', mode: M.CFG.modeRandomLabel };

            // Add-on always behaves like preferred mode (locked collection)
            if (j.handle === M.CFG.mysteryAddonHandle) sel.mode = M.CFG.modePreferredLabel;

            state.variantIdToSelection[String(v.id)] = { rarity: sel.rarity, mode: sel.mode };
            state.variantIdToSku[String(v.id)] = v.sku || '';
          });
        });

        U.log('[BL Mystery] Variant map size', Object.keys(state.variantIdToSelection).length);
        debugLog('variant-map-ready', { size: Object.keys(state.variantIdToSelection).length });
        return state.variantIdToSelection;
      });

    return state.variantMapPromise;
  };

  function getSelectionFromForm(form, productHandle) {
    // A) Parse DOM title
    var title = getVariantTitleFromForm(form);
    var parsed = parseSelectionFromText(title);
    if (title && parsed) return parsed;

    // B) Variant map fallback
    var variantId = getNumericVariantIdFromForm(form);
    var mapped = (variantId && state.variantIdToSelection[variantId]) ? state.variantIdToSelection[variantId] : null;
    if (mapped) return { rarity: normalizeRarity(mapped.rarity), mode: normalizeMode(mapped.mode) };

    // C) Defaults
    var fallback = { rarity: 'common', mode: M.CFG.modeRandomLabel };
    if (productHandle === M.CFG.mysteryAddonHandle) fallback.mode = M.CFG.modePreferredLabel;
    return fallback;
  }

  function buildSignature(handle, mode, rarity, requestedCollection) {
    return [handle, mode, rarity, (requestedCollection || '')].join('|');
  }

  function applyDebugProperties(form, payload) {
    var visibleKeys = [
      'DEBUG Assignment UID',
      'DEBUG Assigned Variant ID',
      'DEBUG Assigned Variant GID',
      'DEBUG Assigned SKU',
      'DEBUG Requested Mode',
      'DEBUG Requested Rarity',
      'DEBUG Locked/Preferred Collection'
    ];

    if (!isDebug()) {
      visibleKeys.forEach(function (key) { removeHidden(form, key); });
      return;
    }

    upsertHidden(form, 'DEBUG Assignment UID', payload.assignmentUid || '');
    upsertHidden(form, 'DEBUG Assigned Variant ID', payload.assignedVariantId || '');
    upsertHidden(form, 'DEBUG Assigned Variant GID', payload.assignedVariantGid || '');
    upsertHidden(form, 'DEBUG Assigned SKU', payload.assignedSku || '');
    upsertHidden(form, 'DEBUG Requested Mode', payload.mode || '');
    upsertHidden(form, 'DEBUG Requested Rarity', payload.rarity || '');
    upsertHidden(form, 'DEBUG Locked/Preferred Collection', payload.collection || '');
  }

  function logDebugState(label, meta) {
    if (!isDebug()) return;
    debugLog(label, meta);
  }

  /* -----------------------------
     ASSIGNMENT (CORE)
     Critical decision: NO silent fallback to ALL for rarity tiers.
     If user paid for Legendary in a collection, we only assign from that collection.
     (UI should hide/disable non-eligible tiers; this prevents pricing mismatch.)
  ------------------------------ */
M.computeAndApplyAssignment = function (form, productHandle, opts) {
  opts = opts || {};
  var force = !!opts.force;

  var handle = String(productHandle || '').trim();
  if (!form) return Promise.resolve(false);
  if (!isTargetHandle(handle)) return Promise.resolve(false);

  // Prevent compute storms (separate from submit lock)
  try {
    if (form.dataset.blMysteryComputing === '1') return Promise.resolve(false);
    form.dataset.blMysteryComputing = '1';
  } catch (e) {}

  // Ensure caches
  var pAll = M.fetchPoolAllPages(M.CFG.defaultPoolCollectionHandle);
  var pMap = M.fetchVariantMap();

  // Wrap everything so we ALWAYS release the computing lock
  return Promise.all([pAll, pMap])
    .then(function () {
      var sel = getSelectionFromForm(form, handle);

      // Add-on forced preferred mode
      if (handle === M.CFG.mysteryAddonHandle) sel.mode = M.CFG.modePreferredLabel;

      var mode = normalizeMode(sel.mode);
      var rarity = normalizeRarity(sel.rarity);
      var isAny = (rarity === M.CFG.anyRarityKey);

      var requestedCollection =
        (mode === M.CFG.modePreferredLabel) ? getPreferredCollectionFromForm(form) : '';

      var poolHandleUsed =
        (mode === M.CFG.modePreferredLabel && requestedCollection)
          ? requestedCollection
          : M.CFG.defaultPoolCollectionHandle;

      // IMPORTANT: include CURRENT variant id in signature (fixes "I changed variant but it didn't reroll")
      var currentVariantId = '';
      try { currentVariantId = String(getNumericVariantIdFromForm(form) || ''); } catch (e2) {}

      var sig = buildSignature(handle, mode, rarity, requestedCollection) + '|' + currentVariantId;

      // Reuse only when NOT forcing and signature matches and assigned exists
      var assignedInput = form.querySelector('[name="properties[' + M.CFG.propAssignedVariantId + ']"]');
      var canonicalInput = form.querySelector('[name="properties[_bl_assigned_variant_id]"]');
      if (!force && assignedInput && assignedInput.value && form.dataset.blAssignedSig === sig && canonicalInput && canonicalInput.value) {
        var existingProps = collectProperties(form);
        var reuseUid = ensureAssignmentUid(form, sig);
        applyDebugProperties(form, {
          assignmentUid: reuseUid,
          assignedVariantId: existingProps._bl_assigned_variant_id || assignedInput.value,
          assignedVariantGid: existingProps._bl_assigned_variant_gid || buildVariantGid(assignedInput.value),
          assignedSku: existingProps._bl_assigned_sku || '',
          mode: mode,
          rarity: isAny ? M.CFG.anyRarityKey : rarity,
          collection: requestedCollection
        });
        logDebugState('assignment-reuse', {
          handle: handle,
          role: handle === M.CFG.mysteryAddonHandle ? 'addon' : 'parent',
          mode: mode,
          rarity: rarity,
          requestedCollection: requestedCollection,
          signature: sig,
          assignment_uid: reuseUid,
          assigned_handle: existingProps[M.CFG.propAssignedHandle] || '',
          assigned_title: existingProps[M.CFG.propAssignedTitle] || '',
          assigned_variant_id: assignedInput.value,
          assigned_variant_gid: existingProps._bl_assigned_variant_gid || buildVariantGid(assignedInput.value),
          assigned_sku: existingProps._bl_assigned_sku || '',
          properties: existingProps
        });
        return true;
      }

      // If forcing, we still overwrite everything (reroll)
      return M.fetchPoolAllPages(poolHandleUsed).then(function () {
        var chosen = isAny
          ? chooseAssignedProductAny(poolHandleUsed)
          : chooseAssignedProduct(poolHandleUsed, rarity);

        // deterministic fallback: if requested rarity is empty, fallback to weighted any but keep requested tier for visibility
        if (!chosen) {
          debugLog('no-eligible-choice', {
            pool: poolHandleUsed,
            rarity: rarity,
            requestedCollection: requestedCollection,
            mode: mode
          });

          var fallbackRarity = pickWeightedRarity(state.pools[poolHandleUsed]);
          if (fallbackRarity) {
            chosen = chooseAssignedProduct(poolHandleUsed, fallbackRarity);
            if (chosen) {
              rarity = fallbackRarity; // use fallback for actual assignment but preserve requested tier later
              debugLog('fallback-choice', { pool: poolHandleUsed, fallbackRarity: fallbackRarity, chosen: chosen });
            }
          }
        }

        if (!chosen) {
          U.err('[BL Mystery] No eligible product for assignment', {
            handle: handle,
            mode: mode,
            rarity: rarity,
            pool: poolHandleUsed,
            requestedCollection: requestedCollection,
            variantId: currentVariantId,
            isAny: isAny
          });
          debugLog('assignment-failed', {
            handle: handle,
            mode: mode,
            rarity: rarity,
            pool: poolHandleUsed,
            requestedCollection: requestedCollection,
            variantId: currentVariantId,
            isAny: isAny
          });
          return false;
        }

        // Persist what user selected (tier) vs what they got (actual)
        upsertHidden(form, M.CFG.propSelectedMode, mode);
        var preferredCollectionSafe = (mode === M.CFG.modePreferredLabel) ? (requestedCollection || '') : '';
        upsertHidden(form, M.CFG.propPreferredCollection, preferredCollectionSafe);
        upsertHidden(form, M.CFG.propRequestedTier, isAny ? M.CFG.anyRarityKey : rarity);
        // Supplemental properties for storefront tracking
        upsertHidden(form, '_bl_mode', mode === M.CFG.modePreferredLabel ? 'preferred' : 'random');
        upsertHidden(form, '_bl_locked_collection', preferredCollectionSafe);
        upsertHidden(form, '_bl_requested_rarity', isAny ? M.CFG.anyRarityKey : rarity);

        // Assigned payload (internal)
        upsertHidden(form, M.CFG.propAssignedHandle, chosen.handle);
        upsertHidden(form, M.CFG.propAssignedTitle, chosen.title);
        upsertHidden(form, M.CFG.propAssignedVariantId, chosen.variant_id);
        upsertHidden(form, M.CFG.propAssignedRarity, chosen.rarity);

        // Assigned payload (visible in cart)
        upsertHidden(form, M.CFG.propVisibleAssignedTitle, chosen.title);
        upsertHidden(form, M.CFG.propVisibleAssignedRarity, chosen.rarity);
        upsertHidden(form, M.CFG.propVisibleRequestedTier, isAny ? 'Lucky Box' : rarity);
        upsertHidden(form, M.CFG.propVisiblePoolUsed, poolHandleUsed);
        upsertHidden(form, M.CFG.propVisibleMode, mode);

        var assignmentUid = ensureAssignmentUid(form, sig);
        var assignedGid = buildVariantGid(chosen.variant_id);
        var assignedSku = getAssignedSku(chosen.variant_id, chosen);

        // Canonical BL properties
        upsertHidden(form, '_bl_assignment_uid', assignmentUid);
        upsertHidden(form, '_bl_assigned_variant_id', chosen.variant_id);
        upsertHidden(form, '_bl_assigned_variant_gid', assignedGid);
        upsertHidden(form, '_bl_assigned_sku', assignedSku || '');

        applyDebugProperties(form, {
          assignmentUid: assignmentUid,
          assignedVariantId: chosen.variant_id,
          assignedVariantGid: assignedGid,
          assignedSku: assignedSku || '',
          mode: mode,
          rarity: isAny ? M.CFG.anyRarityKey : rarity,
          collection: preferredCollectionSafe
        });

        // Cache signature (includes variant id now)
        try { form.dataset.blAssignedSig = sig; } catch (e3) {}

        U.log('[BL Mystery] Assigned', chosen, {
          handle: handle,
          mode: mode,
          requestedCollection: requestedCollection,
          poolUsed: poolHandleUsed,
          requestedTier: isAny ? 'Lucky Box' : rarity,
          variantId: currentVariantId,
          force: force
        });

        logDebugState('assignment', {
          handle: handle,
          role: handle === M.CFG.mysteryAddonHandle ? 'addon' : 'parent',
          mode: mode,
          rarity: rarity,
          requestedCollection: requestedCollection,
          poolUsed: poolHandleUsed,
          variantId: currentVariantId,
          signature: sig,
          assignment_uid: assignmentUid,
          assigned: chosen,
          assigned_variant_gid: assignedGid,
          assigned_sku: assignedSku || '',
          properties: collectProperties(form)
        });

        return true;
      });
    })
    .catch(function (err) {
      U.err('[BL Mystery] computeAndApplyAssignment error', err);
      return false;
    })
    .finally(function () {
      // ALWAYS release computing lock
      try { form.dataset.blMysteryComputing = '0'; } catch (e) {}
    });
};


  /* -----------------------------
     PRECOMPUTE (ONLY ON USER-DRIVEN INPUTS)
     We DO NOT precompute on page load anymore to avoid confusion and spam.
  ------------------------------ */
  M.bindPrecompute = function () {
    if (M.__precomputeBound) return;
    M.__precomputeBound = true;

    var debounced = U.debounce(function (form, handle) {
      M.computeAndApplyAssignment(form, handle).catch(function () {});
    }, 100);

    // Variant dropdown/radio changes
    document.addEventListener('change', function (e) {
      var t = e.target;
      if (!t) return;

      var form = null;
      try { form = t.closest('form'); } catch (err) {}
      if (!form || !form.querySelector('input[name="id"]')) return;

      var h = getHandleForForm(form);
      if (!isTargetHandle(h)) return;

      debounced(form, h);
    }, true);

    // Add-on pill clicks (data-bl-addon-variant is on the button)
    document.addEventListener('click', function (e) {
      var pill = null;
      try { pill = e.target.closest('[data-bl-addon-variant]'); } catch (err) {}
      if (!pill) return;

      var form = null;
      try { form = pill.closest('form'); } catch (err2) {}
      if (!form || !form.querySelector('input[name="id"]')) return;

      var h = getHandleForForm(form);
      if (!isTargetHandle(h)) return;

      // give your pill handler a tick to update the hidden variant id
      setTimeout(function () { debounced(form, h); }, 0);
    }, true);
  };

  /* -----------------------------
     SUBMIT SAFETY
     - Compute once
     - Resubmit once
     - Prevent infinite loops / first-click failures
  ------------------------------ */
  M.bindSubmitSafety = function () {
    if (M.__submitBound) return;
    M.__submitBound = true;

    document.addEventListener('submit', function (e) {
      var form = e.target;
      if (!(form instanceof HTMLFormElement)) return;
      if (!form.querySelector('input[name="id"]')) return;

      // bypass used only for our internal resubmit
      if (form.dataset.blMysteryBypass === '1') {
        form.dataset.blMysteryBypass = '0';
        return;
      }

      var handle = getHandleForForm(form);
      if (!isTargetHandle(handle)) return;

      // Block re-entrancy
      if (form.dataset.blMysteryAssigning === '1') {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }

      e.preventDefault();
      e.stopImmediatePropagation();

      form.dataset.blMysteryAssigning = '1';

      var btn = form.querySelector('[type="submit"]');
      if (btn) btn.setAttribute('disabled', 'disabled');

      M.computeAndApplyAssignment(form, handle, { force: true })
        .then(function (ok) {
          if (!ok) {
            try {
              alert('This option is temporarily unavailable. Please choose a different rarity/collection and try again.');
            } catch (e0) {}
          }
          return !!ok;
        })
        .catch(function (err) {
          U.err('[BL Mystery] compute error', err);
          try { alert('Something went wrong while preparing your Mystery Figure. Please try again.'); } catch (e1) {}
          return false;
        })
        .then(function (ok) {
          form.dataset.blMysteryAssigning = '0';
          if (btn) btn.removeAttribute('disabled');

          if (!ok) return;

          var propsSnapshot = collectProperties(form);
          logDebugState('pre-submit', {
            handle: handle,
            role: handle === M.CFG.mysteryAddonHandle ? 'addon' : 'parent',
            mode: propsSnapshot._bl_mode || propsSnapshot[M.CFG.propSelectedMode] || '',
            rarity: propsSnapshot._bl_requested_rarity || propsSnapshot[M.CFG.propRequestedTier] || '',
            requestedCollection: propsSnapshot._bl_locked_collection || propsSnapshot[M.CFG.propPreferredCollection] || '',
            signature: form.dataset.blAssignedSig || '',
            assignment_uid: propsSnapshot._bl_assignment_uid || form.dataset.blAssignmentUid || '',
            assigned_handle: propsSnapshot[M.CFG.propAssignedHandle] || '',
            assigned_title: propsSnapshot[M.CFG.propAssignedTitle] || '',
            assigned_variant_id: propsSnapshot._bl_assigned_variant_id || propsSnapshot[M.CFG.propAssignedVariantId] || '',
            assigned_variant_gid: propsSnapshot._bl_assigned_variant_gid || buildVariantGid(propsSnapshot[M.CFG.propAssignedVariantId] || ''),
            assigned_sku: propsSnapshot._bl_assigned_sku || '',
            properties: propsSnapshot
          });

          // resubmit once, bypassing our own listener
          form.dataset.blMysteryBypass = '1';

          setTimeout(function () {
            try {
              if (typeof form.requestSubmit === 'function') form.requestSubmit(btn || undefined);
              else form.submit();
            } catch (err2) {
              try { form.submit(); } catch (e2) {}
            }
          }, 0);
        });
    }, true);
  };

  /* -----------------------------
     INIT
  ------------------------------ */
  M.init = function () {
    if (M.__inited) return;
    M.__inited = true;

    // Warm caches (safe)
    M.fetchVariantMap();
    M.fetchPoolAllPages(M.CFG.defaultPoolCollectionHandle);

    // Bind user-driven precompute + submit safety
    M.bindSubmitSafety();

    U.log('[BL Mystery] Engine init');
  };
})();

(function () {
  window.BL = window.BL || {};
  var M = window.BL.mysteryEngine;
  if (!M || !M.CFG) return;

  function qs(root, sel){ return (root || document).querySelector(sel); }
  function qsa(root, sel){ return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  // Adjust these selectors to your actual markup:
  var SEL = {
    form: 'form[action^="/cart/add"], product-form form, form[data-type="add-to-cart-form"]',
    modePreferredBtn: '[data-bl-mode="preferred"], [data-mode="preferred"], button[name="mode"][value="preferred"]',
    modeRandomBtn: '[data-bl-mode="random"], [data-mode="random"], button[name="mode"][value="random"]',
    rarityBtns: '[data-bl-rarity]', // every rarity button should have data-bl-rarity="common|rare|epic|legendary|any"
    prefWrap: '[data-bl-pref-collection-wrap]',
    prefSelect: '[data-bl-pref-collection]',
    prefNotice: '[data-bl-pref-notice]'
  };

  function getActiveMode(root){
    // Implement this based on your existing mode state.
    // Easiest: check for .is-active on mode buttons.
    var p = qs(root, SEL.modePreferredBtn);
    if (p && p.classList.contains('is-active')) return 'preferred';
    return 'random';
  }

  function getSelectedRarity(root){
    // Implement based on your current rarity selection UI.
    var active = qsa(root, SEL.rarityBtns).find(function (b) { return b.classList.contains('is-active'); });
    if (!active) return M.CFG.anyRarityKey || 'any';
    return String(active.getAttribute('data-bl-rarity') || '').toLowerCase() || (M.CFG.anyRarityKey || 'any');
  }

  function setSelectedRarity(root, rarity){
    var btns = qsa(root, SEL.rarityBtns);
    btns.forEach(function (b) {
      var r = String(b.getAttribute('data-bl-rarity') || '').toLowerCase();
      b.classList.toggle('is-active', r === rarity);
    });
    // also update hidden input / form property if your engine uses one
    // e.g. ensureHidden(form, '_bl_requested_rarity', rarity)
  }

  function setNotice(root, msg){
    var el = qs(root, SEL.prefNotice);
    if (!el) return;
    if (!msg) { el.textContent = ''; el.style.display = 'none'; return; }
    el.textContent = msg;
    el.style.display = '';
    clearTimeout(el.__t);
    el.__t = setTimeout(function(){ el.textContent=''; el.style.display='none'; }, 4500);
  }

  function disableRaritiesByCounts(root, counts){
    var min = Number(M.CFG.preferredMinPerRarity || 0);
    var anyKey = String(M.CFG.anyRarityKey || 'any').toLowerCase();

    qsa(root, SEL.rarityBtns).forEach(function (btn) {
      var r = String(btn.getAttribute('data-bl-rarity') || '').toLowerCase();
      var eligible = true;

      if (r && r !== anyKey) {
        eligible = Number(counts[r] || 0) >= min;
      }

      btn.setAttribute('aria-disabled', eligible ? 'false' : 'true');
      btn.classList.toggle('is-disabled', !eligible);
    });
  }

  function pickFallbackRarity(root){
    var anyKey = String(M.CFG.anyRarityKey || 'any').toLowerCase();
    var btns = qsa(root, SEL.rarityBtns);
    var anyBtn = btns.find(function(b){ return String(b.getAttribute('data-bl-rarity')||'').toLowerCase() === anyKey; });
    if (anyBtn && anyBtn.getAttribute('aria-disabled') !== 'true') return anyKey;

    var firstOk = btns.find(function(b){ return b.getAttribute('aria-disabled') !== 'true'; });
    return firstOk ? String(firstOk.getAttribute('data-bl-rarity')||anyKey).toLowerCase() : anyKey;
  }

  function applyPreferredEligibility(root, collectionHandle){
    return M.fetchPoolAllPages(collectionHandle).then(function(){
      var counts = (typeof M.getPoolCounts === 'function') ? M.getPoolCounts(collectionHandle) : null;
      if (!counts) return;

      disableRaritiesByCounts(root, counts);

      var current = getSelectedRarity(root);
      var currentBtn = qsa(root, SEL.rarityBtns).find(function(b){
        return String(b.getAttribute('data-bl-rarity')||'').toLowerCase() === current;
      });

      if (currentBtn && currentBtn.getAttribute('aria-disabled') === 'true') {
        var fb = pickFallbackRarity(root);
        setSelectedRarity(root, fb);
        setNotice(root, 'Some rarities are not available for this collection right now. Switched to an available option.');
      } else {
        setNotice(root, '');
      }

      // Trigger your existing “recompute assignment” path
      // so variant/line-item props update instantly.
      var form = qs(root, SEL.form);
      if (form && typeof M.computeAndApplyAssignment === 'function') {
        M.computeAndApplyAssignment(form, M.CFG.mysteryFigureHandle || 'mystery-figure').catch(function(){});
      }
    });
  }

  function syncPreferredUI(root){
    var wrap = qs(root, SEL.prefWrap);
    var sel = qs(root, SEL.prefSelect);
    if (!wrap || !sel) return;

    var mode = getActiveMode(root);
    var isPreferred = (mode === 'preferred');

    wrap.style.display = isPreferred ? '' : 'none';
    if (!isPreferred) return;

    var handle = String(sel.value || '').trim();
    if (!handle) return;

    applyPreferredEligibility(root, handle);
  }

  function bind(root){
    root = root || document;

    // when dropdown changes
    var sel = qs(root, SEL.prefSelect);
    if (sel && !sel.__bound) {
      sel.__bound = true;
      sel.addEventListener('change', function(){
        syncPreferredUI(root);
      });
    }

    // when mode buttons clicked
    var mp = qs(root, SEL.modePreferredBtn);
    var mr = qs(root, SEL.modeRandomBtn);

    if (mp && !mp.__bound) {
      mp.__bound = true;
      mp.addEventListener('click', function(){
        mp.classList.add('is-active');
        if (mr) mr.classList.remove('is-active');
        syncPreferredUI(root);
      });
    }
    if (mr && !mr.__bound) {
      mr.__bound = true;
      mr.addEventListener('click', function(){
        mr.classList.add('is-active');
        if (mp) mp.classList.remove('is-active');
        syncPreferredUI(root);
      });
    }

    // when rarity clicked, re-check eligibility (prevent selecting disabled via keyboard edge cases)
    qsa(root, SEL.rarityBtns).forEach(function(btn){
      if (btn.__bound) return;
      btn.__bound = true;
      btn.addEventListener('click', function(){
        if (btn.getAttribute('aria-disabled') === 'true') return;
        qsa(root, SEL.rarityBtns).forEach(function(b){ b.classList.remove('is-active'); });
        btn.classList.add('is-active');
        syncPreferredUI(root);
      });
    });

    // initial
    syncPreferredUI(root);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function(){ bind(document); });
  } else {
    bind(document);
  }
})();
