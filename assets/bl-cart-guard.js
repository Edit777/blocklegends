/* =======================================================
   BLOCK LEGENDS — SIMPLE CART GUARD
   - Runs *after* built-in theme cart updates finish
   - Ensures addon quantity never exceeds other products
   - Addon identified by unique handle or line item tag
   ======================================================= */

(() => {
  const global = window;
  const Guard = (global.BL = global.BL || {}).cartGuard || {};
  global.BL.cartGuard = Guard;

  Guard.CFG = {
    addonHandle: 'mystery-add-on',
    addonPropertyKey: '_bl_addon_tag',
    addonPropertyValue: 'BL_ADDON',
    postThemeDelayMs: 300,
    initDelayMs: 200
  };

  const toStr = (value) => {
    try {
      return String(value || '').trim();
    } catch (error) {
      return '';
    }
  };

  const toQty = (value) => {
    const qty = Number(value);
    return Number.isFinite(qty) ? Math.max(0, qty) : 0;
  };

  const isAddon = (item) => {
    if (!item) return false;

    const handle = toStr(item.handle || item.product_handle);
    if (handle && handle === Guard.CFG.addonHandle) return true;

    const tag = toStr(item?.properties?.[Guard.CFG.addonPropertyKey]);
    if (!tag) return false;
    if (!Guard.CFG.addonPropertyValue) return true;

    return tag === Guard.CFG.addonPropertyValue;
  };

  const fetchCart = () =>
    fetch('/cart.js', { credentials: 'same-origin' })
      .then((response) => (response.ok ? response.json() : null))
      .catch(() => null);

  const sendChange = ({ line, quantity }) => {
    if (!line && line !== 0) return Promise.resolve();

    return fetch('/cart/change.js', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ line, quantity: toQty(quantity) })
    }).catch(() => {});
  };

  const buildChanges = (cart) => {
    if (!cart || !Array.isArray(cart.items) || !cart.items.length) return [];

    let otherQty = 0;
    const addons = [];

    cart.items.forEach((item, index) => {
      if (isAddon(item)) {
        addons.push({ ...item, line: toQty(item.line || index + 1) });
      } else {
        otherQty += toQty(item.quantity);
      }
    });

    let remaining = Math.max(0, otherQty);
    const changes = [];

    addons.forEach((item, idx) => {
      const currentQty = toQty(item.quantity);
      const allowed = Math.min(currentQty, remaining);

      if (allowed !== currentQty) {
        const line = toQty(item.line || idx + 1);
        changes.push({ line, quantity: allowed });
      }

      remaining = Math.max(0, remaining - allowed);
    });

    return changes;
  };

  Guard.runCheck = (reason = 'manual') => {
    if (Guard.__checking) {
      Guard.__queued = true;
      return Promise.resolve();
    }

    Guard.__checking = true;

    return fetchCart()
      .then((cart) => {
        const changes = buildChanges(cart);
        if (!changes.length) return null;

        return changes.reduce((promise, change) => promise.then(() => sendChange(change)), Promise.resolve());
      })
      .catch(() => null)
      .finally(() => {
        Guard.__checking = false;
        if (Guard.__queued) {
          Guard.__queued = false;
          Guard.schedule('queued');
        }
      });
  };

  Guard.schedule = (reason = 'scheduled') => {
    clearTimeout(Guard.__timer);
    Guard.__timer = setTimeout(() => {
      // Defer until the browser has a frame to apply built-in DOM updates
      requestAnimationFrame(() => Guard.runCheck(reason));
    }, Guard.CFG.postThemeDelayMs);
  };

  Guard.observeNetwork = () => {
    if (Guard.__patched) return;
    Guard.__patched = true;

    const mutationPattern = /\/cart\/(add|change|update)\.js(\?|$)/;
    const scheduleAfterTheme = () => Guard.schedule('network');

    if (global.fetch) {
      const originalFetch = global.fetch.bind(global);
      global.fetch = (input, init) => {
        const url = typeof input === 'string' ? input : input?.url || '';
        return originalFetch(input, init).then((response) => {
          if (mutationPattern.test(url)) scheduleAfterTheme();
          return response;
        });
      };
    }

    if (global.XMLHttpRequest) {
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
          if (mutationPattern.test(url)) scheduleAfterTheme();
        };

        xhr.addEventListener('load', done);
        xhr.addEventListener('error', done);

        return send.apply(this, arguments);
      };
    }
  };

  Guard.bindThemeEvents = () => {
    if (Guard.__events) return;
    Guard.__events = true;

    const events = ['cart:updated', 'cart:change', 'cart:refresh', 'cart-drawer:rendered', 'shopify:section:load'];
    events.forEach((eventName) => {
      document.addEventListener(eventName, () => Guard.schedule(eventName), true);
    });
  };

  Guard.init = () => {
    if (Guard.__inited) return;
    Guard.__inited = true;

    Guard.observeNetwork();
    Guard.bindThemeEvents();

    setTimeout(() => Guard.runCheck('init'), Guard.CFG.initDelayMs + Guard.CFG.postThemeDelayMs);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', Guard.init);
  } else {
    Guard.init();
  }
})();
