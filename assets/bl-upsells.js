/* =======================================================
   BLOCK LEGENDS — UPSELLS
   - Randomize only "normal" upsells
   - Keep add-on always visible
   - Locks selection per sessionStorage per page/container
   ======================================================= */

(function () {
  window.BL = window.BL || {};
  window.BL.upsells = window.BL.upsells || {};

  var S = window.BL.upsells;

  function toArray(list) {
    try { return Array.prototype.slice.call(list || []); } catch (e) { return []; }
  }

  function qsa(root, sel) {
    if (!root) root = document;
    return toArray(root.querySelectorAll(sel));
  }

  function getAddonHandle() {
    try {
      return window.BL.mysteryEngine && window.BL.mysteryEngine.CFG && window.BL.mysteryEngine.CFG.mysteryAddonHandle
        ? String(window.BL.mysteryEngine.CFG.mysteryAddonHandle)
        : 'mystery-add-on';
    } catch (e) {
      return 'mystery-add-on';
    }
  }

  S._isAddonCard = function (card) {
    if (!card) return false;
    var flag = String(card.getAttribute('data-upsell-addon') || '').trim();
    if (flag === 'true') return true;

    var h = String(card.getAttribute('data-handle') || '').trim();
    return h && h === getAddonHandle();
  };

  S._shuffle = function (arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  };

  S._pickN = function (cards, n, key) {
    var chosen = null;

    // try restore
    try {
      var raw = sessionStorage.getItem(key);
      if (raw) chosen = JSON.parse(raw);
    } catch (e) {}

    // validate restored indices (product list can change)
    if (!Array.isArray(chosen) || !chosen.length) chosen = null;
    if (chosen) {
      for (var i = 0; i < chosen.length; i++) {
        if (typeof chosen[i] !== 'number' || chosen[i] < 0 || chosen[i] >= cards.length) {
          chosen = null;
          break;
        }
      }
    }

    // generate new
    if (!chosen) {
      var idx = [];
      for (var k = 0; k < cards.length; k++) idx.push(k);
      S._shuffle(idx);
      chosen = idx.slice(0, n);

      try { sessionStorage.setItem(key, JSON.stringify(chosen)); } catch (e2) {}
    }

    return chosen;
  };

  S.randomize = function (root) {
    root = root || document;

    var containers = qsa(root, '[data-random-upsells="true"]');
    if (!containers.length) return;

    containers.forEach(function (container) {
      // Prevent re-randomizing the same rendered container
      if (container.dataset.blUpsellsLocked === 'true') return;

      var cards = qsa(container, '.upsell');
      if (!cards.length) return;

      var addon = cards.filter(S._isAddonCard);
      var normal = cards.filter(function (c) { return !S._isAddonCard(c); });

      // If there are no normal items, do nothing (but do not hide everything)
      if (!normal.length) {
        container.dataset.blUpsellsLocked = 'true';
        return;
      }

      // 2 normal + addon (if exists), otherwise 3 normal
      var limitNormal = addon.length ? 2 : 3;
      if (limitNormal > normal.length) limitNormal = normal.length;

      var key =
        'BL_UPSELLS_' +
        (window.location.pathname || '') + '_' +
        (container.id || '') + '_' +
        (container.getAttribute('data-product-handle') || '');

      var chosenIdx = S._pickN(normal, limitNormal, key);
      var chosen = chosenIdx.map(function (i) { return normal[i]; }).filter(Boolean);

      // Fallback: if something went wrong, show first N instead of hiding all
      if (!chosen.length) chosen = normal.slice(0, limitNormal);

      var out = chosen.concat(addon);

      // Hide all then show selected
      cards.forEach(function (c) { c.style.display = 'none'; });
      out.forEach(function (c) { c.style.display = ''; });

      container.dataset.blUpsellsLocked = 'true';
    });
  };

  S.init = function (root) {
    S.randomize(root || document);
  };
})();
