/* =======================================================
   BLOCK LEGENDS — MYSTERY ADD-ON (UPSELL CARD)
   - Compact selector (dropdown) instead of wide pills
   - Disables rarity tiers that are not eligible for the locked collection
   - Triggers assignment computation for add-on form
   - Optional copy blocks toggled by selection
   ======================================================= */

(function () {
  window.BL = window.BL || {};
  window.BL.mysteryAddon = window.BL.mysteryAddon || {};

  var U = window.BL.utils;
  var M = window.BL.mysteryEngine;
  var A = window.BL.mysteryAddon;

  function isDebug() {
    try {
      if (typeof localStorage !== 'undefined' && localStorage.getItem('bl_mystery_debug') === '1') return true;
    } catch (e) {}
    try {
      if (typeof window !== 'undefined' && window.location && window.location.search.indexOf('mystery_debug=1') !== -1) return true;
    } catch (e2) {}
    return false;
  }

  function debugLog() {
    if (!isDebug()) return;
    var args = Array.prototype.slice.call(arguments);
    try { console.log.apply(console, ['[BL Mystery Addon][debug]'].concat(args)); } catch (e) {}
  }

  function ensureCssOnce() {
    if (document.getElementById('bl-addon-css')) return;
    var st = document.createElement('style');
    st.id = 'bl-addon-css';
    st.textContent = [
      '.upsell .upsell__image__img{aspect-ratio:1/1;object-fit:cover;width:100%;height:auto;}',
      '.upsell[data-upsell-addon="true"] .upsell__variant-picker{display:none !important;}',
      '.bl-addon-picker{margin-top:8px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;}',
      '.bl-addon-select{min-width:140px;max-width:100%;padding:8px 10px;border:1px solid rgba(0,0,0,.2);border-radius:10px;background:#fff;font-size:13px;line-height:1.2;}',
      '.bl-addon-status{font-size:12px;opacity:.9;}',
      '.bl-addon-status.is-warn{opacity:1;}'
    ].join('');
    document.head.appendChild(st);
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

  function applyCopy(card, rarity) {
    var blocks = U.qsa(card, '[data-bl-addon-copy]');
    if (!blocks.length) return;
    blocks.forEach(function (el) {
      var fr = (el.getAttribute('data-for-rarity') || '').trim().toLowerCase();
      var ok = !fr || fr === String(rarity || '').toLowerCase();
      el.style.display = ok ? '' : 'none';
    });
  }

  function applyVariant(card, variants, variantId) {
    var v = variants.find(function (x) { return String(x.id) === String(variantId); }) || variants[0];
    if (!v) return;

    // keep data-id in sync (some themes read it)
    card.setAttribute('data-id', String(v.id));

    var form =
      card.querySelector('form[data-type="add-to-cart-form"]') ||
      card.querySelector('form[action^="/cart/add"]') ||
      card.querySelector('form');

    if (form) {
      var idInput = form.querySelector('input[name="id"]') || form.querySelector('select[name="id"]');
      if (idInput) idInput.value = String(v.id);
    }

    // price
    var moneyFormat = card.getAttribute('data-money-format') || (window.Shopify && window.Shopify.money_format) || '${{amount}}';
    var priceEl = card.querySelector('.upsell__price .regular-price');
    var compareEl = card.querySelector('.upsell__price .compare-price');

    if (priceEl) priceEl.textContent = U.money(v.price, moneyFormat);
    if (compareEl) {
      if (v.compare_at_price && v.compare_at_price > v.price) {
        compareEl.textContent = U.money(v.compare_at_price, moneyFormat);
        compareEl.classList.remove('hidden');
      } else {
        compareEl.textContent = '';
        compareEl.classList.add('hidden');
      }
    }

    // image
    var img = card.querySelector('img.upsell__image__img');
    if (img && v.image) {
      img.src = v.image;
      img.removeAttribute('srcset');
      img.removeAttribute('sizes');
    }

    // Determine rarity for copy toggling
    var rarity = '';
    try {
      if (M && typeof M.parseSelectionFromText === 'function') {
        var sel = M.parseSelectionFromText(v.public_title || v.title || '');
        rarity = sel ? sel.rarity : '';
      }
    } catch (e) {}

    applyCopy(card, rarity);
    debugLog('variant-applied', { card: card.getAttribute('data-id'), variantId: v.id, rarity: rarity });

    // recompute assignment for the add-on (so submit is instant)
    if (M && form) {
      M.computeAndApplyAssignment(form, M.CFG.mysteryAddonHandle).catch(function () {});
    }
  }

  function labelForVariant(v) {
    if (!v) return 'Option';
    if (M && typeof M.parseSelectionFromText === 'function') {
      var sel = M.parseSelectionFromText(v.public_title || v.title || '');
      var r = sel ? sel.rarity : '';
      if (r) return r.charAt(0).toUpperCase() + r.slice(1);
    }
    return (v.public_title || v.title || 'Option').trim() || 'Option';
  }

  A.init = function (root) {
    root = root || document;
    if (!U || !M || !M.CFG) return;

    ensureCssOnce();

    var cards = U.qsa(root, '.upsell[data-upsell-addon="true"]');
    if (!cards.length) return;

    cards.forEach(function (card) {
      if (card.__blAddonBound) return;
      card.__blAddonBound = true;

      var variantsScript = card.querySelector('script[data-bl-addon-variants]');
      if (!variantsScript) return;

      var variants = [];
      try { variants = JSON.parse(variantsScript.textContent || '[]') || []; } catch (e) { variants = []; }
      if (!variants.length) return;

      var form =
        card.querySelector('form[data-type="add-to-cart-form"]') ||
        card.querySelector('form[action^="/cart/add"]') ||
        card.querySelector('form');

      // Ensure locked collection + flags are always present (helps cart guard and engine)
      var locked = String(card.getAttribute('data-locked-collection') || '').trim();
      var parentHandle = String(card.getAttribute('data-parent-handle') || '').trim();

      if (form) {
        if (locked) ensureHidden(form, M.CFG.propLockedCollectionLegacy || '_bl_locked_collection', locked);
        ensureHidden(form, '_bl_is_addon', '1');
        if (parentHandle) ensureHidden(form, '_bl_parent_handle', parentHandle);

        form.addEventListener('submit', function () {
          // Reinforce add-on markers before any submission (covers AJAX + native)
          ensureHidden(form, '_bl_is_addon', '1');
          if (locked) ensureHidden(form, M.CFG.propLockedCollectionLegacy || '_bl_locked_collection', locked);
          if (parentHandle) ensureHidden(form, '_bl_parent_handle', parentHandle);
        });
      }

      // Build compact selector UI
      var existing = card.querySelector('[data-bl-addon-picker]');
      if (!existing) {
        var picker = document.createElement('div');
        picker.className = 'bl-addon-picker';
        picker.setAttribute('data-bl-addon-picker', '1');

        var select = document.createElement('select');
        select.className = 'bl-addon-select';
        select.setAttribute('data-bl-addon-select', '1');

        variants.forEach(function (v) {
          var opt = document.createElement('option');
          opt.value = String(v.id);
          opt.textContent = labelForVariant(v);
          select.appendChild(opt);
        });

        var status = document.createElement('div');
        status.className = 'bl-addon-status';
        status.setAttribute('data-bl-addon-status', '1');
        status.style.display = 'none';

        picker.appendChild(select);
        picker.appendChild(status);

        // insert under title/price area if possible
        var target = card.querySelector('.upsell__content') || card;
        target.appendChild(picker);
      }

      var selectEl = card.querySelector('[data-bl-addon-select]');
      var statusEl = card.querySelector('[data-bl-addon-status]');

      function setStatus(msg, warn) {
        if (!statusEl) return;
        if (!msg) {
          statusEl.textContent = '';
          statusEl.style.display = 'none';
          statusEl.classList.remove('is-warn');
          return;
        }
        statusEl.textContent = String(msg);
        statusEl.style.display = '';
        statusEl.classList.toggle('is-warn', !!warn);
      }

      function disableIneligibleOptions() {
        if (!locked || !selectEl) return Promise.resolve();
        return M.fetchPoolAllPages(locked).then(function () {
          var counts = (typeof M.getPoolCounts === 'function') ? M.getPoolCounts(locked) : null;
          if (!counts) return;

          var min = Number(M.CFG.preferredMinPerRarity || 0);

          Array.prototype.slice.call(selectEl.options || []).forEach(function (opt) {
            var vid = String(opt.value || '').trim();
            var sel = (typeof M.getVariantSelection === 'function') ? M.getVariantSelection(vid) : null;
            var rarity = sel ? sel.rarity : '';
            var eligible = true;

            if (rarity && rarity !== M.CFG.anyRarityKey) {
              eligible = Number(counts[rarity] || 0) >= min;
            }
            opt.disabled = !eligible;
          });

          // If current selection is disabled, fall back to Any or first enabled
          var current = String(selectEl.value || '').trim();
          var curOpt = selectEl.querySelector('option[value="' + current.replace(/"/g, '\\"') + '"]');
          if (curOpt && curOpt.disabled) {
            var anyId = '';
            variants.forEach(function (v) {
              var s = (typeof M.getVariantSelection === 'function') ? M.getVariantSelection(v.id) : null;
              if (s && s.rarity === M.CFG.anyRarityKey) anyId = String(v.id);
            });

            var fallback = anyId;
            if (!fallback) {
              for (var i = 0; i < selectEl.options.length; i++) {
                if (!selectEl.options[i].disabled) { fallback = String(selectEl.options[i].value); break; }
              }
            }

            if (fallback) {
              selectEl.value = fallback;
              setStatus('Some rarities are not available for this figure right now. Switched to an available option.', true);
              debugLog('fallback-rarity-addon', { locked: locked, chosen: fallback });
            }
          } else {
            setStatus('', false);
          }

          debugLog('rarity-eligibility', {
            lockedCollection: locked,
            counts: counts,
            selected: selectEl.value
          });
        });
      }

      function sync() {
        if (!selectEl) return;
        var vid = String(selectEl.value || '').trim();
        applyVariant(card, variants, vid);
      }

      // Initial selection
      var initialId = card.getAttribute('data-id') || (variants[0] && variants[0].id);
      if (selectEl && initialId) selectEl.value = String(initialId);

      // Ensure variant map is ready then disable + sync
      (M.fetchVariantMap ? M.fetchVariantMap() : Promise.resolve())
        .then(function () { return disableIneligibleOptions(); })
        .then(function () { sync(); })
        .catch(function () { sync(); });

      // Change handler
      if (selectEl) {
        selectEl.addEventListener('change', function () {
          disableIneligibleOptions().then(function () {
            sync();
          });
        });
      }

      // Precompute assignment once
      if (form) {
        M.computeAndApplyAssignment(form, M.CFG.mysteryAddonHandle).catch(function () {});
      }
    });
  };
})();