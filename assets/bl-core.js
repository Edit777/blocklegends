/* =======================================================
   BLOCK LEGENDS — CORE
   Safe namespace + utilities + debug
   ======================================================= */

(function () {
  window.BL = window.BL || {};
  window.BL.utils = window.BL.utils || {};

  var U = window.BL.utils;

  U.CFG = U.CFG || {
    debugParam: 'bl_debug',
    debugStorageKey: 'BL_DEBUG'
  };

  U.isDebug = function () {
    try {
      var url = new URL(window.location.href);
      var v = url.searchParams.get(U.CFG.debugParam);
      if (v === '1') { localStorage.setItem(U.CFG.debugStorageKey, '1'); return true; }
      if (v === '0') { localStorage.removeItem(U.CFG.debugStorageKey); return false; }
      return localStorage.getItem(U.CFG.debugStorageKey) === '1';
    } catch (e) {
      return false;
    }
  };

  U.log = function () { if (U.isDebug()) try { console.log.apply(console, arguments); } catch (e) {} };
  U.warn = function () { if (U.isDebug()) try { console.warn.apply(console, arguments); } catch (e) {} };
  U.err = function () { if (U.isDebug()) try { console.error.apply(console, arguments); } catch (e) {} };

  U.qs = function (root, sel) { return (root || document).querySelector(sel); };
  U.qsa = function (root, sel) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  U.on = function (root, event, sel, fn, opts) {
    (root || document).addEventListener(event, function (e) {
      var t = e.target && e.target.closest ? e.target.closest(sel) : null;
      if (t && (root || document).contains(t)) fn(e, t);
    }, !!opts);
  };

  U.debounce = function (fn, wait) {
    var t = null;
    return function () {
      var ctx = this, args = arguments;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(ctx, args); }, wait || 80);
    };
  };

  U.money = function (cents, fmt) {
    try {
      if (window.Shopify && typeof window.Shopify.formatMoney === 'function') {
        return window.Shopify.formatMoney(Number(cents || 0), fmt || window.Shopify.money_format);
      }
    } catch (e) {}
    var n = (Number(cents || 0) / 100);
    return '$' + n.toFixed(2);
  };

  U.productHandleFromUrl = function () {
    var m = window.location.pathname.match(/^\/products\/([^\/]+)/);
    return m ? m[1] : null;
  };
})();
