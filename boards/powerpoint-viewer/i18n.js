(() => {
    const P = window.persephone;
    const t = (key, params) => P.i18n.t(key, params);
    const applyI18n = (root = document) => {
        root.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
        root.querySelectorAll("[data-i18n-title]").forEach((el) => { el.title = t(el.dataset.i18nTitle); });

    };
    window.powerpointT = t;
    window.powerpointApplyI18n = applyI18n;
    applyI18n();
})();
