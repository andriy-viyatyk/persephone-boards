(() => {
    const P = window.persephone;
    const t = (key, params) => P.i18n.t(key, params);
    const applyI18n = (root = document) => {
        root.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
        root.querySelectorAll("[data-i18n-title]").forEach((el) => { el.title = t(el.dataset.i18nTitle); });
        root.querySelectorAll("[data-i18n-placeholder]").forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); });
        root.querySelectorAll("[data-i18n-aria-label]").forEach((el) => { el.setAttribute("aria-label", t(el.dataset.i18nAriaLabel)); });

    };
    window.torrentT = t;
    window.torrentApplyI18n = applyI18n;
    applyI18n();
})();
