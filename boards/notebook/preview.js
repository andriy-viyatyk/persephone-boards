// Notebook Markdown preview adapter: safe rendering, links and text search marks.

const PREVIEW_OPTIONS = Object.freeze({
    gfm: true,
    breaks: false,
});
const SANITIZE_OPTIONS = Object.freeze({
    ALLOWED_TAGS: [
        "a", "abbr", "blockquote", "br", "code", "del", "em", "h1", "h2", "h3", "h4", "h5", "h6",
        "hr", "li", "ol", "p", "pre", "strong", "table", "tbody", "td", "th", "thead", "tr", "ul",
    ],
    ALLOWED_ATTR: ["align", "class", "href", "start", "title"],
    ALLOW_DATA_ATTR: false,
    ALLOW_UNKNOWN_PROTOCOLS: false,
});
const ALLOWED_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

/** Create a card-owned, sanitized Markdown preview. */
export function createPreview(host, noteId, appApi) {
    const root = document.createElement("div");
    root.className = "markdown-body";
    root.tabIndex = 0;
    root.setAttribute("aria-label", appApi.translate("notebook.previewLabel"));
    host.append(root);

    function onClick(event) {
        const anchor = event.target.closest("a");
        if (!anchor || !root.contains(anchor)) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        const destination = safeDestination(anchor.getAttribute("href"));
        if (!destination) {
            appApi.showViewNotice(appApi.translate("notebook.previewLinkUnsupported"));
            return;
        }
        try {
            const result = window.persephone.openRawLink(destination.href);
            if (result && typeof result.catch === "function") {
                result.catch(() => appApi.showViewNotice(appApi.translate("notebook.previewLinkFailed")));
            }
        } catch {
            appApi.showViewNotice(appApi.translate("notebook.previewLinkFailed"));
        }
    }

    function onDoubleClick(event) {
        if (!event.target.closest("a")) {
            appApi.switchView(noteId, "monaco");
        }
    }

    root.addEventListener("click", onClick);
    root.addEventListener("dblclick", onDoubleClick);

    return {
        root,
        update(content, searchText) {
            root.innerHTML = window.DOMPurify.sanitize(
                window.marked.parse(content, PREVIEW_OPTIONS),
                SANITIZE_OPTIONS,
            );
            root.querySelectorAll("pre code").forEach((codeBlock) => {
                try {
                    window.hljs.highlightElement(codeBlock);
                } catch {
                    // Unknown code fences remain readable as escaped text.
                }
            });
            markSearchText(root, searchText);
        },
        destroy() {
            root.removeEventListener("click", onClick);
            root.removeEventListener("dblclick", onDoubleClick);
            root.remove();
        },
    };
}

function safeDestination(value) {
    if (!value || value.startsWith("#") || value.startsWith("/") || value.startsWith(".")) {
        return null;
    }
    try {
        const destination = new URL(value);
        return ALLOWED_LINK_PROTOCOLS.has(destination.protocol) ? destination : null;
    } catch {
        return null;
    }
}

function markSearchText(root, searchText) {
    const words = String(searchText || "").trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) {
        return;
    }
    const matcher = new RegExp(`(${words.map(escapeRegExp).join("|")})`, "gi");
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    while (walker.nextNode()) {
        textNodes.push(walker.currentNode);
    }
    for (const textNode of textNodes) {
        const parent = textNode.parentElement;
        if (!parent || parent.closest("mark, script, style")) {
            continue;
        }
        const sourceText = textNode.nodeValue || "";
        matcher.lastIndex = 0;
        if (!matcher.test(sourceText)) {
            continue;
        }
        matcher.lastIndex = 0;
        const fragment = document.createDocumentFragment();
        let previousIndex = 0;
        for (const match of sourceText.matchAll(matcher)) {
            const matchIndex = match.index;
            if (matchIndex > previousIndex) {
                fragment.append(document.createTextNode(sourceText.slice(previousIndex, matchIndex)));
            }
            const mark = document.createElement("mark");
            mark.textContent = match[0];
            fragment.append(mark);
            previousIndex = matchIndex + match[0].length;
        }
        if (previousIndex < sourceText.length) {
            fragment.append(document.createTextNode(sourceText.slice(previousIndex)));
        }
        textNode.replaceWith(fragment);
    }
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
