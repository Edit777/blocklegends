/* =======================================================
   BLOCK LEGENDS — MYSTERY ADD-ON (UPSELL CARD) — STABLE
   - Uses stable Liquid hooks:
     [data-bl-addon-controls], [data-bl-addon-hint]
   - Injects compact <select>
   - Disables ineligible rarities for locked collection
   - Updates price/image/variant-id in place
   - Minimal DOM tweaks (keeps price aligned with add button)
   ======================================================= */

(function () {
  window.BL = window.BL || {};
  window.BL.mysteryAddon = window.BL.mysteryAddon || {};

  var U = window.BL.utils;
  var M = window.BL.mysteryEngine;
  var A = window.BL.mysteryAddon;

  var observer = null;
  var observerRunning = false;
  var RARITY_ORDER = ['any', 'common', 'rare', 'epic', 'legendary', 'special', 'mythical'];
  var MIN_DISTINCT_FOR_SPECIFIC = 3;
  var MIN_DISTINCT_FOR_ANY = 1;

  function getAddonHandle() {
    try {
      return (M && M.CFG && M.CFG.mysteryAddonHandle) ? String(M.CFG.mysteryAddonHandle) : 'mystery-add-on';
    } catch (e) {
      return 'mystery-add-on';
    }
  }

  function isDebug() {
    try {
      if (window.BL && typeof window.BL.isDebug === 'function') return window.BL.isDebug();
      if (window.BL && window.BL.debug === true) return true;
      return window.BL_DEBUG === true;
    } catch (e) {
      return false;
    }
  }

  function shouldDebug() {
    return isDebug();
  }

  function getMinDistinctForSpecific() {
    var min = MIN_DISTINCT_FOR_SPECIFIC;
    if (!isFinite(min) || min < 0) min = MIN_DISTINCT_FOR_SPECIFIC;
    return min;
  }

  function debugLog() {
    if (!shouldDebug()) return;
    var args = Array.prototype.slice.call(arguments);
    try { console.log.apply(console, ['[BL Mystery Addon]'].concat(args)); } catch (e) {}
  }

  function generateUid(prefix) {
    prefix = prefix || 'bl';
    try {
      if (window.crypto && typeof window.crypto.randomUUID === 'function') return prefix + '-' + window.crypto.randomUUID();
    } catch (e) {}
    return prefix + '-' + Math.random().toString(16).slice(2) + '-' + Date.now().toString(16);
  }

  function parseItemsFromFormData(fd) {
    var items = {};
    if (!fd || typeof fd.forEach !== 'function') return [];

    try {
      fd.forEach(function (value, key) {
        var m = String(key || '').match(/^items\[(\d+)\]\[(id|quantity)\]$/);
        if (m && m[1]) {
          var idx = m[1];
          items[idx] = items[idx] || { index: Number(idx), properties: {} };
          items[idx][m[2]] = String(value || '');
          return;
        }

        var p = String(key || '').match(/^items\[(\d+)\]\[properties\]\[(.+)\]$/);
        if (p && p[1] && p[2]) {
          var pIdx = p[1];
          items[pIdx] = items[pIdx] || { index: Number(pIdx), properties: {} };
          items[pIdx].properties[p[2]] = String(value || '');
        }
      });
    } catch (e) {}

    return Object.keys(items)
      .map(function (k) { return items[k]; })
      .sort(function (a, b) { return a.index - b.index; });
  }

  function isInvalidLockedHandle(handle) {
    var h = String(handle || '').trim();
    if (!h) return true;
    if (/\s/.test(h)) return true;
    return !/^[a-z0-9-]+$/.test(h);
  }

  function debugLockedCollection(meta) {
    if (!shouldDebug()) return;
    var poolView = (M && M.CFG && M.CFG.poolView) ? M.CFG.poolView : 'mystery';
    var poolUrl = meta && meta.handle && !meta.rejected
      ? ('/collections/' + encodeURIComponent(meta.handle) + '?view=' + encodeURIComponent(poolView))
      : '';
    try {
      console.debug('[BL Mystery Addon] locked collection resolved', {
        handle: meta && meta.handle ? meta.handle : '',
        title: meta && meta.title ? meta.title : '',
        source: meta && meta.source ? meta.source : '',
        rejected: !!(meta && meta.rejected)
      });
      console.debug('[BL Mystery Addon] pool url', { url: poolUrl });
    } catch (e) {}
  }

  // Canonical pool context (defined in snippets/upsell-block.liquid).
  function getPoolContext() {
    var ctx = { key: '', title: '', handle: '' };
    try {
      var poolEl = document.querySelector('#blPoolContext');
      if (!poolEl) return ctx;
      ctx.key = String(
        (poolEl.dataset && (poolEl.dataset.poolKey || poolEl.dataset.blPoolKey)) ||
        poolEl.getAttribute('data-pool-key') ||
        poolEl.getAttribute('data-bl-pool-key') ||
        ''
      ).trim();
      ctx.title = String(
        (poolEl.dataset && (poolEl.dataset.poolTitle || poolEl.dataset.blPoolTitle)) ||
        poolEl.getAttribute('data-pool-title') ||
        poolEl.getAttribute('data-bl-pool-title') ||
        ''
      ).trim();
      ctx.handle = String(
        (poolEl.dataset && (poolEl.dataset.poolHandle || poolEl.dataset.blPoolHandle)) ||
        poolEl.getAttribute('data-pool-handle') ||
        poolEl.getAttribute('data-bl-pool-handle') ||
        ''
      ).trim();
    } catch (e) {}
    return ctx;
  }

  function getPoolContextFromCard(card) {
    var ctx = { key: '', title: '', handle: '' };
    if (!card) return ctx;
    try {
      ctx.key = String(
        (card.dataset && (card.dataset.poolKey || card.dataset.blPoolKey)) ||
        card.getAttribute('data-pool-key') ||
        card.getAttribute('data-bl-pool-key') ||
        ''
      ).trim();
      ctx.title = String(
        (card.dataset && (card.dataset.poolTitle || card.dataset.blPoolTitle)) ||
        card.getAttribute('data-pool-title') ||
        card.getAttribute('data-bl-pool-title') ||
        ''
      ).trim();
      ctx.handle = String(
        (card.dataset && (card.dataset.poolHandle || card.dataset.blPoolHandle)) ||
        card.getAttribute('data-pool-handle') ||
        card.getAttribute('data-bl-pool-handle') ||
        ''
      ).trim();
      if (!ctx.handle) {
        ctx.handle = String((card.dataset && card.dataset.lockedCollection) || card.getAttribute('data-locked-collection') || '').trim();
      }
    } catch (e) {}
    return ctx;
  }

  function resolveLockedCollection(card) {
    var ctx = getPoolContext();
    if (!ctx.key && !ctx.handle) ctx = getPoolContextFromCard(card);
    var key = ctx.key || '';
    var handle = ctx.handle || '';
    var title = ctx.title;
    if (shouldDebug()) {
      try {
        console.log('[BL Mystery Addon][debug] pool context resolved', {
          poolKey: key,
          poolTitle: title,
          poolHandle: handle
        });
      } catch (e) {}
    }
    if (handle && isInvalidLockedHandle(handle)) {
      debugLockedCollection({ handle: handle, title: title, source: 'pool-context', rejected: true });
      handle = '';
    } else if (handle) {
      debugLockedCollection({ handle: handle, title: title, source: 'pool-context', rejected: false });
    }

    if (!handle && shouldDebug()) {
      debugLockedCollection({ handle: '', title: title, source: 'pool-context', rejected: true });
    }

    return { handle: handle, title: title, key: key };
  }

  var addonVariantIdsPromise = null;
  function getAddonVariantIdSet() {
    if (addonVariantIdsPromise) return addonVariantIdsPromise;

    addonVariantIdsPromise = Promise.resolve().then(function () {
      var handle = getAddonHandle();
      if (!handle || typeof fetch !== 'function') return new Set();

      return fetch('/products/' + encodeURIComponent(handle) + '.js', { credentials: 'same-origin' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (json) {
          var set = new Set();
          if (json && Array.isArray(json.variants)) {
            json.variants.forEach(function (v) {
              if (v && v.id) set.add(String(v.id));
            });
          }
          return set;
        })
        .catch(function () { return new Set(); });
    });

    return addonVariantIdsPromise;
  }

  function buildAddonFormFromItem(item, parentUid) {
    var form = document.createElement('form');
    form.setAttribute('data-bl-handle', getAddonHandle());

    var idInput = document.createElement('input');
    idInput.type = 'hidden';
    idInput.name = 'id';
    idInput.value = item && item.id ? String(item.id) : '';
    form.appendChild(idInput);

    var props = Object.assign({}, item && item.properties ? item.properties : {});
    if (parentUid && !props._bl_parent_uid) props._bl_parent_uid = parentUid;
    if (!props._bl_is_addon) props._bl_is_addon = '1';

    Object.keys(props).forEach(function (key) {
      ensureHidden(form, key, props[key]);
    });

    return form;
  }

  function rewritePropertiesForIndex(fd, idx, props) {
    if (!fd || typeof fd.forEach !== 'function') return;
    var prefix = 'items[' + idx + '][properties][';
    var toDelete = [];

    try {
      fd.forEach(function (_, key) {
        if (String(key || '').indexOf(prefix) === 0) toDelete.push(key);
      });
    } catch (e) {}

    toDelete.forEach(function (k) { try { fd.delete(k); } catch (eDel) {} });

    Object.keys(props || {}).forEach(function (key) {
      var val = props[key];
      if (val === null || typeof val === 'undefined') return;
      try { fd.append(prefix + key + ']', String(val)); } catch (e) {}
    });
  }

  function rewriteItemIdForIndex(fd, idx, value) {
    if (!fd || typeof fd.set !== 'function') return;
    var key = 'items[' + idx + '][id]';
    try { fd.set(key, String(value || '')); } catch (e) {}
  }

  A.enrichCartAddFormData = async function (formData) {
    if (!formData || !(formData instanceof FormData)) return;
    if (!M || typeof M.computeAndApplyAssignment !== 'function') return;

    var items = parseItemsFromFormData(formData);
    if (!items.length) return;

    var addonIds = await getAddonVariantIdSet().catch(function () { return new Set(); });
    var assignmentPropKey = (M && M.CFG && M.CFG.propAssignedVariantId) || '_assigned_variant_id';
    var parentAssignments = {};
    var addonAssignments = {};
    var assignmentFailed = false;

    function recordParentAssignment(uid, variantId) {
      var key = String(uid || '').trim();
      var vid = String(variantId || '').trim();
      if (!key || !vid) return;
      parentAssignments[key] = vid;
    }

    function recordAddonAssignment(uid, variantId) {
      var key = String(uid || '').trim();
      var vid = String(variantId || '').trim();
      if (!key || !vid) return;
      addonAssignments[key] = addonAssignments[key] || [];
      if (addonAssignments[key].indexOf(vid) === -1) addonAssignments[key].push(vid);
    }

    function stripDebugProps(obj) {
      if (!obj || isDebug()) return obj;
      Object.keys(obj).forEach(function (k) {
        if (String(k || '').indexOf('DEBUG ') === 0) delete obj[k];
      });
      return obj;
    }

    // Seed assignments from existing properties when parent UID is explicitly present
    items.forEach(function (it) {
      var props = (it && it.properties) || {};
      var uid = String(props._bl_parent_uid || props._bl_assignment_uid || '').trim();
      if (!uid) return;

      var assignedSeed = props._bl_assigned_variant_id || props[assignmentPropKey] || '';
      if (!assignedSeed) return;

      var idStr = String(assignedSeed || '').trim();
      var isAddonSeed = String(props._bl_is_addon || '') === '1' || (addonIds && addonIds.has(String(it.id || '')));
      if (isAddonSeed) recordAddonAssignment(uid, idStr);
      else recordParentAssignment(uid, idStr);
    });

    var lastParentUid = '';
    var parentUidByIndex = {};

    for (var i = 0; i < items.length; i++) {
      var item = items[i] || {};
      var idx = item.index;
      var id = String(item.id || '');
      var props = item.properties || {};
      var isAddon = String(props._bl_is_addon || '') === '1' || (addonIds && addonIds.has(id));

      if (!isAddon) {
        var parentUid = props._bl_parent_uid || props._bl_assignment_uid || parentUidByIndex[idx];
        if (!parentUid) parentUid = generateUid('bl-parent');
        parentUidByIndex[idx] = parentUid;
        lastParentUid = parentUid;

        var parentAssigned = props._bl_assigned_variant_id || props[assignmentPropKey];
        if (parentAssigned) recordParentAssignment(parentUid, parentAssigned);
        continue;
      }

      if (!id) {
        continue;
      }

      var addonParentUid = props._bl_parent_uid || lastParentUid || parentUidByIndex[idx] || generateUid('bl-parent');
      var lockedMeta = resolveLockedCollection(null);
      var lockedKey = (M && M.CFG && M.CFG.propLockedCollectionLegacy) ? M.CFG.propLockedCollectionLegacy : '_bl_locked_collection';
      var lockedCollection = props[lockedKey] || '';
      if (lockedCollection && isInvalidLockedHandle(lockedCollection)) {
        logAddonDebug('addon-locked-collection-invalid', { locked_collection: lockedCollection });
        lockedCollection = '';
      }
      if (!lockedCollection) lockedCollection = lockedMeta.handle;
      if (lockedCollection) props[lockedKey] = lockedCollection;
      if (lockedMeta.title && !props._bl_locked_collection_name) props._bl_locked_collection_name = lockedMeta.title;
      logAddonDebug('addon-enrich-locked-collection', { locked_collection: lockedCollection });

      var excludeVariantIds = [];
      if (addonParentUid && parentAssignments[addonParentUid]) excludeVariantIds.push(parentAssignments[addonParentUid]);
      if (addonParentUid && addonAssignments[addonParentUid] && addonAssignments[addonParentUid].length) {
        excludeVariantIds = excludeVariantIds.concat(addonAssignments[addonParentUid]);
      }
      var seenExcludes = {};
      var dedupedExcludes = excludeVariantIds.filter(function (vid) {
        var key = String(vid || '').trim();
        if (!key || seenExcludes[key]) return false;
        seenExcludes[key] = true;
        return true;
      });

      var syntheticForm = buildAddonFormFromItem({ id: id, properties: props }, addonParentUid);

      try {
        await M.computeAndApplyAssignment(syntheticForm, getAddonHandle(), { force: true, excludeVariantIds: dedupedExcludes });
      } catch (errCompute) {
        debugLog('addon-enrich-compute-error', errCompute);
        assignmentFailed = true;
      }

      var computedProps = collectProperties(syntheticForm);
      var mergedProps = Object.assign({}, props, computedProps);

      var assignUid = mergedProps._bl_assignment_uid || mergedProps._bl_assign_uid || (syntheticForm.dataset && syntheticForm.dataset.blAssignmentUid) || '';
      if (!assignUid) assignUid = generateUid('bl-assign');

      mergedProps._bl_assignment_uid = assignUid;
      mergedProps._bl_assign_uid = assignUid;
      mergedProps._bl_is_addon = '1';
      mergedProps._bl_parent_uid = addonParentUid;
      if (props._bl_parent_handle && !mergedProps._bl_parent_handle) mergedProps._bl_parent_handle = props._bl_parent_handle;
      if (props._bl_locked_collection && !mergedProps._bl_locked_collection) mergedProps._bl_locked_collection = props._bl_locked_collection;

      stripDebugProps(mergedProps);

      var assignedVariantId = mergedProps._bl_assigned_variant_id || mergedProps[assignmentPropKey] || '';
      if (assignedVariantId) {
        rewriteItemIdForIndex(formData, idx, assignedVariantId);
        logAddonDebug('addon-enrich-swap', {
          original_variant_id: id,
          assigned_variant_id: assignedVariantId,
          pool_handle: mergedProps._bl_locked_pool_handle || mergedProps._bl_locked_collection || ''
        });
      } else {
        assignmentFailed = true;
      }

      rewritePropertiesForIndex(formData, idx, mergedProps);
      parentUidByIndex[idx] = addonParentUid;
      lastParentUid = addonParentUid;

      var addonAssignedVariant = mergedProps._bl_assigned_variant_id || mergedProps[assignmentPropKey] || '';
      if (addonAssignedVariant) recordAddonAssignment(addonParentUid, addonAssignedVariant);
    }

    if (assignmentFailed) {
      if (A && typeof A.notifyError === 'function') {
        A.notifyError('Unable to assign a figure from the pool.');
      }
      return false;
    }
    return true;
  };

function ensureCssOnce() {
  if (document.getElementById('bl-addon-css')) return;

  var st = document.createElement('style');
  st.id = 'bl-addon-css';

  st.textContent = [
    /* Base */
    '.upsell[data-upsell-addon="true"] .upsell__image__img{aspect-ratio:1/1;object-fit:cover;width:100%;height:auto;}',

    /* Main row */
    '.upsell[data-upsell-addon="true"] .bl-addon-main{display:flex;align-items:center;gap:.85rem;width:100%;}',
    '.upsell[data-upsell-addon="true"] .upsell__image{flex:0 0 76px;width:76px;display:flex;align-items:center;justify-content:center;align-self:center;}',
    '.upsell[data-upsell-addon="true"] .upsell__image .upsell__image__img{max-width:76px;width:100%;height:auto;}',

    '.upsell[data-upsell-addon="true"] .bl-addon-body{flex:1;min-width:0;display:flex;flex-direction:column;gap:.25rem;}',
    '.upsell[data-upsell-addon="true"] .upsell__content{min-width:0;}',
    '.upsell[data-upsell-addon="true"] .upsell__title h3{white-space:normal;word-break:normal;overflow-wrap:anywhere;margin:0;line-height:1.22;font-size:15px;}',

    /* Right side (price + plus) */
    '.upsell[data-upsell-addon="true"] .bl-addon-right{display:flex;align-items:center;justify-content:flex-end;gap:6px;white-space:nowrap;flex:0 0 auto;min-width:88px;margin-left:auto;}',
    '.upsell[data-upsell-addon="true"] .bl-addon-price-wrap{display:flex;align-items:center;justify-content:center;}',
    '.upsell[data-upsell-addon="true"] .bl-addon-right .upsell__price{margin:0;display:flex;align-items:center;justify-content:center;line-height:1;}',
    '.upsell[data-upsell-addon="true"] .bl-addon-right .upsell__price .regular-price{display:inline-block;line-height:1;margin:0;padding:0;font-weight:700;}',
    '.upsell[data-upsell-addon="true"] .upsell__price--separate{margin:0;}',
    '.upsell[data-upsell-addon="true"] .bl-addon-right button{display:flex;align-items:center;justify-content:center;}',
    '.upsell[data-upsell-addon="true"] .upsell__price,.upsell[data-upsell-addon="true"] .upsell__price *{vertical-align:middle;}',

    /* Meta (selector + hint) */
    '.upsell[data-upsell-addon="true"] .bl-addon-meta{margin-top:.22rem;display:flex;flex-direction:column;gap:.22rem;min-width:0;}',
    '.upsell[data-upsell-addon="true"] .bl-addon-controls{display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;min-width:0;}',
    '.upsell[data-upsell-addon="true"] .bl-addon-controls label{font-size:12px;font-weight:700;letter-spacing:.01em;white-space:nowrap;}',
    '.upsell[data-upsell-addon="true"] .bl-addon-select{min-height:32px;height:32px;padding:4px 10px;border:1px solid rgba(0,0,0,.18);border-radius:8px;background:#fff;font-size:12px;line-height:1.1;max-width:100%;min-width:120px;}',
    '.upsell[data-upsell-addon="true"] .bl-addon-select option:disabled{color:rgba(0,0,0,.35);}',
    '.upsell[data-upsell-addon="true"] .bl-addon-hint{font-size:12px;line-height:1.28;opacity:.85;}',
    '.upsell[data-upsell-addon="true"] .product-form__quantity,.upsell[data-upsell-addon="true"] .quantity__input,.upsell[data-upsell-addon="true"] .quantity__button{display:none !important;}',
    '.upsell[data-upsell-addon="true"] .upsell__add-btn .icon-plus{display:none !important;}',
    '.upsell[data-upsell-addon="true"] .bl-addon-controls{justify-content:flex-start;}',
    '.upsell[data-upsell-addon="true"] .bl-addon-meta{align-items:flex-start;}',

    /* Notice block */
    '.bl-addon-notice{margin-top:0.75rem;font-size:13px;line-height:1.4;color:#b33;padding:.6rem .8rem;border:1px solid rgba(179,51,51,.35);border-radius:8px;background:rgba(179,51,51,.08);width:100%;display:block;}',

    /* Hide shrine picker */
    '.upsell[data-upsell-addon="true"] .upsell__variant-picker{display:none !important;}',

    /* --- Mobile tuning --- */

    /* Keep selector narrower on small screens */
    '@media (max-width: 640px){' +
      '.upsell[data-upsell-addon="true"] .bl-addon-controls{flex-wrap:nowrap;}' +
      '.upsell[data-upsell-addon="true"] .bl-addon-select{min-width:0;width:108px;max-width:46vw;}' +
    '}',

    /* <=420: smaller text + tighter right gap + smaller image */
    '@media (max-width: 420px){' +
      '.upsell[data-upsell-addon="true"] .bl-addon-main{gap:.72rem;}' +
      '.upsell[data-upsell-addon="true"] .upsell__image{flex:0 0 62px;width:62px;align-self:center;}' +
      '.upsell[data-upsell-addon="true"] .upsell__image .upsell__image__img{max-width:62px;}' +

      '.upsell[data-upsell-addon="true"] .upsell__title h3{font-size:13.5px;line-height:1.18;}' +
      '.upsell[data-upsell-addon="true"] .bl-addon-controls{gap:.38rem;flex-wrap:nowrap;}' +
      '.upsell[data-upsell-addon="true"] .bl-addon-controls label{font-size:10.8px;}' +
      '.upsell[data-upsell-addon="true"] .bl-addon-select{min-width:92px;height:28px;min-height:28px;padding:3px 8px;font-size:10.8px;border-radius:7px;}' +
      '.upsell[data-upsell-addon="true"] .bl-addon-hint{font-size:10.4px;line-height:1.18;}' +

      '.upsell[data-upsell-addon="true"] .bl-addon-right{gap:0px;min-width:0;}' +
    '}',

    /* <=390: grid layout so things don’t collide */
    '@media (max-width: 390px){' +
      '.upsell[data-upsell-addon="true"] .bl-addon-main{display:grid;grid-template-columns:56px minmax(0,1fr) max-content;align-items:center;column-gap:12px;row-gap:4px;}' +
      '.upsell[data-upsell-addon="true"] .bl-addon-main>.upsell__image{grid-column:1;grid-row:1;align-self:center;}' +
      '.upsell[data-upsell-addon="true"] .bl-addon-main>.bl-addon-body{grid-column:2;grid-row:1;min-width:0;}' +
      '.upsell[data-upsell-addon="true"] .bl-addon-main>.bl-addon-right{grid-column:3;grid-row:1;min-width:0;}' +

      '.upsell[data-upsell-addon="true"] .upsell__image{flex:0 0 56px;width:56px;}' +
      '.upsell[data-upsell-addon="true"] .upsell__image .upsell__image__img{max-width:56px;width:100%;}' +

      '.upsell[data-upsell-addon="true"] .upsell__title h3{font-size:12.9px;line-height:1.16;}' +
      '.upsell[data-upsell-addon="true"] .bl-addon-controls label{font-size:10.6px;}' +
      '.upsell[data-upsell-addon="true"] .bl-addon-select{max-width:92px;min-width:82px;height:28px;min-height:28px;padding:3px 7px;font-size:10.6px;border-radius:7px;}' +
      '.upsell[data-upsell-addon="true"] .bl-addon-meta{margin-top:.1rem;}' +
      '.upsell[data-upsell-addon="true"] .bl-addon-hint{font-size:10.25px;line-height:1.16;}' +
    '}',

    /* <=370: (bring back) HIDE the "Rarity" label + a bit smaller */
    '@media (max-width: 370px){' +
      '.upsell[data-upsell-addon="true"] .bl-addon-controls label{display:none !important;}' +
      '.upsell[data-upsell-addon="true"] .upsell__title h3{font-size:12.5px;line-height:1.14;}' +
      '.upsell[data-upsell-addon="true"] .bl-addon-select{max-width:92px;min-width:80px;height:27px;min-height:27px;padding:3px 6px;font-size:10.4px;}' +
      '.upsell[data-upsell-addon="true"] .bl-addon-hint{font-size:10.0px;line-height:1.14;}' +
    '}',

    /* <=360: keep it only slightly smaller (NO giant “super small” jump) */
    '@media (max-width: 360px){' +
      '.upsell[data-upsell-addon="true"] .upsell__title h3{font-size:12.3px;line-height:1.14;}' +
      '.upsell[data-upsell-addon="true"] .bl-addon-select{max-width:90px;min-width:78px;height:27px;min-height:27px;padding:3px 6px;font-size:10.3px;}' +
      '.upsell[data-upsell-addon="true"] .bl-addon-hint{font-size:9.9px;line-height:1.14;}' +
    '}',

    '@media (max-width: 356px){' +
      '.upsell[data-upsell-addon="true"] .upsell__title h3{font-size:11.3px;line-height:1.14;}' +
      '.upsell[data-upsell-addon="true"] .bl-addon-select{max-width:90px;min-width:78px;height:27px;min-height:27px;padding:3px 6px;font-size:10.3px;}' +
      '.upsell[data-upsell-addon="true"] .bl-addon-hint{font-size:8.2px;line-height:1.14;}' +
    '}',

    '@media (max-width: 348px){' +
      '.upsell[data-upsell-addon="true"] .upsell__title h3{font-size:10.3px;line-height:1.14;}' +
      '.upsell[data-upsell-addon="true"] .bl-addon-select{max-width:90px;min-width:78px;height:27px;min-height:27px;padding:3px 6px;font-size:10.3px;}' +
      '.upsell[data-upsell-addon="true"] .bl-addon-hint{font-size:7.6px;line-height:1.14;}' +
    '}',

    '@media (max-width: 334px){' +
      '.upsell[data-upsell-addon="true"] .upsell__title h3{font-size:9.3px;line-height:1.14;}' +
      '.upsell[data-upsell-addon="true"] .bl-addon-select{max-width:90px;min-width:78px;height:27px;min-height:27px;padding:3px 6px;font-size:10.3px;}' +
      '.upsell[data-upsell-addon="true"] .bl-addon-hint{font-size:6.8px;line-height:1.14;}' +
    '}'
  ].join('');

  document.head.appendChild(st);
}



  function ensureLayout(card) {
    if (!card) return;
    var main = card.querySelector('.bl-addon-main');
    if (!main) return;

    var right = main.querySelector('.bl-addon-right');
    var price = card.querySelector('.upsell__price');
    var priceWrap = right ? right.querySelector('.bl-addon-price-wrap') : null;

    if (right && !priceWrap) {
      priceWrap = document.createElement('div');
      priceWrap.className = 'bl-addon-price-wrap';
      try { right.insertBefore(priceWrap, right.firstChild); } catch (e) {}
    }

    if (price && priceWrap && price.parentNode !== priceWrap) {
      try { priceWrap.appendChild(price); } catch (e) {}
    }
  }

  function refreshMoneyAttributes(card) {
    if (!card || !U || typeof U.getMoneyEnvironment !== 'function') return { moneyFormat: null, currency: null };
    var env = U.getMoneyEnvironment();
    if (env && env.moneyFormat) card.setAttribute('data-money-format', env.moneyFormat);
    if (env && env.currency) card.setAttribute('data-currency', env.currency);
    return env || { moneyFormat: null, currency: null };
  }

  function getDiscountConfig(card) {
    if (!card) return { enabled: false, percentageLeft: 1, fixedDiscount: 0 };
    var enabled = String(card.getAttribute('data-update-prices') || '').trim() === 'true';
    var percentageLeft = parseFloat(card.getAttribute('data-percentage-left') || '1');
    if (!isFinite(percentageLeft) || percentageLeft <= 0) percentageLeft = 1;
    var fixedDiscount = parseInt(card.getAttribute('data-fixed-discount') || '0', 10);
    if (!isFinite(fixedDiscount) || fixedDiscount < 0) fixedDiscount = 0;
    return { enabled: enabled, percentageLeft: percentageLeft, fixedDiscount: fixedDiscount };
  }

  function applyDiscount(price, cfg) {
    var base = Number(price || 0);
    if (!cfg || !cfg.enabled) return base;
    var discounted = Math.round((base * cfg.percentageLeft) - cfg.fixedDiscount);
    return discounted < 0 ? 0 : discounted;
  }

  function ensureHidden(form, key, value) {
    if (!form) return null;
    var name = 'properties[' + key + ']';
    var el = form.querySelector('input[name="' + name.replace(/"/g, '\\"') + '"]');
    if (!el) {
      el = document.createElement('input');
      el.type = 'hidden';
      el.name = name;
      form.appendChild(el);
    }
    if (typeof value !== 'undefined') el.value = String(value || '');
    return el;
  }

  function setAddonProperties(form, meta, rarity) {
    if (!form) return;
    var locked = meta && meta.handle ? meta.handle : '';
    var key = meta && meta.key ? meta.key : '';
    var title = meta && meta.title ? meta.title : '';
    ensureHidden(form, (M && M.CFG && M.CFG.propLockedCollectionLegacy) || '_bl_locked_collection', locked);
    ensureHidden(form, '_bl_locked_collection_name', title);
    ensureHidden(form, '_bl_locked_collection_title', title);
    ensureHidden(form, '_bl_locked_pool_key', key);
    ensureHidden(form, '_bl_locked_pool_handle', locked);
    ensureHidden(form, '_bl_locked_pool_title', title);
    ensureHidden(form, '_bl_selected_rarity', rarity || '');
    ensureHidden(form, '_bl_requested_rarity', rarity || '');
    if (M && M.CFG && M.CFG.propRequestedTier) {
      ensureHidden(form, M.CFG.propRequestedTier, rarity || '');
    }
  }

  function collectProperties(form) {
    var props = {};
    if (!form) return props;

    try {
      var inputs = form.querySelectorAll('input[name^="properties["]');
      Array.prototype.slice.call(inputs || []).forEach(function (input) {
        var name = input.getAttribute('name') || '';
        var match = name.match(/^properties\[(.*)\]$/);
        if (!match || match.length < 2) return;
        var key = match[1];
        props[key] = input.value || '';
      });
    } catch (e) {}

    return props;
  }

  function mirrorPropertiesToItems(form, props) {
    if (!form || !props) return;

    var idInputs = form.querySelectorAll('input[name^="items["][name$="[id]"]');
    if (!idInputs || !idInputs.length) return;

    Array.prototype.slice.call(idInputs || []).forEach(function (idInput, autoIdx) {
      var name = idInput.getAttribute('name') || '';
      var m = name.match(/^(items\[[^\]]*\])\[id\]$/);
      var itemKey = (m && m[1]) ? m[1] : 'items[' + autoIdx + ']';

      Object.keys(props).forEach(function (key) {
        var propName = itemKey + '[properties[' + key + ']]';
        var existing = form.querySelector('input[name="' + propName.replace(/"/g, '\\"') + '"]');
        if (!existing) {
          existing = document.createElement('input');
          existing.type = 'hidden';
          existing.name = propName;
          form.appendChild(existing);
        }
        existing.value = props[key] || '';
      });
    });
  }

  function logAddonDebug(label, meta) {
    if (!shouldDebug()) return;
    debugLog(label, meta);
  }

  var poolAvailabilityPromises = {};
  var poolValidationPromises = {};
  function normalizePoolHandle(handle) {
    return String(handle || '').trim();
  }

  function getPoolView() {
    return (M && M.CFG && M.CFG.poolView) ? M.CFG.poolView : 'mystery';
  }

  function getPoolCacheKey(handle) {
    return 'bl-mystery-pool-' + String(handle || '').trim();
  }

  function readPoolCache(handle) {
    var key = getPoolCacheKey(handle);
    if (!key) return null;
    try {
      if (!window.sessionStorage) return null;
      var raw = window.sessionStorage.getItem(key);
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (data && Array.isArray(data.products)) return data;
    } catch (e) {}
    try {
      if (window.sessionStorage) window.sessionStorage.removeItem(key);
    } catch (e2) {}
    return null;
  }

  function writePoolCache(handle, data) {
    var key = getPoolCacheKey(handle);
    if (!key || !data) return;
    try {
      if (window.sessionStorage) window.sessionStorage.setItem(key, JSON.stringify(data));
    } catch (e) {}
  }

  function fetchPoolJson(handle) {
    var poolHandle = normalizePoolHandle(handle);
    if (!poolHandle) return Promise.resolve(null);

    var cached = readPoolCache(poolHandle);
    if (cached) return Promise.resolve(cached);

    var poolView = getPoolView();
    var url = '/collections/' + encodeURIComponent(poolHandle) + '?view=' + encodeURIComponent(poolView);

    return fetch(url, { credentials: 'same-origin' })
      .then(function (response) {
        if (!response.ok) throw new Error('Pool HTTP ' + response.status);
        return response.json();
      })
      .then(function (json) {
        if (json && Array.isArray(json.products)) writePoolCache(poolHandle, json);
        return json;
      })
      .catch(function () { return null; });
  }

  function validatePoolEndpoint(handle, meta) {
    var poolHandle = normalizePoolHandle(handle);
    var poolView = getPoolView();
    var url = poolHandle
      ? '/collections/' + encodeURIComponent(poolHandle) + '?view=' + encodeURIComponent(poolView)
      : '';

    if (!poolHandle) {
      logAddonDebug('pool-validation-missing-handle', {
        poolKey: meta && meta.key ? meta.key : '',
        poolHandle: poolHandle,
        url: url
      });
      return Promise.resolve({ ok: false, reason: 'missing-handle', status: 0, url: url, length: 0 });
    }

    if (poolValidationPromises[poolHandle]) return poolValidationPromises[poolHandle];

    poolValidationPromises[poolHandle] = fetch(url, { credentials: 'same-origin' })
      .then(function (response) {
        var status = response.status;
        return response.text().then(function (text) {
          var parsedOk = false;
          var data = null;
          var length = 0;
          try {
            data = JSON.parse(text || '{}');
            parsedOk = true;
          } catch (e) {
            parsedOk = false;
          }

          if (parsedOk && data && Array.isArray(data.products)) length = data.products.length;

          var hasFields = parsedOk && data && Array.isArray(data.products) && (data.collection || data.collection_handle);
          var ok = status === 200 && hasFields;

          logAddonDebug('pool-validation-response', {
            poolKey: meta && meta.key ? meta.key : '',
            poolHandle: poolHandle,
            url: url,
            status: status,
            parsed: parsedOk,
            length: length
          });

          if (!ok) {
            return { ok: false, reason: 'bad-handle-view', status: status, url: url, length: length };
          }

          return { ok: true, status: status, url: url, length: length, data: data };
        });
      })
      .catch(function (err) {
        logAddonDebug('pool-validation-error', {
          poolKey: meta && meta.key ? meta.key : '',
          poolHandle: poolHandle,
          url: url,
          error: String(err || '')
        });
        return { ok: false, reason: 'fetch-error', status: 0, url: url, length: 0 };
      });

    return poolValidationPromises[poolHandle];
  }

  function normalizeDistinctIdentity(item) {
    if (!item) return '';
    var raw = item.real_name || item.title || '';
    var normalized = String(raw || '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!normalized) {
      normalized = String(item.handle || item.variant_id || '').trim().toLowerCase();
    }
    return normalized;
  }

  function computeDistinctAvailability(index) {
    var allowed = (M && M.CFG && Array.isArray(M.CFG.allowedRarities))
      ? M.CFG.allowedRarities.slice()
      : ['common', 'rare', 'epic', 'legendary'];
    var perRarityDistinct = {};
    var totalSet = {};

    allowed.forEach(function (rarity) {
      var list = index && index[rarity] ? index[rarity] : [];
      var seen = {};
      list.forEach(function (item) {
        var identity = normalizeDistinctIdentity(item);
        if (!identity || seen[identity]) return;
        seen[identity] = true;
        totalSet[identity] = true;
      });
      perRarityDistinct[rarity] = Object.keys(seen).length;
    });

    return {
      perRarityDistinct: perRarityDistinct,
      totalDistinct: Object.keys(totalSet).length
    };
  }

  function enableAnyOnlyOption(selectEl) {
    if (!selectEl) return [];
    var anyKey = String((M && M.CFG && M.CFG.anyRarityKey) || 'any').toLowerCase();
    var enabledOptions = [];
    var anyFound = false;

    Array.prototype.slice.call(selectEl.options || []).forEach(function (opt) {
      var rarity = normalizeRarityForIndex(getVariantRarity(String(opt.value || '').trim()));
      var isAny = rarity === anyKey;
      if (isAny) {
        opt.disabled = false;
        anyFound = true;
        enabledOptions.push(opt);
      } else {
        opt.disabled = true;
      }
      opt.hidden = false;
    });

    if (!anyFound && selectEl.options.length) {
      selectEl.options[0].disabled = false;
      enabledOptions.push(selectEl.options[0]);
    }

    if (enabledOptions.length) {
      selectEl.value = String(enabledOptions[0].value || '');
    }

    logAddonDebug('addon-availability-fallback', {
      enabled_options: enabledOptions.map(function (opt) { return opt.value; })
    });

    return enabledOptions;
  }

  function loadPoolAvailability(handle) {
    var key = normalizePoolHandle(handle);
    if (!key) return Promise.resolve(null);
    if (poolAvailabilityPromises[key]) return poolAvailabilityPromises[key];
    if (!M || typeof M.buildPoolIndex !== 'function') {
      poolAvailabilityPromises[key] = Promise.resolve(null);
      return poolAvailabilityPromises[key];
    }

    poolAvailabilityPromises[key] = fetchPoolJson(key)
      .then(function (json) {
        if (!json) return null;
        var index = M.buildPoolIndex(json);
        if (!index) return null;
        return computeDistinctAvailability(index);
      })
      .catch(function () { return null; });

    return poolAvailabilityPromises[key];
  }

  function getLockedCollectionMeta(card, form) {
    return resolveLockedCollection(card);
  }

  function getLockedCollectionKey(card, form) {
    var meta = getLockedCollectionMeta(card, form);
    return meta.handle || '';
  }

  function patchCartDrawerProductForm(pfEl, form) {
    if (!pfEl || !form) return;
    if (pfEl.dataset && pfEl.dataset.blAddonPatched === '1') return;

    var formHandle = (form.getAttribute('data-bl-handle') || '').trim();
    if (formHandle && formHandle !== getAddonHandle()) return;

    var originalSubmit = typeof pfEl.onSubmit === 'function' ? pfEl.onSubmit.bind(pfEl) : null;
    if (!originalSubmit) return;

    try { pfEl.dataset.blAddonPatched = '1'; } catch (e) {}

    pfEl.onSubmit = function (evt) {
      var handle = getAddonHandle();

      var computePromise = Promise.resolve(true);
      try {
        if (M && typeof M.computeAndApplyAssignment === 'function') {
          computePromise = M.computeAndApplyAssignment(form, handle, { force: true });
        }
      } catch (e) {}

      return computePromise.then(function (ok) {
        if (!ok) {
          logAddonDebug('pre-submit-skip', { role: 'addon', handle: handle, reason: 'compute-failed' });
          if (evt && typeof evt.preventDefault === 'function') evt.preventDefault();
          return false;
        }

        var propsSnapshot = collectProperties(form);
        mirrorPropertiesToItems(form, propsSnapshot);

        logAddonDebug('pre-submit', {
          role: 'addon',
          handle: handle,
          properties: propsSnapshot
        });

        if (isDebug() && (!propsSnapshot._bl_assigned_variant_id || !propsSnapshot._bl_assignment_uid)) {
          console.error('[BL Mystery][addon] BLOCKED: missing swap properties');
          logAddonDebug('blocked', {
            role: 'addon',
            handle: handle,
            reason: 'missing-properties',
            properties: propsSnapshot
          });
          if (evt && typeof evt.preventDefault === 'function') evt.preventDefault();
          return false;
        }

        var assignedVariantId = propsSnapshot._bl_assigned_variant_id || propsSnapshot[(M && M.CFG && M.CFG.propAssignedVariantId) || '_assigned_variant_id'] || '';
        if (assignedVariantId && M && typeof M.applyAssignedVariantForSubmit === 'function') {
          M.applyAssignedVariantForSubmit(form, assignedVariantId);
        }

        var result = originalSubmit(evt);
        if (assignedVariantId && M && typeof M.restoreOriginalVariantId === 'function') {
          setTimeout(function () { M.restoreOriginalVariantId(form); }, 0);
        }
        return result;
      });
    };
  }

  function parseVariants(card) {
    var script = card.querySelector('script[data-bl-addon-variants]');
    if (!script) return [];
    try { return JSON.parse(script.textContent || '[]') || []; } catch (e) { return []; }
  }

  function labelForVariant(v) {
    if (!v) return 'Option';
    try {
      if (M && typeof M.parseSelectionFromText === 'function') {
        var sel = M.parseSelectionFromText(v.public_title || v.title || '');
        var r = sel ? sel.rarity : '';
        if (r) return r.charAt(0).toUpperCase() + r.slice(1);
      }
    } catch (e) {}
    return (v.public_title || v.title || 'Option').trim() || 'Option';
  }

  function rarityOrderValue(rarity) {
    var r = String(rarity || '').toLowerCase();
    var idx = RARITY_ORDER.indexOf(r);
    return idx === -1 ? 999 : idx;
  }

  function normalizeAddonRarity(raw) {
    var anyKey = 'any';
    try { anyKey = String((M && M.CFG && M.CFG.anyRarityKey) || 'any').toLowerCase(); } catch (e) { anyKey = 'any'; }

    var allowed = (M && M.CFG && Array.isArray(M.CFG.allowedRarities)) ? M.CFG.allowedRarities.slice() : ['common', 'rare', 'epic', 'legendary'];
    ['special', 'mythical'].forEach(function (rarity) {
      if (allowed.indexOf(rarity) === -1) allowed.push(rarity);
    });
    var lower = String(raw || '').trim().toLowerCase();
    var normalized = '';

    if (lower === anyKey) normalized = anyKey;
    else if (allowed.indexOf(lower) !== -1) normalized = lower;

    logAddonDebug('requested-rarity-normalized', { raw: raw, normalized: normalized });
    return normalized;
  }

  function normalizeRarityForIndex(rarity) {
    var r = String(rarity || '').toLowerCase();
    if (r === 'special' || r === 'mythical') return 'legendary';
    return r;
  }

  function getVariantRarity(variantId) {
    try {
      if (M && typeof M.getVariantSelection === 'function') {
        var sel = M.getVariantSelection(variantId);
        if (sel && sel.rarity) return normalizeAddonRarity(sel.rarity);
      }
    } catch (e) {}
    return '';
  }

  function formatCollectionName(card) {
    var meta = getLockedCollectionMeta(card);
    if (meta.title) return meta.title;

    var handle = meta.handle || '';
    if (!handle) return '';
    return handle
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, function (c) { return c.toUpperCase(); })
      .trim();
  }

  function hintForRarity(rarity, collectionName) {
    var r = String(rarity || '').toLowerCase();
    var anyKey = 'any';
    try { anyKey = String((M && M.CFG && M.CFG.anyRarityKey) || 'any').toLowerCase(); } catch (e) { anyKey = 'any'; }

    var suffix = collectionName ? ' from ' + collectionName : '';

    if (!r || r === anyKey) return 'Get a random figure' + suffix + '.';

    var label = r.charAt(0).toUpperCase() + r.slice(1);
    return 'Get a ' + label + ' figure' + suffix + '.';
  }

  function getNoticeEl(card) {
    var el = document.querySelector('[data-bl-addon-notice]');
    if (el) return el;

    var container = null;
    try { container = card.closest('.upsells, .bl-upsells, .upsells-block, [data-upsells-wrapper]'); } catch (e) {}

    el = document.createElement('div');
    el.setAttribute('data-bl-addon-notice', '');
    el.className = 'bl-addon-notice';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.setAttribute('aria-atomic', 'true');
    el.style.display = 'none';

    if (container && container.parentNode) {
      try { container.parentNode.insertBefore(el, container.nextSibling); return el; } catch (e2) {}
    }

    try { document.body.appendChild(el); } catch (e3) {}
    return el;
  }

  function showNotice(card, text) {
    var el = getNoticeEl(card);
    if (!el) return;

    el.textContent = text || '';
    el.style.display = text ? 'block' : 'none';

    if (el.__blHideTimer) clearTimeout(el.__blHideTimer);
    el.__blHideTimer = setTimeout(function () {
      el.style.display = 'none';
    }, 5000);
  }

  A.notifyError = function (message) {
    var msg = message || 'Unable to assign a figure from the pool.';
    var card = document.querySelector('.upsell[data-upsell-addon="true"]');
    if (card) {
      showNotice(card, msg);
      return;
    }
    try { console.warn('[BL Mystery Addon] ' + msg); } catch (e) {}
  };

  function handlePoolFailure(card, selectEl, lockedMeta, result) {
    var reason = result && result.reason ? result.reason : '';
    var message = 'Pool unavailable (bad handle/view)';
    if (!lockedMeta || !lockedMeta.handle) {
      message = 'This add-on is unavailable because a locked collection could not be determined.';
    } else if (reason === 'bad-handle-view') {
      message = 'Pool unavailable (bad handle/view)';
    }

    showNotice(card, message);
    if (selectEl) {
      setAddonDisabled(card, selectEl, false);
      enableAnyOnlyOption(selectEl);
      updateHint(card, selectEl);
    }

    logAddonDebug('addon-pool-failure', {
      pool_handle: lockedMeta && lockedMeta.handle ? lockedMeta.handle : '',
      pool_key: lockedMeta && lockedMeta.key ? lockedMeta.key : '',
      reason: reason,
      validation: result && result.validation ? result.validation : null
    });
    return false;
  }

  function applyVariant(card, variants, variantId) {
    var v = variants.find(function (x) { return String(x.id) === String(variantId); }) || variants[0];
    if (!v) return;

    refreshMoneyAttributes(card);

    card.setAttribute('data-id', String(v.id));

    var form =
      card.querySelector('form[data-type="add-to-cart-form"]') ||
      card.querySelector('form[action^="/cart/add"]') ||
      card.querySelector('form');

    var productFormEl = card.querySelector('product-form');

    if (form) {
      var idInput = form.querySelector('input[name="id"]') || form.querySelector('select[name="id"]');
      if (idInput) idInput.value = String(v.id);
    }

    // price
    var env = U && typeof U.getMoneyEnvironment === 'function' ? U.getMoneyEnvironment() : {};
    var moneyFormat = card.getAttribute('data-money-format') || (env && env.moneyFormat) || null;
    var moneyCurrency = card.getAttribute('data-currency') || (env && env.currency) || null;

    var priceEl = card.querySelector('.upsell__price .regular-price');
    var compareEl = card.querySelector('.upsell__price .compare-price');
    var discountCfg = getDiscountConfig(card);
    var basePrice = Number(v.price || 0);
    var baseCompare = (v.compare_at_price && v.compare_at_price > v.price) ? Number(v.compare_at_price) : basePrice;
    var displayPrice = applyDiscount(basePrice, discountCfg);
    var displayCompare = baseCompare;

    if (priceEl && U && typeof U.money === 'function') {
      var formatted = U.money(displayPrice, { moneyFormat: moneyFormat, currency: moneyCurrency });
      if (priceEl.textContent !== formatted) priceEl.textContent = formatted;
    }
    if (compareEl && U && typeof U.money === 'function') {
      if (displayCompare > displayPrice) {
        var compareText = U.money(displayCompare, { moneyFormat: moneyFormat, currency: moneyCurrency });
        if (compareEl.textContent !== compareText) compareEl.textContent = compareText;
        if (compareEl.classList.contains('hidden')) compareEl.classList.remove('hidden');
      } else {
        if (compareEl.textContent !== '') compareEl.textContent = '';
        if (!compareEl.classList.contains('hidden')) compareEl.classList.add('hidden');
      }
    }

    if (card && card.getAttribute('data-update-prices') === 'true') {
      card.setAttribute('data-price', String(displayPrice));
      card.setAttribute('data-compare-price', String(displayCompare));
    }

    // image
    var img = card.querySelector('img.upsell__image__img');
    if (img && v.image) {
      img.src = v.image;
      img.removeAttribute('srcset');
      img.removeAttribute('sizes');
    }

    // Sync requested state but defer assignment until add-to-cart
    try {
      if (M && form && typeof M.computeAndApplyAssignment === 'function') {
        M.computeAndApplyAssignment(form, M.CFG.mysteryAddonHandle, { assign: false }).catch(function () {});
      }
    } catch (e) {}
  }

  function disableIneligibleOptions(card, variants, selectEl, lockedMeta) {
    if (!selectEl) return Promise.resolve({ ok: false, reason: 'missing-select', switched: false });

    var poolHandle = normalizePoolHandle(lockedMeta && lockedMeta.handle ? lockedMeta.handle : '');
    if (!poolHandle) {
      logAddonDebug('addon-pool-handle-missing', { pool_handle: poolHandle });
      return Promise.resolve({ ok: false, reason: 'missing-handle', switched: false });
    }

    return validatePoolEndpoint(poolHandle, lockedMeta).then(function (validation) {
      if (!validation || !validation.ok) {
        return {
          ok: false,
          reason: (validation && validation.reason) || 'validation-failed',
          switched: false,
          validation: validation || null
        };
      }

      return loadPoolAvailability(poolHandle).then(function (availability) {
        if (!availability) {
          return { ok: false, reason: 'availability-missing', switched: false, validation: validation };
        }

        var anyKey = String((M && M.CFG && M.CFG.anyRarityKey) || 'any').toLowerCase();
        var totalDistinct = Number(availability.totalDistinct || 0);
        var perRarityDistinct = availability.perRarityDistinct || {};
        var counts = {};

        Object.keys(perRarityDistinct || {}).forEach(function (rarityKey) {
          counts[String(rarityKey || '').toLowerCase()] = Number(perRarityDistinct[rarityKey] || 0);
        });
        ['common', 'rare', 'epic', 'legendary'].forEach(function (rarityKey) {
          if (typeof counts[rarityKey] === 'undefined') counts[rarityKey] = 0;
        });

        if (shouldDebug()) {
          try {
            console.log('[BL Mystery Addon][debug] pool availability', {
              poolHandle: poolHandle,
              poolTitle: formatCollectionName(card),
              totalDistinct: totalDistinct,
              perRarityDistinct: counts
            });
          } catch (e) {}
        }

        var switched = false;
        var enabledOptions = [];
        var minSpecific = getMinDistinctForSpecific();

        Array.prototype.slice.call(selectEl.options || []).forEach(function (opt) {
          var vid = String(opt.value || '').trim();
          var rarity = normalizeRarityForIndex(getVariantRarity(vid));
          var eligibleFlag = true;

          if (rarity === anyKey) {
            eligibleFlag = totalDistinct >= MIN_DISTINCT_FOR_ANY;
          } else if (rarity) {
            eligibleFlag = (counts[rarity] || 0) >= minSpecific;
          }
          opt.disabled = !eligibleFlag;
          opt.hidden = false;
          if (eligibleFlag) enabledOptions.push(opt);
        });

        logAddonDebug('addon-eligibility-updated', {
          pool_handle: poolHandle,
          total_distinct: totalDistinct,
          per_rarity_distinct: counts,
          min_specific: minSpecific,
          enabled_options: enabledOptions.map(function (opt) { return opt.value; })
        });
        logAddonDebug('addon-availability', {
          poolHandle: poolHandle,
          totalDistinct: totalDistinct,
          perRarityDistinct: counts,
          enabledOptions: enabledOptions.map(function (opt) { return opt.value; })
        });

        // fallback if current disabled (prefer Any)
        var cur = String(selectEl.value || '').trim();
        var curOpt = selectEl.querySelector('option[value="' + cur.replace(/"/g, '\\"') + '"]');
        if (curOpt && curOpt.disabled) {
          var fallback = '';
          var anyFallback = '';

          for (var i = 0; i < selectEl.options.length; i++) {
            var opt = selectEl.options[i];
            if (opt.disabled) continue;
            var r = getVariantRarity(String(opt.value || '').trim());
            if (r === anyKey && !anyFallback) anyFallback = String(opt.value);
            if (!fallback) fallback = String(opt.value);
          }

          var target = anyFallback || fallback;
          if (target && target !== cur) {
            selectEl.value = target;
            switched = true;
          }
        }

        if (!enabledOptions.length) {
          enableAnyOnlyOption(selectEl);
        }

        if (shouldDebug()) {
          try {
            console.log('[BL Mystery Addon][debug] addon-selection', {
              poolHandle: poolHandle,
              selected: selectEl.value,
              enabled: enabledOptions.map(function (opt) { return opt.value; })
            });
          } catch (e) {}
        }

        return { ok: true, switched: switched, counts: counts, enabledOptions: enabledOptions, validation: validation };
      });
    }).catch(function (err) {
      return { ok: false, reason: 'availability-error', switched: false, error: err || null };
    });
  }

  function removePills(card) {
    // hard remove any legacy pill UI inside addon card
    var pillWrap = card.querySelector('.bl-addon-variants');
    if (pillWrap) pillWrap.remove();
    if (U && typeof U.qsa === 'function') {
      U.qsa(card, '.bl-addon-pill').forEach(function (btn) { btn.remove(); });
    } else {
      Array.prototype.slice.call(card.querySelectorAll('.bl-addon-pill')).forEach(function (btn) { btn.remove(); });
    }
  }

  function buildSelect(card, variants) {
    var controls = card.querySelector('[data-bl-addon-controls]');
    if (!controls) return null;

    var existing = controls.querySelector('select[data-bl-addon-select="1"]');
    if (existing) return existing;

    var selectId = 'bl-addon-select-' + String(Math.random()).replace(/\D/g, '').slice(0, 6);
    var select = document.createElement('select');
    select.className = 'bl-addon-select';
    select.setAttribute('data-bl-addon-select', '1');
    select.id = selectId;

    var sortedVariants = variants.slice().sort(function (a, b) {
      return rarityOrderValue(getVariantRarity(a.id)) - rarityOrderValue(getVariantRarity(b.id));
    });

    sortedVariants.forEach(function (v) {
      var opt = document.createElement('option');
      opt.value = String(v.id);
      opt.textContent = labelForVariant(v);
      select.appendChild(opt);
    });

    var label = document.createElement('label');
    label.setAttribute('for', selectId);
    label.textContent = 'Rarity';

    controls.appendChild(label);
    controls.appendChild(select);
    return select;
  }

  function findSelectEl(card) {
    if (!card) return null;
    return (
      card.querySelector('select[data-bl-addon-select="1"]') ||
      card.querySelector('select.bl-addon-select') ||
      (card.querySelector('[data-bl-addon-controls]') || card).querySelector('select')
    );
  }

  function updateHint(card, selectEl) {
    var hintEl = card.querySelector('[data-bl-addon-hint]');
    if (!hintEl) return;

    var rarity = selectEl ? getVariantRarity(String(selectEl.value)) : '';
    var collectionName = formatCollectionName(card);
    var nextText = hintForRarity(rarity, collectionName);
    var current = hintEl.textContent || '';
    if (current === nextText || hintEl.__blLastHint === nextText) return;
    hintEl.textContent = nextText;
    hintEl.__blLastHint = nextText;
  }

  function setAddonDisabled(card, selectEl, disabled) {
    if (selectEl) selectEl.disabled = !!disabled;
    if (!card) return;
    var btn = card.querySelector('button[type="submit"]');
    if (btn) btn.disabled = !!disabled;
    card.setAttribute('data-bl-addon-disabled', disabled ? 'true' : 'false');
  }

  function findAddonForm(card) {
    if (!card) return null;
    return (
      card.querySelector('form[data-type="add-to-cart-form"]') ||
      card.querySelector('form[action^="/cart/add"]') ||
      card.querySelector('form')
    );
  }

  function getAssignedVariantIdFromForm(form) {
    if (!form) return '';
    var props = collectProperties(form);
    return props._bl_assigned_variant_id || props[(M && M.CFG && M.CFG.propAssignedVariantId) || '_assigned_variant_id'] || '';
  }

  function addAssignedVariantToCart(card, form, assignedVariantId) {
    if (!assignedVariantId) return Promise.resolve(false);
    var props = collectProperties(form);
    var payload = {
      id: assignedVariantId,
      quantity: 1,
      properties: props
    };

    logAddonDebug('addon-plus-add-to-cart', {
      assigned_variant_id: assignedVariantId,
      payload: payload
    });

    return fetch('/cart/add.js', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(payload)
    }).then(function (resp) {
      logAddonDebug('addon-plus-add-to-cart-response', {
        status: resp.status,
        assigned_variant_id: assignedVariantId
      });
      if (!resp.ok) return false;
      return resp.json().then(function () { return true; }).catch(function () { return true; });
    });
  }

  function handleAddonPlusClick(card, button) {
    if (!card || !M || typeof M.computeAndApplyAssignment !== 'function') return;
    if (card.__blAddonAdding) return;
    card.__blAddonAdding = true;

    var form = findAddonForm(card);
    if (!form) {
      showNotice(card, 'Unable to add add-on because the form is missing.');
      card.__blAddonAdding = false;
      return;
    }

    var selectEl = findSelectEl(card);
    var lockedMeta = getLockedCollectionMeta(card, form);
    var lockedHandle = lockedMeta.handle;
    var poolKey = lockedMeta.key;
    var rarity = selectEl ? getVariantRarity(selectEl.value) : '';

    logAddonDebug('addon-plus-click', {
      poolKey: poolKey,
      poolHandle: lockedHandle,
      rarity: rarity
    });

    if (!lockedHandle) {
      showNotice(card, 'This add-on is unavailable because a locked collection could not be determined.');
      card.__blAddonAdding = false;
      return;
    }

    ensureHidden(form, '_bl_is_addon', '1');
    var parentHandle = String(card.getAttribute('data-parent-handle') || '').trim();
    if (parentHandle) ensureHidden(form, '_bl_parent_handle', parentHandle);

    var parentUidInput = ensureHidden(form, '_bl_parent_uid', '');
    if (parentUidInput && !parentUidInput.value) parentUidInput.value = generateUid('bl-parent');

    setAddonProperties(form, lockedMeta, rarity);

    validatePoolEndpoint(lockedHandle, lockedMeta)
      .then(function (validation) {
        if (!validation || !validation.ok) {
          handlePoolFailure(card, selectEl, lockedMeta, validation || {});
          return { aborted: true };
        }
        return M.computeAndApplyAssignment(form, getAddonHandle(), { force: true });
      })
      .then(function (assignedOk) {
        if (assignedOk && assignedOk.aborted) return false;
        if (!assignedOk) {
          showNotice(card, 'Unable to assign a figure from the pool.');
          logAddonDebug('addon-plus-assignment-failed', { pool_handle: lockedHandle, pool_key: poolKey });
          return false;
        }

        var assignedVariantId = getAssignedVariantIdFromForm(form);
        if (!assignedVariantId) {
          showNotice(card, 'Unable to assign a figure from the pool.');
          logAddonDebug('addon-plus-assignment-missing', { pool_handle: lockedHandle, pool_key: poolKey });
          return false;
        }

        return addAssignedVariantToCart(card, form, assignedVariantId).then(function (ok) {
          if (!ok) {
            showNotice(card, 'Unable to add the assigned figure to cart.');
            return false;
          }
          return true;
        });
      })
      .catch(function (err) {
        logAddonDebug('addon-plus-add-error', { error: String(err || '') });
        showNotice(card, 'Unable to add the assigned figure to cart.');
      })
      .then(function () {
        card.__blAddonAdding = false;
      }, function () {
        card.__blAddonAdding = false;
      });
  }

  var addonPlusHandlerBound = false;
  function bindAddonPlusHandler() {
    if (addonPlusHandlerBound) return;
    addonPlusHandlerBound = true;

    document.addEventListener('click', function (evt) {
      var target = evt && evt.target ? evt.target : null;
      if (!target || !target.closest) return;
      var button = target.closest('.upsell__plus-btn');
      if (!button) return;
      var card = button.closest('.upsell[data-upsell-addon="true"]');
      if (!card) return;

      evt.preventDefault();
      evt.stopPropagation();

      handleAddonPlusClick(card, button);
    });
  }

  function bindCard(card) {
    if (card.__blAddonBound) return;
    card.__blAddonBound = true;

    // only target the addon product card
    var h = String(card.getAttribute('data-handle') || '').trim();
    if (!h || h !== getAddonHandle()) return;

    var variants = parseVariants(card);
    if (!variants.length) return;

    ensureCssOnce();
    ensureLayout(card);
    removePills(card);
    refreshMoneyAttributes(card);

    var form =
      card.querySelector('form[data-type="add-to-cart-form"]') ||
      card.querySelector('form[action^="/cart/add"]') ||
      card.querySelector('form');

    var productFormEl = card.querySelector('product-form');

    var lockedMeta = getLockedCollectionMeta(card, form);
    var locked = lockedMeta.handle;
    var lockedTitle = lockedMeta.title;
    var poolKey = lockedMeta.key;
    var parentHandle = String(card.getAttribute('data-parent-handle') || '').trim();
    var hasPoolContext = !!locked;

    if (form) {
      ensureHidden(form, '_bl_is_addon', '1');
      if (parentHandle) ensureHidden(form, '_bl_parent_handle', parentHandle);
      setAddonProperties(form, lockedMeta, getVariantRarity(card.getAttribute('data-id') || ''));
      var parentUidInput = ensureHidden(form, '_bl_parent_uid', '');
      if (parentUidInput && !parentUidInput.value) parentUidInput.value = generateUid('bl-parent');

      form.addEventListener('submit', function (evt) {
        lockedMeta = getLockedCollectionMeta(card, form);
        locked = lockedMeta.handle;
        lockedTitle = lockedMeta.title;
        poolKey = lockedMeta.key;
        hasPoolContext = !!locked;
        if (!hasPoolContext) {
          showNotice(card, 'This add-on is unavailable because a locked collection could not be determined.');
          setAddonDisabled(card, selectEl, false);
          if (evt && typeof evt.preventDefault === 'function') evt.preventDefault();
          return;
        }
        logAddonDebug('addon-submit', { locked_collection: locked, pool_handle: locked });
        ensureHidden(form, '_bl_is_addon', '1');
        if (parentHandle) ensureHidden(form, '_bl_parent_handle', parentHandle);
        setAddonProperties(form, lockedMeta, getVariantRarity(selectEl ? selectEl.value : ''));
        var submitParentUid = ensureHidden(form, '_bl_parent_uid', '');
        if (submitParentUid && !submitParentUid.value) submitParentUid.value = generateUid('bl-parent');

        // assignment happens in engine submit safety; keep flags in sync
      });
    }

    if (productFormEl && form) {
      patchCartDrawerProductForm(productFormEl, form);
    }

    var selectEl = buildSelect(card, variants);
    if (!selectEl) selectEl = findSelectEl(card);

    // initial id
    var initialId = card.getAttribute('data-id') || (variants[0] && variants[0].id);
    if (selectEl && initialId) selectEl.value = String(initialId);

    // ensure variant map is ready, then eligibility, then apply
    (M && typeof M.fetchVariantMap === 'function' ? M.fetchVariantMap() : Promise.resolve())
      .then(function () {
        if (!hasPoolContext) {
          showNotice(card, 'This add-on is unavailable because a locked collection could not be determined.');
          logAddonDebug('addon-collection-missing', { locked_collection: locked });
          setAddonDisabled(card, selectEl, false);
          return { ok: false, reason: 'missing-handle' };
        }
        setAddonDisabled(card, selectEl, false);
        return disableIneligibleOptions(card, variants, selectEl, lockedMeta);
      })
      .then(function (result) {
        if (!result || !result.ok) {
          handlePoolFailure(card, selectEl, lockedMeta, result || {});
          applyVariant(card, variants, selectEl ? selectEl.value : initialId);
          updateHint(card, selectEl);
          return;
        }
        var selectedRarity = getVariantRarity(selectEl ? selectEl.value : initialId);
        setAddonProperties(form, lockedMeta, selectedRarity);
        applyVariant(card, variants, selectEl ? selectEl.value : initialId);
        updateHint(card, selectEl);
        if (result.switched) {
          showNotice(card, 'Some rarities are not available for this collection right now. Switched to an available option.');
        }
      })
      .catch(function () {
        applyVariant(card, variants, selectEl ? selectEl.value : initialId);
        updateHint(card, selectEl);
      });

    if (selectEl) {
      selectEl.addEventListener('change', function () {
        lockedMeta = getLockedCollectionMeta(card, form);
        locked = lockedMeta.handle;
        lockedTitle = lockedMeta.title;
        poolKey = lockedMeta.key;
        hasPoolContext = !!locked;
        if (!hasPoolContext) {
          showNotice(card, 'This add-on is unavailable because a locked collection could not be determined.');
          logAddonDebug('addon-collection-missing', { locked_collection: locked });
          setAddonDisabled(card, selectEl, false);
          return;
        }
        setAddonDisabled(card, selectEl, false);
        disableIneligibleOptions(card, variants, selectEl, lockedMeta).then(function (result) {
          if (!result || !result.ok) {
            handlePoolFailure(card, selectEl, lockedMeta, result || {});
            applyVariant(card, variants, selectEl.value);
            updateHint(card, selectEl);
            return;
          }
          setAddonProperties(form, lockedMeta, getVariantRarity(selectEl.value));
          applyVariant(card, variants, selectEl.value);
          updateHint(card, selectEl);
          if (result.switched) {
            showNotice(card, 'Some rarities are not available for this collection right now. Switched to an available option.');
          }
        });
      });
    }

    // lightweight observer: only if theme replaces inner price/image text
    if (!card.__blAddonObserver && typeof MutationObserver !== 'undefined' && U && typeof U.debounce === 'function') {
      try {
        var mo = new MutationObserver(U.debounce(function () {
          if (!card.isConnected) { mo.disconnect(); return; }
          removePills(card);
          ensureLayout(card);
          var updatedSelect = findSelectEl(card);
          var updatedLockedMeta = getLockedCollectionMeta(card, form);
          var updatedLocked = updatedLockedMeta.handle;
          if (updatedSelect && updatedLocked) {
            setAddonDisabled(card, updatedSelect, false);
            disableIneligibleOptions(card, variants, updatedSelect, updatedLockedMeta).then(function (result) {
              if (!result || !result.ok) {
                handlePoolFailure(card, updatedSelect, updatedLockedMeta, result || {});
                return;
              }
              if (result.switched) {
                showNotice(card, 'Some rarities are not available for this collection right now. Switched to an available option.');
              }
            });
          } else if (!updatedLocked) {
            showNotice(card, 'This add-on is unavailable because a locked collection could not be determined.');
            setAddonDisabled(card, updatedSelect, false);
          }
          // do NOT rebuild layout; only keep price/hint accurate
          if (updatedSelect) {
            refreshMoneyAttributes(card);
            updateHint(card, updatedSelect);
          }
        }, 120));
        mo.observe(card, { childList: true, subtree: true });
        card.__blAddonObserver = mo;
      } catch (e) {}
    }
  }

  function startObserver() {
    if (observer || typeof MutationObserver === 'undefined' || !U || typeof U.debounce !== 'function') return;
    try {
      observer = new MutationObserver(U.debounce(function () {
        if (observerRunning) return;
        observerRunning = true;
        try { A.init(document); } finally { observerRunning = false; }
      }, 120));
      observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
    } catch (e) {}
  }

  A.init = function (root) {
    root = root || document;
    if (!U || !M || !M.CFG) return;

    startObserver();
    bindAddonPlusHandler();

    var cards = (U && typeof U.qsa === 'function')
      ? U.qsa(root, '.upsell[data-upsell-addon="true"]')
      : Array.prototype.slice.call(root.querySelectorAll('.upsell[data-upsell-addon="true"]'));

    if (!cards.length) return;

    cards.forEach(function (card) {
      bindCard(card);
    });
  };

  function initOnReady() {
    try {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { A.init(document); });
      } else {
        A.init(document);
      }
    } catch (e) {}
  }

  initOnReady();

  document.addEventListener('shopify:section:load', function (evt) {
    try { A.init(evt && evt.target ? evt.target : document); } catch (e) {}
  });
})();
