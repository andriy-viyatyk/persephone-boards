(() => {
    const t = (key, params) => persephone.i18n.t(key, params);
    const applyI18n = (root = document) => {
        root.querySelectorAll("[data-i18n]").forEach((el) => {
            const node = Array.from(el.childNodes).find((child) => child.nodeType === Node.TEXT_NODE);
            if (node) node.nodeValue = t(el.dataset.i18n);
            else el.prepend(document.createTextNode(t(el.dataset.i18n)));
        });
        root.querySelectorAll("[data-i18n-placeholder]").forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); });
        root.querySelectorAll("[data-i18n-title]").forEach((el) => { el.title = t(el.dataset.i18nTitle); });
        root.querySelectorAll("[data-i18n-aria-label]").forEach((el) => { el.setAttribute("aria-label", t(el.dataset.i18nAriaLabel)); });
    };
    Object.assign(globalThis, { t, applyI18n });
})();
