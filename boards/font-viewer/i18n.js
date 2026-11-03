"use strict";
function applyI18n(root = document) {
    root.querySelectorAll("[data-i18n]").forEach((element) => {
        element.textContent = persephone.i18n.t(element.dataset.i18n);
    });
}
