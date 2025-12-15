/* =======================================================
   BLOCK LEGENDS — INIT
   Single entrypoint for all modules
   ======================================================= */

(function () {
  window.BL = window.BL || {};

  function initAll(root) {
    root = root || document;

    if (window.BL.mysteryEngine && typeof window.BL.mysteryEngine.init === 'function') {
      window.BL.mysteryEngine.init();
    }

    if (window.BL.mysteryUI && typeof window.BL.mysteryUI.init === 'function') {
      window.BL.mysteryUI.init(root);
    }

    if (window.BL.upsells && typeof window.BL.upsells.init === 'function') {
      window.BL.upsells.init(root);
    }

    if (window.BL.mysteryAddon && typeof window.BL.mysteryAddon.init === 'function') {
      window.BL.mysteryAddon.init(root);
    }

    if (window.BL.parentUid && typeof window.BL.parentUid.init === 'function') {
      window.BL.parentUid.init();
    }

    if (window.BL.cartGuard && typeof window.BL.cartGuard.init === 'function') {
      window.BL.cartGuard.init();
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    initAll(document);
  });

  document.addEventListener('shopify:section:load', function (event) {
    initAll(event.target);
  });
})();
