"use strict";
(() => {
  const t = (key, params = {}) => persephone.i18n.t(key, params);
  document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); });
  globalThis.t = t;
})();
