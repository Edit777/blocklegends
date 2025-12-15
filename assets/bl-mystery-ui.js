/* =======================================================
   BLOCK LEGENDS — MYSTERY UI (PRODUCT PAGE)
   - Preferred collection selector (pills) + validation
   - Prevent invalid rarity tiers for a preferred collection
   - Optional copy blocks toggled by selection
   ======================================================= */

(function () {
  window.BL = window.BL || {};
  window.BL.mysteryUI = window.BL.mysteryUI || {};

  var U = window.BL.utils;
  var M = window.BL.mysteryEngine;
  var UI = window.BL.mysteryUI;

  function ensureCssOnce() {
    if (document.getElementById('bl-preferred-css')) return;
    var st = document.createElement('style');
    st.id = 'bl-preferred-css';
    st.textContent = [
      '.bl-preferred-wrap{margin-top:10px;}',
      '.bl-preferred-label{font-size:12px;opacity:.9;margin-bottom:6px;}',
      '.bl-preferred-pills{display:flex;gap:8px;flex-wrap:wrap;}',
      '.bl-pill{padding:8px 10px;border:1px solid rgba(0,0,0,.2);border-radius:999px;background:#fff;font-size:13px;line-height:1;cursor:pointer;}',
      '.bl-pill.is-active{border-color:#000;}',
      '.bl-pill[disabled]{opacity:.45;cursor:not-allowed;}',
      '.bl-mystery-status{margin-top:8px;font-size:12px;opacity:.9;}',
      '.bl-mystery-status.is-warn{opacity:1;}',
      '@media (max-width: 749px){.bl-pill{padding:10px 12px;font-size:14px;}}'
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
    input.value = String(value || '');
  }

  function getVariantId(form) {
    try {
      var el = form.querySelector('input[name="id"], select[name="id"]');
      return el ? String(el.value || '').trim() : '';
    } catch (e) { return ''; }
  }

  function setVariantId(form, id) {
    id = String(id || '').trim();
    if (!id) return false;

    // 1) select[name=id] (variant dropdown)
    var sel = form.querySelector('select[name="id"], select.variant-dropdown, select.sticky-atc__variant-select');
    if (sel) {
      if (String(sel.value) !== id) sel.value = id;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }

    // 2) hidden input[name=id]
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

    // Fallback: parse selected option title
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

    // Any element with data-bl-mystery-copy toggles by attributes:
    // - data-for-rarity="common|rare|epic|legendary|any"
    // - data-for-mode="Random Collection|Preferred Collection"
    // - data-for-collection="handle" (optional)
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

  UI.init = function (root) {
    root = root || document;
    if (!U || !M || !M.CFG) return;

    var handle = U.productHandleFromUrl();
    if (handle !== M.CFG.mysteryFigureHandle) return;

    var form = U.qs(root, 'form[action^="/cart/add"]') || U.qs(root, 'form[data-type="add-to-cart-form"]');
    if (!form) return;

    ensureCssOnce();

    // Mount point near variant picker
    var mount = U.qs(root, '[data-bl-mystery-preferred-mount]');
    if (!mount) {
      var variantSelect = U.qs(form, 'select[name="id"]') || U.qs(form, 'select.variant-dropdown');
      if (variantSelect && variantSelect.parentNode) {
        mount = document.createElement('div');
        mount.setAttribute('data-bl-mystery-preferred-mount', 'true');
        variantSelect.parentNode.insertBefore(mount, variantSelect.nextSibling);
      }
    }
    if (!mount) return;
    if (mount.dataset.blBuilt === 'true') return;
    mount.dataset.blBuilt = 'true';

    var collections = (window.BL && window.BL.mystery && window.BL.mystery.collections) ? window.BL.mystery.collections : [];

    var wrap = document.createElement('div');
    wrap.className = 'bl-preferred-wrap';
    wrap.innerHTML = [
      '<div class="bl-preferred-label">Choose collection</div>',
      '<div class="bl-preferred-pills" data-bl-preferred-pills></div>',
      '<div class="bl-mystery-status" data-bl-mystery-status style="display:none;"></div>'
    ].join('');

    var pills = wrap.querySelector('[data-bl-preferred-pills]');
    var statusEl = wrap.querySelector('[data-bl-mystery-status]');
    if (!pills) return;

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

    function getPreferredCollection() {
      try {
        var name = 'properties[' + M.CFG.propPreferredCollection + ']';
        var input = form.querySelector('input[name="' + name.replace(/"/g, '\\"') + '"]');
        return input ? String(input.value || '').trim() : '';
      } catch (e) { return ''; }
    }

    function setPreferredCollection(val) {
      upsertHidden(form, M.CFG.propPreferredCollection, String(val || ''));
    }

    function setActive(val) {
      U.qsa(pills, '.bl-pill').forEach(function (b) {
        b.classList.toggle('is-active', String(b.getAttribute('data-collection') || '') === String(val || ''));
      });
    }

    // Build pills
    var noneBtn = document.createElement('button');
    noneBtn.type = 'button';
    noneBtn.className = 'bl-pill is-active';
    noneBtn.setAttribute('data-collection', '');
    noneBtn.textContent = 'Any';
    pills.appendChild(noneBtn);

    collections.forEach(function (c) {
      if (!c || !c.handle) return;
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'bl-pill';
      b.setAttribute('data-collection', c.handle);
      b.textContent = c.title || c.handle;
      pills.appendChild(b);
    });

    function setVisibleForMode(sel) {
      var mode = sel && sel.mode ? sel.mode : M.CFG.modeRandomLabel;
      wrap.style.display = (mode === M.CFG.modePreferredLabel) ? '' : 'none';
      if (mode !== M.CFG.modePreferredLabel) {
        setPreferredCollection('');
        setActive('');
        setStatus('', false);
      }
    }

    function ensureVariantMapReady() {
      return (M.fetchVariantMap ? M.fetchVariantMap() : Promise.resolve());
    }

    function recompute() {
      M.computeAndApplyAssignment(form, M.CFG.mysteryFigureHandle).catch(function () {});
    }

    function validateAndMaybeFix() {
      var sel = getSelectionFromForm(form);
      var mode = M.normalizeMode ? M.normalizeMode(sel.mode) : sel.mode;
      var rarity = M.normalizeRarity ? M.normalizeRarity(sel.rarity) : sel.rarity;

      setVisibleForMode(sel);

      var preferred = (mode === M.CFG.modePreferredLabel) ? getPreferredCollection() : '';
      applyCopy(root, { rarity: rarity, mode: mode }, preferred);

      // Random mode => always OK
      if (mode !== M.CFG.modePreferredLabel) {
        setStatus('', false);
        recompute();
        return Promise.resolve(true);
      }

      // Preferred mode + Any collection => OK
      if (!preferred) {
        setStatus('', false);
        recompute();
        return Promise.resolve(true);
      }

      // Ensure pool loaded for preferred collection then validate rarity
      return M.fetchPoolAllPages(preferred).then(function () {
        var counts = (typeof M.getPoolCounts === 'function') ? M.getPoolCounts(preferred) : null;
        if (!counts) {
          setStatus('Pool data unavailable. Please try again.', true);
          recompute();
          return true;
        }

        // Any always passes
        if (rarity === M.CFG.anyRarityKey) {
          setStatus('', false);
          recompute();
          return true;
        }

        var min = Number(M.CFG.preferredMinPerRarity || 0);
        if (Number(counts[rarity] || 0) >= min) {
          setStatus('', false);
          recompute();
          return true;
        }

        // Not eligible => switch to a safe fallback
        setStatus('This collection does not have enough ' + rarity + ' figures right now. Switched to Any.', true);

        return ensureVariantMapReady().then(function () {
          var targetId =
            findVariantIdFor(M.CFG.anyRarityKey, M.CFG.modePreferredLabel) ||
            findVariantIdFor(rarity, M.CFG.modeRandomLabel) ||
            findVariantIdFor(M.CFG.anyRarityKey, M.CFG.modeRandomLabel);

          if (targetId) setVariantId(form, targetId);

          // Ensure preferred collection property is preserved only if still preferred mode
          var sel2 = getSelectionFromForm(form);
          var mode2 = M.normalizeMode ? M.normalizeMode(sel2.mode) : sel2.mode;
          if (mode2 !== M.CFG.modePreferredLabel) {
            setPreferredCollection('');
            setActive('');
          }

          recompute();
          return true;
        });
      });
    }

    // click pills
    pills.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('.bl-pill') : null;
      if (!btn) return;
      e.preventDefault();

      var val = btn.getAttribute('data-collection') || '';
      setPreferredCollection(val);
      setActive(val);
      validateAndMaybeFix();
    });

    // variant changes (rarity/mode)
    var debounced = U.debounce(function () {
      validateAndMaybeFix();
    }, 80);

    form.addEventListener('change', debounced, true);
    document.addEventListener('change', function (e) {
      if (form.contains(e.target)) debounced();
    }, true);

    // mount
    mount.appendChild(wrap);

    // defaults
    setPreferredCollection('');
    setActive('');

    // ensure map warm
    ensureVariantMapReady().then(function () {
      validateAndMaybeFix();
    });
  };
})();