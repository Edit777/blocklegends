/* =======================================================
   BLOCK LEGENDS — MYSTERY UI (PRODUCT PAGE)
   Enhanced preferred collection gating for Mystery Figure
   ======================================================= */

(function () {
  window.BL = window.BL || {};
  window.BL.mysteryUI = window.BL.mysteryUI || {};

  var U = window.BL.utils;
  var M = window.BL.mysteryEngine;
  var UI = window.BL.mysteryUI;

  if (!U || !M || !M.CFG) return;

  var STORAGE_KEYS = {
    mode: 'BL_MYSTERY_MODE',
    collection: 'BL_MYSTERY_COLLECTION_HANDLE',
    rarity: 'BL_MYSTERY_RARITY'
  };

  var ANY = (M.CFG.anyRarityKey || 'any').toLowerCase();
  var MODE_LABELS = {
    preferred: M.CFG.modePreferredLabel,
    random: M.CFG.modeRandomLabel
  };

  function ensureCssOnce() {
    if (document.getElementById('bl-preferred-css')) return;
    var st = document.createElement('style');
    st.id = 'bl-preferred-css';
    st.textContent = [
      '.bl-mystery-card{margin-top:12px;padding:12px;border:1px solid rgba(0,0,0,.12);border-radius:10px;background:#fff;}',
      '.bl-mystery-card .product-form__quantity,.bl-mystery-card .quantity__input,.bl-mystery-card .quantity__button{display:none !important;}',
      '.bl-mystery-row{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:10px;margin-bottom:10px;}',
      '.bl-mystery-label{font-size:13px;font-weight:600;min-width:96px;}',
      '.bl-pill-group{display:flex;flex-wrap:wrap;gap:8px;}',
      '.bl-pill{padding:9px 12px;border:1px solid rgba(0,0,0,.25);border-radius:999px;background:#fff;font-size:13px;line-height:1;cursor:pointer;transition:all .15s ease;}',
      '.bl-pill.is-active{border-color:#000;box-shadow:0 0 0 1px #000;}',
      '.bl-pill[disabled]{opacity:.45;cursor:not-allowed;}',
      '.bl-collection-row{display:flex;flex-direction:column;gap:6px;}',
      '.bl-collection-select{min-width:200px;padding:8px 10px;border:1px solid rgba(0,0,0,.25);border-radius:8px;font-size:14px;}',
      '.bl-mystery-helper{font-size:12px;opacity:.9;margin-top:4px;}',
      '.bl-mystery-helper.is-warn{opacity:1;color:#a94442;}',
      '.bl-mystery-row[data-bl-mode-row],.bl-mystery-row[data-bl-rarity-row]{justify-content:center;text-align:center;}', 
      '@media (max-width: 749px){.bl-pill{padding:11px 14px;font-size:14px;}}'
    ].join('');
    document.head.appendChild(st);
  }

  function upsertHidden(form, key, value) {
    if (!form) return;
    var name = 'properties[' + key + ']';
    var input = form.querySelector('input[type="hidden"][name="' + name.replace(/"/g, '\\"') + '"]');
    if (!input) {
      input = document.createElement('input');
      input.type = 'hidden';
      input.name = name;
      form.appendChild(input);
    }
    input.value = String(value == null ? '' : value);
  }

  function getVariantId(form) {
    try {
      var el = form.querySelector('input[name="id"], select[name="id"]');
      return el ? String(el.value || '').trim() : '';
    } catch (e) {
      return '';
    }
  }

  function setVariantId(form, id) {
    id = String(id || '').trim();
    if (!id) return false;

    var sel = form.querySelector('select[name="id"], select.variant-dropdown, select.sticky-atc__variant-select');
    if (sel) {
      if (String(sel.value) !== id) sel.value = id;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }

    var inp = form.querySelector('input[name="id"]');
    if (inp) {
      if (String(inp.value) !== id) inp.value = id;
      inp.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    return false;
  }

  function getSelectionFromForm(form) {
    var vid = getVariantId(form);
    var mapped = (M && typeof M.getVariantSelection === 'function') ? M.getVariantSelection(vid) : null;
    if (mapped) return mapped;

    var title = '';
    try {
      var sel = form.querySelector('select[name="id"]') || form.querySelector('select.variant-dropdown');
      if (sel && sel.selectedOptions && sel.selectedOptions[0]) title = (sel.selectedOptions[0].textContent || '').trim();
    } catch (e) {}
    if (M && typeof M.parseSelectionFromText === 'function') {
      var parsed = M.parseSelectionFromText(title);
      if (parsed) return parsed;
    }
    return { rarity: 'common', mode: (M && M.CFG ? M.CFG.modeRandomLabel : 'Random Collection') };
  }

  function findVariantIdFor(rarity, mode) {
    if (!M || typeof M.getVariantSelectionMap !== 'function') return '';
    var map = M.getVariantSelectionMap() || {};
    var r = (M.normalizeRarity ? M.normalizeRarity(rarity) : String(rarity || '').toLowerCase());
    var m = (M.normalizeMode ? M.normalizeMode(mode) : String(mode || ''));
    for (var id in map) {
      if (!Object.prototype.hasOwnProperty.call(map, id)) continue;
      var s = map[id];
      if (!s) continue;
      var sr = (M.normalizeRarity ? M.normalizeRarity(s.rarity) : String(s.rarity || '').toLowerCase());
      var sm = (M.normalizeMode ? M.normalizeMode(s.mode) : String(s.mode || ''));
      if (sr === r && sm === m) return String(id);
    }
    return '';
  }

  function applyCopy(root, sel, preferredCollection) {
    root = root || document;
    var rarity = sel && sel.rarity ? String(sel.rarity) : '';
    var mode = sel && sel.mode ? String(sel.mode) : '';

    var blocks = U.qsa(root, '[data-bl-mystery-copy]');
    if (!blocks.length) return;

    blocks.forEach(function (el) {
      var fr = (el.getAttribute('data-for-rarity') || '').trim().toLowerCase();
      var fm = (el.getAttribute('data-for-mode') || '').trim();
      var fc = (el.getAttribute('data-for-collection') || '').trim();

      var ok = true;
      if (fr) ok = ok && (fr === String(rarity || '').toLowerCase());
      if (fm) ok = ok && (fm === mode);
      if (fc) ok = ok && (fc === String(preferredCollection || ''));
      el.style.display = ok ? '' : 'none';
    });
  }

  function detectIsMysteryPage(root) {
    var handle = '';
    try { handle = U.productHandleFromUrl() || ''; } catch (e) {}
    if (handle === M.CFG.mysteryFigureHandle) return true;

    var bodyHandle = '';
    try { bodyHandle = (document.body && document.body.getAttribute('data-product-handle')) || ''; } catch (e2) {}
    if (bodyHandle === M.CFG.mysteryFigureHandle) return true;

    var form = U.qs(root, 'form[action^="/cart/add"], form[data-type="add-to-cart-form"]');
    try {
      var formHandle = form ? (form.getAttribute('data-product-handle') || '') : '';
      if (formHandle === M.CFG.mysteryFigureHandle) return true;
    } catch (e3) {}

    try {
      if (window.location && /\/products\/mystery-figure/.test(window.location.pathname)) return true;
    } catch (e4) {}
    return false;
  }

  function getCollections(root) {
    var src = U.qs(root, '[data-bl-collections]');
    var json = (src && src.getAttribute('data-bl-collections')) || '';
    var parsed = [];
    if (json) {
      try { parsed = JSON.parse(json); } catch (e) { parsed = []; }
    }
    if (parsed && parsed.length) return parsed;

    try {
      var fallback = (window.BL && window.BL.mystery && window.BL.mystery.collections) ? window.BL.mystery.collections : [];
      if (fallback && fallback.length) return fallback;
    } catch (e2) {}
    return [];
  }

  function getPoolKey(root, form) {
    var key = '';
    try {
      key = (root && root.getAttribute && root.getAttribute('data-bl-pool-key')) || '';
    } catch (e) {}
    if (!key && form) {
      try { key = form.getAttribute('data-bl-pool-key') || ''; } catch (e2) {}
      if (!key && typeof form.closest === 'function') {
        var host = form.closest('[data-bl-pool-key]');
        if (host) key = host.getAttribute('data-bl-pool-key') || '';
      }
    }
    return String(key || '').trim().toLowerCase();
  }

  function getStored(key) {
    try { return window.sessionStorage ? window.sessionStorage.getItem(key) : null; } catch (e) { return null; }
  }

  function setStored(key, val) {
    try {
      if (window.sessionStorage) {
        if (val === null || typeof val === 'undefined') window.sessionStorage.removeItem(key);
        else window.sessionStorage.setItem(key, val);
      }
    } catch (e) {}
  }

  function capitalize(str) {
    var s = String(str || '');
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
  }

  function formatHelper(rarity, collectionTitle, modeIsPreferred) {
    var label = collectionTitle || (modeIsPreferred ? 'this collection' : 'a random collection');
    if (!rarity || rarity === ANY) return 'Get a random figure from ' + label + '.';
    return 'Get a ' + capitalize(rarity) + ' figure from ' + label + '.';
  }

  function getPreferredCollectionFromForm(form) {
    try {
      var name = 'properties[' + M.CFG.propPreferredCollection + ']';
      var input = form.querySelector('input[name="' + name.replace(/"/g, '\\"') + '"]');
      return input ? String(input.value || '').trim() : '';
    } catch (e) { return ''; }
  }

  function syncHiddenProps(form, state) {
    var modeKey = state.mode === MODE_LABELS.preferred ? 'preferred' : 'random';
    var poolKey = String(state.poolKey || '').trim();
    var collectionVal = poolKey || ((state.mode === MODE_LABELS.preferred) ? (state.collection || '') : '');
    upsertHidden(form, M.CFG.propPreferredCollection, collectionVal);
    upsertHidden(form, '_bl_mode', modeKey);
    upsertHidden(form, '_bl_locked_collection', collectionVal);
    upsertHidden(form, '_bl_requested_rarity', state.rarity || ANY);
  }

  function ensureVariantMapReady() {
    return (M.fetchVariantMap ? M.fetchVariantMap() : Promise.resolve());
  }

  function syncVariantToState(form, state) {
    return ensureVariantMapReady().then(function () {
      var targetId = findVariantIdFor(state.rarity, state.mode);
      if (!targetId && state.rarity !== ANY) {
        targetId = findVariantIdFor(ANY, state.mode) || findVariantIdFor(state.rarity, MODE_LABELS.random);
      }
      if (!targetId) return;
      setVariantId(form, targetId);
    });
  }

  function computeCounts(collectionHandle) {
    var counts = (typeof M.getPoolCounts === 'function') ? M.getPoolCounts(collectionHandle) : null;
    if (counts) return Promise.resolve(counts);

    return M.fetchPoolAllPages(collectionHandle).then(function () {
      var fallback = (typeof M.getPoolCounts === 'function') ? M.getPoolCounts(collectionHandle) : null;
      return fallback || null;
    });
  }

  function buildUI(root, form, collections) {
    var mount = U.qs(root, '[data-bl-mystery-preferred-mount]');
    if (!mount) {
      var variantSelect = U.qs(form, 'select[name="id"]') || U.qs(form, 'select.variant-dropdown');
      if (variantSelect && variantSelect.parentNode) {
        mount = document.createElement('div');
        mount.setAttribute('data-bl-mystery-preferred-mount', 'true');
        variantSelect.parentNode.insertBefore(mount, variantSelect.nextSibling);
      }
    }
    if (!mount || mount.dataset.blBuilt === 'true') return null;
    mount.dataset.blBuilt = 'true';

    var card = document.createElement('div');
    card.className = 'bl-mystery-card';

    card.innerHTML = [
      '<div class="bl-mystery-row" data-bl-mode-row>\n',
      '  <div class="bl-mystery-label">Mode</div>\n',
      '  <div class="bl-pill-group" data-bl-mode-group>\n',
      '    <button type="button" class="bl-pill" data-mode="random">' + MODE_LABELS.random + '</button>\n',
      '    <button type="button" class="bl-pill" data-mode="preferred">' + MODE_LABELS.preferred + '</button>\n',
      '  </div>\n',
      '</div>\n',
      '<div class="bl-mystery-row" data-bl-rarity-row>\n',
      '  <div class="bl-mystery-label">Rarity</div>\n',
      '  <div class="bl-pill-group" data-bl-rarity-group></div>\n',
      '</div>\n',
      '<div class="bl-mystery-row bl-collection-row" data-bl-collection-row style="display:none;">\n',
      '  <div class="bl-mystery-label">Collection</div>\n',
      '  <select class="bl-collection-select" data-bl-collection-select></select>\n',
      '</div>\n',
      '<div class="bl-mystery-helper" data-bl-helper role="status" aria-live="polite"></div>'
    ].join('');

    mount.appendChild(card);

    var rarityGroup = card.querySelector('[data-bl-rarity-group]');
    var rarities = ['common', 'rare', 'epic', 'legendary'];
    if (rarities.indexOf(ANY) === -1) rarities.push(ANY);
    rarities.forEach(function (r) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'bl-pill';
      btn.setAttribute('data-rarity', r);
      btn.textContent = r === ANY ? 'Any' : capitalize(r);
      rarityGroup.appendChild(btn);
    });

    var select = card.querySelector('[data-bl-collection-select]');
    if (select) {
      var defaultOpt = document.createElement('option');
      defaultOpt.value = '';
      defaultOpt.textContent = 'Select a collection';
      select.appendChild(defaultOpt);
      (collections || []).forEach(function (c) {
        if (!c || !c.handle) return;
        var opt = document.createElement('option');
        opt.value = c.handle;
        opt.textContent = c.title || c.handle;
        select.appendChild(opt);
      });
    }

    return {
      root: card,
      modeButtons: U.qsa(card, '[data-mode]'),
      rarityButtons: U.qsa(card, '[data-rarity]'),
      collectionRow: card.querySelector('[data-bl-collection-row]'),
      collectionSelect: select,
      helper: card.querySelector('[data-bl-helper]')
    };
  }

  UI.init = function (root) {
    root = root || document;
    if (!detectIsMysteryPage(root)) return;

    var form = U.qs(root, 'form[action^="/cart/add"], form[data-type="add-to-cart-form"]');
    if (!form) return;

    ensureCssOnce();

    var collections = getCollections(root);
    var ui = buildUI(root, form, collections);
    if (!ui) return;

    var poolKey = getPoolKey(root, form);
    var state = { mode: MODE_LABELS.random, rarity: ANY, collection: '', poolKey: poolKey };
    var storedMode = getStored(STORAGE_KEYS.mode);
    var storedCollection = getStored(STORAGE_KEYS.collection);
    var storedRarity = getStored(STORAGE_KEYS.rarity);

    var initialSel = getSelectionFromForm(form);
    state.mode = M.normalizeMode(storedMode || initialSel.mode || MODE_LABELS.random);
    state.rarity = M.normalizeRarity(storedRarity || initialSel.rarity || ANY);
    state.collection = storedCollection || getPreferredCollectionFromForm(form) || poolKey || '';

    function persist() {
      setStored(STORAGE_KEYS.mode, state.mode === MODE_LABELS.preferred ? 'preferred' : 'random');
      setStored(STORAGE_KEYS.collection, state.collection || '');
      setStored(STORAGE_KEYS.rarity, state.rarity || '');
    }

    function setHelper(msg, warn) {
      if (!ui.helper) return;
      ui.helper.textContent = msg || '';
      ui.helper.classList.toggle('is-warn', !!warn);
    }

    function updateUIActive() {
      ui.modeButtons.forEach(function (b) {
        var key = b.getAttribute('data-mode');
        b.classList.toggle('is-active', (key === 'preferred' && state.mode === MODE_LABELS.preferred) || (key === 'random' && state.mode === MODE_LABELS.random));
      });
      ui.rarityButtons.forEach(function (b) {
        var r = String(b.getAttribute('data-rarity') || '').toLowerCase();
        b.classList.toggle('is-active', r === state.rarity);
      });
      if (ui.collectionSelect) {
        if (ui.collectionSelect.value !== state.collection) ui.collectionSelect.value = state.collection || '';
      }
      if (ui.collectionRow) {
        ui.collectionRow.style.display = state.mode === MODE_LABELS.preferred ? '' : 'none';
      }
    }

    function findCollectionTitle(handle) {
      var h = String(handle || '');
      var match = (collections || []).find(function (c) { return c && String(c.handle) === h; });
      return match ? (match.title || match.handle || '') : '';
    }

    function applyEligibility() {
      var modePreferred = state.mode === MODE_LABELS.preferred;
      var rarityBtns = ui.rarityButtons || [];
      var collectionHandle = state.poolKey || state.collection;

      if (!modePreferred || !collectionHandle) {
        rarityBtns.forEach(function (btn) { btn.disabled = false; btn.classList.remove('is-disabled'); btn.setAttribute('aria-disabled', 'false'); });
        return Promise.resolve();
      }

      return computeCounts(collectionHandle).then(function (counts) {
        var min = Number(M.CFG.preferredMinPerRarity || 0);
        rarityBtns.forEach(function (btn) {
          var r = String(btn.getAttribute('data-rarity') || '').toLowerCase();
          var eligible = (r === ANY) || (Number(counts && counts[r] || 0) >= min);
          btn.disabled = !eligible;
          btn.classList.toggle('is-disabled', !eligible);
          btn.setAttribute('aria-disabled', eligible ? 'false' : 'true');
        });

        var currentBtn = rarityBtns.find(function (b) { return b.classList.contains('is-active'); });
        if (currentBtn && currentBtn.getAttribute('aria-disabled') === 'true') {
          var fallback = rarityBtns.find(function (b) { return b.getAttribute('aria-disabled') === 'false'; });
          state.rarity = fallback ? String(fallback.getAttribute('data-rarity') || ANY).toLowerCase() : ANY;
        }
      }).catch(function () {
        rarityBtns.forEach(function (btn) {
          btn.disabled = false;
          btn.classList.remove('is-disabled');
          btn.setAttribute('aria-disabled', 'false');
        });
      });
    }

    function updateHelper() {
      var title = findCollectionTitle(state.poolKey || state.collection);
      var modePreferred = state.mode === MODE_LABELS.preferred;
      if (modePreferred && !state.collection) {
        setHelper('Select a collection to continue.', true);
        return;
      }
      var helper = formatHelper(state.rarity, modePreferred ? title || state.collection : '', modePreferred);
      setHelper(helper, false);
    }

    function recompute() {
      syncHiddenProps(form, state);
      applyCopy(root, { rarity: state.rarity, mode: state.mode }, state.collection);
      updateUIActive();
      updateHelper();
      persist();

      return syncVariantToState(form, state)
        .then(function () {
          return M.computeAndApplyAssignment(form, M.CFG.mysteryFigureHandle).catch(function () {});
        });
    }

    function setMode(key) {
      state.mode = key === 'preferred' ? MODE_LABELS.preferred : MODE_LABELS.random;
      if (state.mode === MODE_LABELS.random) {
        state.collection = '';
      }
      return applyEligibility().then(recompute);
    }

    function setRarity(r) {
      state.rarity = M.normalizeRarity(r);
      return recompute();
    }

    function setCollection(handle) {
      state.collection = handle || '';
      return applyEligibility().then(recompute);
    }

    ui.modeButtons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var key = btn.getAttribute('data-mode');
        setMode(key);
      });
    });

    ui.rarityButtons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (btn.getAttribute('aria-disabled') === 'true' || btn.disabled) return;
        var r = btn.getAttribute('data-rarity');
        setRarity(r);
      });
    });

    if (ui.collectionSelect) {
      ui.collectionSelect.addEventListener('change', function () {
        setCollection(ui.collectionSelect.value);
      });
    }

    var debouncedChange = U.debounce(function () {
      var sel = getSelectionFromForm(form);
      var modeNext = M.normalizeMode(sel.mode);
      var rarityNext = M.normalizeRarity(sel.rarity);
      var changed = false;
      if (modeNext !== state.mode) { state.mode = modeNext; changed = true; }
      if (rarityNext !== state.rarity) { state.rarity = rarityNext; changed = true; }
      if (changed) {
        applyEligibility().then(recompute);
      }
    }, 120);

    form.addEventListener('change', debouncedChange, true);

    applyEligibility().then(recompute);
  };
})();
