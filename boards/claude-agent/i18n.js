(() => {
  const t = (key, params) => persephone.i18n.t(key, params);
  const applyI18n = (root = document) => {
    root.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
    // A contenteditable div shows its placeholder from data-placeholder via CSS.
    root.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
      if ("placeholder" in el) el.placeholder = t(el.dataset.i18nPlaceholder); else el.dataset.placeholder = t(el.dataset.i18nPlaceholder);
    });
    root.querySelectorAll("[data-i18n-title]").forEach((el) => { el.title = t(el.dataset.i18nTitle); });
  };
  Object.assign(globalThis, { t, applyI18n });
})();
