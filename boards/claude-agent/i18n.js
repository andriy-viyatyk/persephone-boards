(() => {
  const t = (key, params) => persephone.i18n.t(key, params);
  const applyI18n = (root = document) => {
    root.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
    root.querySelectorAll("[data-i18n-placeholder]").forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); });
    root.querySelectorAll("[data-i18n-title]").forEach((el) => { el.title = t(el.dataset.i18nTitle); });
  };
  Object.assign(globalThis, { t, applyI18n });
})();
