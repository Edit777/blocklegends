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

  function isDebug() {
    try { return window.BL && typeof window.BL.isDebug === 'function' ? window.BL.isDebug() : false; } catch (e) { return false; }
  }

  function debugLog() {
    if (!isDebug()) return;
    var args = Array.prototype.slice.call(arguments);
    try { console.log.apply(console, ['[BL Mystery][debug]'].concat(args)); } catch (e) {}
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

  function collectProperties(form) {
    var props = {};
    try {
      var inputs = form.querySelectorAll('input[name^="properties["]');
      Array.prototype.slice.call(inputs || []).forEach(function (input) {
        var name = input.getAttribute('name') || '';
        var match = name.match(/^properties\[(.*)\]$/);
        if (!match || match.length < 2) return;
        var key = match[1];
        props[key] = input.value || '';
      });
    } catch (e) {}
    return props;
  }

  function getQuantity(form) {
    try {
      var input = form.querySelector('input[name="quantity"]');
      var val = input ? parseInt(input.value, 10) : 1;
      if (isNaN(val) || val < 1) return 1;
      return val;
    } catch (e) {
      return 1;
    }
  }

  function showError(message) {
    try { alert(message); } catch (e) {}
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

  function capitalize(str) {
    var s = String(str || '');
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function applyEligibility(root, form, entries, collectionHandle, selection, noticeEl) {
    if (!form || !entries.length) return Promise.resolve({ switched: false, rarity: selection.rarity });
    return M.fetchPoolAllPages(collectionHandle).then(function () {
      var counts = typeof M.getPoolCounts === 'function' ? M.getPoolCounts(collectionHandle) : null;
      if (!counts) return { switched: false, rarity: selection.rarity };

      entries.forEach(function (entry) {
        var rarityKey = (entry.rarity || '').toLowerCase();
        var eligible = rarityKey === ANY_KEY ? true : Number(counts[rarityKey] || 0) >= MIN_PER_RARITY;
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

    var collections = parseCollections(root);
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
    form.dataset.blMysteryDirectAdd = '1';

    var availability = findVariantAvailability(root);
    var state = {
      mode: M.CFG.modeRandomLabel,
      rarity: ANY_KEY,
      collection: dropdown.value || ''
    };

    var initialSelection = getSelection(getVariantId(form));
    state.mode = initialSelection.mode || state.mode;
    state.rarity = initialSelection.rarity || state.rarity;

    function getCollectionTitle(handle) {
      var match = collections.find(function (c) { return c.handle === handle; });
      return match ? match.title : '';
    }

    function updateModeButtons() {
      modeButtons.forEach(function (btn) {
        var key = btn.getAttribute('data-bl-mode');
        var isActive = M.normalizeMode(key) === M.normalizeMode(state.mode);
        btn.classList.toggle('is-active', isActive);
        btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      });
      setDisplay(collectionRow, M.normalizeMode(state.mode) === M.CFG.modePreferredLabel);
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

    if (!form.__blMysterySubmitBound) {
      form.__blMysterySubmitBound = true;
      form.addEventListener('submit', function (evt) {
        if (form.dataset.blMysteryDirectAdd !== '1') return;
        evt.preventDefault();
        evt.stopImmediatePropagation();

        if (form.dataset.blMysterySubmitting === '1') return;
        form.dataset.blMysterySubmitting = '1';

        var btn = form.querySelector('[type="submit"]');
        if (btn) btn.setAttribute('disabled', 'disabled');

        var requestedMode = state.mode;
        var requestedRarity = state.rarity;
        var requestedCollection = state.collection;
        var quantity = getQuantity(form);
        var usedFallback = false;

        Promise.resolve()
          .then(function () { return M.computeAndApplyAssignment(form, HANDLE, { force: true }); })
          .then(function (ok) {
            if (!ok) {
              showError('This option is temporarily unavailable. Please choose a different rarity/collection and try again.');
              throw new Error('mystery-assign-failed');
            }

            var props = collectProperties(form);
            var assignedBaseHandle = props._bl_assigned_base_handle || props[M.CFG.propAssignedHandle] || '';
            var assignedTitle = props._bl_assigned_title || props[M.CFG.propAssignedTitle] || props[M.CFG.propVisibleAssignedTitle] || '';
            var assignedRarity = props._bl_assigned_rarity || props[M.CFG.propAssignedRarity] || '';
            var requestedRarityValue = props._bl_requested_rarity || props[M.CFG.propRequestedTier] || requestedRarity || '';
            var modeValue = props._bl_mode || props[M.CFG.propSelectedMode] || requestedMode || '';
            var collectionValue = props._bl_locked_collection || props[M.CFG.propPreferredCollection] || requestedCollection || '';
            var assignedVariantId = props._bl_assigned_variant_id || props[M.CFG.propAssignedVariantId] || '';
            var normalizedMode = (typeof M.normalizeMode === 'function') ? M.normalizeMode(modeValue) : modeValue;
            var modeKey = normalizedMode === M.CFG.modePreferredLabel ? 'preferred' : 'random';
            var assignmentUid = props._bl_assignment_uid || form.dataset.blAssignmentUid || '';

            if (!assignedBaseHandle) {
              showError('We could not prepare your Mystery Figure. Please try again.');
              throw new Error('mystery-missing-base-handle');
            }

            var isAny = String(requestedRarityValue || '').toLowerCase() === ANY_KEY;
            var addedHandle = assignedBaseHandle;
            var anyHandle = '';
            var anyHandleHit = false;
            if (isAny && typeof M.mapToAnyHandle === 'function') {
              anyHandle = M.mapToAnyHandle(assignedBaseHandle, collectionValue);
              anyHandleHit = !!anyHandle && anyHandle !== assignedBaseHandle;
              addedHandle = anyHandle || assignedBaseHandle;
            }

            function resolveVariantId(handle) {
              if (!handle) return Promise.resolve(null);
              if (handle === assignedBaseHandle && assignedVariantId) return Promise.resolve(String(assignedVariantId));
              if (typeof M.resolveVariantIdByHandle === 'function') {
                return M.resolveVariantIdByHandle(handle);
              }
              return Promise.resolve(null);
            }

            return resolveVariantId(addedHandle)
              .then(function (variantId) {
                if (!variantId) {
                  showError('This option is sold out right now. Please choose another and try again.');
                  throw new Error('mystery-no-variant');
                }
                if (String(addedHandle || '') === HANDLE) {
                  showError('Unable to add your Mystery Figure right now. Please try again.');
                  throw new Error('mystery-selector-added');
                }

                props._bl_mode = props._bl_mode || modeKey;
                props._bl_requested_rarity = props._bl_requested_rarity || requestedRarityValue;
                props._bl_locked_collection = props._bl_locked_collection || collectionValue;
                props._bl_price_mode = props._bl_price_mode || (normalizedMode === M.CFG.modePreferredLabel ? 'mystery_preferred' : 'mystery_random');
                props._bl_assignment_uid = assignmentUid;
                props._bl_assigned_base_handle = assignedBaseHandle;
                props._bl_added_handle = addedHandle;
                props._bl_assigned_rarity = assignedRarity;
                props._bl_assigned_title = assignedTitle;
                delete props._bl_is_addon;

                debugLog('mystery-add', {
                  mode: modeValue,
                  rarity: requestedRarityValue,
                  collection: collectionValue,
                  assignedBaseHandle: assignedBaseHandle,
                  addedHandle: addedHandle,
                  anyHandle: anyHandle || null,
                  anyHandleHit: anyHandleHit,
                  assignedVariantId: variantId,
                  fallbackUsed: usedFallback
                });

                var payload = {
                  items: [{
                    id: variantId,
                    quantity: quantity,
                    properties: props
                  }]
                };

                return fetch('/cart/add.js', {
                  method: 'POST',
                  credentials: 'same-origin',
                  headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                  },
                  body: JSON.stringify(payload)
                });
              })
              .then(function (res) {
                if (!res || !res.ok) {
                  showError('Unable to add your Mystery Figure right now. Please try again.');
                  throw new Error('mystery-add-failed');
                }
                return res.json().catch(function () { return null; });
              })
              .then(function () {
                try {
                  form.dispatchEvent(new CustomEvent('bl:mystery:added', { bubbles: true }));
                } catch (e) {}
              });
          })
          .catch(function () {})
          .finally(function () {
            form.dataset.blMysterySubmitting = '0';
            if (btn) btn.removeAttribute('disabled');
          });
      }, true);
    }

    Promise.all([
      (typeof M.fetchVariantMap === 'function') ? M.fetchVariantMap() : Promise.resolve(),
      (typeof M.fetchPoolAllPages === 'function') ? M.fetchPoolAllPages(M.CFG.defaultPoolCollectionHandle) : Promise.resolve()
    ]).finally(function () {
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
