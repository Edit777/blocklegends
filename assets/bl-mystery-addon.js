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

  var observer = null;
  var moneyEnvLogged = false;
  
  function getAddonHandle() {
    try {
      return M && M.CFG && M.CFG.mysteryAddonHandle ? String(M.CFG.mysteryAddonHandle) : 'mystery-add-on';
    } catch (e) {
      return 'mystery-add-on';
    }
  }

  function refreshMoneyAttributes(card) {
    if (!card || !U || typeof U.getMoneyEnvironment !== 'function') return { moneyFormat: null, currency: null };
    var env = U.getMoneyEnvironment();
    if (env.moneyFormat) card.setAttribute('data-money-format', env.moneyFormat);
    if (env.currency) card.setAttribute('data-currency', env.currency);
    return env;
  }

  function isMysteryAddonCard(card) {
    if (!card) return false;
    var h = String(card.getAttribute('data-handle') || '').trim();
    return h && h === getAddonHandle();
  }

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

  function logMoneyEnvironment(card) {
    if (moneyEnvLogged || !isDebug() || !U || typeof U.getMoneyEnvironment !== 'function') return;
    var env = U.getMoneyEnvironment();
    var moneyFormat = (card && card.getAttribute('data-money-format')) || env.moneyFormat;
    var currency = (card && card.getAttribute('data-currency')) || env.currency;
    var sample = typeof U.money === 'function' ? U.money(12345, { moneyFormat: moneyFormat, currency: currency }) : null;
    debugLog('money-env', {
      activeCurrency: currency,
      formatSource: env && env.source,
      moneyFormat: moneyFormat,
      sample: sample
    });
    moneyEnvLogged = true;
  }

  function ensureCssOnce() {
    if (document.getElementById('bl-addon-css')) return;
    var st = document.createElement('style');
    st.id = 'bl-addon-css';
    st.textContent = [
      '.upsell .upsell__image__img{aspect-ratio:1/1;object-fit:cover;width:100%;height:auto;}',
      '.upsell[data-upsell-addon="true"] .upsell__container{align-items:flex-start;row-gap:0.25rem;}',
      '.upsell[data-upsell-addon="true"] .upsell__content{display:flex;flex-direction:column;gap:0.2rem;}',
      '.upsell[data-upsell-addon="true"] .upsell__variant-picker{display:none !important;}',
      '.bl-addon-topline{display:flex;align-items:center;gap:0.6rem;flex-wrap:wrap;}',
      '.bl-addon-topline .upsell__title{flex:1;display:flex;align-items:center;gap:0.35rem;justify-content:flex-start;margin:0;}',
      '.bl-addon-topline .upsell__price{margin-left:auto;line-height:1.2;}',
      '.bl-addon-picker{margin-top:0;display:flex;gap:8px;align-items:center;flex-wrap:wrap;}',
      '.bl-addon-select{min-width:128px;max-width:100%;padding:6px 9px;border:1px solid rgba(0,0,0,.2);border-radius:8px;background:#fff;font-size:12px;line-height:1.25;min-height:34px;}',
      '.bl-addon-status{font-size:12px;opacity:.9;margin-top:4px;}',
      '.bl-addon-status.is-warn{opacity:1;}',
      '.bl-addon-helper{margin-top:6px;font-size:12px;line-height:1.35;opacity:.9;}',
      '.bl-addon-hint{font-size:12px;opacity:.9;}'
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

    logMoneyEnvironment(card);

    var env = refreshMoneyAttributes(card);

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
    var moneyFormat = card.getAttribute('data-money-format') || (env && env.moneyFormat) || null;
    var moneyCurrency = card.getAttribute('data-currency') || (env && env.currency) || null;
    var priceEl = card.querySelector('.upsell__price .regular-price');
    var compareEl = card.querySelector('.upsell__price .compare-price');

    if (priceEl) priceEl.textContent = U.money(v.price, { moneyFormat: moneyFormat, currency: moneyCurrency });
    if (compareEl) {
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

  function getVariantRarity(variants, variantId) {
    if (!variants || !variants.length) return '';
    var v = variants.find(function (x) { return String(x.id) === String(variantId); });
    if (!v) return '';

    try {
      if (typeof M.getVariantSelection === 'function') {
        var sel = M.getVariantSelection(v.id);
        if (sel && sel.rarity) return String(sel.rarity || '');
      }
    } catch (e) {}

    try {
      if (typeof M.parseSelectionFromText === 'function') {
        var parsed = M.parseSelectionFromText(v.public_title || v.title || '');
        if (parsed && parsed.rarity) return String(parsed.rarity || '');
      }
    } catch (e2) {}

    return '';
  }

  function formatCollectionName(card) {
    var name = '';
    try {
      name = (card && card.getAttribute('data-locked-collection-name')) || '';
    } catch (e) { name = ''; }
    if (name && name.trim()) return name.trim();

    var handle = '';
    try { handle = (card && card.getAttribute('data-locked-collection')) || ''; } catch (e2) { handle = ''; }
    if (!handle) return '';

    return handle
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, function (c) { return c.toUpperCase(); })
      .trim();
  }

  function hintForRarity(rarity, collectionName) {
    var r = String(rarity || '').toLowerCase();
    var anyKey = '';
    try { anyKey = String((M && M.CFG && M.CFG.anyRarityKey) || 'any').toLowerCase(); } catch (e) { anyKey = 'any'; }

    var suffix = collectionName ? ' from ' + collectionName : '';

    if (r === anyKey) return 'Get a random figure' + suffix + '.';
    if (r === 'common') return 'Get a random Common figure' + suffix + '.';
    if (r === 'rare') return 'Get a random Rare figure' + suffix + '.';
    if (r === 'epic') return 'Get a random Epic figure' + suffix + '.';
    if (r === 'legendary') return 'Get a random Legendary figure' + suffix + '.';
    return 'Get a random figure' + suffix + '.';
  }

  function startObserver() {
    if (observer || typeof MutationObserver === 'undefined' || !U || typeof U.debounce !== 'function') return;
    try {
      observer = new MutationObserver(U.debounce(function () {
        A.init(document);
      }, 80));
      observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
    } catch (e) {}
  }

  A.init = function (root) {
    root = root || document;
    if (!U || !M || !M.CFG) return;

    startObserver();

    ensureCssOnce();

    var cards = U.qsa(root, '.upsell[data-upsell-addon="true"]');
    if (!cards.length) return;

    cards.forEach(function (card) {
      if (card.__blAddonBound) return;
      card.__blAddonBound = true;

      var isMysteryAddon = isMysteryAddonCard(card);

      var variantsScript = card.querySelector('script[data-bl-addon-variants]');
      if (!variantsScript) return;

      var variants = [];
      try { variants = JSON.parse(variantsScript.textContent || '[]') || []; } catch (e) { variants = []; }
      if (!variants.length) return;

      refreshMoneyAttributes(card);

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
      var hintEl = card.querySelector('[data-bl-addon-hint]');

      function removePills() {
        if (!isMysteryAddon) return;
        var pillWrap = card.querySelector('.bl-addon-variants');
        if (pillWrap) pillWrap.remove();
        U.qsa(card, '.bl-addon-pill').forEach(function (btn) { btn.remove(); });
      }

      function ensureHelperWrap() {
        var content = card.querySelector('.upsell__content') || card;
        if (!content) return null;

        var wrap = content.querySelector('.bl-addon-helper');
        if (!wrap) {
          wrap = document.createElement('div');
          wrap.className = 'bl-addon-helper';
          wrap.setAttribute('data-bl-addon-helper', '1');
          var topline = content.querySelector('.bl-addon-topline');
          if (topline && topline.nextSibling) {
            content.insertBefore(wrap, topline.nextSibling);
          } else if (topline) {
            content.appendChild(wrap);
          } else {
            content.appendChild(wrap);
          }
        }
        return wrap;
      }

      function ensureHint() {
        if (!isMysteryAddon || !selectEl) return null;
        var helperWrap = ensureHelperWrap();
        if (!helperWrap) return null;
        if (hintEl && helperWrap.contains(hintEl)) return hintEl;

        if (!hintEl) {
          hintEl = document.createElement('div');
          hintEl.className = 'bl-addon-hint';
          hintEl.setAttribute('data-bl-addon-hint', '1');
        }

        helperWrap.insertBefore(hintEl, helperWrap.firstChild || null);
        return hintEl;
      }

      function ensureLayout() {
        var content = card.querySelector('.upsell__content') || card;
        if (!content) return;

        var picker = card.querySelector('[data-bl-addon-picker]');
        var price = card.querySelector('.upsell__price');
        var title = content.querySelector('.upsell__title');
        var topline = content.querySelector('.bl-addon-topline');
        var helperWrap = ensureHelperWrap();

        if (!topline) {
          topline = document.createElement('div');
          topline.className = 'bl-addon-topline';
          content.insertBefore(topline, content.firstChild);
        }

        if (title && title.parentNode !== topline) topline.appendChild(title);
        if (picker && picker.parentNode !== topline) topline.appendChild(picker);
        if (price && price.parentNode !== topline) topline.appendChild(price);

        if (helperWrap) {
          if (hintEl && hintEl.parentNode !== helperWrap) helperWrap.insertBefore(hintEl, helperWrap.firstChild || null);
          if (statusEl && statusEl.parentNode !== helperWrap) helperWrap.appendChild(statusEl);
        }
      }

      function updateHint() {
        if (!isMysteryAddon) return;
        var hintNode = ensureHint();
        if (!hintNode) return;
        var rarity = getVariantRarity(variants, selectEl ? selectEl.value : null);
        var collectionName = formatCollectionName(card);
        hintNode.textContent = hintForRarity(rarity, collectionName);
      }

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

      var syncing = false;

      function sync() {
        if (!selectEl || syncing) return;
        syncing = true;
        refreshMoneyAttributes(card);
        var vid = String(selectEl.value || '').trim();
        applyVariant(card, variants, vid);
        updateHint();
        syncing = false;
      }

      function ensureCardObserver() {
        if (card.__blAddonObserver || typeof MutationObserver === 'undefined' || !U || typeof U.debounce !== 'function') return;
        try {
          var mo = new MutationObserver(U.debounce(function () {
            if (!card.isConnected) { mo.disconnect(); return; }
            removePills();
            ensureLayout();
            sync();
          }, 80));
          mo.observe(card, { childList: true, subtree: true, characterData: true });
          card.__blAddonObserver = mo;
        } catch (e) {}
      }

      // Initial selection
      var initialId = card.getAttribute('data-id') || (variants[0] && variants[0].id);
      if (selectEl && initialId) selectEl.value = String(initialId);

      removePills();
      ensureLayout();

      // Ensure variant map is ready then disable + sync
      (M.fetchVariantMap ? M.fetchVariantMap() : Promise.resolve())
        .then(function () { return disableIneligibleOptions(); })
        .then(function () { sync(); })
        .catch(function () { sync(); });

      ensureCardObserver();

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