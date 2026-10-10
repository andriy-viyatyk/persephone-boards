"use strict";
window.forceGraphT=(k,p)=>window.persephone.i18n.t(k,p);
function applyI18n(root){const s=root||document,t=window.forceGraphT;s.querySelectorAll("[data-i18n]").forEach(e=>e.textContent=t(e.dataset.i18n));s.querySelectorAll("[data-i18n-title]").forEach(e=>e.title=t(e.dataset.i18nTitle));s.querySelectorAll("[data-i18n-aria-label]").forEach(e=>e.setAttribute("aria-label",t(e.dataset.i18nAriaLabel)));s.querySelectorAll("[data-i18n-placeholder]").forEach(e=>e.setAttribute("placeholder",t(e.dataset.i18nPlaceholder)));}
applyI18n(document);
