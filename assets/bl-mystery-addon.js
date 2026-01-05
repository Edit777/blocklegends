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
  var RARITY_ORDER = ['any', 'common', 'rare', 'epic', 'legendary'];

  function getAddonHandle() {
    try {
      return (M && M.CFG && M.CFG.mysteryAddonHandle) ? String(M.CFG.mysteryAddonHandle) : 'mystery-add-on';
    } catch (e) {
      return 'mystery-add-on';
    }
  }

  function isDebug() {
    try { return (window.BL && typeof window.BL.isDebug === 'function') ? window.BL.isDebug() : false; } catch (e) { return false; }
  }

  function debugLog() {
    if (!isDebug()) return;
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

  function getLockedCollectionHandleFromDom() {
    try {
      var selector = '.upsell[data-upsell-addon="true"][data-locked-collection]';
      var el = (U && typeof U.qs === 'function') ? U.qs(document, selector) : document.querySelector(selector);
      var handle = el ? (el.getAttribute('data-locked-collection') || '').trim() : '';
      if (handle) return handle;
    } catch (e) {}
    return '';
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
      var lockedCollection = props._bl_locked_collection || getLockedCollectionHandleFromDom();
      if (lockedCollection) props._bl_locked_collection = lockedCollection;
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
      }

      var computedProps = collectProperties(syntheticForm);
      var mergedProps = Object.assign({}, props, computedProps);

      var assignUid = mergedProps._bl_assignment_uid || mergedProps._bl_assign_uid || (syntheticForm.dataset && syntheticForm.dataset.blAssignmentUid) || '';
      if (!assignUid) assignUid = generateUid('bl-assign');

      mergedProps._bl_assignment_uid = assignUid;
      mergedProps._bl_assign_uid = assignUid;
      mergedProps._bl_is_addon = '1';
      mergedProps._bl_parent_uid = addonParentUid;
      if (!mergedProps._bl_assigned_variant_id && id) mergedProps._bl_assigned_variant_id = id;

      if (props._bl_parent_handle && !mergedProps._bl_parent_handle) mergedProps._bl_parent_handle = props._bl_parent_handle;
      if (props._bl_locked_collection && !mergedProps._bl_locked_collection) mergedProps._bl_locked_collection = props._bl_locked_collection;

      stripDebugProps(mergedProps);

      var assignedVariantId = mergedProps._bl_assigned_variant_id || mergedProps[assignmentPropKey] || '';
      if (assignedVariantId) rewriteItemIdForIndex(formData, idx, assignedVariantId);

      rewritePropertiesForIndex(formData, idx, mergedProps);
      parentUidByIndex[idx] = addonParentUid;
      lastParentUid = addonParentUid;

      var addonAssignedVariant = mergedProps._bl_assigned_variant_id || mergedProps[assignmentPropKey] || '';
      if (addonAssignedVariant) recordAddonAssignment(addonParentUid, addonAssignedVariant);
    }
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
    if (!isDebug()) return;
    debugLog(label, meta);
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

    var allowed = (M && M.CFG && Array.isArray(M.CFG.allowedRarities)) ? M.CFG.allowedRarities : ['common', 'rare', 'epic', 'legendary'];
    var lower = String(raw || '').trim().toLowerCase();
    var normalized = '';

    if (lower === anyKey) normalized = anyKey;
    else if (allowed.indexOf(lower) !== -1) normalized = lower;

    logAddonDebug('requested-rarity-normalized', { raw: raw, normalized: normalized });
    return normalized;
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
    var name = (card.getAttribute('data-locked-collection-name') || '').trim();
    if (name) return name;

    var handle = (card.getAttribute('data-locked-collection') || '').trim();
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

    if (priceEl && U && typeof U.money === 'function') {
      var formatted = U.money(v.price, { moneyFormat: moneyFormat, currency: moneyCurrency });
      if (priceEl.textContent !== formatted) priceEl.textContent = formatted;
    }
    if (compareEl && U && typeof U.money === 'function') {
      if (v.compare_at_price && v.compare_at_price > v.price) {
        var compareText = U.money(v.compare_at_price, { moneyFormat: moneyFormat, currency: moneyCurrency });
        if (compareEl.textContent !== compareText) compareEl.textContent = compareText;
        if (compareEl.classList.contains('hidden')) compareEl.classList.remove('hidden');
      } else {
        if (compareEl.textContent !== '') compareEl.textContent = '';
        if (!compareEl.classList.contains('hidden')) compareEl.classList.add('hidden');
      }
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

  function disableIneligibleOptions(card, variants, selectEl) {
    if (!selectEl || !M || typeof M.fetchPoolAllPages !== 'function') return Promise.resolve(false);

    var locked = String(card.getAttribute('data-locked-collection') || '').trim();
    if (!locked) {
      logAddonDebug('addon-collection-unlocked', { locked_collection: locked });
      return Promise.resolve(false);
    }

    return M.fetchPoolAllPages(M.CFG.defaultPoolCollectionHandle).then(function () {
      var switched = false;
      if (typeof M.getPoolCounts !== 'function') return switched;

      var counts = M.getPoolCounts(M.CFG.defaultPoolCollectionHandle, locked);
      if (!counts) return switched;

      var min = 1;
      var anyKey = String((M.CFG && M.CFG.anyRarityKey) || 'any').toLowerCase();

      Array.prototype.slice.call(selectEl.options || []).forEach(function (opt) {
        var vid = String(opt.value || '').trim();
        var rarity = getVariantRarity(vid);
        var eligible = true;

        if (rarity && rarity !== anyKey) {
          eligible = Number(counts[rarity] || 0) >= min;
        }
        opt.disabled = !eligible;
      });

      // fallback if current disabled
      var cur = String(selectEl.value || '').trim();
      var curOpt = selectEl.querySelector('option[value="' + cur.replace(/"/g, '\\"') + '"]');
      if (curOpt && curOpt.disabled) {
        var fallback = '';

        // try Any
        variants.forEach(function (v) {
          var r = getVariantRarity(String(v.id));
          if (!fallback && r === anyKey) fallback = String(v.id);
        });

        // else first enabled
        if (!fallback) {
          for (var i = 0; i < selectEl.options.length; i++) {
            if (!selectEl.options[i].disabled) { fallback = String(selectEl.options[i].value); break; }
          }
        }

        if (fallback && fallback !== cur) {
          selectEl.value = fallback;
          switched = true;
        }
      }

      return switched;
    }).catch(function () {
      return false;
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

    var locked = String(card.getAttribute('data-locked-collection') || '').trim();
    var parentHandle = String(card.getAttribute('data-parent-handle') || '').trim();

    if (form) {
      ensureHidden(form, '_bl_is_addon', '1');
      if (parentHandle) ensureHidden(form, '_bl_parent_handle', parentHandle);
      if (locked) ensureHidden(form, (M && M.CFG && M.CFG.propLockedCollectionLegacy) || '_bl_locked_collection', locked);
      var parentUidInput = ensureHidden(form, '_bl_parent_uid', '');
      if (parentUidInput && !parentUidInput.value) parentUidInput.value = generateUid('bl-parent');

      form.addEventListener('submit', function () {
        logAddonDebug('addon-submit', { locked_collection: locked });
        ensureHidden(form, '_bl_is_addon', '1');
        if (parentHandle) ensureHidden(form, '_bl_parent_handle', parentHandle);
        if (locked) ensureHidden(form, (M && M.CFG && M.CFG.propLockedCollectionLegacy) || '_bl_locked_collection', locked);
        var submitParentUid = ensureHidden(form, '_bl_parent_uid', '');
        if (submitParentUid && !submitParentUid.value) submitParentUid.value = generateUid('bl-parent');

        // assignment happens in engine submit safety; keep flags in sync
      });
    }

    if (productFormEl && form) {
      patchCartDrawerProductForm(productFormEl, form);
    }

    var selectEl = buildSelect(card, variants);

    // initial id
    var initialId = card.getAttribute('data-id') || (variants[0] && variants[0].id);
    if (selectEl && initialId) selectEl.value = String(initialId);

    // ensure variant map is ready, then eligibility, then apply
    (M && typeof M.fetchVariantMap === 'function' ? M.fetchVariantMap() : Promise.resolve())
      .then(function () { return disableIneligibleOptions(card, variants, selectEl); })
      .then(function (switched) {
        applyVariant(card, variants, selectEl ? selectEl.value : initialId);
        updateHint(card, selectEl);
        if (switched) {
          showNotice(card, 'Some rarities are not available for this collection right now. Switched to an available option.');
        }
      })
      .catch(function () {
        applyVariant(card, variants, selectEl ? selectEl.value : initialId);
        updateHint(card, selectEl);
      });

    if (selectEl) {
      selectEl.addEventListener('change', function () {
        disableIneligibleOptions(card, variants, selectEl).then(function (switched) {
          applyVariant(card, variants, selectEl.value);
          updateHint(card, selectEl);
          if (switched) {
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
          // do NOT rebuild layout; only keep price/hint accurate
          if (selectEl) {
            refreshMoneyAttributes(card);
            updateHint(card, selectEl);
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

    var cards = (U && typeof U.qsa === 'function')
      ? U.qsa(root, '.upsell[data-upsell-addon="true"]')
      : Array.prototype.slice.call(root.querySelectorAll('.upsell[data-upsell-addon="true"]'));

    if (!cards.length) return;

    cards.forEach(function (card) {
      bindCard(card);
    });
  };
})();
