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

  function isSelected(card) {
    return card && String(card.getAttribute('data-selected')) === 'true';
  }

  P.init = function () {
    if (P.__inited) return;
    P.__inited = true;

    document.addEventListener('submit', function (e) {
      var form = e.target;
      if (!(form instanceof HTMLFormElement)) return;
      if (!form.querySelector('input[name="id"]')) return;

      // skip if this is inside an upsell card (we only bind on MAIN form)
      try {
        if (form.closest('.upsell')) return;
      } catch (err) {}

      // find add-on card in same main product section if possible
      var scope = null;
      try { scope = form.closest('[id^="MainProduct-"]'); } catch (err2) {}
      scope = scope || document;

      var addonCard = scope.querySelector('.upsell[data-upsell-addon="true"]');
      if (!addonCard || !isSelected(addonCard)) return;

      var uid = newUid();

      // parent gets uid
      ensureHidden(form, 'properties[' + P.CFG.propParentUid + ']', uid);

      // addon gets same uid + defensive sync
      var addonForm = addonCard.querySelector('form[data-type="add-to-cart-form"]');
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
