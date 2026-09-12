// Force Graph board — canvas palette adapter.
//
// A canvas cannot consume `var(--p-…)`, so the 14 graph colors have to arrive as
// concrete values. In the app that is `resolveColor(color.graph.*)` over the
// `--color-graph-*` family; here it is `persephone.getTheme()` + `onThemeChange()`.
//
// EPIC-100's bridge contract adds a graph palette to the board theme payload
// (US-1404, landing in parallel with this board). We read it defensively, accepting
// any of the shapes that contract can plausibly take:
//
//   1. theme.graph.nodeDefault          — camelCase object (the contract as written)
//   2. theme.graph["node-default"]      — kebab-case object
//   3. theme.vars["--p-graph-node-default"] — the CSS `--p-graph-*` family
//   4. fallback                         — the built-in editor's own default-dark /
//                                         light-modern values, chosen by theme.isDark
//
// The fallback exists so the board renders correctly on an app build that predates the
// contract. It is a stopgap, not a design: once `getTheme().graph` ships everywhere,
// paths 1-3 win on every theme and the per-theme fidelity of all 10 themes comes back.
// Delete the fallback only when the board's minAppVersion guarantees the contract.
(() => {
    const FG = (window.FG = window.FG || {});

    // renderer key → the `--color-graph-*` / `--p-graph-*` suffix it corresponds to.
    const GRAPH_KEYS = {
        bg: "bg",
        nodeDefault: "node-default",
        nodeHighlight: "node-highlight",
        nodeSelected: "node-selected",
        borderDefault: "border-default",
        borderHighlight: "border-highlight",
        borderSelected: "border-selected",
        linkDefault: "link-default",
        linkSelected: "link-selected",
        labelBg: "label-bg",
        labelText: "label-text",
        groupBorder: "group-border",
        nodeSpecial: "node-special",
        borderSpecial: "border-special",
    };

    // Verbatim from src/renderer/theme/themes/default-dark.ts.
    const FALLBACK_DARK = {
        bg: "#1f1f1f",
        nodeDefault: "#00bfff",
        nodeHighlight: "#32cd32",
        nodeSelected: "#ffb6c1",
        borderDefault: "#00bfff",
        borderHighlight: "#228b22",
        borderSelected: "#fa8072",
        linkDefault: "#778899",
        linkSelected: "#ffb6c1",
        labelBg: "rgba(121, 121, 121, 0.2)",
        labelText: "#cccccc",
        groupBorder: "#3a6ea5",
        nodeSpecial: "#b07ce8",
        borderSpecial: "#9055c8",
    };

    // Verbatim from src/renderer/theme/themes/light-modern.ts.
    const FALLBACK_LIGHT = {
        bg: "#FFFFFF",
        nodeDefault: "#0078d4",
        nodeHighlight: "#1A7F37",
        nodeSelected: "#CF222E",
        borderDefault: "#0078d4",
        borderHighlight: "#1A7F37",
        borderSelected: "#CF222E",
        linkDefault: "#C0C0C0",
        linkSelected: "#CF222E",
        labelBg: "rgba(243, 243, 243, 0.85)",
        labelText: "#3B3B3B",
        groupBorder: "#2a5a8a",
        nodeSpecial: "#7c3aed",
        borderSpecial: "#6d28d9",
    };

    function pick(theme, key, suffix) {
        const graph = theme && theme.graph;
        if (graph && typeof graph === "object") {
            if (typeof graph[key] === "string" && graph[key]) return graph[key];
            if (typeof graph[suffix] === "string" && graph[suffix]) return graph[suffix];
        }
        const vars = (theme && theme.vars) || {};
        const cssVar = vars["--p-graph-" + suffix];
        if (typeof cssVar === "string" && cssVar) return cssVar;
        return null;
    }

    /**
     * Resolve the graph palette for a board theme payload.
     * Returns the 14 concrete colors plus `fromContract` — false while the running app
     * still lacks the `getTheme().graph` / `--p-graph-*` contract.
     */
    function resolveGraphPalette(theme) {
        const fallback = theme && theme.isDark === false ? FALLBACK_LIGHT : FALLBACK_DARK;
        const out = {};
        let fromContract = true;

        for (const [key, suffix] of Object.entries(GRAPH_KEYS)) {
            const value = pick(theme, key, suffix);
            if (value) {
                out[key] = value;
            } else {
                out[key] = fallback[key];
                fromContract = false;
            }
        }

        // The canvas always sits on the real page background, even in fallback mode —
        // a mismatched graph background is the one error that is obvious at a glance.
        const pageBg = theme && theme.vars && theme.vars["--p-bg"];
        if (!pick(theme, "bg", "bg") && pageBg) out.bg = pageBg;

        out.fromContract = fromContract;
        return out;
    }

    /**
     * Subscribe to the live palette. Calls `onPalette(palette)` immediately (the bridge's
     * onThemeChange fires once on registration) and on every theme switch.
     * Returns an unsubscribe function.
     */
    function watchGraphPalette(P, onPalette) {
        const emit = (theme) => {
            try {
                onPalette(resolveGraphPalette(theme));
            } catch (e) {
                console.error("Force Graph board: theme apply failed —", e);
            }
        };
        if (P && typeof P.onThemeChange === "function") {
            return P.onThemeChange(emit);
        }
        emit(P && typeof P.getTheme === "function" ? P.getTheme() : null);
        return () => {};
    }

    Object.assign(FG, { GRAPH_KEYS, resolveGraphPalette, watchGraphPalette });
})();
