// CodeMirror adapter: creates local editors with syntax, search decorations and theme variables.

import {
    Compartment,
    Decoration,
    EditorState,
    EditorView,
    HighlightStyle,
    StateEffect,
    StateField,
    Transaction,
    defaultKeymap,
    history,
    historyKeymap,
    html,
    indentWithTab,
    javascript,
    json,
    keymap,
    markdown,
    sql,
    syntaxHighlighting,
    tags,
    xml,
    yaml,
    css as cssLanguage,
} from "./lib/codemirror.js";

const MAX_INLINE_EDITOR_HEIGHT = 400;
const EXTERNAL_CHANGE_ANNOTATION = "notebook.external";
const setSearchQuery = StateEffect.define();
const languageCompartment = new Compartment();
const searchQueryField = StateField.define({
    create: () => "",
    update(currentQuery, transaction) {
        for (const effect of transaction.effects) {
            if (effect.is(setSearchQuery)) {
                return effect.value;
            }
        }
        return currentQuery;
    },
});
const searchDecorationField = createSearchDecorationField();

/** Create a CodeMirror instance for one note and report user document changes. */
export function createEditor(parent, note, onDocumentChange) {
    let currentLanguage = note.content.language;
    const view = new EditorView({
        parent,
        state: EditorState.create({
            doc: note.content.content,
            extensions: [
                history(),
                keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
                languageCompartment.of(languageExtension(currentLanguage)),
                searchQueryField,
                searchDecorationField,
                editorTheme,
                syntaxHighlighting(notebookHighlightStyle),
                EditorView.lineWrapping,
                EditorView.updateListener.of((update) => {
                    if (isUserDocumentChange(update)) {
                        onDocumentChange(update.state.doc.toString());
                    }
                }),
            ],
        }),
    });
    view.dom.style.setProperty("--p-notebook-content-height", `${MAX_INLINE_EDITOR_HEIGHT}px`);

    return {
        view,
        update(updatedNote, searchText, hasPendingContentEdit) {
            updateLanguage(updatedNote.content.language);
            updateDocument(updatedNote.content.content, hasPendingContentEdit);
            view.dispatch({ effects: setSearchQuery.of(searchText || "") });
        },
        destroy() {
            view.destroy();
        },
    };

    function updateLanguage(language) {
        if (language === currentLanguage) {
            return;
        }
        currentLanguage = language;
        view.dispatch({ effects: languageCompartment.reconfigure(languageExtension(language)) });
    }

    function updateDocument(content, hasPendingContentEdit) {
        if (hasPendingContentEdit || view.state.doc.toString() === content) {
            return;
        }
        view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: content },
            annotations: [
                Transaction.userEvent.of(EXTERNAL_CHANGE_ANNOTATION),
                Transaction.addToHistory.of(false),
            ],
        });
    }
}

function createSearchDecorationField() {
    return StateField.define({
        create: (state) => buildSearchDecorations(state.doc.toString(), ""),
        update(decorations, transaction) {
            const queryEffect = transaction.effects.find((effect) => effect.is(setSearchQuery));
            if (!transaction.docChanged && !queryEffect) {
                return decorations;
            }
            const query = queryEffect
                ? queryEffect.value
                : transaction.state.field(searchQueryField);
            return buildSearchDecorations(transaction.state.doc.toString(), query);
        },
        provide: (field) => EditorView.decorations.from(field),
    });
}

function buildSearchDecorations(content, query) {
    const ranges = [];
    const lowerContent = content.toLocaleLowerCase();
    const words = String(query).toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    for (const word of words) {
        let startIndex = 0;
        while ((startIndex = lowerContent.indexOf(word, startIndex)) !== -1) {
            ranges.push({ from: startIndex, to: startIndex + word.length });
            startIndex += word.length;
        }
    }
    ranges.sort((left, right) => left.from - right.from || left.to - right.to);

    let previousEnd = -1;
    const marks = ranges
        .filter((range) => {
            if (range.from < previousEnd) {
                return false;
            }
            previousEnd = range.to;
            return true;
        })
        .map((range) => Decoration.mark({ class: "search-match" }).range(range.from, range.to));
    return Decoration.set(marks);
}

function isUserDocumentChange(update) {
    return update.docChanged && !update.transactions.some((transaction) => (
        transaction.annotation(Transaction.userEvent) === EXTERNAL_CHANGE_ANNOTATION
    ));
}

function languageExtension(language) {
    switch (language) {
        case "javascript":
            return javascript();
        case "typescript":
            return javascript({ typescript: true });
        case "javascriptreact":
        case "jsx":
            return javascript({ jsx: true });
        case "typescriptreact":
        case "tsx":
            return javascript({ jsx: true, typescript: true });
        case "json":
            return json();
        case "markdown":
            return markdown();
        case "html":
            return html();
        case "css":
            return cssLanguage();
        case "xml":
            return xml();
        case "yaml":
            return yaml();
        case "sql":
            return sql();
        default:
            return [];
    }
}

const editorTheme = EditorView.theme({
    "&": {
        backgroundColor: "var(--p-bg)",
        color: "var(--p-text)",
        height: "auto",
    },
    ".cm-content": { caretColor: "var(--p-text)" },
    ".cm-gutters": {
        backgroundColor: "var(--p-bg)",
        color: "var(--p-text-muted)",
        borderColor: "var(--p-border)",
    },
    ".search-match": {
        backgroundColor: "var(--p-warning)",
        color: "var(--p-bg)",
    },
});

const notebookHighlightStyle = HighlightStyle.define([
    { tag: tags.keyword, color: "var(--p-accent)" },
    { tag: tags.string, color: "var(--p-success)" },
    { tag: tags.number, color: "var(--p-warning)" },
    { tag: tags.function(tags.variableName), color: "var(--p-link)" },
    { tag: tags.comment, color: "var(--p-text-muted)" },
    { tag: tags.invalid, color: "var(--p-error)" },
]);
