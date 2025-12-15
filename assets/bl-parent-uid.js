/* =======================================================
   BLOCK LEGENDS — PARENT UID BINDER
   - When user submits MAIN product and addon is selected,
     inject a shared uid into both lines.
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
    if (typeof value !== 'undefined') el.value = value;
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

  function deriveUid() {
    // Always create a fresh uid per submission to avoid collisions when the
    // same parent/add-on combo is added multiple times (we want the combo to
    // be stackable instead of treated as the exact same line item).
    return newUid();
  }

  function isSelected(card) {
    return card && String(card.getAttribute('data-selected')) === 'true';
  }

  function findEligibleParentUid(parentHandle, lockedCollection) {
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

  function submitAddonForm(form) {
    if (form.__bl_uid_bound) return;
    form.__bl_uid_bound = true;

    var uidInput = ensureHidden(form, 'properties[' + P.CFG.propParentUid + ']');
    var parentHandle = '';
    var lockedCollection = '';

    try {
      var card = form.closest('.upsell');
      if (card) {
        parentHandle = card.getAttribute('data-parent-handle') || '';
        lockedCollection = card.getAttribute('data-locked-collection') || '';
      }
    } catch (e) {}

    var ensureUid = function (uid) {
      if (!uid) uid = P.__lastUid || deriveUid();
      uidInput.value = uid;

      try { form.submit(); } catch (e) {}
    };

    if (uidInput && uidInput.value) {
      ensureUid(uidInput.value);
      return;
    }

    findEligibleParentUid(parentHandle, lockedCollection)
      .then(function (uid) { ensureUid(uid); })
      .catch(function () { ensureUid(''); });
  }

  P.init = function () {
    if (P.__inited) return;
    P.__inited = true;

    document.addEventListener('submit', function (e) {
      var form = e.target;
      if (!(form instanceof HTMLFormElement)) return;
      if (!form.querySelector('input[name="id"]')) return;

      var isUpsell = false;
      try { isUpsell = !!form.closest('.upsell'); } catch (err) {}
      var isAddon = !!form.querySelector('input[name="properties[' + P.CFG.propIsAddon + ']"]');

      if (isUpsell && isAddon) {
        e.preventDefault();
        submitAddonForm(form);
        return;
      }

      // skip upsell forms that are not the main product
      if (isUpsell) return;

      // find add-on card in same main product section if possible
      var scope = null;
      try { scope = form.closest('[id^="MainProduct-"]'); } catch (err2) {}
      scope = scope || document;

      var addonCard = scope.querySelector('.upsell[data-upsell-addon="true"]');
      if (!addonCard || !isSelected(addonCard)) return;

      var addonForm = addonCard.querySelector('form[data-type="add-to-cart-form"]');
      var uid = deriveUid();
      P.__lastUid = uid;

      // parent gets uid
      ensureHidden(form, 'properties[' + P.CFG.propParentUid + ']', uid);

      // addon gets same uid + defensive sync
      if (addonForm) {
        ensureHidden(addonForm, 'properties[' + P.CFG.propParentUid + ']', uid);

        var ph = addonCard.getAttribute('data-parent-handle') || '';
        var lc = addonCard.getAttribute('data-locked-collection') || '';

        ensureHidden(addonForm, 'properties[' + P.CFG.propParentHandle + ']', ph);
        ensureHidden(addonForm, 'properties[' + P.CFG.propLockedCollection + ']', lc);
        ensureHidden(addonForm, 'properties[' + P.CFG.propIsAddon + ']', '1');
      }
    }, true);
  };
})();
