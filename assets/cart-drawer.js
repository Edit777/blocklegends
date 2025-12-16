(() => {
  const global = window;

  function hasNativeCartDrawer() {
    const nativeElement = document.querySelector('cart-drawer');
    const nativeDefinition = global.customElements?.get?.('cart-drawer');
    return Boolean(nativeElement && nativeDefinition && nativeDefinition !== CartDrawerController);
  }

  class CartDrawerController {
  static init(root, options = {}) {
    if (hasNativeCartDrawer()) return null;
    if (!root) return null;
    if (CartDrawerController.instance) CartDrawerController.instance.destroy();
    CartDrawerController.instance = new CartDrawerController(root, options);
    return CartDrawerController.instance;
  }

  constructor(root, { skipInitialRefresh = false } = {}) {
    this.root = root;
    this.mapElements();
    this.bindHandlers();
    this.attachEvents();
    this.bindAddToCartForms();
    this.restartCountdownTimers();
    this.closeTimeout = null;
    this.setVisibility(this.root.classList.contains('active'));
    this.renderInitialSkeleton();
    if (!skipInitialRefresh) this.refreshCart();
  }

  mapElements() {
    this.overlay = this.root.querySelector('[data-cart-overlay]');
    this.panel = this.root.querySelector('[data-cart-panel]');
    this.closeButtons = this.root.querySelectorAll('[data-cart-close]');
    this.itemsContainer = this.root.querySelector('[data-cart-items]');
    this.emptyState = this.root.querySelector('[data-cart-empty]');
    this.emptyCollection = this.root.querySelector('[data-cart-empty-collection]');
    this.footer = this.root.querySelector('[data-cart-footer]');
    this.subtotal = this.root.querySelector('[data-cart-subtotal]');
    this.errors = this.root.querySelector('[data-cart-errors]');
    this.heading = this.root.querySelector('[data-cart-heading]');
    this.headingTemplate = this.root.dataset.cartHeadingTemplate || '';
    this.cartForm = this.root.querySelector('[data-cart-form]');
    this.noteField = this.root.querySelector('[data-cart-note]');
    this.noteContainer = this.root.querySelector('[data-cart-note-container]');
    this.updateButton = this.root.querySelector('[data-cart-update]');
    this.checkoutButton = this.root.querySelector('[data-cart-checkout]');
    this.toggleElements = Array.from(
      document.querySelectorAll('[data-cart-toggle], #cart-icon-bubble')
    );
  }

  bindHandlers() {
    this.onOverlayClick = (event) => {
      event?.stopPropagation?.();
      this.close();
    };
    this.onCloseButtonClick = (event) => {
      const closeButton = event.target.closest('[data-cart-close]');
      if (!closeButton) return;

      event.preventDefault();
      event.stopPropagation();
      this.close();
    };
    this.onDocumentClose = (event) => {
      const closeBtn = event.target.closest('[data-cart-close]');
      if (!closeBtn) return;
      event.preventDefault();
      this.close();
    };
    this.onKeyUp = (event) => {
      if (event.key === 'Escape' && this.root?.classList?.contains('active')) {
        this.close();
      }
    };
    this.onToggleClick = (event) => {
      event.preventDefault();
      this.open();
    };
    this.onSectionChange = () => {
      this.updateToggleElements();
      this.bindAddToCartForms();
    };
    this.onItemClick = (event) => {
      const removeButton = event.target.closest('[data-cart-remove]');
      if (removeButton) {
        const item = removeButton.closest('[data-cart-item]');
        if (item) this.updateItem(item.dataset.itemKey, 0);
        return;
      }

      const quantityButton = event.target.closest('[data-cart-quantity-change]');
      if (quantityButton) {
        const item = quantityButton.closest('[data-cart-item]');
        if (!item) return;
        const currentQty = Number(item.querySelector('[data-cart-quantity]')?.value || 0);
        const delta = Number(quantityButton.dataset.cartQuantityChange || 0);
        const newQty = Math.max(currentQty + delta, 0);
        this.updateItem(item.dataset.itemKey, newQty);
      }
    };
    this.onItemChange = (event) => {
      const quantityInput = event.target.closest('[data-cart-quantity]');
      if (quantityInput) {
        const item = quantityInput.closest('[data-cart-item]');
        if (!item) return;
        const newQty = Math.max(Number(quantityInput.value || 0), 0);
        this.updateItem(item.dataset.itemKey, newQty);
      }
    };
    this.onNoteChange = () => this.updateNote();
    this.onUpdateClick = (event) => {
      event.preventDefault();
      this.refreshCart();
    };
    this.onCheckoutClick = (event) => {
      event.preventDefault();
      window.location.href = '/checkout';
    };
    this.onAddToCartSubmit = (event) => {
      if (event.__cartDrawerHandled) return;
      event.__cartDrawerHandled = true;
      const form = event.target.closest('form');
      if (!form) return;
      const submitter = event.submitter || form.querySelector('[type="submit"]');
      const shouldBypass = form.dataset.cartRedirect === 'true' || form.dataset.preventDrawer === 'true';
      if (shouldBypass) return;
      event.preventDefault();
      const formData = new FormData(form);
      if (event.submitter?.name) formData.append(event.submitter.name, event.submitter.value);
      this.addItem(formData, form, submitter);
    };
  }

  attachEvents() {
    this.overlay?.addEventListener('click', this.onOverlayClick);
    this.closeButtons.forEach((btn) => btn.addEventListener('click', this.onCloseButtonClick));
    this.panel?.addEventListener('click', this.onCloseButtonClick);
    document.addEventListener('click', this.onDocumentClose, true);
    document.addEventListener('keyup', this.onKeyUp);
    this.updateToggleElements();
    this.itemsContainer?.addEventListener('click', this.onItemClick);
    this.itemsContainer?.addEventListener('change', this.onItemChange);
    this.noteField?.addEventListener('change', this.onNoteChange);
    this.updateButton?.addEventListener('click', this.onUpdateClick);
    this.checkoutButton?.addEventListener('click', this.onCheckoutClick);
    document.addEventListener('shopify:section:load', this.onSectionChange);
    document.addEventListener('shopify:section:reorder', this.onSectionChange);
  }

  detachEvents() {
    this.overlay?.removeEventListener('click', this.onOverlayClick);
    this.closeButtons.forEach((btn) => btn.removeEventListener('click', this.onCloseButtonClick));
    this.panel?.removeEventListener('click', this.onCloseButtonClick);
    document.removeEventListener('click', this.onDocumentClose, true);
    document.removeEventListener('keyup', this.onKeyUp);
    this.toggleElements.forEach((toggle) => toggle.removeEventListener('click', this.onToggleClick));
    this.itemsContainer?.removeEventListener('click', this.onItemClick);
    this.itemsContainer?.removeEventListener('change', this.onItemChange);
    this.noteField?.removeEventListener('change', this.onNoteChange);
    this.updateButton?.removeEventListener('click', this.onUpdateClick);
    this.checkoutButton?.removeEventListener('click', this.onCheckoutClick);
    this.addToCartForms?.forEach((form) => form.removeEventListener('submit', this.onAddToCartSubmit));

    if (this.delegatedSubmitListenerAttached) {
      document.removeEventListener('submit', this.onAddToCartSubmit, true);
      this.delegatedSubmitListenerAttached = false;
    }

    document.removeEventListener('shopify:section:load', this.onSectionChange);
    document.removeEventListener('shopify:section:reorder', this.onSectionChange);
  }

  updateToggleElements() {
    const newToggles = Array.from(document.querySelectorAll('[data-cart-toggle], #cart-icon-bubble'));
    const removed = this.toggleElements.filter((toggle) => !newToggles.includes(toggle));
    const added = newToggles.filter((toggle) => !this.toggleElements.includes(toggle));

    removed.forEach((toggle) => toggle.removeEventListener('click', this.onToggleClick));
    added.forEach((toggle) => toggle.addEventListener('click', this.onToggleClick));

    this.toggleElements = newToggles;
  }

  bindAddToCartForms(context = document) {
    const forms = Array.from(context.querySelectorAll('form[action*="/cart/add"]'));
    const newlyBound = [];

    forms.forEach((form) => {
      if (form.dataset.cartDrawerBound === 'true') return;
      form.dataset.cartDrawerBound = 'true';
      form.addEventListener('submit', this.onAddToCartSubmit);
      newlyBound.push(form);
    });

    this.addToCartForms = [...(this.addToCartForms || []), ...newlyBound];

    if (!this.delegatedSubmitListenerAttached) {
      document.addEventListener('submit', this.onAddToCartSubmit, true);
      this.delegatedSubmitListenerAttached = true;
    }
  }

  destroy() {
    this.detachEvents();
    this.root = null;
  }

  renderInitialSkeleton() {
    if (this.root.dataset.emptyStateInitial === 'true') {
      this.showEmptyState();
    }
  }

  async refreshCart() {
    return this.renderSection();
  }

  async renderSection() {
    const shouldStayOpen = this.root?.classList?.contains('active');
    const quantityError = this.root?.dataset.quantityError || 'Error updating cart';
    try {
      this.setLoading(true);
      const response = await fetch('/?sections=cart-drawer');
      const data = await response.json();
      const html = data['cart-drawer'];
      if (!html) throw new Error('Missing cart drawer section HTML');
      const temp = document.createElement('div');
      temp.innerHTML = html;
      const newDrawer = temp.querySelector('[data-cart-drawer]');
      if (!newDrawer) throw new Error('Cart drawer markup missing');
      const currentRoot = this.root;
      this.detachEvents();
      currentRoot?.replaceWith(newDrawer);
      this.runInlineScripts(newDrawer);
      this.root = null;
      CartDrawerController.init(newDrawer, { skipInitialRefresh: true });
      if (shouldStayOpen && CartDrawerController.instance) CartDrawerController.instance.open();
      CartDrawerController.instance?.restartCountdownTimers?.();
      this.dispatchCartEvent('cart-drawer:rendered', { reason: 'refresh' });
    } catch (error) {
      console.error(error);
      this.showError(quantityError);
    } finally {
      this.setLoading(false);
    }
  }

  async updateItem(key, quantity) {
    try {
      this.setLoading(true);
      await fetch('/cart/update.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates: { [key]: quantity } })
      });
      await this.refreshCart();
    } catch (error) {
      console.error(error);
      this.showError(this.root?.dataset.quantityError || 'Error updating cart');
    } finally {
      this.setLoading(false);
    }
  }

  async addItem(formData, form, submitter) {
    const errorMessage = this.root?.dataset.quantityError || 'Error updating cart';
    try {
      this.setLoading(true);
      this.setAddToCartState(form, true, submitter);
      const response = await fetch('/cart/add.js', {
        method: 'POST',
        headers: { Accept: 'application/json' },
        body: formData
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        const description = data?.description || data?.message;
        throw new Error(description || errorMessage);
      }

      await this.refreshCart();

      // Always open the most recent controller instance to avoid using a
      // destroyed reference after the cart section re-renders.
      CartDrawerController.instance?.open?.();
    } catch (error) {
      console.error(error);
      this.showError(error?.message || errorMessage);
      if (form) {
        const errorSummary = form.querySelector('[data-form-error]');
        if (errorSummary) errorSummary.textContent = error?.message || errorMessage;
      }
    } finally {
      this.setLoading(false);
      this.setAddToCartState(form, false, submitter);
    }
  }

  async updateNote() {
    try {
      this.setLoading(true);
      await fetch('/cart/update.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: this.noteField?.value || '' })
      });
    } catch (error) {
      console.error(error);
      this.showError(this.root?.dataset.quantityError || 'Error updating cart');
    } finally {
      this.setLoading(false);
    }
  }

  setLoading(isLoading) {
    this.root?.classList?.toggle('is-loading', Boolean(isLoading));
  }

  restartCountdownTimers() {
    const timers = this.root?.querySelectorAll('countdown-timer') || [];
    timers.forEach((timer) => {
      try {
        if (typeof timer.start === 'function') {
          timer.start();
        } else if (typeof timer.restart === 'function') {
          timer.restart();
        } else if (typeof timer.reset === 'function') {
          timer.reset();
          timer.start?.();
        } else {
          const clone = timer.cloneNode(true);
          timer.replaceWith(clone);
        }
      } catch (error) {
        console.error(error);
      }
    });
  }

  setAddToCartState(form, isLoading, submitter) {
    if (!form) return;

    const submitButton =
      submitter ||
      form.querySelector('[type="submit"][name="add"]') ||
      form.querySelector('[type="submit"][name="add-to-cart"]') ||
      form.querySelector('[type="submit"]');
    const spinner =
      submitButton?.querySelector('.loading-overlay__spinner') ||
      form.querySelector('.loading-overlay__spinner');
    const errorSummary = form.querySelector('[data-form-error]');

    if (errorSummary) errorSummary.textContent = '';
    if (!submitButton) return;

    if (isLoading) {
      submitButton.dataset.prevDisabled = submitButton.hasAttribute('disabled');
      submitButton.setAttribute('disabled', 'true');
      submitButton.classList.add('loading');
      spinner?.classList?.remove('hidden');
      submitButton.setAttribute('aria-busy', 'true');
    } else {
      submitButton.removeAttribute('aria-busy');
      submitButton.classList.remove('loading');
      if (submitButton.dataset.prevDisabled !== 'true' && submitButton.dataset.unavailable !== 'true') {
        submitButton.removeAttribute('disabled');
      }
      delete submitButton.dataset.prevDisabled;
      spinner?.classList?.add('hidden');
    }
  }

  getTransitionDuration() {
    try {
      const value = getComputedStyle(this.root).getPropertyValue('--duration-default').trim();
      if (!value) return 200;
      const numeric = Number.parseFloat(value);
      if (Number.isNaN(numeric)) return 200;
      return value.endsWith('ms') ? numeric : numeric * 1000;
    } catch (error) {
      console.error(error);
      return 200;
    }
  }

  setVisibility(isVisible) {
    if (!this.root) return;
    this.root.style.visibility = isVisible ? 'visible' : 'hidden';
  }

  showError(message) {
    if (!this.errors) return;
    this.errors.textContent = message;
  }

  clearErrors() {
    if (!this.errors) return;
    this.errors.textContent = '';
  }

  showEmptyState() {
    this.emptyState?.removeAttribute('hidden');
    this.emptyCollection?.removeAttribute('hidden');
    this.footer?.setAttribute('hidden', 'true');
  }

  hideEmptyState() {
    this.emptyState?.setAttribute('hidden', 'true');
    this.emptyCollection?.setAttribute('hidden', 'true');
  }

  runInlineScripts(container) {
    container?.querySelectorAll('script')?.forEach((oldScript) => {
      if (oldScript.src) return;
      const newScript = document.createElement('script');
      newScript.textContent = oldScript.textContent;
      oldScript.replaceWith(newScript);
    });
  }

  open() {
    clearTimeout(this.closeTimeout);
    this.setVisibility(true);
    this.root?.classList?.add('active');
    document.body.classList.add('overflow-hidden');
    this.panel?.focus();
    this.restartCountdownTimers();
  }

  close() {
    clearTimeout(this.closeTimeout);
    this.root?.classList?.remove('active');
    document.body.classList.remove('overflow-hidden');
    this.closeTimeout = setTimeout(() => this.setVisibility(false), this.getTransitionDuration());
  }

  formatMoney(value, showCurrency = false) {
    if (typeof Shopify !== 'undefined' && Shopify.formatMoney) {
      return Shopify.formatMoney(value, Shopify.money_format);
    }
    const amount = Number(value || 0) / 100;
    return showCurrency ? `$${amount.toFixed(2)}` : amount.toFixed(2);
  }

  dispatchCartEvent(name, detail = {}) {
    try {
      document.dispatchEvent(new CustomEvent(name, { detail }));
    } catch (error) {
      console.error(error);
    }
  }
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (global.__cartDrawerBootstrapped) return;
    global.__cartDrawerBootstrapped = true;

    if (hasNativeCartDrawer()) {
      console.info('[Cart Drawer] Native custom element detected; deferring to built-in behavior.');
      return;
    }
    const drawer = document.querySelector('[data-cart-drawer]');
    const toggles = document.querySelectorAll('[data-cart-toggle], #cart-icon-bubble');
    const usingCustomDrawer = Boolean(drawer);

    const nativeElement = global.customElements?.get?.('cart-drawer');
    const hasConflictingCartDrawer = Boolean(nativeElement) && nativeElement !== CartDrawerController;

    console.info(
      `[Cart Drawer] Mode: ${usingCustomDrawer ? 'Custom cart drawer active' : 'Default cart behavior (drawer markup missing)'}; ${toggles.length} toggle(s) detected. ${hasConflictingCartDrawer ? 'Native cart drawer element already registered.' : ''}`
    );

    if (drawer) CartDrawerController.init(drawer, { skipInitialRefresh: true });
  });

  async function loadDrawerMarkup() {
    const response = await fetch('/?sections=cart-drawer');
    const data = await response.json();
    const html = data['cart-drawer'];
    if (!html) throw new Error('Missing cart drawer section HTML');

    const temp = document.createElement('div');
    temp.innerHTML = html;
    const drawer = temp.querySelector('[data-cart-drawer]');
    if (!drawer) throw new Error('Cart drawer markup missing');

    temp.querySelectorAll('script').forEach((oldScript) => {
      if (oldScript.src) return;
      const newScript = document.createElement('script');
      newScript.textContent = oldScript.textContent;
      oldScript.replaceWith(newScript);
    });

    document.body.appendChild(drawer);
    return drawer;
  }

  document.addEventListener(
    'click',
    (event) => {
      if (hasNativeCartDrawer()) return;

      const toggle = event.target.closest('[data-cart-toggle], #cart-icon-bubble');
      if (!toggle || CartDrawerController.instance) return;

      const drawer = document.querySelector('[data-cart-drawer]');

      const bootstrapAndOpen = async () => {
        try {
          const targetDrawer = drawer || (await loadDrawerMarkup());
          const instance = CartDrawerController.init(targetDrawer, { skipInitialRefresh: true });
          if (!instance) return;

          event.preventDefault();
          instance.open();
          console.info('[Cart Drawer] Drawer initialized on-demand after toggle click.');
        } catch (error) {
          console.error(error);
        }
      };

      bootstrapAndOpen();
    },
    true
  );

  global.CartDrawerController = CartDrawerController;
})();
