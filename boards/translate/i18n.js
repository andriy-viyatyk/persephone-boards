"use strict";
(() => {
  const t = (key, params = {}) => persephone.i18n.t(key, params);
  document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); });
  // Icon-only buttons carry their label as a tooltip and accessible name.
  document.querySelectorAll("[data-i18n-label]").forEach((el) => { const label = t(el.dataset.i18nLabel); el.title = label; el.setAttribute("aria-label", label); });
  globalThis.t = t;
})();
