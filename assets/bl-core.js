/* =======================================================
   BLOCK LEGENDS — CORE
   Safe namespace + utilities + debug
   ======================================================= */

(function () {
  window.BL = window.BL || {};
  window.BL.utils = window.BL.utils || {};
  window.BL_DEBUG = true;

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

  // Shared debug helper (canonical entry point for other scripts)
  window.BL.isDebug = function () {
    return U.isDebug();
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

  var moneyEnvCache = null;

  function pickLocale() {
    try { if (document && document.documentElement && document.documentElement.lang) return document.documentElement.lang; } catch (e) {}
    try { if (typeof navigator !== 'undefined' && navigator.language) return navigator.language; } catch (e2) {}
    return 'en';
  }

  function detectMoneyFormatFromDom() {
    try {
      var el = document && document.querySelector('[data-money-format]');
      if (!el) return { moneyFormat: null, currency: null };
      return {
        moneyFormat: el.getAttribute('data-money-format') || (el.dataset ? el.dataset.moneyFormat : null),
        currency: el.getAttribute('data-currency') || (el.dataset ? el.dataset.currency : null),
        source: 'data-money-format'
      };
    } catch (e) {
      return { moneyFormat: null, currency: null };
    }
  }

  function formatWithDelimiters(cents, precision, thousand, decimal) {
    precision = typeof precision === 'number' ? precision : 2;
    thousand = typeof thousand === 'string' ? thousand : ',';
    decimal = typeof decimal === 'string' ? decimal : '.';

    var number = Number(cents || 0) / 100;
    var fixed = number.toFixed(precision);
    var parts = fixed.split('.');
    var dollars = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, thousand);
    var centsPart = parts[1] ? decimal + parts[1] : '';
    return dollars + centsPart;
  }

  function parseAndRenderMoney(cents, format) {
    var templateMatch = format && format.match(/\{\{\s*(\w+)\s*\}\}/);
    var token = templateMatch ? templateMatch[1] : 'amount';
    var tokenMap = {
      amount: { precision: 2, thousand: ',', decimal: '.' },
      amount_no_decimals: { precision: 0, thousand: ',', decimal: '.' },
      amount_with_comma_separator: { precision: 2, thousand: '.', decimal: ',' },
      amount_no_decimals_with_comma_separator: { precision: 0, thousand: '.', decimal: ',' },
      amount_with_space_separator: { precision: 2, thousand: '\u00A0', decimal: '.' },
      amount_no_decimals_with_space_separator: { precision: 0, thousand: '\u00A0', decimal: '.' }
    };
    var settings = tokenMap[token] || tokenMap.amount;
    var rendered = formatWithDelimiters(cents, settings.precision, settings.thousand, settings.decimal);
    return (format || '{{amount}}').replace(templateMatch ? templateMatch[0] : '{{amount}}', rendered);
  }

  function resolveMoneyEnvironment() {
    var env = { currency: null, moneyFormat: null, formatter: null, source: '' };

    try {
      if (window.Shopify) {
        if (window.Shopify.currency && window.Shopify.currency.active) env.currency = window.Shopify.currency.active;
        if (window.Shopify.currency && window.Shopify.currency.money_formats) {
          var fmtInfo = window.Shopify.currency.money_formats[env.currency];
          if (fmtInfo && fmtInfo.money_format) {
            env.moneyFormat = fmtInfo.money_format;
            env.source = env.source || 'Shopify.currency.money_formats';
          } else if (fmtInfo) {
            env.moneyFormat = fmtInfo;
            env.source = env.source || 'Shopify.currency.money_formats';
          }
        }
        if (typeof window.Shopify.formatMoney === 'function') {
          env.formatter = function (cents, fmt) { return window.Shopify.formatMoney(Number(cents || 0), fmt || window.Shopify.money_format); };
          env.source = env.source || 'Shopify.formatMoney';
        }
        if (window.Shopify.money_format) {
          env.moneyFormat = window.Shopify.money_format;
          env.source = env.source || 'Shopify.money_format';
        }
        if (!env.currency && window.Shopify.shop_currency) env.currency = window.Shopify.shop_currency;
      }
    } catch (e) {}

    try {
      if (!env.moneyFormat && window.theme) {
        var themeFmt = window.theme.moneyFormat || (window.theme.settings && window.theme.settings.moneyFormat);
        if (themeFmt) {
          env.moneyFormat = themeFmt;
          env.source = env.source || 'theme.moneyFormat';
        }
        if (!env.currency && window.theme.currency) env.currency = window.theme.currency;
      }
    } catch (e2) {}

    if (!env.moneyFormat) {
      var domInfo = detectMoneyFormatFromDom();
      if (domInfo.moneyFormat) {
        env.moneyFormat = domInfo.moneyFormat;
        env.source = env.source || domInfo.source || 'data-money-format';
      }
      if (domInfo.currency && !env.currency) env.currency = domInfo.currency;
    }

    if (!env.currency) env.currency = 'USD';
    if (!env.moneyFormat) env.moneyFormat = '{{amount}}';
    if (!env.source) env.source = 'fallback';
    moneyEnvCache = env;
    return env;
  }

  U.getMoneyEnvironment = resolveMoneyEnvironment;

  U.money = function (cents, opts) {
    var options = {};
    if (typeof opts === 'string') {
      options.moneyFormat = opts;
    } else if (opts && typeof opts === 'object') {
      options = opts;
    }

    var env = resolveMoneyEnvironment();
    var moneyFormat = options.moneyFormat || env.moneyFormat;
    var currency = options.currency || env.currency;
    var locale = options.locale || pickLocale();
    var value = Number(cents || 0);

    if (env.formatter) {
      try { return env.formatter(value, moneyFormat); } catch (e) {}
    }

    if (moneyFormat && moneyFormat.indexOf('{{') !== -1) {
      try { return parseAndRenderMoney(value, moneyFormat); } catch (e2) {}
    }

    try {
      return new Intl.NumberFormat(locale, { style: 'currency', currency: currency }).format(value / 100);
    } catch (e3) {}

    var fallback = (value / 100).toFixed(2);
    return (currency ? currency + ' ' : '') + fallback;
  };

  U.productHandleFromUrl = function () {
    var m = window.location.pathname.match(/^\/products\/([^\/]+)/);
    return m ? m[1] : null;
  };

  function normalizePoolKey(key) {
    return String(key || '').trim().toLowerCase();
  }

  function readPoolContextFromDom() {
    try {
      var el = document.getElementById('blPoolContext');
      if (!el) return { key: '', title: '' };
      return {
        key: normalizePoolKey(el.getAttribute('data-bl-pool-key') || ''),
        title: String(el.getAttribute('data-bl-pool-title') || '').trim()
      };
    } catch (e) {
      return { key: '', title: '' };
    }
  }

  function readPoolKeyFromMetafieldNode() {
    try {
      var el = document.querySelector('[data-bl-product-pool-key]');
      if (!el) return '';
      return normalizePoolKey(el.getAttribute('data-bl-product-pool-key') || '');
    } catch (e) {
      return '';
    }
  }

  function parseInternalPoolHandles() {
    var handles = [];
    var attr = '';
    try {
      var el = document.querySelector('[data-bl-internal-pools]');
      if (el) attr = el.getAttribute('data-bl-internal-pools') || '';
    } catch (e) {}
    if (attr) {
      try {
        var parsed = JSON.parse(attr);
        if (Array.isArray(parsed)) handles = parsed.map(function (c) { return String(c.handle || c || '').trim().toLowerCase(); });
      } catch (e2) {}
    }
    if (!handles.length) {
      try {
        var listNode = document.querySelector('[data-collections], [data-bl-collections]');
        if (listNode) {
          var raw = listNode.getAttribute('data-collections') || listNode.getAttribute('data-bl-collections') || '';
          if (raw) {
            var parsedList = JSON.parse(raw);
            if (Array.isArray(parsedList)) {
              handles = parsedList.map(function (c) { return String(c.handle || '').trim().toLowerCase(); }).filter(Boolean);
            }
          }
        }
      } catch (e3) {}
    }
    return handles;
  }

  window.BL.getPoolKeyFromPage = function () {
    var ctx = readPoolContextFromDom();
    if (ctx.key) return ctx.key;

    var metafieldKey = readPoolKeyFromMetafieldNode();
    if (metafieldKey) return metafieldKey;

    var fallbackNode = null;
    try { fallbackNode = document.querySelector('[data-bl-pool-key]'); } catch (e) {}
    if (fallbackNode) {
      var fallbackKey = normalizePoolKey(fallbackNode.getAttribute('data-bl-pool-key') || '');
      if (fallbackKey) return fallbackKey;
    }

    var internalHandles = parseInternalPoolHandles();
    var productCollectionHandle = '';
    try {
      var collectionNode = document.querySelector('[data-bl-product-collection-handle]');
      if (collectionNode) productCollectionHandle = normalizePoolKey(collectionNode.getAttribute('data-bl-product-collection-handle') || '');
    } catch (e2) {}
    if (productCollectionHandle) {
      var denied = ['catalog', 'all', 'frontpage'];
      if (denied.indexOf(productCollectionHandle) === -1 && internalHandles.indexOf(productCollectionHandle) !== -1) {
        return productCollectionHandle;
      }
    }

    return null;
  };

  window.BL.getPoolTitleFromPage = function () {
    var ctx = readPoolContextFromDom();
    if (ctx.title) return ctx.title;
    return '';
  };

  window.BL.fetchPoolAllPages = function (poolKey) {
    var handle = normalizePoolKey(poolKey);
    if (!handle) return Promise.reject(new Error('Missing pool key'));

    var view = 'mystery';
    try {
      if (window.BL && window.BL.mysteryEngine && window.BL.mysteryEngine.CFG && window.BL.mysteryEngine.CFG.poolView) {
        view = window.BL.mysteryEngine.CFG.poolView;
      }
    } catch (e) {}

    function fetchPage(page) {
      var url = '/collections/' + encodeURIComponent(handle) + '?view=' + encodeURIComponent(view) + '&page=' + encodeURIComponent(page);
      return fetch(url, { credentials: 'same-origin' })
        .then(function (r) {
          if (!r.ok) throw new Error('Pool HTTP ' + r.status);
          return r.json();
        });
    }

    return fetchPage(1).then(function (first) {
      if (!first || !Array.isArray(first.products)) {
        throw new Error('Pool response missing products');
      }
      var pages = Number(first.pages || 1);
      var all = first.products.slice();
      if (pages <= 1) return all;

      var requests = [];
      for (var p = 2; p <= pages; p++) {
        requests.push(fetchPage(p));
      }
      return Promise.all(requests).then(function (rest) {
        rest.forEach(function (json) {
          if (!json || !Array.isArray(json.products)) {
            throw new Error('Pool response missing products');
          }
          all = all.concat(json.products);
        });
        return all;
      });
    });
  };
})();
