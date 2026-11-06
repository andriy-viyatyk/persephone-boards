// Notebook translation helper: resolves all board UI text through Persephone's language packs.

/** Translate a board-pack message with optional interpolation parameters. */
export function translate(messageKey, parameters) {
    return window.persephone.i18n.t(messageKey, parameters);
}

/** Apply translated text, placeholders, titles and accessible labels to a DOM subtree. */
export function applyTranslations(root = document) {
    root.querySelectorAll("[data-i18n]").forEach((element) => {
        element.textContent = translate(element.dataset.i18n);
    });
    root.querySelectorAll("[data-i18n-placeholder]").forEach((element) => {
        element.placeholder = translate(element.dataset.i18nPlaceholder);
    });
    root.querySelectorAll("[data-i18n-title]").forEach((element) => {
        element.title = translate(element.dataset.i18nTitle);
    });
    root.querySelectorAll("[data-i18n-aria-label]").forEach((element) => {
        element.setAttribute("aria-label", translate(element.dataset.i18nAriaLabel));
    });
}
