/* =======================================================
   BLOCK LEGENDS — PARENT UID BINDER
   - Injects a stable parent UID so parent + add-ons can STACK
   - Ensures add-on submits always bind to an existing parent UID
   ======================================================= */

(function () {
  window.BL = window.BL || {};
  window.BL.parentUid = window.BL.parentUid || {};

  var U = window.BL.utils;
  var P = window.BL.parentUid;

  P.CFG = P.CFG || {
    propParentUid: '_bl_parent_uid',
    propParentHandle: '_bl_parent_handle',
    propLockedCollection: '_bl_locked_collection',
    propIsAddon: '_bl_is_addon'
  };

  function newUid() {
    try {
      if (window.crypto && crypto.getRandomValues) {
        var a = new Uint32Array(2);
        crypto.getRandomValues(a);
        return 'bl_' + a[0].toString(16) + a[1].toString(16) + '_' + Date.now();
      }
    } catch (e) {}
    return 'bl_' + Math.random().toString(16).slice(2) + '_' + Date.now();
  }

  function stableHash(str) {
    // djb2-ish, returns base36
    var s = String(str || '');
    var h = 5381;
    for (var i = 0; i < s.length; i++) {
      h = ((h << 5) + h) ^ s.charCodeAt(i);
    }
    // force uint32
    h = h >>> 0;
    return h.toString(36);
  }

  function deriveStableParentUid(parentHandle, variantId, lockedCollection) {
    // Deterministic UID so Shopify will stack the parent line (same variant + same lock)
    // and add-ons can attach to the same parent group.
    var key = [
      'p',
      String(parentHandle || '').trim(),
      String(variantId || '').trim(),
      String(lockedCollection || '').trim()
    ].join('|');

    // If we cannot build a stable key, fall back to a random uid.
    if (!parentHandle || !variantId) return newUid();
    return 'blp_' + stableHash(key);
  }

  function cartJson() {
    return fetch('/cart.js', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  function getProp(item, key) {
    try {
      if (!item || !item.properties) return '';
      return String(item.properties[key] || '').trim();
    } catch (e) { return ''; }
  }

  function maybeStr(v) {
    try { return String(v || '').trim(); } catch (e) { return ''; }
  }

  function ensureHidden(form, name, value) {
    if (!form) return null;
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

  function getVariantId(form) {
    if (!form) return '';
    try {
      var input = form.querySelector('input[name="id"]') || form.querySelector('select[name="id"]');
      return input ? String(input.value || '').trim() : '';
    } catch (e) {
      return '';
    }
  }

  function isSelected(card) {
    return card && String(card.getAttribute('data-selected')) === 'true';
  }

  function findEligibleParentUid(parentHandle, lockedCollection) {
    // Find a parent UID that has remaining capacity (parent qty - addon qty > 0)
    // so "add addon later" works and stays 1:1.
    return cartJson().then(function (cart) {
      if (!cart || !cart.items || !cart.items.length) return '';

      var addonCounts = {};
      var parents = [];

      cart.items.forEach(function (it) {
        if (!it) return;

        var uid = getProp(it, P.CFG.propParentUid);
        if (!uid) return;

        var isAddon = getProp(it, P.CFG.propIsAddon) === '1';
        var handle = maybeStr(it.handle || it.product_handle);
        var lock = getProp(it, P.CFG.propLockedCollection);
        var qty = Number(it.quantity || 0);

        if (isAddon) {
          addonCounts[uid] = (addonCounts[uid] || 0) + qty;
          return;
        }

        if (parentHandle && handle && handle !== parentHandle) return;
        if (lockedCollection && lock && lock !== lockedCollection) return;

        parents.push({ uid: uid, qty: qty });
      });

      var bestUid = '';
      var bestCapacity = 0;

      parents.forEach(function (p) {
        var used = addonCounts[p.uid] || 0;
        var capacity = p.qty - used;
        if (capacity > bestCapacity) {
          bestCapacity = capacity;
          bestUid = p.uid;
        }
      });

      return bestCapacity > 0 ? bestUid : '';
    });
  }

  function resubmitForm(form) {
    // Trigger the theme's normal submit/AJAX path (product-form.js etc.)
    // while avoiding infinite loops in our own submit capture.
    try { form.dataset.blUidBypass = '1'; } catch (e) {}

    setTimeout(function () {
      try {
        if (typeof form.requestSubmit === 'function') form.requestSubmit();
        else form.submit();
      } catch (e2) {
        try { form.submit(); } catch (e3) {}
      }
    }, 0);
  }

  function submitAddonForm(form) {
    var uidInput = ensureHidden(form, 'properties[' + P.CFG.propParentUid + ']');
    var phInput = ensureHidden(form, 'properties[' + P.CFG.propParentHandle + ']');
    var lcInput = ensureHidden(form, 'properties[' + P.CFG.propLockedCollection + ']');
    var isAddonInput = ensureHidden(form, 'properties[' + P.CFG.propIsAddon + ']');

    var parentHandle = '';
    var lockedCollection = '';

    try {
      var card = form.closest('.upsell');
      if (card) {
        parentHandle = (card.getAttribute('data-parent-handle') || '').trim();
        lockedCollection = (card.getAttribute('data-locked-collection') || '').trim();
      }
    } catch (e) {}

    if (phInput && parentHandle) phInput.value = parentHandle;
    if (lcInput && lockedCollection) lcInput.value = lockedCollection;
    if (isAddonInput) isAddonInput.value = '1';

    // If uid already set on the form (e.g. injected from main submit), use it.
    if (uidInput && uidInput.value) {
      P.__lastUid = uidInput.value;
      resubmitForm(form);
      return;
    }

    // Otherwise attach to an existing parent UID that still needs add-ons.
    findEligibleParentUid(parentHandle, lockedCollection)
      .then(function (uid) {
        if (!uid) uid = P.__lastUid || '';
        if (!uid) uid = newUid(); // last resort: still allow add, Cart Guard will clean if orphaned
        uidInput.value = uid;
        P.__lastUid = uid;
        resubmitForm(form);
      })
      .catch(function () {
        var uid = P.__lastUid || newUid();
        uidInput.value = uid;
        P.__lastUid = uid;
        resubmitForm(form);
      });
  }

  P.init = function () {
    if (P.__inited) return;
    P.__inited = true;

    document.addEventListener('submit', function (e) {
      var form = e.target;
      if (!(form instanceof HTMLFormElement)) return;
      if (!form.querySelector('input[name="id"], select[name="id"]')) return;

      // bypass used only for our internal resubmit
      if (form.dataset && form.dataset.blUidBypass === '1') {
        try { form.dataset.blUidBypass = '0'; } catch (e0) {}
        return;
      }

      var isUpsell = false;
      try { isUpsell = !!form.closest('.upsell'); } catch (err) {}
      var isAddon = !!form.querySelector('input[name="properties[' + P.CFG.propIsAddon + ']"]');

      // Intercept add-on upsell submissions to ensure they bind to a valid parent UID
      if (isUpsell && isAddon) {
        e.preventDefault();
        e.stopImmediatePropagation();
        submitAddonForm(form);
        return;
      }

      // Skip other upsell forms (non-add-ons)
      if (isUpsell) return;

      // MAIN PRODUCT FORM:
      // If an add-on card exists in this context, always inject a stable parent UID.
      // This enables: (a) parent stacking, (b) adding add-ons later from cart/upsells.
      var scope = null;
      try { scope = form.closest('[id^="MainProduct-"]'); } catch (err2) {}
      scope = scope || document;

      var addonCard = scope.querySelector('.upsell[data-upsell-addon="true"]');
      if (!addonCard) return;

      var parentHandle =
        (addonCard.getAttribute('data-parent-handle') || '').trim() ||
        (scope.getAttribute && (scope.getAttribute('data-product-handle') || '')) ||
        (U && typeof U.productHandleFromUrl === 'function' ? (U.productHandleFromUrl() || '') : '') ||
        '';

      var lockedCollection = (addonCard.getAttribute('data-locked-collection') || '').trim();
      var variantId = getVariantId(form);
      var uid = deriveStableParentUid(parentHandle, variantId, lockedCollection);

      // parent always gets uid (so it can be a valid parent in cart)
      ensureHidden(form, 'properties[' + P.CFG.propParentUid + ']', uid);
      if (parentHandle) ensureHidden(form, 'properties[' + P.CFG.propParentHandle + ']', parentHandle);
      if (lockedCollection) ensureHidden(form, 'properties[' + P.CFG.propLockedCollection + ']', lockedCollection);

      // If add-on is selected, ensure the add-on form has the same uid + linking properties.
      // (Theme may submit both forms, or the user may submit the add-on separately.)
      if (!isSelected(addonCard)) return;

      var addonForm = addonCard.querySelector('form[data-type="add-to-cart-form"]') ||
        addonCard.querySelector('form[action^="/cart/add"]') ||
        addonCard.querySelector('form');

      if (addonForm) {
        ensureHidden(addonForm, 'properties[' + P.CFG.propParentUid + ']', uid);
        if (parentHandle) ensureHidden(addonForm, 'properties[' + P.CFG.propParentHandle + ']', parentHandle);
        if (lockedCollection) ensureHidden(addonForm, 'properties[' + P.CFG.propLockedCollection + ']', lockedCollection);
        ensureHidden(addonForm, 'properties[' + P.CFG.propIsAddon + ']', '1');
      }

      P.__lastUid = uid;
    }, true);
  };
})();
