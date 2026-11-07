"use strict";
(() => {
  function t(key, params) {
    return persephone.i18n.t(key, params);
  }
  function applyI18n(root = document) {
    root.querySelectorAll("[data-i18n]").forEach(element => {
      element.textContent = t(element.dataset.i18n);
    });
    root.querySelectorAll("[data-i18n-placeholder]").forEach(element => {
      element.placeholder = t(element.dataset.i18nPlaceholder);
    });
    root.querySelectorAll("[data-i18n-title]").forEach(element => {
      element.title = t(element.dataset.i18nTitle);
    });
  }
  Object.assign(globalThis, { t, applyI18n });
})();
