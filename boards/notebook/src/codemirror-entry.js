// CodeMirror bundle entry: exports the editor, language, highlighting and command APIs used locally.

export {
    Compartment,
    EditorState,
    StateEffect,
    StateField,
    Transaction,
} from "@codemirror/state";

export {
    Decoration,
    EditorView,
    keymap,
} from "@codemirror/view";

export {
    defaultKeymap,
    history,
    historyKeymap,
    indentWithTab,
} from "@codemirror/commands";

export {
    HighlightStyle,
    syntaxHighlighting,
} from "@codemirror/language";

export { javascript } from "@codemirror/lang-javascript";
export { json } from "@codemirror/lang-json";
export { markdown } from "@codemirror/lang-markdown";
export { html } from "@codemirror/lang-html";
export { css } from "@codemirror/lang-css";
export { xml } from "@codemirror/lang-xml";
export { yaml } from "@codemirror/lang-yaml";
export { sql } from "@codemirror/lang-sql";
export { tags } from "@lezer/highlight";
