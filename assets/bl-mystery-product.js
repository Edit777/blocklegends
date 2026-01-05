(function () {
  var BL = (typeof window !== 'undefined') ? (window.BL = window.BL || {}) : {};
  var M = BL.mysteryEngine;
  var U = BL.utils || {};

  if (!M || !M.CFG) return;

  var HANDLE = M.CFG.mysteryFigureHandle || 'mystery-figure';
  var ANY_KEY = (M.CFG.anyRarityKey || 'any').toLowerCase();

  function isDebug() {
    try { return (window.BL && typeof window.BL.isDebug === 'function') ? window.BL.isDebug() : false; } catch (e) { return false; }
  }

  function onReady(cb) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', cb);
    } else {
      cb();
    }
  }

  function safeText(el, text) {
    if (!el) return;
    var next = text || '';
    if (el.textContent === next) return;
    el.textContent = next;
  }

  function setDisplay(el, show) {
    if (!el) return;
    var target = show ? '' : 'none';
    if (el.style.display === target) return;
    el.style.display = target;
  }

  function upsertHidden(form, key, value) {
    if (!form || !key) return;
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

  function formatCollectionLabel(key) {
    var text = String(key || '').trim();
    if (!text) return '';
    return text.replace(/[-_]+/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  function getVariantId(form) {
    try {
      var input = form.querySelector('input[name="id"]');
      return input ? String(input.value || '').trim() : '';
    } catch (e) {
      return '';
    }
  }

  function getSelection(variantId) {
    var sel = variantId && typeof M.getVariantSelection === 'function' ? M.getVariantSelection(variantId) : null;
    var rarity = sel && sel.rarity ? M.normalizeRarity(sel.rarity) : ANY_KEY;
    var mode = sel && sel.mode ? M.normalizeMode(sel.mode) : M.CFG.modeRandomLabel;
    return {
      rarity: rarity,
      mode: mode
    };
  }

  function normalizeRarityValue(val) {
    var lower = String(val || '').trim().toLowerCase();
    if (!lower) return null;
    if (lower === ANY_KEY) return ANY_KEY;
    if ((M.CFG.anyRarityLabels || []).some(function (l) { return String(l || '').trim().toLowerCase() === lower; })) return ANY_KEY;
    if ((M.CFG.allowedRarities || []).some(function (r) { return String(r || '').trim().toLowerCase() === lower; })) return lower;
    return null;
  }

  function setRarityDisabled(entry, disabled) {
    if (!entry || !entry.input) return;
    var label = entry.label || entry.input;
    if (entry.input.disabled !== !!disabled) {
      entry.input.disabled = !!disabled;
    }
    entry.input.setAttribute('aria-disabled', disabled ? 'true' : 'false');
    if (label) label.classList.toggle('is-disabled', !!disabled);
  }

  function clearRarityDisabled(entries) {
    entries.forEach(function (entry) { setRarityDisabled(entry, false); });
  }

  function pickFallbackRarity(entries) {
    var anyEntry = entries.find(function (e) { return (e.rarity || '').toLowerCase() === ANY_KEY && !e.input.disabled; });
    if (anyEntry) return anyEntry.rarity;
    var first = entries.find(function (e) { return !e.input.disabled; });
    return first ? first.rarity : null;
  }

  function markRarityActive(entries, rarity) {
    entries.forEach(function (entry) {
      var isActive = (entry.rarity || '').toLowerCase() === String(rarity || '').toLowerCase();
      entry.input.classList.toggle('is-active', isActive);
      entry.input.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      entry.input.checked = isActive;
    });
  }

  function selectRarity(entries, rarity) {
    var match = entries.find(function (e) { return e.rarity === rarity; });
    if (!match || !match.input || match.input.disabled) return false;
    markRarityActive(entries, rarity);
    if (match.input.tagName === 'BUTTON') {
      match.input.dispatchEvent(new Event('click', { bubbles: true }));
    } else {
      match.input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return true;
  }

  function getCurrentRarity(entries) {
    var active = entries.find(function (e) {
      if (!e.input) return false;
      if (e.input.classList && e.input.classList.contains('is-active')) return true;
      return !!e.input.checked;
    });
    return active ? active.rarity : null;
  }

  function findVariantAvailability(root) {
    var availability = {};
    try {
      var script = root.closest('section') && root.closest('section').querySelector('variant-selects script[type="application/json"]');
      if (script && script.textContent) {
        var parsed = JSON.parse(script.textContent);
        if (Array.isArray(parsed)) {
          parsed.forEach(function (variant) {
            availability[String(variant.id)] = variant.available !== false;
          });
        }
      }
    } catch (e) {}
    return availability;
  }

  function buildRarityEntries(container) {
    var entries = [];
    if (!container) return entries;

    if (!container.childElementCount) {
      var allowed = (M.CFG && M.CFG.allowedRarities) ? M.CFG.allowedRarities.slice() : ['common', 'rare', 'epic', 'legendary'];
      if (allowed.indexOf(ANY_KEY) === -1) allowed.push(ANY_KEY);
      allowed.forEach(function (rarity) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'bl-mystery-pill';
        btn.setAttribute('data-bl-rarity', rarity);
        btn.textContent = rarity === ANY_KEY ? 'Any' : rarity.charAt(0).toUpperCase() + rarity.slice(1);
        container.appendChild(btn);
      });
    }

    entries = Array.prototype.slice.call(container.querySelectorAll('[data-bl-rarity]')).map(function (btn) {
      var rarity = normalizeRarityValue(btn.getAttribute('data-bl-rarity'));
      return rarity ? { input: btn, rarity: rarity, label: btn } : null;
    }).filter(Boolean);

    return entries;
  }

  function findVariantIdFor(mode, rarity, availabilityMap) {
    var map = typeof M.getVariantSelectionMap === 'function' ? M.getVariantSelectionMap() : {};
    var target = '';
    Object.keys(map || {}).some(function (id) {
      var sel = map[id];
      if (!sel) return false;
      var r = M.normalizeRarity(sel.rarity);
      var m = M.normalizeMode(sel.mode);
      if (r === rarity && m === mode) {
        target = id;
        if (!availabilityMap || availabilityMap[id] !== false) return true;
      }
      return false;
    });
    return target;
  }

  function setVariantId(form, variantId) {
    if (!form || !variantId) return false;
    var variantStr = String(variantId);
    var select = form.querySelector('select[name="id"]');
    var changed = false;

    if (select && select.value !== variantStr) {
      select.value = variantStr;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      changed = true;
    }

    var hidden = form.querySelector('input[name="id"]');
    if (hidden && hidden.value !== variantStr) {
      hidden.value = variantStr;
      hidden.dispatchEvent(new Event('change', { bubbles: true }));
      changed = true;
    }

    var radio = form.querySelector('input[type="radio"][name="id"][value="' + variantStr + '"]');
    if (radio && !radio.checked) {
      radio.checked = true;
      radio.dispatchEvent(new Event('change', { bubbles: true }));
      changed = true;
    }

    return changed;
  }

  function updateHint(hintEl, rarity, collectionTitle) {
    if (!hintEl) return;
    var label = collectionTitle || '';
    var any = ANY_KEY === String(rarity || '').toLowerCase();
    var text = '';
    if (label) {
      text = any ? 'Get a random figure from ' + label + '.' : 'Get a ' + capitalize(rarity) + ' figure from ' + label + '.';
    }
    safeText(hintEl, text);
  }

  function syncHiddenProps(form, state) {
    if (!form || !state) return;
    var preferredMode = M.normalizeMode(state.mode) === M.CFG.modePreferredLabel;
    var collectionVal = preferredMode ? (state.collection || '') : '';
    var modeKey = preferredMode ? 'preferred' : 'random';
    upsertHidden(form, M.CFG.propPreferredCollection, collectionVal);
    upsertHidden(form, '_bl_mode', modeKey);
    upsertHidden(form, '_bl_locked_collection', collectionVal);
    upsertHidden(form, '_bl_requested_rarity', state.rarity || ANY_KEY);
  }

  function capitalize(str) {
    var s = String(str || '');
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function applyEligibility(root, form, entries, collectionHandle, selection, noticeEl) {
    if (!form || !entries.length) return Promise.resolve({ switched: false, rarity: selection.rarity });
    var poolHandle = M.CFG.defaultPoolCollectionHandle;
    return M.fetchPoolAllPages(poolHandle).then(function () {
      var availability = typeof M.getRarityAvailability === 'function'
        ? M.getRarityAvailability(poolHandle, collectionHandle)
        : null;
      if (!availability) return { switched: false, rarity: selection.rarity };

      entries.forEach(function (entry) {
        var rarityKey = (entry.rarity || '').toLowerCase();
        var eligible = rarityKey === availability.anyKey ? true : !!availability.eligible[rarityKey];
        setRarityDisabled(entry, !eligible);
      });

      var currentRarity = getCurrentRarity(entries) || selection.rarity;
      var currentEntry = entries.find(function (e) { return (e.rarity || '').toLowerCase() === (currentRarity || '').toLowerCase(); });
      var requiresFallback = currentEntry && currentEntry.input.getAttribute('aria-disabled') === 'true';
      var picked = currentRarity;
      if (requiresFallback) {
        var fallback = pickFallbackRarity(entries);
        if (fallback) {
          picked = fallback;
          markRarityActive(entries, fallback);
        }
        safeText(noticeEl, 'Some rarities are not available right now. Switched to an available option.');
        setDisplay(noticeEl, true);
      } else {
        safeText(noticeEl, '');
        setDisplay(noticeEl, false);
      }

      return { switched: requiresFallback, rarity: picked };
    });
  }

  function attach(root) {
    if (!root || root.dataset.blMysteryBound === '1') return;
    if (String(root.getAttribute('data-product-handle') || '') !== HANDLE) return;

    var form = root.closest('section') ? root.closest('section').querySelector('form[data-type="add-to-cart-form"]') : null;
    if (!form) form = document.querySelector('form[data-type="add-to-cart-form"]');
    if (!form) return;

    var dropdown = root.querySelector('[data-bl-pref-collection-select]');
    var collectionRow = root.querySelector('[data-bl-collection-row]');
    var rarityContainer = root.querySelector('[data-bl-rarity-options]');
    var modeButtons = Array.prototype.slice.call(root.querySelectorAll('[data-bl-mode]'));
    var hintEl = root.querySelector('[data-bl-mystery-hint]');
    var noticeEl = root.parentElement ? root.parentElement.querySelector('[data-bl-mystery-notice]') : null;
    var rarityEntries = buildRarityEntries(rarityContainer);

    if (!dropdown || !collectionRow || !rarityEntries.length || !modeButtons.length) return;

    root.dataset.blMysteryBound = '1';

    var availability = findVariantAvailability(root);
    var collectionMap = {};
    var state = {
      mode: M.CFG.modeRandomLabel,
      rarity: ANY_KEY,
      collection: dropdown.value || ''
    };

    var initialSelection = getSelection(getVariantId(form));
    state.mode = initialSelection.mode || state.mode;
    state.rarity = initialSelection.rarity || state.rarity;

    function getCollectionTitle(handle) {
      return collectionMap[handle] || formatCollectionLabel(handle);
    }

    function ensureCollectionError() {
      var err = root.querySelector('[data-bl-pref-error]');
      if (err) return err;
      err = document.createElement('div');
      err.className = 'bl-mystery-notice';
      err.setAttribute('data-bl-pref-error', '1');
      err.style.display = 'none';
      root.appendChild(err);
      return err;
    }

    function setCollectionError(show, message) {
      var err = ensureCollectionError();
      if (!err) return;
      if (!show) {
        err.textContent = '';
        err.style.display = 'none';
        return;
      }
      err.textContent = message || 'No preferred collections are available right now.';
      err.style.display = '';
    }

    function updateModeButtons() {
      modeButtons.forEach(function (btn) {
        var key = btn.getAttribute('data-bl-mode');
        var isActive = M.normalizeMode(key) === M.normalizeMode(state.mode);
        btn.classList.toggle('is-active', isActive);
        btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      });
      setDisplay(collectionRow, M.normalizeMode(state.mode) === M.CFG.modePreferredLabel);
      var inPreferred = M.normalizeMode(state.mode) === M.CFG.modePreferredLabel;
      var hasCollections = dropdown && dropdown.options && dropdown.options.length > 0;
      setCollectionError(inPreferred && !hasCollections, 'Preferred collections are unavailable. Please choose Random Collection.');
    }

    function updateHelper() {
      var label = M.normalizeMode(state.mode) === M.CFG.modePreferredLabel
        ? getCollectionTitle(state.collection)
        : M.CFG.modeRandomLabel;
      updateHint(hintEl, state.rarity, label);
    }

    function syncVariant() {
      var targetId = findVariantIdFor(state.mode, state.rarity, availability);
      if (targetId) setVariantId(form, targetId);
      if (typeof M.computeAndApplyAssignment === 'function') {
        M.computeAndApplyAssignment(form, HANDLE).catch(function () {});
      }
    }

    function handleEligibility() {
      if (M.normalizeMode(state.mode) !== M.CFG.modePreferredLabel) {
        clearRarityDisabled(rarityEntries);
        setDisplay(noticeEl, false);
        safeText(noticeEl, '');
        return Promise.resolve({ switched: false, rarity: state.rarity });
      }

      return applyEligibility(root, form, rarityEntries, state.collection || dropdown.value, state, noticeEl)
        .then(function (result) {
          if (result && result.rarity) {
            state.rarity = normalizeRarityValue(result.rarity) || state.rarity;
            markRarityActive(rarityEntries, state.rarity);
          }
          return result;
        });
    }

    function refresh() {
      updateModeButtons();
      markRarityActive(rarityEntries, state.rarity);
      updateHelper();
      syncHiddenProps(form, state);
      syncVariant();
    }

    dropdown.addEventListener('change', function () {
      state.collection = dropdown.value;
      handleEligibility().then(function (res) {
        if (res && res.rarity) state.rarity = res.rarity;
        refresh();
      });
    });

    rarityEntries.forEach(function (entry) {
      if (entry.input.__blBound) return;
      entry.input.__blBound = true;
      entry.input.addEventListener('click', function (evt) {
        if (entry.input.disabled || entry.input.getAttribute('aria-disabled') === 'true') return;
        state.rarity = entry.rarity;
        markRarityActive(rarityEntries, state.rarity);
        updateHelper();
        syncVariant();
      });
    });

    modeButtons.forEach(function (btn) {
      if (btn.__blBound) return;
      btn.__blBound = true;
      btn.addEventListener('click', function () {
        var key = btn.getAttribute('data-bl-mode');
        state.mode = key === 'preferred' ? M.CFG.modePreferredLabel : M.CFG.modeRandomLabel;
        if (M.normalizeMode(state.mode) !== M.CFG.modePreferredLabel) {
          setDisplay(noticeEl, false);
          safeText(noticeEl, '');
        }
        handleEligibility().then(function (res) {
          if (res && res.rarity) state.rarity = res.rarity;
          refresh();
        });
      });
    });

    form.addEventListener('change', function () {
      var sel = getSelection(getVariantId(form));
      state.mode = sel.mode || state.mode;
      state.rarity = sel.rarity || state.rarity;
      refresh();
    });

    Promise.all([
      (typeof M.fetchVariantMap === 'function') ? M.fetchVariantMap() : Promise.resolve(),
      (typeof M.fetchPoolAllPages === 'function') ? M.fetchPoolAllPages(M.CFG.defaultPoolCollectionHandle) : Promise.resolve()
    ]).finally(function () {
      var collectionKeys = (typeof M.getPoolCollectionKeys === 'function')
        ? M.getPoolCollectionKeys(M.CFG.defaultPoolCollectionHandle)
        : [];

      if (dropdown) {
        dropdown.innerHTML = '';
        collectionMap = {};
        collectionKeys.forEach(function (key) {
          var label = formatCollectionLabel(key);
          collectionMap[key] = label || key;
          var opt = document.createElement('option');
          opt.value = key;
          opt.textContent = collectionMap[key];
          dropdown.appendChild(opt);
        });
        if (isDebug()) {
          try { console.log('[BL Mystery][debug] preferred-dropdown-populated', { count: collectionKeys.length }); } catch (e) {}
        }
        if (collectionKeys.length && !collectionMap[state.collection]) {
          state.collection = collectionKeys[0];
          dropdown.value = state.collection;
        }
      }

      markRarityActive(rarityEntries, state.rarity);
      handleEligibility().then(function (res) {
        if (res && res.rarity) state.rarity = res.rarity;
        refresh();
      });
    });
  }

  onReady(function () {
    var roots = Array.prototype.slice.call(document.querySelectorAll('[data-bl-mystery-ui]'));
    roots.forEach(function (root) { attach(root); });
  });
})();
