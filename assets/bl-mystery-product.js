(function () {
  var BL = (typeof window !== 'undefined') ? (window.BL = window.BL || {}) : {};
  var M = BL.mysteryEngine;
  var U = BL.utils || {};

  if (!M || !M.CFG) return;

  var HANDLE = M.CFG.mysteryFigureHandle || 'mystery-figure';
  var ANY_KEY = (M.CFG.anyRarityKey || 'any').toLowerCase();
  var MIN_PER_RARITY = Number(M.CFG.preferredMinPerRarity || 0);

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

  function parseCollections(root) {
    try {
      var raw = root.getAttribute('data-collections') || '[]';
      var parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    } catch (e) {}
    return [];
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

  function mapRarityInputs(form) {
    var mapped = [];
    if (!form) return mapped;

    var radios = Array.prototype.slice.call(form.querySelectorAll('input[type="radio"]'));
    radios.forEach(function (input) {
      var rarity = normalizeRarityValue(input.value || input.getAttribute('data-value'));
      if (!rarity) return;
      var label = input.id ? form.querySelector('label[for="' + input.id + '"]') : null;
      input.dataset.blRarity = rarity;
      if (label) label.dataset.blRarity = rarity;
      mapped.push({ input: input, label: label, rarity: rarity });
    });

    return mapped;
  }

  function setRarityDisabled(entry, disabled) {
    if (!entry || !entry.input) return;
    var label = entry.label;
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

  function selectRarity(entries, rarity) {
    var match = entries.find(function (e) { return e.rarity === rarity; });
    if (!match || !match.input || match.input.disabled) return false;
    if (!match.input.checked) {
      match.input.checked = true;
      match.input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return true;
  }

  function getCurrentRarity(entries) {
    var active = entries.find(function (e) { return e.input && e.input.checked; });
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

  function capitalize(str) {
    var s = String(str || '');
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function applyEligibility(root, form, entries, collectionHandle, selection, noticeEl) {
    if (!form || !entries.length) return Promise.resolve();
    return M.fetchPoolAllPages(collectionHandle).then(function () {
      var counts = typeof M.getPoolCounts === 'function' ? M.getPoolCounts(collectionHandle) : null;
      if (!counts) return;

      entries.forEach(function (entry) {
        var rarityKey = (entry.rarity || '').toLowerCase();
        var eligible = rarityKey === ANY_KEY ? true : Number(counts[rarityKey] || 0) >= MIN_PER_RARITY;
        setRarityDisabled(entry, !eligible);
      });

      var currentRarity = getCurrentRarity(entries) || selection.rarity;
      var currentEntry = entries.find(function (e) { return (e.rarity || '').toLowerCase() === (currentRarity || '').toLowerCase(); });
      var requiresFallback = currentEntry && currentEntry.input.getAttribute('aria-disabled') === 'true';
      if (requiresFallback) {
        var fallback = pickFallbackRarity(entries);
        if (fallback && fallback !== currentRarity) {
          var changed = selectRarity(entries, fallback);
          if (!changed) {
            var availability = findVariantAvailability(root);
            var targetId = findVariantIdFor(selection.mode, fallback, availability);
            if (targetId) setVariantId(form, targetId);
          }
        }
        safeText(noticeEl, 'Some rarities are not available right now. Switched to an available option.');
        setDisplay(noticeEl, true);
      } else {
        safeText(noticeEl, '');
        setDisplay(noticeEl, false);
      }

      if (typeof M.computeAndApplyAssignment === 'function') {
        M.computeAndApplyAssignment(form, HANDLE).catch(function () {});
      }
    });
  }

  function attach(root) {
    if (!root || root.dataset.blMysteryBound === '1') return;
    if (String(root.getAttribute('data-product-handle') || '') !== HANDLE) return;

    var collections = parseCollections(root);
    var form = root.closest('section') ? root.closest('section').querySelector('form[data-type="add-to-cart-form"]') : null;
    if (!form) form = document.querySelector('form[data-type="add-to-cart-form"]');
    if (!form) return;

    var dropdown = root.querySelector('[data-bl-pref-collection-select]');
    var wrap = root.querySelector('[data-bl-pref-collection-wrap]');
    var hintEl = root.querySelector('[data-bl-mystery-hint]');
    var noticeEl = root.parentElement ? root.parentElement.querySelector('[data-bl-mystery-notice]') : null;
    var rarityEntries = mapRarityInputs(form);

    if (!dropdown || !wrap) return;

    root.dataset.blMysteryBound = '1';

    var availability = findVariantAvailability(root);
    var currentCollectionHandle = dropdown.value;

    function getCollectionTitle(handle) {
      var match = collections.find(function (c) { return c.handle === handle; });
      return match ? match.title : '';
    }

    function syncState() {
      var variantId = getVariantId(form);
      var selection = getSelection(variantId);
      var modePreferred = M.normalizeMode(selection.mode) === M.CFG.modePreferredLabel;

      setDisplay(wrap, modePreferred);
      currentCollectionHandle = dropdown.value || currentCollectionHandle;

      if (!modePreferred) {
        clearRarityDisabled(rarityEntries);
        safeText(noticeEl, '');
        setDisplay(noticeEl, false);
        updateHint(hintEl, selection.rarity, M.CFG.modeRandomLabel);
        if (typeof M.computeAndApplyAssignment === 'function') {
          M.computeAndApplyAssignment(form, HANDLE).catch(function () {});
        }
        return;
      }

      updateHint(hintEl, selection.rarity, getCollectionTitle(currentCollectionHandle));
      applyEligibility(root, form, rarityEntries, currentCollectionHandle, selection, noticeEl);
    }

    dropdown.addEventListener('change', function () {
      currentCollectionHandle = dropdown.value;
      var variantId = getVariantId(form);
      var selection = getSelection(variantId);
      updateHint(hintEl, selection.rarity, getCollectionTitle(currentCollectionHandle));
      applyEligibility(root, form, rarityEntries, currentCollectionHandle, selection, noticeEl);
    });

    rarityEntries.forEach(function (entry) {
      if (entry.input.__blBound) return;
      entry.input.__blBound = true;
      entry.input.addEventListener('change', function () {
        var variantId = getVariantId(form);
        var selection = getSelection(variantId);
        updateHint(hintEl, selection.rarity, getCollectionTitle(currentCollectionHandle));
        if (typeof M.computeAndApplyAssignment === 'function') {
          M.computeAndApplyAssignment(form, HANDLE).catch(function () {});
        }
      });
    });

    form.addEventListener('change', function () {
      syncState();
    });

    Promise.all([
      (typeof M.fetchVariantMap === 'function') ? M.fetchVariantMap() : Promise.resolve(),
      (typeof M.fetchPoolAllPages === 'function') ? M.fetchPoolAllPages(M.CFG.defaultPoolCollectionHandle) : Promise.resolve()
    ]).finally(function () {
      syncState();
    });
  }

  onReady(function () {
    var roots = Array.prototype.slice.call(document.querySelectorAll('[data-bl-mystery-ui]'));
    roots.forEach(function (root) { attach(root); });
  });
})();
