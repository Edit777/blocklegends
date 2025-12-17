/* =======================================================
   BLOCK LEGENDS — MYSTERY ADD-ON (UPSELL CARD) — STABLE
   - Uses stable Liquid hooks:
     [data-bl-addon-controls], [data-bl-addon-hint]
   - Injects compact <select>
   - Disables ineligible rarities for locked collection
   - Updates price/image/variant-id in place
   - NO DOM re-parenting / NO layout rebuilding
   ======================================================= */

(function () {
  window.BL = window.BL || {};
  window.BL.mysteryAddon = window.BL.mysteryAddon || {};

  var U = window.BL.utils;
  var M = window.BL.mysteryEngine;
  var A = window.BL.mysteryAddon;

  var observer = null;

  function getAddonHandle() {
    try {
      return (M && M.CFG && M.CFG.mysteryAddonHandle) ? String(M.CFG.mysteryAddonHandle) : 'mystery-add-on';
    } catch (e) {
      return 'mystery-add-on';
    }
  }

  function isDebug() {
    try {
      if (typeof localStorage !== 'undefined' && localStorage.getItem('bl_mystery_debug') === '1') return true;
    } catch (e) {}
    try {
      if (window.location && String(window.location.search || '').indexOf('mystery_debug=1') !== -1) return true;
    } catch (e2) {}
    return false;
  }

  function debugLog() {
    if (!isDebug()) return;
    var args = Array.prototype.slice.call(arguments);
    try { console.log.apply(console, ['[BL Mystery Addon]'].concat(args)); } catch (e) {}
  }

  function ensureCssOnce() {
    if (document.getElementById('bl-addon-css')) return;
    var st = document.createElement('style');
    st.id = 'bl-addon-css';
    st.textContent = [
      '.upsell[data-upsell-addon="true"] .upsell__image__img{aspect-ratio:1/1;object-fit:cover;width:100%;height:auto;}',
      '.upsell[data-upsell-addon="true"] .bl-addon-main{display:flex;align-items:center;gap:.85rem;width:100%;}',
      '.upsell[data-upsell-addon="true"] .upsell__image{flex:0 0 76px;width:76px;display:flex;align-items:center;justify-content:center;}',
      '.upsell[data-upsell-addon="true"] .upsell__image .upsell__image__img{max-width:76px;width:100%;}',
      '.upsell[data-upsell-addon="true"] .bl-addon-body{flex:1;min-width:0;}',
      '.upsell[data-upsell-addon="true"] .upsell__content{min-width:0;}',
      '.upsell[data-upsell-addon="true"] .upsell__title h3{white-space:normal;word-break:normal;overflow-wrap:anywhere;margin:0;}',

      '.upsell[data-upsell-addon="true"] .bl-addon-right{display:flex;align-items:center;gap:.6rem;white-space:nowrap;flex:0 0 auto;}',
      '.upsell[data-upsell-addon="true"] .upsell__price{margin:0;display:flex;flex-direction:column;align-items:flex-end;justify-content:center;line-height:1.15;}',
      '.upsell[data-upsell-addon="true"] .upsell__price .regular-price{font-weight:700;}',

      '.upsell[data-upsell-addon="true"] .bl-addon-meta{margin-top:.25rem;display:flex;flex-direction:column;gap:.25rem;}',
      '.upsell[data-upsell-addon="true"] .bl-addon-controls{display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;}',
      '.upsell[data-upsell-addon="true"] .bl-addon-select{min-height:32px;height:32px;padding:4px 10px;border:1px solid rgba(0,0,0,.18);border-radius:8px;background:#fff;font-size:12px;line-height:1.1;max-width:100%;min-width:120px;}',
      '.upsell[data-upsell-addon="true"] .bl-addon-hint{font-size:12px;line-height:1.35;opacity:.85;}',
      '.upsell[data-upsell-addon="true"] .upsell__variant-picker{display:none !important;}'
    ].join('');
    document.head.appendChild(st);
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

  function getVariantRarity(variantId) {
    try {
      if (M && typeof M.getVariantSelection === 'function') {
        var sel = M.getVariantSelection(variantId);
        if (sel && sel.rarity) return String(sel.rarity);
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
    if (r === 'common') return 'Get a random Common figure' + suffix + '.';
    if (r === 'rare') return 'Get a random Rare figure' + suffix + '.';
    if (r === 'epic') return 'Get a random Epic figure' + suffix + '.';
    if (r === 'legendary') return 'Get a random Legendary figure' + suffix + '.';
    return 'Get a random figure' + suffix + '.';
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
      priceEl.textContent = U.money(v.price, { moneyFormat: moneyFormat, currency: moneyCurrency });
    }
    if (compareEl && U && typeof U.money === 'function') {
      if (v.compare_at_price && v.compare_at_price > v.price) {
        compareEl.textContent = U.money(v.compare_at_price, { moneyFormat: moneyFormat, currency: moneyCurrency });
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

    // precompute assignment (so add is instant)
    try {
      if (M && form && typeof M.computeAndApplyAssignment === 'function') {
        M.computeAndApplyAssignment(form, M.CFG.mysteryAddonHandle).catch(function () {});
      }
    } catch (e) {}
  }

  function disableIneligibleOptions(card, variants, selectEl) {
    if (!selectEl || !M || typeof M.fetchPoolAllPages !== 'function') return Promise.resolve();

    var locked = String(card.getAttribute('data-locked-collection') || '').trim();
    if (!locked) return Promise.resolve();

    return M.fetchPoolAllPages(locked).then(function () {
      if (typeof M.getPoolCounts !== 'function') return;

      var counts = M.getPoolCounts(locked);
      if (!counts) return;

      var min = Number((M.CFG && M.CFG.preferredMinPerRarity) || 0);
      var anyKey = String((M.CFG && M.CFG.anyRarityKey) || 'any');

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

        if (fallback) selectEl.value = fallback;
      }
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

    var select = document.createElement('select');
    select.className = 'bl-addon-select';
    select.setAttribute('data-bl-addon-select', '1');

    variants.forEach(function (v) {
      var opt = document.createElement('option');
      opt.value = String(v.id);
      opt.textContent = labelForVariant(v);
      select.appendChild(opt);
    });

    controls.appendChild(select);
    return select;
  }

  function updateHint(card, selectEl) {
    var hintEl = card.querySelector('[data-bl-addon-hint]');
    if (!hintEl) return;

    var rarity = selectEl ? getVariantRarity(String(selectEl.value)) : '';
    var collectionName = formatCollectionName(card);
    hintEl.textContent = hintForRarity(rarity, collectionName);
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
    removePills(card);
    refreshMoneyAttributes(card);

    var form =
      card.querySelector('form[data-type="add-to-cart-form"]') ||
      card.querySelector('form[action^="/cart/add"]') ||
      card.querySelector('form');

    var locked = String(card.getAttribute('data-locked-collection') || '').trim();
    var parentHandle = String(card.getAttribute('data-parent-handle') || '').trim();

    if (form) {
      ensureHidden(form, '_bl_is_addon', '1');
      if (parentHandle) ensureHidden(form, '_bl_parent_handle', parentHandle);
      if (locked) ensureHidden(form, (M && M.CFG && M.CFG.propLockedCollectionLegacy) || '_bl_locked_collection', locked);

      form.addEventListener('submit', function () {
        ensureHidden(form, '_bl_is_addon', '1');
        if (parentHandle) ensureHidden(form, '_bl_parent_handle', parentHandle);
        if (locked) ensureHidden(form, (M && M.CFG && M.CFG.propLockedCollectionLegacy) || '_bl_locked_collection', locked);
      });
    }

    var selectEl = buildSelect(card, variants);

    // initial id
    var initialId = card.getAttribute('data-id') || (variants[0] && variants[0].id);
    if (selectEl && initialId) selectEl.value = String(initialId);

    // ensure variant map is ready, then eligibility, then apply
    (M && typeof M.fetchVariantMap === 'function' ? M.fetchVariantMap() : Promise.resolve())
      .then(function () { return disableIneligibleOptions(card, variants, selectEl); })
      .then(function () {
        applyVariant(card, variants, selectEl ? selectEl.value : initialId);
        updateHint(card, selectEl);
      })
      .catch(function () {
        applyVariant(card, variants, selectEl ? selectEl.value : initialId);
        updateHint(card, selectEl);
      });

    if (selectEl) {
      selectEl.addEventListener('change', function () {
        disableIneligibleOptions(card, variants, selectEl).then(function () {
          applyVariant(card, variants, selectEl.value);
          updateHint(card, selectEl);
        });
      });
    }

    // lightweight observer: only if theme replaces inner price/image text
    if (!card.__blAddonObserver && typeof MutationObserver !== 'undefined' && U && typeof U.debounce === 'function') {
      try {
        var mo = new MutationObserver(U.debounce(function () {
          if (!card.isConnected) { mo.disconnect(); return; }
          removePills(card);
          // do NOT rebuild layout; only keep price/hint accurate
          if (selectEl) {
            refreshMoneyAttributes(card);
            updateHint(card, selectEl);
          }
        }, 120));
        mo.observe(card, { childList: true, subtree: true, characterData: true });
        card.__blAddonObserver = mo;
      } catch (e) {}
    }
  }

  function startObserver() {
    if (observer || typeof MutationObserver === 'undefined' || !U || typeof U.debounce !== 'function') return;
    try {
      observer = new MutationObserver(U.debounce(function () {
        A.init(document);
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