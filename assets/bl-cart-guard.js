/* =======================================================
   BLOCK LEGENDS — CART GUARD (MYSTERY ADD-ON ENFORCER)
   - Validates mystery add-ons are tied to an eligible parent item
   - Enforces 1 add-on per parent quantity, qty always 1 for add-ons
   - Removes orphan / mismatched add-ons before they can be abused
   - Hooks into cart mutations and checkout to keep state clean
   ======================================================= */

(() => {
  const global = window;
  global.BL = global.BL || {};
  global.BL.cartGuard = global.BL.cartGuard || {};

  const Guard = global.BL.cartGuard;

  Guard.CFG = Guard.CFG || {
    addonHandle: 'mystery-add-on',
    propIsAddon: '_bl_is_addon',
    propParentHandle: '_bl_parent_handle',
    propParentUid: '_bl_parent_uid',
    propLockedCollection: '_bl_locked_collection',
    networkDebounceMs: 200,
    mutationDebounceMs: 250
  };

  const toStr = (val) => {
    try {
      return String(val || '').trim();
    } catch (error) {
      return '';
    }
  };

  const toNumber = (val) => {
    const n = Number(val);
    return Number.isFinite(n) ? n : 0;
  };

  const isAddon = (item) => {
    if (!item) return false;

    try {
      const flag = toStr(item?.properties?.[Guard.CFG.propIsAddon]);
      if (flag === '1') return true;

      const handle = toStr(item.handle || item.product_handle);
      if (handle && handle === Guard.CFG.addonHandle) return true;

      const url = toStr(item.url);
      if (url && url.indexOf(`/products/${Guard.CFG.addonHandle}`) !== -1) return true;
    } catch (error) {
      return false;
    }

    return false;
  };

  const fetchCart = () =>
    fetch('/cart.js', { credentials: 'same-origin' })
      .then((response) => (response.ok ? response.json() : null))
      .catch(() => null);

  const changeLine = ({ key, line, qty }) => {
    if (!key && !line) return Promise.resolve();

    const payload = { quantity: qty };
    if (key) payload.id = key;
    else payload.line = line;

    return fetch('/cart/change.js', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).catch(() => {});
  };

  const buildParents = (items) => {
    const parents = {};

    (items || []).forEach((item, index) => {
      if (!item || isAddon(item)) return;

      const uid = toStr(item?.properties?.[Guard.CFG.propParentUid]);
      if (!uid) return; // only guard items that opted into the contract

      const line = toNumber(item.line || index + 1);
      const handle = toStr(item.handle || item.product_handle);
      const locked = toStr(item?.properties?.[Guard.CFG.propLockedCollection]);
      const qty = Math.max(0, toNumber(item.quantity));

      const existing = parents[uid];
      if (existing) {
        // Merge duplicate parents under the same uid so capacity matches total quantity
        existing.qty += qty;
        existing.lines.push(line);
      } else {
        parents[uid] = {
          uid,
          handle,
          locked,
          qty,
          lines: [line]
        };
      }
    });

    return parents;
  };

  const computeChanges = (cart) => {
    if (!cart || !Array.isArray(cart.items) || !cart.items.length) return [];

    const parents = buildParents(cart.items);
    const capacity = Object.keys(parents).reduce((acc, uid) => {
      acc[uid] = parents[uid].qty;
      return acc;
    }, {});

    const changes = [];

    (cart.items || []).forEach((item, index) => {
      if (!item || !isAddon(item)) return;

      const line = toNumber(item.line || index + 1);
      const qty = Math.max(0, toNumber(item.quantity));
      const uid = toStr(item?.properties?.[Guard.CFG.propParentUid]);
      const parentHandle = toStr(item?.properties?.[Guard.CFG.propParentHandle]);
      const locked = toStr(item?.properties?.[Guard.CFG.propLockedCollection]);
      const parent = uid ? parents[uid] : null;

      const meta = { key: item.key, line, qty, uid, parentHandle, locked };

      if (!parent) {
        // Add-on without a tracked parent UID — remove entirely
        changes.push({ key: item.key, line, qty: 0 });
        return;
      }

      if (parentHandle && parent.handle && parentHandle !== parent.handle) {
        changes.push({ key: item.key, line, qty: 0 });
        return;
      }

      if (locked && parent.locked && locked !== parent.locked) {
        changes.push({ key: item.key, line, qty: 0 });
        return;
      }

      const remaining = Math.max(0, toNumber(capacity[uid]));
      const allowed = Math.min(1, remaining);

      if (allowed <= 0) {
        changes.push({ key: item.key, line, qty: 0 });
        return;
      }

      if (qty !== allowed) {
        changes.push({ key: item.key, line, qty: allowed });
      }

      capacity[uid] = remaining - allowed;
    });

    return changes;
  };

  Guard.cleanup = (reason) => {
    if (Guard.__busy) {
      Guard.__queued = true;
      return Promise.resolve(false);
    }

    Guard.__busy = true;

    return fetchCart()
      .then((cart) => {
        const changes = computeChanges(cart);
        if (!changes.length) return false;

        Guard.__silentNetwork = true;

        let sequence = Promise.resolve();
        changes.forEach((change) => {
          sequence = sequence.then(() => changeLine(change));
        });

        return sequence.then(() => true);
      })
      .catch(() => false)
      .finally(() => {
        Guard.__silentNetwork = false;
        Guard.__busy = false;

        if (Guard.__queued) {
          Guard.__queued = false;
          Guard.cleanup('queued');
        }
      });
  };

  const debounce = (fn, ms) => {
    let timer = null;
    return (...args) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => fn.apply(null, args), ms);
    };
  };

  Guard._scheduleNetwork = debounce((reason) => Guard.cleanup(reason || 'network'), Guard.CFG.networkDebounceMs);
  Guard._scheduleMutation = debounce((reason) => Guard.cleanup(reason || 'mutation'), Guard.CFG.mutationDebounceMs);

  Guard.patchNetwork = () => {
    if (Guard.__patched) return;
    Guard.__patched = true;

    if (global.fetch) {
      const originalFetch = global.fetch;
      global.fetch = (input, init) => {
        const url = typeof input === 'string' ? input : input?.url || '';
        const isMutation = /\/cart\/(add|change|update)\.js(\?|$)/.test(url);

        return originalFetch(input, init).then((response) => {
          if (isMutation && !Guard.__silentNetwork) Guard._scheduleNetwork('fetch');
          return response;
        });
      };
    }

    try {
      const open = XMLHttpRequest.prototype.open;
      const send = XMLHttpRequest.prototype.send;

      XMLHttpRequest.prototype.open = function (method, url) {
        this.__bl_url = url;
        return open.apply(this, arguments);
      };

      XMLHttpRequest.prototype.send = function () {
        const xhr = this;
        const done = () => {
          const url = toStr(xhr.__bl_url);
          if (/\/cart\/(add|change|update)\.js(\?|$)/.test(url) && !Guard.__silentNetwork) {
            Guard._scheduleNetwork('xhr');
          }
        };

        xhr.addEventListener('load', done);
        xhr.addEventListener('error', done);

        return send.apply(this, arguments);
      };
    } catch (error) {
      // ignore
    }
  };

  Guard.observeCartDrawer = () => {
    if (Guard.__obs || !global.MutationObserver) return;

    const target =
      document.querySelector('[data-cart-items]') ||
      document.querySelector('[data-cart-drawer]') ||
      document.querySelector('#CartDrawer') ||
      document.querySelector('cart-drawer');

    if (!target) return;

    Guard.__obs = new MutationObserver(() => Guard._scheduleMutation('dom'));
    Guard.__obs.observe(target, { childList: true, subtree: true });
  };

  Guard.bindThemeEvents = () => {
    if (Guard.__events) return;
    Guard.__events = true;

    ['cart:updated', 'cart:change', 'cart:refresh', 'cart-drawer:rendered'].forEach((evt) => {
      document.addEventListener(evt, () => Guard._scheduleNetwork(evt), true);
    });
  };

  Guard.guardCheckout = () => {
    if (Guard.__checkoutBound) return;
    Guard.__checkoutBound = true;

    const selector = 'button[name="checkout"], input[name="checkout"], [href^="/checkout"]';

    document.addEventListener(
      'click',
      (event) => {
        const target = event.target?.closest(selector);
        if (!target) return;

        event.preventDefault();
        event.stopImmediatePropagation();

        const proceed = () => {
          try {
            if (target.tagName === 'A' && target.href) return (global.location.href = target.href);
            const form = target.closest('form');
            if (form) return form.submit();
          } catch (error) {
            // ignore and fall back
          }

          global.location.href = '/checkout';
        };

        Guard.cleanup('checkout').finally(proceed);
      },
      true
    );
  };

  Guard.init = () => {
    if (Guard.__inited) return;
    Guard.__inited = true;

    Guard.patchNetwork();
    Guard.bindThemeEvents();
    Guard.observeCartDrawer();
    Guard.guardCheckout();

    setTimeout(() => Guard.cleanup('init'), 150);

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) Guard._scheduleNetwork('visibility');
    });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', Guard.init);
  } else {
    Guard.init();
  }
})();
