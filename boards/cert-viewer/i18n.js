"use strict";
function applyI18n(root){const t=k=>window.persephone.i18n.t(k),s=root||document;s.querySelectorAll("[data-i18n]").forEach(e=>e.textContent=t(e.dataset.i18n));s.querySelectorAll("[data-i18n-title]").forEach(e=>e.title=t(e.dataset.i18nTitle));s.querySelectorAll("[data-i18n-aria-label]").forEach(e=>e.setAttribute("aria-label",t(e.dataset.i18nAriaLabel)));s.querySelectorAll("[data-i18n-placeholder]").forEach(e=>e.setAttribute("placeholder",t(e.dataset.i18nPlaceholder)));}
window.applyI18n=applyI18n;
