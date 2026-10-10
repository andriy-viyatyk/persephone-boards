(() => {
    "use strict";

    applyI18n();
    const uiNumber = new Intl.NumberFormat(persephone.locale.code, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const GROUPS = [
        { name: "Backgrounds", keys: ["--color-bg-default", "--color-bg-dark", "--color-bg-light", "--color-bg-selection", "--color-bg-tree-selection", "--color-bg-scrollbar", "--color-bg-scrollbar-thumb", "--color-bg-message", "--color-bg-overlay", "--color-bg-overlay-hover", "--color-bg-webview", "--color-bg-backdrop"] },
        { name: "Text", keys: ["--color-text-default", "--color-text-dark", "--color-text-light", "--color-text-selection", "--color-text-strong"] },
        { name: "Icons", keys: ["--color-icon-default", "--color-icon-dark", "--color-icon-light", "--color-icon-disabled", "--color-icon-selection", "--color-icon-active"] },
        { name: "Borders & shadow", keys: ["--color-border-active", "--color-border-default", "--color-border-light", "--color-shadow-default"] },
        { name: "Grid", keys: ["--color-grid-header-bg", "--color-grid-header-color", "--color-grid-data-bg", "--color-grid-border", "--color-grid-data-color", "--color-grid-sel-selected", "--color-grid-sel-hovered", "--color-grid-sel-border", "--color-grid-sel-border-light"] },
        { name: "Status", keys: ["--color-misc-blue", "--color-misc-link", "--color-misc-green", "--color-misc-red", "--color-misc-yellow", "--color-misc-orange", "--color-misc-vlc", "--color-error-bg", "--color-error-text", "--color-error-border", "--color-error-text-hover", "--color-success-bg", "--color-success-text", "--color-success-border", "--color-success-text-hover", "--color-primary-bg", "--color-primary-text", "--color-primary-border", "--color-primary-text-hover", "--color-warning-bg", "--color-warning-text", "--color-warning-border", "--color-warning-text-hover"] },
        { name: "Editor", keys: ["--color-highlight-active-match", "--color-minimap-bg", "--color-minimap-hover-bg", "--color-minimap-active-bg"], monaco: true },
        { name: "Graph", keys: ["--color-graph-bg", "--color-graph-node-default", "--color-graph-node-highlight", "--color-graph-node-selected", "--color-graph-border-default", "--color-graph-border-highlight", "--color-graph-border-selected", "--color-graph-link-default", "--color-graph-link-selected", "--color-graph-label-bg", "--color-graph-label-text", "--color-graph-group-border", "--color-graph-node-special", "--color-graph-border-special"] },
    ];
    const MONACO_KEYS = ["editor.background", "menu.background", "menu.foreground", "menu.selectionBackground", "menu.selectionForeground", "menu.separatorBackground", "menu.border"];
    const BASE_FIELDS = [
        { key: "background", label: "Background", required: true },
        { key: "text", label: "Text", required: true },
        { key: "accent", label: "Accent", required: true },
        { key: "link", label: "Link" },
        { key: "error", label: "theme.contrast.label.error" },
        { key: "warning", label: "theme.contrast.label.warning" },
        { key: "success", label: "theme.contrast.label.success" },
    ];
    const CONTRAST_LABELS = {
        "text-default/bg-default": "theme.contrast.label.textDefault",
        "text-light/bg-default": "theme.contrast.label.textLight",
        "text-strong/bg-default": "theme.contrast.label.textStrong",
        "text-selection/bg-selection": "theme.contrast.label.selection",
        "text-selection/bg-tree-selection": "theme.contrast.label.treeSelection",
        "grid-header-color/grid-header-bg": "theme.contrast.label.gridHeader",
        "grid-data-color/grid-data-bg": "theme.contrast.label.gridData",
        "graph-label-text/graph-label-bg": "theme.contrast.label.graphLabel",
        "misc-link/bg-default": "theme.contrast.label.link",
        "error-text/error-bg": "Error",
        "success-text/success-bg": "Success",
        "warning-text/warning-bg": "Warning",
        "primary-text/primary-bg": "theme.contrast.label.primary",
        "primary-text-hover/primary-bg": "theme.contrast.label.primaryHover",
        "error-text-hover/error-bg": "theme.contrast.label.errorHover",
        "success-text-hover/success-bg": "theme.contrast.label.successHover",
        "warning-text-hover/warning-bg": "theme.contrast.label.warningHover",
    };
    const GENERATOR_BLOCKS = [
        { key: "background", label: "Background", required: true, strip: ["--color-bg-default", "--color-bg-dark", "--color-bg-light", "--color-bg-scrollbar", "--color-bg-message", "--color-bg-overlay", "--color-bg-overlay-hover", "--color-bg-webview", "--color-bg-backdrop", "--color-grid-header-bg", "--color-grid-data-bg", "--color-graph-bg", "--color-border-default", "--color-border-light", "--color-grid-sel-border-light", "--color-icon-disabled", "--color-highlight-active-match", "--color-error-bg", "--color-error-border", "--color-success-bg", "--color-success-border", "--color-warning-bg", "--color-warning-border", "--color-primary-bg", "--color-primary-border"] },
        { key: "text", label: "Text", required: true, strip: ["--color-text-default", "--color-text-dark", "--color-text-light", "--color-text-strong", "--color-icon-default", "--color-icon-dark", "--color-icon-light", "--color-bg-scrollbar-thumb", "--color-minimap-bg", "--color-minimap-hover-bg", "--color-grid-header-color", "--color-grid-data-color", "--color-graph-label-bg", "--color-graph-label-text", "--color-graph-link-default"], contrast: "text-default/bg-default" },
        { key: "accent", label: "Accent", required: true, strip: ["--color-bg-selection", "--color-bg-tree-selection", "--color-border-active", "--color-icon-active", "--color-misc-blue", "--color-grid-sel-selected", "--color-grid-sel-hovered", "--color-grid-sel-border", "--color-minimap-active-bg", "--color-primary-text", "--color-primary-text-hover", "--color-graph-node-highlight", "--color-graph-border-highlight", "--color-graph-group-border"] },
        { key: "link", label: "Link", strip: ["--color-misc-link"] },
        { key: "error", label: "Error", strip: ["--color-error-text", "--color-error-text-hover"] },
        { key: "warning", label: "Warning", strip: ["--color-warning-text", "--color-warning-text-hover"] },
        { key: "success", label: "Success", strip: ["--color-success-text", "--color-success-text-hover"] },
    ];
    const REQUIRED_RANDOM_PAIRS = ["text-default/bg-default", "text-selection/bg-selection", "primary-text/primary-bg", "misc-link/bg-default"];
    const REQUIRED_RANDOM_PAIR_COUNT = REQUIRED_RANDOM_PAIRS.length;
    const $ = (selector) => document.querySelector(selector);
    const ui = {
        base: $("#base-controls"),
        groups: $("#palette-groups"), contrast: $("#contrast-list"), message: $("#message"),
        mode: $("#mode-indicator"),
        active: $("#active-theme"), deleteDialog: $("#delete-dialog"), renameDialog: $("#rename-dialog"),
        intentDialog: $("#intent-dialog"),
        clearOverrides: $("#clear-overrides"), deleteCopy: $("#delete-copy"), renameInput: $("#rename-input"), renameTitle: $("#rename-title"), renameConfirm: $("#confirm-rename"), importFile: $("#import-file"), importDialog: $("#import-dialog"), chooseImportFile: $("#choose-import-file"),
        generator: $("#generator-blocks"), generatorMessage: $("#generator-message"), generateButtons: [$("#generate-dark"), $("#generate-light")],
        overrideNotice: $("#override-notice"), overrideNoticeText: $("#override-notice-text"), generatorClearOverrides: $("#generator-clear-overrides"),
        startingPalette: $('[aria-labelledby="starting-heading"]'),
        setStatus: $("#set-status"), setModeButtons: [...document.querySelectorAll("#set-mode button")], setTiles: $("#set-tiles"), setRegenerate: $("#set-regenerate"),
    };
    const state = {
        themes: [], current: null, draft: null, baseline: null, sourceId: null,
        sourceKind: "new", derived: null, displayed: null, contrast: null,
        hasPreview: false, previewSuperseded: false, lastPreviewId: null,
        lastPreviewSignature: "",
        dirty: false, busy: false, externalTimer: 0, externalRefreshPromise: Promise.resolve(), operation: 0, previewGeneration: 0,
        previewTimer: 0, previewResolve: null, previewChain: Promise.resolve(),
        unlistenTheme: null, locks: {}, view: "generator", nameDialogMode: "rename",
        generatedSet: null, selectedSetIndex: null, generatingSet: false, setMode: "both",
        pageModified: false, persistTimer: 0, restoredDraft: false, intentPending: 0,
        // Override keys holding the opened theme's exact colors (not set by hand in Details). The
        // board opens with them as-is; the first generator change releases them all.
        sourceExact: new Set(),
    };
    let initializationPromise;
    let intentQueue = Promise.resolve();

    function clone(value) { return JSON.parse(JSON.stringify(value)); }
    function clamp(value, min, max) { return Math.max(min, Math.min(max, Math.round(value))); }
    function normalizeHue(value) { return ((Math.round(value) % 360) + 360) % 360; }
    function hslToHex(hue, saturation, lightness) {
        const h = normalizeHue(hue) / 360;
        const s = clamp(saturation, 0, 100) / 100;
        const l = clamp(lightness, 0, 100) / 100;
        const hueToRgb = (p, q, t) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1 / 6) return p + (q - p) * 6 * t;
            if (t < 1 / 2) return q;
            if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
            return p;
        };
        let r, g, b;
        if (!s) r = g = b = l;
        else {
            const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
            const p = 2 * l - q;
            r = hueToRgb(p, q, h + 1 / 3);
            g = hueToRgb(p, q, h);
            b = hueToRgb(p, q, h - 1 / 3);
        }
        return `#${[r, g, b].map((channel) => Math.round(channel * 255).toString(16).padStart(2, "0")).join("")}`;
    }
    function colorToHsl(value) {
        if (!parseableColor(value)) return { h: 0, s: 0, l: 50 };
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 1;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) return { h: 0, s: 0, l: 50 };
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = "#000000";
        context.fillStyle = value;
        context.fillRect(0, 0, 1, 1);
        // Array.from: mapping the Uint8ClampedArray itself would round every channel back to 0 or 1.
        const [red, green, blue] = Array.from(context.getImageData(0, 0, 1, 1).data.slice(0, 3), (channel) => channel / 255);
        const max = Math.max(red, green, blue), min = Math.min(red, green, blue);
        const delta = max - min;
        const lightness = (max + min) / 2;
        let hue = 0, saturation = 0;
        if (delta) {
            saturation = delta / (1 - Math.abs(2 * lightness - 1));
            if (max === red) hue = ((green - blue) / delta) % 6;
            else if (max === green) hue = (blue - red) / delta + 2;
            else hue = (red - green) / delta + 4;
            hue *= 60;
        }
        return { h: normalizeHue(hue), s: clamp(saturation * 100, 0, 100), l: clamp(lightness * 100, 0, 100) };
    }
    function stripColor(key) {
        return state.derived?.colors?.[key] || "";
    }
    function generatorInputValue(block) {
        const baseValue = state.draft?.base?.[block.key];
        if (baseValue) return baseValue;
        const fallback = block.key === "link" ? "--color-misc-link" : `--color-${block.key}-text`;
        return stripColor(fallback) || "#808080";
    }
    function makeGeneratorBlock(block) {
        const card = document.createElement("section");
        card.className = "generator-block";
        card.dataset.block = block.key;
        card.dataset.name = `generator-block-${block.key}`;
        const heading = document.createElement("div");
        heading.className = "generator-block-heading";
        const title = document.createElement("h2");
        title.textContent = t(`theme.base.${block.key}`);
        const actions = document.createElement("div");
        actions.className = "generator-actions";
        const reroll = document.createElement("button");
        reroll.type = "button";
        reroll.className = "p-btn sm";
        reroll.textContent = t("theme.reroll");
        reroll.dataset.name = `reroll-${block.key}`;
        reroll.setAttribute("aria-label", t("theme.reroll.aria", { block: t(`theme.base.${block.key}`) }));
        const lock = document.createElement("button");
        lock.type = "button";
        lock.className = "p-btn sm lock-button";
        lock.textContent = t("theme.lock.unlocked");
        lock.dataset.name = `lock-${block.key}`;
        lock.setAttribute("aria-pressed", "false");
        lock.setAttribute("aria-label", t("theme.lock.aria", { action: t("theme.lock.lock"), block: t(`theme.base.${block.key}`) }));
        actions.append(reroll, lock);
        heading.append(title, actions);
        const controls = document.createElement("div");
        controls.className = "generator-controls";
        const colorRow = document.createElement("div");
        colorRow.className = "generator-color-row";
        const picker = document.createElement("input");
        picker.type = "color";
        picker.className = "generator-color-well";
        picker.dataset.role = "picker";
        picker.dataset.name = `generator-${block.key}-well`;
        picker.setAttribute("aria-label", t("theme.picker.aria", { block: t(`theme.base.${block.key}`) }));
        const hex = document.createElement("input");
        hex.type = "text";
        hex.className = "p-input sm generator-hex";
        hex.dataset.role = "hex";
        hex.dataset.name = `generator-${block.key}-hex`;
        hex.setAttribute("aria-label", t("theme.cssColor.aria", { block: t(`theme.base.${block.key}`) }));
        hex.autocomplete = "off";
        colorRow.append(picker, hex);
        controls.append(colorRow);
        const sliders = document.createElement("div");
        sliders.className = "hsl-controls";
        for (const [component, max] of [["h", 360], ["s", 100], ["l", 100]]) {
            const row = document.createElement("label");
            row.className = "hsl-row";
            const label = document.createElement("span");
            label.textContent = t(`theme.color.${{ h: "hue", s: "saturation", l: "lightness" }[component]}`);
            const range = document.createElement("input");
            range.type = "range";
            range.min = "0";
            range.max = String(max);
            range.step = "1";
            range.dataset.role = `hsl-${component}`;
            range.dataset.name = `generator-${block.key}-${component}`;
            range.setAttribute("aria-label", t("theme.color.componentAria", { block: t(`theme.base.${block.key}`), component: t(`theme.color.${{ h: "hue", s: "saturation", l: "lightness" }[component]}`) }));
            const output = document.createElement("output");
            output.dataset.role = `value-${component}`;
            output.textContent = "0";
            row.append(label, range, output);
            sliders.append(row);
            range.addEventListener("input", () => {
                output.textContent = range.value;
                const values = [...sliders.querySelectorAll("input[type=range]")].map((input) => Number(input.value));
                setGeneratorColor(block, hslToHex(...values));
            });
        }
        controls.append(sliders);
        if (block.key === "background") {
            const mode = document.createElement("div");
            mode.className = "generator-mode";
            mode.dataset.name = "generator-background-mode";
            for (const [value, text] of [["auto", "theme.mode.auto"], ["dark", "theme.mode.dark"], ["light", "theme.mode.light"]]) {
                const button = document.createElement("button");
                button.type = "button";
                button.textContent = t(text);
                button.dataset.mode = value;
                button.setAttribute("aria-pressed", "false");
                button.addEventListener("click", () => {
                    mutateMode(value);
                });
                mode.append(button);
            }
            controls.append(mode);
        } else if (!block.required) {
            const stateLabel = document.createElement("label");
            stateLabel.className = "semantic-state";
            stateLabel.textContent = t("theme.colorSource");
            const select = document.createElement("select");
            select.className = "p-select sm";
            select.dataset.role = "semantic-state";
            select.dataset.name = `generator-${block.key}-state`;
            select.setAttribute("aria-label", t("theme.colorSource.aria", { block: t(`theme.base.${block.key}`) }));
            select.innerHTML = `<option value="auto">${t("theme.source.auto")}</option><option value="custom">${t("theme.source.custom")}</option>`;
            select.addEventListener("change", () => {
                if (select.value === "auto") mutateBaseColor(block.key, null);
                else mutateBaseColor(block.key, hex.value.trim() || generatorInputValue(block));
                syncGeneratorControls();
            });
            stateLabel.append(select);
            controls.append(stateLabel);
        }
        const strip = document.createElement("div");
        strip.className = "generator-strip";
        strip.dataset.name = `generator-strip-${block.key}`;
        const stripTitle = document.createElement("h3");
        stripTitle.textContent = t("theme.derivedColors");
        strip.append(stripTitle);
        const tokens = document.createElement("div");
        tokens.className = "generator-tokens";
        for (const key of block.strip) {
            const token = document.createElement("div");
            token.className = "generator-token";
            token.dataset.key = key;
            token.dataset.name = `strip-${key.replaceAll(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "")}`;
            const swatch = document.createElement("span");
            swatch.className = "generator-token-swatch";
            swatch.setAttribute("aria-label", t("theme.swatch.derived", { key }));
            const label = document.createElement("span");
            label.className = "generator-token-label";
            label.textContent = key.replace(/^--color-/, "");
            label.title = key;
            const pin = document.createElement("span");
            pin.className = "pinned-marker";
            pin.textContent = t("theme.override.pinned");
            pin.hidden = true;
            token.append(swatch, label, pin);
            tokens.append(token);
        }
        strip.append(tokens);
        card.append(heading, controls, strip);
        reroll.addEventListener("click", () => { void randomize([block.key]); });
        lock.addEventListener("click", () => setBlockLock(block.key, !state.locks[block.key]));
        picker.addEventListener("input", () => setGeneratorColor(block, picker.value));
        hex.addEventListener("input", () => {
            const valid = parseableColor(hex.value.trim());
            hex.setAttribute("aria-invalid", hex.value && !valid ? "true" : "false");
            if (valid) setGeneratorColor(block, hex.value.trim());
            else {
                ui.generatorMessage.textContent = t("theme.error.invalidCssColor", { block: t(`theme.base.${block.key}`) });
                ui.generatorMessage.hidden = false;
            }
        });
        ui.generator.append(card);
        return card;
    }
    function makeGeneratorBlocks() {
        ui.generator.replaceChildren();
        for (const block of GENERATOR_BLOCKS) makeGeneratorBlock(block);
    }
    function setGeneratorColor(block, value) {
        if (!state.draft || !parseableColor(value)) return;
        mutateBaseColor(block.key, value, { syncControls: false });
        if (!block.required) {
            const select = ui.generator.querySelector(`[data-block="${block.key}"] [data-role="semantic-state"]`);
            if (select) select.value = "custom";
        }
        syncGeneratorControls();
        ui.generatorMessage.hidden = true;
    }
    function setBlockLock(key, locked) {
        if (!GENERATOR_BLOCKS.some((block) => block.key === key)) {
            throw new Error(`Unknown generator block "${key}". Allowed blocks: ${GENERATOR_BLOCKS.map((block) => block.key).join(", ")}.`);
        }
        state.locks[key] = locked;
        const button = ui.generator.querySelector(`[data-block="${key}"] .lock-button`);
        if (!button) return;
        button.textContent = t(locked ? "theme.lock.locked" : "theme.lock.unlocked");
        button.classList.toggle("locked", locked);
        button.setAttribute("aria-pressed", String(locked));
        button.setAttribute("aria-label", t("theme.lock.aria", { action: t(locked ? "theme.lock.unlock" : "theme.lock.lock"), block: GENERATOR_BLOCKS.find((block) => block.key === key).label }));
        for (const button of ui.generateButtons) button.disabled = state.busy || GENERATOR_BLOCKS.slice(0, 3).every((block) => state.locks[block.key]);
    }
    function syncGeneratorControls() {
        if (!state.draft) return;
        for (const block of GENERATOR_BLOCKS) {
            const card = ui.generator.querySelector(`[data-block="${block.key}"]`);
            if (!card) continue;
            const value = generatorInputValue(block);
            const hex = card.querySelector('[data-role="hex"]');
            const picker = card.querySelector('[data-role="picker"]');
            if (document.activeElement !== hex) hex.value = value;
            hex.setAttribute("aria-invalid", parseableColor(value) ? "false" : "true");
            picker.value = colorPickerValue(value);
            const hsl = colorToHsl(value);
            for (const component of ["h", "s", "l"]) {
                const range = card.querySelector(`[data-role="hsl-${component}"]`);
                const output = card.querySelector(`[data-role="value-${component}"]`);
                if (document.activeElement !== range) range.value = hsl[component];
                output.textContent = String(hsl[component]);
            }
            const semantic = card.querySelector('[data-role="semantic-state"]');
            if (semantic) semantic.value = state.draft.base[block.key] ? "custom" : "auto";
            for (const token of card.querySelectorAll(".generator-token")) {
                const key = token.dataset.key;
                const derived = stripColor(key);
                token.querySelector(".generator-token-swatch").style.backgroundColor = derived || "transparent";
                const handSet = Object.hasOwn(state.draft.overrides, key) && !state.sourceExact.has(key);
                token.classList.toggle("pinned", handSet);
                token.querySelector(".pinned-marker").hidden = !handSet;
            }
            if (block.contrast) {
                const item = state.contrast?.[block.contrast];
                let badge = card.querySelector(".generator-contrast");
                if (!badge) {
                    badge = document.createElement("div");
                    badge.className = "generator-contrast";
                    card.querySelector(".generator-strip").prepend(badge);
                }
                badge.textContent = item ? t("theme.contrast.summary", { ratio: uiNumber.format(Number(item.ratio)), result: t(item.meetsAA ? "theme.contrast.aa" : "theme.contrast.fail") }) : t("theme.contrast.pending");
                badge.classList.toggle("pass", !!item?.meetsAA);
            }
        }
        for (const button of ui.generator.querySelectorAll(".generator-mode button")) {
            const selected = (state.draft.isDark === null && button.dataset.mode === "auto") ||
                (state.draft.isDark === true && button.dataset.mode === "dark") ||
                (state.draft.isDark === false && button.dataset.mode === "light");
            button.setAttribute("aria-pressed", String(selected));
        }
        const handSetCount = Object.keys(state.draft.overrides).filter((key) => !state.sourceExact.has(key)).length;
        ui.overrideNotice.hidden = handSetCount === 0;
        ui.overrideNoticeText.textContent = t("theme.override.notice", { count: handSetCount });
        for (const button of ui.generateButtons) button.disabled = state.busy || GENERATOR_BLOCKS.slice(0, 3).every((block) => state.locks[block.key]);
    }
    function setView(view) {
        if (view !== "set" && view !== "generator" && view !== "details") throw new Error('Unknown view. Allowed values: "set", "generator", "details".');
        state.view = view;
        for (const button of document.querySelectorAll(".view-tab")) button.setAttribute("aria-selected", String(button.dataset.view === view));
        for (const panel of document.querySelectorAll("[data-view-panel]")) panel.hidden = panel.dataset.viewPanel !== view;
        // Generator and Set replace the sidebar's base-color controls; Contrast remains visible.
        ui.startingPalette.hidden = view !== "details";
        if (view === "set") void ensureGeneratedSet().catch((error) => reportError(error, t("theme.error.generate")));
    }
    function setGeneratedView() { setView("set"); return ensureGeneratedSet(); }
    function randomBetween(min, max, random = Math.random) { return min + random() * (max - min); }
    function randomInt(min, max, random = Math.random) { return Math.floor(randomBetween(min, max + 1, random)); }
    function randomBaseColor(hue, saturationRange, lightnessRange, random = Math.random) {
        return hslToHex(hue, randomBetween(...saturationRange, random), randomBetween(...lightnessRange, random));
    }
    function activeDark(draft = state.draft) {
        if (draft.isDark !== null) return draft.isDark;
        return state.derived?.isDark ?? true;
    }
    // Backgrounds are muted (8–20% saturation) so text reads calmly on them; at that strength red and
    // orange read as brown. One Generate click in VIVID_BACKGROUND_CHANCE picks a strongly colored
    // background instead (a deep red, blue or green; a pastel tint in light mode).
    const VIVID_BACKGROUND_CHANCE = 0.2;
    const MUTED_BACKGROUND_SATURATION = [8, 20];
    const VIVID_BACKGROUND_SATURATION = [40, 70];
    function makeRandomCandidate(source, keys, random = Math.random, mode, vividBackground = false) {
        const candidate = clone(source);
        const randomizeBackground = keys.includes("background") && !state.locks.background;
        // An explicit mode (Generate dark/light) wins over the draft's mode; the result goes to Auto so
        // Persephone infers dark or light from the generated background.
        if (mode) candidate.isDark = null;
        const bgModeDark = mode ? mode === "dark" : candidate.isDark === null
            ? (randomizeBackground ? random() < 0.5 : activeDark(candidate))
            : candidate.isDark;
        if (randomizeBackground) {
            const hue = randomInt(0, 359, random);
            const saturation = vividBackground ? VIVID_BACKGROUND_SATURATION : MUTED_BACKGROUND_SATURATION;
            candidate.base.background = randomBaseColor(hue, saturation, bgModeDark ? [10, 22] : [88, 96], random);
        }
        const backgroundHsl = colorToHsl(candidate.base.background);
        const dark = mode ? mode === "dark" : candidate.isDark === null ? bgModeDark : candidate.isDark;
        if (keys.includes("text") && !state.locks.text) {
            candidate.base.text = randomBaseColor(backgroundHsl.h, [0, 10], dark ? [88, 96] : [6, 16], random);
        }
        if (keys.includes("accent") && !state.locks.accent) {
            const harmony = [180, 120, -120, randomBetween(20, 35, random), -randomBetween(20, 35, random)][randomInt(0, 4, random)];
            candidate.base.accent = randomBaseColor(backgroundHsl.h + harmony, [65, 90], dark ? [42, 68] : [34, 58], random);
        }
        for (const key of keys.filter((item) => !["background", "text", "accent"].includes(item))) {
            const block = GENERATOR_BLOCKS.find((item) => item.key === key);
            if (block && Object.hasOwn(candidate.base, key) && !state.locks[key]) {
                const hue = randomInt(0, 359, random);
                candidate.base[key] = randomBaseColor(hue, [55, 85], dark ? [42, 72] : [30, 60], random);
            }
        }
        if (candidate.isDark === null) candidate.isDark = null;
        return candidate;
    }
    function rankContrast(report) {
        const results = REQUIRED_RANDOM_PAIRS.map((key) => report?.[key]).filter(Boolean);
        return {
            passes: results.filter((item) => item.meetsAA).length,
            lowest: results.length ? Math.min(...results.map((item) => Number(item.ratio) || 0)) : 0,
            complete: results.length === REQUIRED_RANDOM_PAIR_COUNT,
        };
    }
    function seededRandom(seed) {
        let value = typeof seed === "number" ? seed >>> 0 : 2166136261;
        if (typeof seed !== "number") {
            for (const character of String(seed)) value = Math.imul(value ^ character.charCodeAt(0), 16777619) >>> 0;
        }
        return () => {
            value += 0x6D2B79F5;
            let result = value;
            result = Math.imul(result ^ (result >>> 15), result | 1);
            result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
            return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
        };
    }
    function generatorSource() {
        const source = clone(state.draft);
        for (const key of state.sourceExact) delete source.overrides[key];
        return source;
    }
    function clearSetSelection() {
        state.selectedSetIndex = null;
        for (const tile of ui.setTiles.querySelectorAll(".set-tile")) tile.setAttribute("aria-pressed", "false");
    }
    function selectSetTile(index) {
        state.selectedSetIndex = index;
        for (const tile of ui.setTiles.querySelectorAll(".set-tile")) tile.setAttribute("aria-pressed", String(Number(tile.dataset.index) === index));
    }
    async function applyGeneratedDraft(candidate, { polarity = candidate.isDark, selectedIndex = null, allowBusy = false } = {}) {
        if (!state.draft) throw new Error("The theme draft is not ready.");
        if (state.busy && !allowBusy) throw new Error("Theme Editor is busy with another operation; try again when it finishes.");
        releaseSourceExact();
        clearSetSelection();
        state.draft.base = clone(candidate.base);
        if (typeof polarity === "boolean") state.draft.isDark = polarity;
        else state.draft.isDark = candidate.isDark;
        setPolarity();
        syncGeneratorControls();
        onDraftChanged();
        if (selectedIndex !== null) selectSetTile(selectedIndex);
        await queueDraftRefresh();
    }
    function effectiveVariantColors(derived, draft) {
        const colors = { ...(derived?.colors || {}) };
        for (const [key, value] of Object.entries(draft.overrides || {})) {
            if (key.startsWith("--color-") && !state.sourceExact.has(key)) colors[key] = value;
        }
        return colors;
    }
    function makeSetTile(variant, index) {
        const tile = document.createElement("button");
        tile.type = "button";
        tile.className = "set-tile";
        tile.dataset.index = String(index);
        tile.dataset.name = `set-tile-${index + 1}`;
        tile.setAttribute("aria-pressed", String(index === state.selectedSetIndex));
        tile.setAttribute("aria-label", t("theme.variant.aria", { index: new Intl.NumberFormat(persephone.locale.code).format(index + 1), mode: t(variant.isDark ? "theme.mode.dark" : "theme.mode.light") }));
        const mock = document.createElement("span");
        mock.className = "mini-window";
        mock.setAttribute("aria-hidden", "true");
        const c = variant.colors;
        mock.style.setProperty("--tile-bg", c["--color-bg-default"] || "#ffffff");
        mock.style.setProperty("--tile-title", c["--color-bg-dark"] || c["--color-bg-default"] || "#333333");
        mock.style.setProperty("--tile-title-text", c["--color-text-strong"] || c["--color-text-default"] || "#ffffff");
        mock.style.setProperty("--tile-toolbar", c["--color-bg-light"] || c["--color-bg-default"] || "#eeeeee");
        mock.style.setProperty("--tile-text", c["--color-text-default"] || "#222222");
        mock.style.setProperty("--tile-muted", c["--color-text-light"] || c["--color-text-default"] || "#777777");
        mock.style.setProperty("--tile-border", c["--color-border-default"] || "#999999");
        mock.style.setProperty("--tile-border-light", c["--color-border-light"] || c["--color-border-default"] || "#cccccc");
        mock.style.setProperty("--tile-primary", c["--color-primary-bg"] || "#336699");
        mock.style.setProperty("--tile-primary-text", c["--color-primary-text"] || "#ffffff");
        mock.style.setProperty("--tile-selection", c["--color-bg-selection"] || "transparent");
        mock.style.setProperty("--tile-selection-text", c["--color-text-selection"] || c["--color-text-default"] || "#222222");
        mock.innerHTML = `<span class="mini-title"><i></i><i></i><i></i><b>${t("theme.mini.theme")}</b></span><span class="mini-toolbar"><i></i><i></i><i></i></span><span class="mini-content"><b>${t("theme.mini.heading")}</b><i class="mini-line"></i><i class="mini-line short"></i><span class="mini-selection">${t("theme.mini.selected")}</span><span class="mini-accent">${t("theme.mini.action")}</span><small>${t("theme.mini.helper")}</small></span>`;
        const caption = document.createElement("span");
        caption.className = "set-caption";
        caption.textContent = t("theme.variant.caption", { index: new Intl.NumberFormat(persephone.locale.code).format(index + 1), mode: t(variant.isDark ? "theme.mode.dark" : "theme.mode.light") });
        tile.append(mock, caption);
        return tile;
    }
    function renderGeneratedSet() {
        const fragment = document.createDocumentFragment();
        state.generatedSet.forEach((variant, index) => {
            const currentColors = effectiveVariantColors({ colors: variant.derivedColors }, state.draft);
            fragment.append(makeSetTile({ ...variant, colors: currentColors }, index));
        });
        ui.setTiles.replaceChildren(fragment);
    }
    // "both" picks dark or light per variant, so the set mixes them whatever the draft's mode. A locked
    // Background fixes the polarity, so the switch then has no effect.
    function variantMode(random) {
        if (state.locks.background) return undefined;
        if (state.setMode === "both") return random() < 0.5 ? "dark" : "light";
        return state.setMode;
    }
    function setGeneratedSetMode(mode) {
        if (!["both", "dark", "light"].includes(mode)) throw new Error('Unknown set mode. Allowed values: "both", "dark", "light".');
        state.setMode = mode;
        for (const button of ui.setModeButtons) button.setAttribute("aria-pressed", String(button.dataset.mode === mode));
        return ensureGeneratedSet(true);
    }
    async function ensureGeneratedSet(force = false) {
        if (state.generatingSet) return state.setPromise;
        if (state.generatedSet && !force) return state.generatedSet;
        if (!state.draft) return null;
        state.generatingSet = true;
        state.generatedSet = null;
        clearSetSelection();
        markBusy(true);
        const startedAt = performance.now();
        const source = generatorSource();
        const keys = GENERATOR_BLOCKS.map((block) => block.key);
        const variants = [];
        ui.setTiles.replaceChildren();
        ui.setStatus.textContent = t("theme.set.generating", { count: new Intl.NumberFormat(persephone.locale.code).format(0) });
        ui.setRegenerate.disabled = true;
        for (const button of ui.setModeButtons) button.disabled = true;
        try {
            state.setPromise = (async () => {
                for (let start = 0; start < 100; start += 15) {
                    const batch = Array.from({ length: Math.min(15, 100 - start) }, async (_, offset) => {
                        const random = Math.random;
                        let best = null, bestReport = null, bestRank = null, chosenMode = null;
                        const vividBackground = random() < VIVID_BACKGROUND_CHANCE;
                        for (let attempt = 0; attempt < 2; attempt++) {
                            const candidate = makeRandomCandidate(source, keys, random, variantMode(random), vividBackground);
                            const report = await persephone.themes.contrast(candidate);
                            const rank = rankContrast(report);
                            if (!bestRank || rank.passes > bestRank.passes || (rank.passes === bestRank.passes && rank.lowest > bestRank.lowest)) {
                                best = candidate; bestReport = report; bestRank = rank;
                            }
                            if (rank.complete && rank.passes === REQUIRED_RANDOM_PAIR_COUNT) break;
                        }
                        const backgroundHsl = colorToHsl(best.base.background);
                        const inferredDark = best.isDark === null ? backgroundHsl.l < 50 : best.isDark;
                        const derived = await persephone.themes.derive(best.base, inferredDark);
                        chosenMode = derived?.isDark ?? inferredDark;
                        return { draft: best, contrast: bestReport, rank: bestRank, isDark: chosenMode, derivedColors: derived?.colors || {}, hue: backgroundHsl.h, lightness: backgroundHsl.l };
                    });
                    variants.push(...await Promise.all(batch));
                    ui.setStatus.textContent = t("theme.set.generating", { count: new Intl.NumberFormat(persephone.locale.code).format(variants.length) });
                }
                // The hue wheel wraps: crimson and rose (330–359°) look red, so they lead the set with red;
                // the set then runs orange, yellow, green, cyan, blue and ends on violet/magenta (to 329°).
                const hueOrder = (hue) => (hue + 30) % 360;
                variants.sort((a, b) => hueOrder(a.hue) - hueOrder(b.hue) || a.lightness - b.lightness);
                state.generatedSet = variants;
                renderGeneratedSet();
                const duration = ((performance.now() - startedAt) / 1000).toFixed(2);
                ui.setStatus.textContent = t("theme.set.ready", { seconds: uiNumber.format(duration) });
                return variants;
            })();
            return await state.setPromise;
        } catch (error) {
            ui.setStatus.textContent = t("theme.set.failed");
            throw error;
        } finally {
            state.generatingSet = false;
            markBusy(false);
            ui.setRegenerate.disabled = false;
            for (const button of ui.setModeButtons) button.disabled = false;
        }
    }
    async function applySetTile(index) {
        if (state.busy) throw new Error("Theme Editor is busy with another operation; try again when it finishes.");
        if (!Number.isInteger(index) || index < 0 || index >= (state.generatedSet?.length || 0)) throw new Error("Variant index must be an integer from 0 to 99.");
        const variant = state.generatedSet[index];
        await applyGeneratedDraft(variant.draft, { polarity: variant.isDark, selectedIndex: index });
        return { index, isDark: variant.isDark, contrast: clone(variant.contrast) };
    }
    async function randomizeCore({ blocks, seed, mode } = {}) {
        if (!state.draft) throw new Error("The theme draft is not ready.");
        if (state.busy) throw new Error("Theme Editor is busy with another operation; try again when it finishes.");
        const keys = blocks == null ? ["background", "text", "accent"] : blocks;
        if (!Array.isArray(keys)) throw new Error("blocks must be an array of generator block names.");
        const legal = new Set(GENERATOR_BLOCKS.map((block) => block.key));
        const unknown = keys.filter((key) => !legal.has(key));
        if (unknown.length) throw new Error(`Unknown generator block${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}. Allowed blocks: ${[...legal].join(", ")}.`);
        if (seed !== undefined && !["number", "string"].includes(typeof seed)) throw new Error("seed must be a number or string.");
        if (mode !== undefined && mode !== "dark" && mode !== "light") throw new Error(`Unknown mode "${mode}". Allowed modes: dark, light.`);
        if (mode && state.locks.background && (colorToHsl(state.draft.base.background).l < 50) !== (mode === "dark")) {
            throw new Error(`The Background block is locked to a ${mode === "dark" ? "light" : "dark"} color; unlock it to generate a ${mode} theme.`);
        }
        const selected = keys.filter((key) => !state.locks[key]);
        if (!selected.length) return { accepted: false, passes: 0, total: REQUIRED_RANDOM_PAIR_COUNT, reason: "All requested generator blocks are locked." };
        if (!await flushPendingPreview()) throw new Error(validDraft().message || "The current draft is invalid.");
        markBusy(true);
        const random = seed === undefined ? Math.random : seededRandom(seed);
        const source = generatorSource();
        let best = null;
        let bestReport = null;
        let bestRank = null;
        let accepted = false;
        // Decided once per click, not per attempt: 20 attempts would make nearly every click vivid.
        const vividBackground = random() < VIVID_BACKGROUND_CHANCE;
        try {
            state.previewChain = state.previewChain.then(async () => {
                for (let attempt = 0; attempt < 20; attempt++) {
                    const candidate = makeRandomCandidate(source, selected, random, mode, vividBackground);
                    const report = await persephone.themes.contrast(candidate);
                    const rank = rankContrast(report);
                    if (!bestRank || rank.passes > bestRank.passes || (rank.passes === bestRank.passes && rank.lowest > bestRank.lowest)) {
                        best = candidate;
                        bestReport = report;
                        bestRank = rank;
                    }
                    if (rank.complete && rank.passes === REQUIRED_RANDOM_PAIR_COUNT) {
                        best = candidate;
                        bestReport = report;
                        accepted = true;
                        break;
                    }
                }
            });
            await state.previewChain;
            if (!best) return;
            await applyGeneratedDraft(best, { polarity: best.isDark, allowBusy: true });
            state.contrast = bestReport;
            if (accepted) {
                ui.generatorMessage.textContent = blocks ? t("theme.generation.passes") : t("theme.generation.modePasses", { mode: mode || "random" });
            } else {
                ui.generatorMessage.textContent = t("theme.generation.best", { passes: new Intl.NumberFormat(persephone.locale.code).format(bestRank.passes) });
            }
            ui.generatorMessage.hidden = false;
            return { accepted, passes: bestRank?.passes || 0, total: REQUIRED_RANDOM_PAIR_COUNT, lowest: bestRank?.lowest || 0, contrast: bestReport };
        } finally { markBusy(false); }
    }
    async function randomize(blocks, mode) { try { return await randomizeCore({ blocks, mode }); } catch (error) { reportError(error, t("theme.error.generate")); return false; } }
    function themeSignature(theme) {
        return JSON.stringify({ id: theme?.id, isDark: theme?.isDark, colors: theme?.colors, monaco: theme?.monaco });
    }
    function setMessage(message, error = false) {
        ui.message.textContent = message;
        ui.message.classList.toggle("error", error);
        ui.message.hidden = !message;
    }
    function reportError(error, context) {
        const message = context;
        console.error(context, error);
        setMessage(message, true);
        try { persephone.notify(message, "error"); } catch { /* The in-board message remains available. */ }
    }
    function markBusy(busy) {
        state.busy = busy;
        for (const control of [...ui.base.querySelectorAll("input"), ...ui.generator.querySelectorAll("input, select, button"), ...ui.groups.querySelectorAll("input, button")]) control.disabled = busy;
        for (const button of ui.generateButtons) button.disabled = busy;
        ui.setRegenerate.disabled = busy || !state.draft;
        for (const tile of ui.setTiles.querySelectorAll(".set-tile")) tile.disabled = busy;
        renderDirty();
    }
    function draftIsDirty() {
        return !!state.draft && (state.restoredDraft || JSON.stringify(state.draft) !== JSON.stringify(state.baseline));
    }
    function renderDirty() {
        const wasDirty = state.dirty;
        state.dirty = draftIsDirty();
        const overrideCount = state.draft ? Object.keys(state.draft.overrides).length : 0;
        ui.clearOverrides.textContent = overrideCount ? t("theme.overrides.clearCount", { count: new Intl.NumberFormat(persephone.locale.code).format(overrideCount) }) : t("theme.overrides.clearAll");
        ui.clearOverrides.disabled = state.busy || !overrideCount;
        ui.generatorClearOverrides.disabled = state.busy || !overrideCount;
        syncPageToolbar();
        if (wasDirty !== state.dirty) {
            try { persephone.page.setModified(state.dirty); } catch { /* Older hosts may not expose plain-page dirty state. */ }
            state.pageModified = state.dirty;
            scheduleDraftPersistence();
        }
        if (state.draft) syncGeneratorControls();
    }
    // Rename / Save / Save as / Revert and the … menu items live in Persephone's page toolbar; the
    // board only declares them and keeps their enabled state current. The theme name fills the
    // toolbar's read-only text slot (the dirty dot is on the page tab).
    const MENU_ITEMS = [
        { id: "delete", label: t("theme.toolbar.delete") },
        { id: "export", label: t("theme.toolbar.export") },
        { id: "import", label: t("theme.toolbar.import") },
    ];
    let pageToolbarKey = "";
    function declarePageToolbar() {
        persephone.toolbar.set([
            { id: "rename", type: "button", label: t("theme.toolbar.rename"), title: t("theme.toolbar.renameTitle"), disabled: true },
            { id: "save", type: "button", label: t("theme.toolbar.save"), title: t("theme.toolbar.saveTitle"), disabled: true },
            { id: "save-as", type: "button", label: t("theme.toolbar.saveAs"), title: t("theme.toolbar.saveAsTitle"), disabled: true },
            { id: "revert", type: "button", label: t("theme.toolbar.revert"), title: t("theme.toolbar.revertTitle"), disabled: true },
            { id: "theme", type: "menu", placement: "board-menu", items: MENU_ITEMS },
        ]);
        pageToolbarKey = "";
        syncPageToolbar();
    }
    function syncPageToolbar() {
        const ready = !state.busy && !!state.draft;
        const custom = state.sourceKind === "custom" && !!state.sourceId;
        const controls = [
            { id: "rename", disabled: !ready },
            { id: "save", disabled: !ready || !state.dirty },
            { id: "save-as", disabled: !ready },
            { id: "revert", disabled: !ready || (!state.dirty && !state.hasPreview) },
            { id: "theme", items: MENU_ITEMS.map((item) => ({ ...item, disabled: item.id === "delete" ? !ready || !custom : !ready })) },
        ];
        const text = state.draft ? t("theme.toolbar.text", { name: state.draft.name }) : "";
        const key = JSON.stringify([controls, text]);
        if (key === pageToolbarKey) return;
        pageToolbarKey = key;
        persephone.toolbar.update(controls);
        persephone.toolbar.setText(text);
    }
    function onPageToolbarAction({ id, value }) {
        if (id === "rename") openNameDialog("rename");
        else if (id === "save") void saveDraft(false);
        else if (id === "save-as") openNameDialog("saveAs");
        else if (id === "revert") void revertDraft();
        else if (id === "theme" && value === "delete") void deleteTheme();
        else if (id === "theme" && value === "export") void exportTheme();
        // The pick came from Persephone's window, which gives this frame no user activation, so the
        // file chooser must be opened by a click inside the board.
        else if (id === "theme" && value === "import") ui.importDialog.showModal();
    }
    function scheduleDraftPersistence() {
        clearTimeout(state.persistTimer);
        if (!state.dirty || !state.draft) {
            void persephone.pageState.remove("draft").catch((error) => reportError(error, t("theme.error.clearDraft")));
            return;
        }
        state.persistTimer = setTimeout(() => {
            if (!state.dirty || !state.draft) return;
            const saved = JSON.stringify({ sourceId: state.sourceId, sourceKind: state.sourceKind, draft: state.draft, baseline: state.baseline, sourceExact: [...state.sourceExact] });
            void persephone.pageState.set("draft", saved).catch((error) => reportError(error, t("theme.error.preserveDraft")));
        }, 500);
    }
    function parseableColor(value) {
        return typeof value === "string" && value.trim() !== "" && CSS.supports("color", value.trim());
    }
    function colorPickerValue(value) {
        return /^#[0-9a-f]{6}$/i.test(value || "") ? value : "#808080";
    }
    function makeBaseControls() {
        ui.base.replaceChildren();
        for (const field of BASE_FIELDS) {
            const row = document.createElement("div");
            row.className = "base-row";
            row.dataset.key = field.key;
            const label = document.createElement("label");
            label.className = field.required ? "" : "optional-label";
            label.htmlFor = `base-${field.key}`;
            label.textContent = t(`theme.base.${field.key}`);
            const picker = document.createElement("input");
            picker.type = "color";
            picker.dataset.role = "picker";
            picker.setAttribute("aria-label", t("theme.base.colorPicker", { label: t(`theme.base.${field.key}`) }));
            const text = document.createElement("input");
            text.type = "text";
            text.id = `base-${field.key}`;
            text.className = "p-input sm";
            text.dataset.role = "value";
            text.dataset.name = `base-${field.key}`;
            text.placeholder = t(field.required ? "theme.base.required" : "theme.base.omit");
            text.autocomplete = "off";
            row.append(label, picker, text);
            ui.base.append(row);
            picker.addEventListener("input", () => {
                text.value = picker.value;
                text.dispatchEvent(new Event("input", { bubbles: true }));
            });
            text.addEventListener("input", () => {
                picker.value = colorPickerValue(text.value.trim());
                updateBaseField(field, text);
            });
        }
    }
    function makeColorRow(key, isMonaco = false) {
        const overrideKey = isMonaco ? `monaco:${key}` : key;
        const row = document.createElement("div");
        row.className = "color-row";
        row.dataset.key = overrideKey;
        const label = document.createElement("span");
        label.className = "color-label";
        label.textContent = isMonaco ? key : key.replace(/^--color-/, "");
        label.title = overrideKey;
        const swatch = document.createElement("span");
        swatch.className = "swatch";
        swatch.setAttribute("aria-label", t("theme.override.swatch", { key: overrideKey }));
        const input = document.createElement("input");
        input.type = "text";
        input.className = "p-input sm";
        input.dataset.role = "value";
        input.setAttribute("aria-label", overrideKey);
        input.dataset.name = `override-${overrideKey.replaceAll(":", "-")}`;
        input.autocomplete = "off";
        const picker = document.createElement("input");
        picker.type = "color";
        picker.dataset.role = "picker";
        picker.setAttribute("aria-label", t("theme.override.picker", { key: overrideKey }));
        const reset = document.createElement("button");
        reset.type = "button";
        reset.className = "p-btn ghost reset";
        reset.textContent = t("theme.reset");
        reset.dataset.name = `reset-${overrideKey.replaceAll(":", "-")}`;
        row.append(label, swatch, input, picker, reset);
        input.addEventListener("input", () => {
            picker.value = colorPickerValue(input.value.trim());
            updateOverride(overrideKey, input.value.trim());
        });
        picker.addEventListener("input", () => {
            input.value = picker.value;
            updateOverride(overrideKey, picker.value);
        });
        reset.addEventListener("click", () => {
            resetOverrideCore(overrideKey);
        });
        return row;
    }
    function makePaletteGroups() {
        ui.groups.replaceChildren();
        for (const group of GROUPS) {
            const section = document.createElement("section");
            section.className = "color-group";
            section.dataset.name = `palette-${group.name.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}`;
            const heading = document.createElement("h2");
            heading.textContent = t(`theme.group.${{ "Backgrounds": "backgrounds", "Text": "text", "Icons": "icons", "Borders & shadow": "borders", "Grid": "grid", "Status": "status", "Editor": "editor", "Graph": "graph" }[group.name]}`);
            section.append(heading);
            if (group.monaco) {
                const note = document.createElement("p");
                note.className = "monaco-note";
                note.textContent = t("theme.monaco.inferred");
                section.append(note);
            }
            for (const key of group.keys) section.append(makeColorRow(key));
            if (group.monaco) for (const key of MONACO_KEYS) section.append(makeColorRow(key, true));
            ui.groups.append(section);
        }
    }
    function updateBaseField(field, input) {
        const value = input.value.trim();
        mutateBaseColor(field.key, value, { allowInvalid: true, syncControls: false });
        input.setAttribute("aria-invalid", value && !parseableColor(value) ? "true" : "false");
    }
    // Initialization flow: a loaded theme keeps its exact colors; the generator controls only show
    // where its base colors sit. User-change flow: the first base-color, mode or Generate/Reroll
    // change hands every exact color back to the generator. Colors set by hand in Details stay.
    function markSourceExact() {
        state.sourceExact = new Set(Object.keys(state.draft?.overrides || {}));
    }
    function releaseSourceExact() {
        if (!state.draft || !state.sourceExact.size) return;
        for (const key of state.sourceExact) delete state.draft.overrides[key];
        state.sourceExact.clear();
        renderPaletteValues();
    }
    function mutateBaseColor(key, value, { allowInvalid = false, syncControls = true } = {}) {
        const field = BASE_FIELDS.find((item) => item.key === key);
        if (!field) throw new Error(`Unknown base color "${key}". Allowed keys: ${BASE_FIELDS.map((item) => item.key).join(", ")}.`);
        if (!state.draft) throw new Error("The theme draft is not ready.");
        const normalized = value == null ? "" : String(value).trim();
        if (!allowInvalid && normalized && !parseableColor(normalized)) throw new Error(`"${normalized}" is not a valid CSS color for ${key}; use a CSS color value such as #336699, rgb(), hsl(), or a named color.`);
        if (!normalized && field.required && !allowInvalid) throw new Error(`${key} is required and cannot be removed.`);
        releaseSourceExact();
        clearSetSelection();
        if (!normalized && !field.required) delete state.draft.base[key];
        else state.draft.base[key] = normalized;
        if (syncControls) renderEditorFields();
        onDraftChanged();
        return state.draft.base[key] ?? null;
    }
    function updateOverride(key, value) {
        mutateOverride(key, value, { allowInvalid: true, syncControls: false });
        const input = ui.groups.querySelector(`[data-key="${CSS.escape(key)}"] [data-role="value"]`);
        if (input) input.setAttribute("aria-invalid", value && !parseableColor(value) ? "true" : "false");
    }
    function mutateOverride(key, value, { allowInvalid = false, syncControls = true } = {}) {
        if (!state.draft) throw new Error("The theme draft is not ready.");
        const legalKeys = [...GROUPS.flatMap((group) => group.keys), ...MONACO_KEYS.map((item) => `monaco:${item}`)];
        if (!legalKeys.includes(key)) throw new Error(`Unknown override key "${key}". Allowed keys: ${legalKeys.join(", ")}.`);
        const normalized = value == null ? "" : String(value).trim();
        if (!allowInvalid && normalized && !parseableColor(normalized)) throw new Error(`"${normalized}" is not a valid CSS color for ${key}; use a CSS color value such as #336699, rgb(), hsl(), or a named color.`);
        state.sourceExact.delete(key);
        if (!normalized) delete state.draft.overrides[key];
        else state.draft.overrides[key] = normalized;
        if (state.generatedSet) renderGeneratedSet();
        if (syncControls) renderPaletteValues();
        onDraftChanged();
        return state.draft.overrides[key] ?? null;
    }
    function resetOverrideCore(key) {
        if (!state.draft) throw new Error("The theme draft is not ready.");
        const legalKeys = [...GROUPS.flatMap((group) => group.keys), ...MONACO_KEYS.map((item) => `monaco:${item}`)];
        if (!legalKeys.includes(key)) throw new Error(`Unknown override key "${key}". Allowed keys: ${legalKeys.join(", ")}.`);
        if (!(key in state.draft.overrides)) return false;
        state.sourceExact.delete(key);
        delete state.draft.overrides[key];
        if (state.generatedSet) renderGeneratedSet();
        renderPaletteValues();
        onDraftChanged();
        return true;
    }
    function clearOverridesCore() {
        if (!state.draft) throw new Error("The theme draft is not ready.");
        const count = Object.keys(state.draft.overrides).length;
        state.draft.overrides = {};
        state.sourceExact.clear();
        if (state.generatedSet) renderGeneratedSet();
        renderPaletteValues();
        onDraftChanged();
        return count;
    }
    function validDraft() {
        if (!state.draft || !state.draft.name.trim()) return { valid: false, message: "Enter a name for this theme." };
        for (const field of BASE_FIELDS) {
            const value = state.draft.base[field.key];
            if (field.required && !value) return { valid: false, message: `${field.label} is required.` };
            if (value && !parseableColor(value)) return { valid: false, message: `“${value}” is not a valid CSS color for ${field.label}.` };
        }
        for (const [key, value] of Object.entries(state.draft.overrides)) {
            if (!parseableColor(value)) return { valid: false, message: `“${value}” is not a valid CSS color for ${key}.` };
        }
        return { valid: true, message: "" };
    }
    function setPolarity() {
        for (const button of ui.polarityButtons) {
            const selected = (state.draft?.isDark === null && button.dataset.mode === "auto") ||
                (state.draft?.isDark === true && button.dataset.mode === "dark") ||
                (state.draft?.isDark === false && button.dataset.mode === "light");
            button.setAttribute("aria-pressed", String(selected));
        }
        for (const button of ui.generator.querySelectorAll(".generator-mode button")) {
            const selected = (state.draft?.isDark === null && button.dataset.mode === "auto") ||
                (state.draft?.isDark === true && button.dataset.mode === "dark") ||
                (state.draft?.isDark === false && button.dataset.mode === "light");
            button.setAttribute("aria-pressed", String(selected));
        }
    }
    function mutateMode(mode) {
        if (!state.draft) throw new Error("The theme draft is not ready.");
        if (!["auto", "dark", "light"].includes(mode)) throw new Error(`Unknown theme mode "${mode}". Allowed modes: auto, dark, light.`);
        releaseSourceExact();
        clearSetSelection();
        state.draft.isDark = mode === "auto" ? null : mode === "dark";
        setPolarity();
        syncGeneratorControls();
        onDraftChanged();
        return mode;
    }
    function renderEditorFields() {
        if (!state.draft) return;
        for (const field of BASE_FIELDS) {
            const row = ui.base.querySelector(`[data-key="${field.key}"]`);
            const value = state.draft.base[field.key] || "";
            row.querySelector('[data-role="value"]').value = value;
            row.querySelector('[data-role="picker"]').value = colorPickerValue(value);
            row.querySelector('[data-role="value"]').setAttribute("aria-invalid", value && !parseableColor(value) ? "true" : "false");
        }
        setPolarity();
        renderPaletteValues();
        syncGeneratorControls();
        renderDirty();
    }
    function renderPaletteValues() {
        if (!state.draft) return;
        for (const row of ui.groups.querySelectorAll(".color-row")) {
            const key = row.dataset.key;
            const monaco = key.startsWith("monaco:");
            const valueKey = monaco ? key.slice(7) : key;
            const derivedValue = monaco ? state.derived?.monaco?.colors?.[valueKey] : state.derived?.colors?.[valueKey];
            const value = state.draft.overrides[key] ?? derivedValue ?? "";
            row.querySelector(".swatch").style.backgroundColor = value || "transparent";
            const input = row.querySelector('[data-role="value"]');
            if (document.activeElement !== input) input.value = value;
            input.setAttribute("aria-invalid", value && !parseableColor(value) ? "true" : "false");
            row.querySelector('[data-role="picker"]').value = colorPickerValue(value);
            row.querySelector(".reset").disabled = !(key in state.draft.overrides);
            row.querySelector(".reset").title = t("theme.override.resetTo", { value: derivedValue || t("theme.reset.toDerived") });
        }
        const isDark = state.displayed?.isDark ?? state.derived?.isDark;
        ui.mode.textContent = t(isDark ? "theme.mode.darkInferred" : "theme.mode.lightInferred");
        ui.mode.classList.toggle("dark", !!isDark);
        ui.mode.classList.toggle("light", !isDark);
        const monacoBase = state.displayed?.monaco?.base || state.derived?.monaco?.base;
        const note = ui.groups.querySelector(".monaco-note");
        if (note && monacoBase) note.textContent = t("theme.monaco.base", { base: monacoBase });
        syncGeneratorControls();
    }
    function renderContrast(report) {
        ui.contrast.replaceChildren();
        if (!report || !Object.keys(report).length) {
            ui.contrast.textContent = t("theme.contrast.none");
            return;
        }
        for (const [key, item] of Object.entries(report)) {
            const row = document.createElement("div");
            row.className = "contrast-row";
            const name = document.createElement("span");
            name.className = "contrast-name";
            name.textContent = CONTRAST_LABELS[key] ? t(CONTRAST_LABELS[key]) : key;
            name.title = key;
            const ratio = document.createElement("span");
            ratio.className = "contrast-ratio";
            ratio.textContent = `${uiNumber.format(Number(item.ratio))}:1`;
            const badge = document.createElement("span");
            badge.className = `contrast-badge${item.meetsAA ? " pass" : ""}`;
            badge.textContent = t(item.meetsAA ? "theme.contrast.aa" : "theme.contrast.fail");
            badge.setAttribute("aria-label", t(item.meetsAA ? "theme.contrast.passAria" : "theme.contrast.failAria"));
            row.append(name, ratio, badge);
            ui.contrast.append(row);
        }
    }
    function updateActiveLabel(theme) {
        if (!theme) return;
        state.current = theme;
        ui.active.textContent = `Active in Persephone: ${theme.name}${state.previewSuperseded ? " · another selection replaced this preview" : ""}`;
    }
    async function refreshThemes() {
        const selected = state.sourceId;
        state.themes = await persephone.themes.list();
        if (selected && state.draft && state.dirty) {
            if (!state.themes.some((theme) => theme.id === selected)) {
                setMessage(t("theme.message.removed"), true);
            } else if (state.sourceKind === "custom") {
                const latest = await persephone.themes.file(selected);
                if (latest && JSON.stringify(latest) !== JSON.stringify(state.baseline)) {
                    setMessage(t("theme.message.changed"));
                }
            }
        }
    }
    function newDraft() {
        const defaultBase = {
            background: state.current?.colors?.["--color-bg-default"] || "#202124",
            text: state.current?.colors?.["--color-text-default"] || "#e8eaed",
            accent: state.current?.colors?.["--color-primary-bg"] || "#4f8cff",
        };
        return { schemaVersion: 1, name: "New Theme", base: defaultBase, isDark: null, overrides: {} };
    }
    async function loadSourceCore(id) {
        state.generatedSet = null;
        clearSetSelection();
        if (state.busy) throw new Error("Theme Editor is busy with another operation; try again when it finishes.");
        if (!state.themes.some((theme) => theme.id === id)) throw new Error(`Unknown theme "${id}".`);
        markBusy(true);
        clearTimeout(state.previewTimer);
        if (state.previewResolve) {
            state.previewResolve();
            state.previewResolve = null;
        }
        state.previewGeneration++;
        const op = ++state.operation;
        // Opening a theme does not change the window; only an edit (or an already-running preview
        // from this board) shows the draft live.
        const keepPreviewing = state.hasPreview && !state.previewSuperseded;
        try {
            let draft;
            if (id.startsWith("custom-")) {
                const file = await persephone.themes.file(id);
                if (!file) throw new Error("That saved custom theme is no longer available. Refresh the theme list and choose another.");
                state.sourceId = id;
                state.sourceKind = "custom";
                draft = clone(file);
            } else {
                const source = state.themes.find((theme) => theme.id === id);
                if (!source) throw new Error("That starting theme is no longer in the theme list.");
                // An exact copy ("<name> copy"), so the board opens on what the window shows.
                draft = await persephone.themes.fork(id);
                state.sourceId = id;
                state.sourceKind = "builtin";
            }
            if (op !== state.operation) return;
            state.draft = clone(draft);
            markSourceExact();
            state.baseline = clone(draft);
            state.restoredDraft = false;
            state.hasPreview = false;
            state.previewSuperseded = false;
            state.displayed = null;
            state.derived = null;
            setMessage("");
            renderEditorFields();
            syncGeneratorControls();
            await queueDraftRefresh({ preview: keepPreviewing });
        } catch (error) {
            if (op === state.operation) throw error;
        } finally {
            if (op === state.operation) markBusy(false);
        }
    }
    async function loadSource(id) {
        try { return await loadSourceCore(id); }
        catch (error) { reportError(error, t("theme.error.load")); return false; }
    }
    function validateThemeEditIntent(request) {
        if (!request || request.id !== "theme.edit" || request.version !== 1) return null;
        const payload = request.payload;
        if (!payload || typeof payload !== "object" || Array.isArray(payload) || Object.getPrototypeOf(payload) !== Object.prototype) return null;
        const keys = Object.keys(payload).sort();
        if (payload.mode === "edit" && keys.length === 2 && keys[0] === "mode" && keys[1] === "themeId" &&
            typeof payload.themeId === "string" && payload.themeId.trim()) {
            return { mode: "edit", themeId: payload.themeId };
        }
        if (payload.mode === "new" && keys.length === 1 && keys[0] === "mode") return { mode: "new" };
        return null;
    }
    function askIntentDraftDecision() {
        return new Promise((resolve) => {
            const onClose = () => resolve(ui.intentDialog.returnValue || "cancel");
            ui.intentDialog.addEventListener("close", onClose, { once: true });
            ui.intentDialog.showModal();
        });
    }
    async function captureIntentSource(intent) {
        await refreshThemes();
        const active = await persephone.themes.current();
        state.current = active;
        if (intent.mode === "edit") {
            if (!state.themes.some((theme) => theme.id === intent.themeId)) {
                throw new Error(`Unknown theme "${intent.themeId}".`);
            }
            return { mode: "edit", themeId: intent.themeId, activeId: intent.themeId };
        }

        let activeId = active.id;
        let snapshot;
        if (activeId === "preview") {
            activeId = state.sourceId || "";
            if (!activeId && state.draft) snapshot = clone(state.draft);
        }
        if (!snapshot) {
            if (!activeId || !state.themes.some((theme) => theme.id === activeId)) {
                throw new Error("The active theme is no longer available to copy.");
            }
            snapshot = activeId.startsWith("custom-")
                ? await persephone.themes.file(activeId)
                : await persephone.themes.fork(activeId);
            if (!snapshot) throw new Error("The active custom theme is no longer available to copy.");
        }
        const draft = clone(snapshot);
        delete draft.id;
        // A new theme keeps the active theme's base colors and mode but none of its pinned colors:
        // an exact built-in fork pins ~47 colors to reproduce the original, which would leave the
        // generator with almost nothing to drive.
        draft.overrides = {};
        draft.isDark = null;
        draft.name = `New ${active.name || draft.name}`;
        return { mode: "new", activeId, active, draft };
    }
    async function loadIntentSource(source) {
        if (source.activeId) await persephone.themes.apply(source.activeId);
        state.current = await persephone.themes.current();
        state.hasPreview = false;
        state.previewSuperseded = false;
        state.displayed = null;
        if (source.mode === "edit") {
            await refreshThemes();
            await loadSourceCore(source.themeId);
            setView("generator");
            return;
        }

        markBusy(true);
        try {
            state.sourceId = null;
            state.sourceKind = "new";
            state.draft = clone(source.draft);
            state.generatedSet = null;
            clearSetSelection();
            markSourceExact();
            state.baseline = clone(source.draft);
            state.restoredDraft = true;
            state.derived = null;
            state.contrast = null;
            renderEditorFields();
            updateActiveLabel(state.current);
            await queueDraftRefresh({ preview: true, delay: 0 });
            setMessage(t("theme.message.newDraft"));
        } finally {
            markBusy(false);
        }
        await setGeneratedView();
    }
    async function processThemeEditIntent(intent) {
        await state.externalRefreshPromise;
        const source = await captureIntentSource(intent);
        if (draftIsDirty()) {
            const choice = await askIntentDraftDecision();
            if (choice === "cancel") {
                state.current = await persephone.themes.current();
                updateActiveLabel(state.current);
                await queueDraftRefresh({ preview: true, delay: 0 });
                return;
            }
            if (choice === "save") {
                const saved = await saveDraft(false);
                if (!saved) {
                    await queueDraftRefresh({ preview: true, delay: 0 });
                    return;
                }
            } else {
                clearTimeout(state.persistTimer);
                await persephone.pageState.remove("draft");
            }
        }
        await loadIntentSource(source);
    }
    function onIntentRequest(request) {
        const intent = validateThemeEditIntent(request);
        if (!intent) {
            request?.reject("Unsupported theme.edit request. Expected v1 edit or new payload.");
            return;
        }

        // Capability deadlines cover cold board startup. Settle before any source reads or UI.
        state.intentPending++;
        request.resolve({ accepted: true });
        intentQueue = intentQueue.then(async () => {
            try {
                await initializationPromise;
                await processThemeEditIntent(intent);
            } catch (error) {
                reportError(error, t("theme.error.handleRequest"));
            } finally {
                state.intentPending = Math.max(0, state.intentPending - 1);
                if (state.intentPending === 0) scheduleExternalRefresh();
            }
        });
    }
    // Throttle, not debounce: refresh at once, then at most every PREVIEW_INTERVAL_MS while input keeps
    // coming (a slider drag), always ending on the latest draft. A debounce would hold the window's
    // theme still for the whole drag. Each refresh costs ~10 ms (derive + contrast + preview).
    const PREVIEW_INTERVAL_MS = 50;
    async function queueDraftRefresh({ preview = true, delay } = {}) {
        if (delay === undefined) delay = Math.max(0, PREVIEW_INTERVAL_MS - (Date.now() - (state.lastRefreshAt || 0)));
        clearTimeout(state.previewTimer);
        if (state.previewResolve) {
            state.previewResolve();
            state.previewResolve = null;
        }
        const op = ++state.previewGeneration;
        const validity = validDraft();
        if (!validity.valid) {
            setMessage(validity.message, true);
            renderDirty();
            return;
        }
        setMessage("");
        const draft = clone(state.draft);
        return new Promise((resolve) => {
            state.previewResolve = resolve;
            state.previewTimer = setTimeout(async () => {
                state.lastRefreshAt = Date.now();
                state.previewChain = state.previewChain.then(async () => {
                    if (op !== state.previewGeneration) return;
                    const [derived, contrast] = await Promise.all([
                        persephone.themes.derive(draft.base, draft.isDark),
                        persephone.themes.contrast(draft),
                    ]);
                    if (op !== state.previewGeneration) return;
                    const displayed = preview ? await persephone.themes.preview(draft) : null;
                    if (op !== state.previewGeneration) return;
                    state.derived = derived;
                    state.contrast = contrast;
                    if (displayed) {
                        state.displayed = displayed;
                        state.hasPreview = true;
                        state.previewSuperseded = false;
                        state.lastPreviewId = displayed.id;
                        state.lastPreviewSignature = themeSignature(displayed);
                    }
                    renderPaletteValues();
                    renderContrast(contrast);
                    renderDirty();
                }).catch((error) => {
                    if (op === state.previewGeneration) reportError(error, t("theme.error.updatePreview"));
                }).finally(() => {
                    if (state.previewResolve === resolve) state.previewResolve = null;
                    resolve();
                });
            }, delay);
        });
    }
    async function flushPendingPreview() {
        if (!state.draft || !validDraft().valid) return false;
        if (state.previewTimer || state.previewResolve) await queueDraftRefresh({ preview: true, delay: 0 });
        await state.previewChain;
        return true;
    }
    function onDraftChanged() {
        if (!state.draft) return;
        renderDirty();
        void queueDraftRefresh();
    }
    async function saveDraftCore(saveAs, name) {
        if (state.busy) throw new Error("Theme Editor is busy with another operation; try again when it finishes.");
        if (!await flushPendingPreview()) {
            const validity = validDraft();
            throw new Error(validity.message || "The current draft is invalid.");
        }
        const validity = validDraft();
        if (!validity.valid) throw new Error(validity.message);
        const newName = typeof name === "string" ? name.trim() : "";
        if (name !== undefined && !newName) throw new Error("Theme name cannot be empty.");
        markBusy(true);
        try {
            const draft = clone(state.draft);
            if (saveAs) delete draft.id;
            if (newName) draft.name = newName;
            const saved = await persephone.themes.save(draft);
            await persephone.themes.apply(saved.id);
            state.sourceId = saved.id;
            state.sourceKind = "custom";
            state.draft = clone(saved);
            state.baseline = clone(saved);
            state.restoredDraft = false;
            state.hasPreview = false;
            state.previewSuperseded = false;
            state.current = await persephone.themes.current();
            await refreshThemes();
            renderEditorFields();
            setMessage(t(saveAs ? "theme.message.savedAs" : "theme.message.saved"));
            return true;
        }
        finally { markBusy(false); }
    }
    async function saveDraft(saveAs, name) {
        try { return await saveDraftCore(saveAs, name); }
        catch (error) { reportError(error, t("theme.error.save")); return false; }
    }
    async function revertDraftCore() {
        if (state.busy) throw new Error("Theme Editor is busy with another operation; try again when it finishes.");
        clearSetSelection();
        markBusy(true);
        const ownedPreview = state.hasPreview && !state.previewSuperseded;
        let superseded = state.previewSuperseded;
        try {
            if (state.sourceKind === "custom" && state.sourceId) {
                const file = await persephone.themes.file(state.sourceId);
                if (!file) throw new Error("This saved theme was removed. Choose another starting theme.");
                state.draft = clone(file);
            } else if (state.sourceKind === "builtin" && state.sourceId) {
                state.draft = state.baseline ? clone(state.baseline) : clone(await persephone.themes.fork(state.sourceId));
            } else {
                state.draft = state.baseline ? clone(state.baseline) : newDraft();
            }
            state.baseline = clone(state.draft);
            markSourceExact();
            state.restoredDraft = false;
            if (ownedPreview) {
                const active = await persephone.themes.current();
                const stillOurs = active.id === state.lastPreviewId && themeSignature(active) === state.lastPreviewSignature;
                if (stillOurs) await persephone.themes.endPreview();
                else superseded = true;
            }
            state.hasPreview = false;
            state.previewSuperseded = superseded;
            state.current = await persephone.themes.current();
            state.derived = await persephone.themes.derive(state.draft.base, state.draft.isDark);
            state.contrast = await persephone.themes.contrast(state.draft);
            state.displayed = null;
            renderEditorFields();
            renderContrast(state.contrast);
            updateActiveLabel(state.current);
            setMessage(t(superseded ? "theme.message.revertedSuperseded" : "theme.message.reverted"));
        } catch (error) { throw error; }
        finally { markBusy(false); }
    }
    async function revertDraft() {
        try { return await revertDraftCore(); }
        catch (error) { reportError(error, t("theme.error.revert")); return false; }
    }
    function openNameDialog(mode) {
        if (!state.draft || state.busy) return;
        state.nameDialogMode = mode;
        const saveAs = mode === "saveAs";
        ui.renameTitle.textContent = t(saveAs ? "theme.saveAs.title" : "theme.rename.title");
        ui.renameConfirm.textContent = t(saveAs ? "theme.unsaved.save" : "theme.rename.confirm");
        ui.renameInput.value = saveAs && state.sourceKind === "custom" ? `${state.draft.name} copy` : state.draft.name;
        ui.renameDialog.showModal();
        ui.renameInput.select();
    }
    async function deleteTheme() {
        if (state.sourceKind !== "custom" || !state.sourceId) return;
        ui.deleteCopy.textContent = t("theme.delete.confirmCopy", { name: state.draft.name });
        ui.deleteDialog.showModal();
    }
    // A saved custom theme is renamed in place (unsaved edits stay a draft); an unsaved copy of a
    // built-in only takes the new name, which its first Save uses.
    async function renameThemeCore(name) {
        if (state.busy) throw new Error("Theme Editor is busy with another operation; try again when it finishes.");
        if (!state.draft) throw new Error("The theme draft is not ready.");
        const normalized = typeof name === "string" ? name.trim() : "";
        if (!normalized) throw new Error("Theme name cannot be empty.");
        if (state.sourceKind !== "custom" || !state.sourceId) {
            state.draft.name = normalized;
            renderEditorFields();
            setMessage(t("theme.message.nameChanged"));
            return { id: null, name: normalized };
        }
        markBusy(true);
        try {
            const id = state.sourceId;
            await persephone.themes.rename(id, normalized);
            const file = await persephone.themes.file(id);
            if (file && !state.dirty) { state.draft = clone(file); state.baseline = clone(file); markSourceExact(); state.restoredDraft = false; }
            else { state.draft.name = normalized; state.baseline.name = normalized; }
            await refreshThemes();
            renderEditorFields();
            setMessage(t("theme.message.renamed"));
            return { id, name: normalized };
        } finally { markBusy(false); }
    }
    async function deleteThemeCore() {
        if (state.busy) throw new Error("Theme Editor is busy with another operation; try again when it finishes.");
        if (state.sourceKind !== "custom" || !state.sourceId) throw new Error("Delete is available only for a selected saved custom theme.");
        markBusy(true);
        try {
            const deleted = state.sourceId;
            let ownedPreview = state.hasPreview && !state.previewSuperseded;
            let wasSuperseded = state.previewSuperseded || (state.hasPreview && !ownedPreview);
            if (ownedPreview) {
                const active = await persephone.themes.current();
                ownedPreview = active.id === state.lastPreviewId && themeSignature(active) === state.lastPreviewSignature;
                if (ownedPreview) await persephone.themes.endPreview();
                else wasSuperseded = true;
            }
            await persephone.themes.delete(deleted);
            state.hasPreview = false;
            state.previewSuperseded = wasSuperseded;
            state.current = await persephone.themes.current();
            await refreshThemes();
        } finally { markBusy(false); }
        // The board always edits the theme the window shows, so it follows Persephone's fallback.
        await loadSourceCore(state.current.id);
        updateActiveLabel(state.current);
        setMessage(t("theme.message.deleted"));
        return { nextSourceId: state.sourceId };
    }
    async function exportTheme() {
        try {
            let data;
            if (state.sourceKind === "custom" && state.sourceId) {
                data = await persephone.themes.file(state.sourceId);
                if (!data) throw new Error("The saved custom theme was not found.");
            } else if (state.sourceKind === "builtin" && state.sourceId) {
                data = await persephone.themes.fork(state.sourceId);
                data.name = state.themes.find((theme) => theme.id === state.sourceId)?.name || data.name;
            } else {
                data = clone(state.draft);
                delete data.id;
            }
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = `${(data.name || "theme").replace(/[^a-z0-9_-]+/gi, "-")}.json`;
            document.body.append(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            setMessage(t("theme.message.exported"));
        } catch (error) { reportError(error, t("theme.error.export")); }
    }
    function looseImportShape(value) {
        return value && typeof value === "object" && !Array.isArray(value) && value.schemaVersion === 1 &&
            typeof value.name === "string" && value.base && typeof value.base === "object" &&
            ["background", "text", "accent"].every((key) => typeof value.base[key] === "string") &&
            (value.isDark === null || typeof value.isDark === "boolean") &&
            value.overrides && typeof value.overrides === "object" && !Array.isArray(value.overrides);
    }
    async function importFile(file) {
        try {
            const parsed = JSON.parse(await file.text());
            if (!looseImportShape(parsed)) throw new Error("Expected a theme JSON object with schemaVersion, name, base colors, isDark, and overrides.");
            const draft = clone(parsed);
            delete draft.id;
            const saved = await persephone.themes.save(draft);
            await persephone.themes.apply(saved.id);
            state.current = await persephone.themes.current();
            state.sourceKind = "custom";
            state.sourceId = saved.id;
            state.draft = clone(saved);
            markSourceExact();
            state.baseline = clone(saved);
            state.restoredDraft = false;
            state.hasPreview = false;
            state.previewSuperseded = false;
            await refreshThemes();
            renderEditorFields();
            updateActiveLabel(state.current);
            setMessage(t("theme.message.imported"));
        } catch (error) { reportError(error, t("theme.error.import")); }
        finally { ui.importFile.value = ""; }
    }
    function scheduleExternalRefresh() {
        clearTimeout(state.externalTimer);
        state.externalTimer = setTimeout(async () => {
            if (state.intentPending) return;
            state.externalRefreshPromise = (async () => {
                try {
                    await refreshThemes();
                    if (state.intentPending) return;
                    const active = await persephone.themes.current();
                    if (state.intentPending) return;
                    updateActiveLabel(active);
                    if (state.hasPreview && state.lastPreviewId &&
                        (active.id !== state.lastPreviewId || themeSignature(active) !== state.lastPreviewSignature)) {
                        state.previewSuperseded = true;
                        state.hasPreview = false;
                    }
                    // Without unsaved changes the board follows the window. A queued intent takes
                    // ownership of source loading and waits for any refresh already in flight.
                    if (!state.intentPending && !state.dirty && !state.busy && !state.hasPreview && active.id !== "preview") {
                        const stale = active.id !== state.sourceId || (state.sourceKind === "custom" &&
                            JSON.stringify(await persephone.themes.file(active.id)) !== JSON.stringify(state.baseline));
                        if (!state.intentPending && stale && !state.dirty && !state.busy) await loadSource(active.id);
                    }
                } catch (error) { reportError(error, t("theme.error.refresh")); }
            })();
        }, 250);
    }

    function exposeAiVisionModel() {
        const aiVision = window.persephone && window.persephone.aiVision;
        if (!aiVision || typeof aiVision.expose !== "function") return;
        const overrideKeys = [...GROUPS.flatMap((group) => group.keys), ...MONACO_KEYS.map((key) => `monaco:${key}`)];
        const declarations = [
            ...BASE_FIELDS.map((field) => ({ name: `base-${field.key}`, view: "main", purpose: `Edit the ${field.key} base color${field.required ? " (required)" : " (optional; empty follows Auto)"}.`, where: "Starting palette sidebar." })),
            { name: "theme-polarity", view: "main", purpose: "Choose Auto, Dark, or Light mode for the draft.", where: "Starting palette sidebar, Color mode." },
            { name: "clear-overrides", view: "main", purpose: "Remove all pinned palette overrides so colors follow derived values.", where: "Details view heading." },
            { name: "generator-clear-overrides", view: "main", purpose: "Remove all pinned palette overrides so colors follow derived values.", where: "Generator view, above the color blocks when overrides exist." },
            { name: "view-generator", view: "main", purpose: "Show the Generator tab for base colors and randomization.", where: "Palette area tab strip." },
            { name: "view-set", view: "main", purpose: "Show the Generated Set tab with 100 sorted theme variants.", where: "Palette area tab strip." },
            { name: "view-details", view: "main", purpose: "Show the Details tab for individual derived palette values and overrides.", where: "Palette area tab strip." },
            { name: "set-regenerate", view: "main", purpose: "Generate a fresh set of 100 contrast-ranked variants.", where: "Generated Set heading." },
            { name: "set-mode", view: "main", purpose: "Choose Both, Dark or Light variants; changing it regenerates the set.", where: "Generated Set heading." },
            { name: "set-status", view: "main", purpose: "Show Generated Set progress and completion status.", where: "Generated Set heading." },
            ...Array.from({ length: 100 }, (_, index) => ({ name: `set-tile-${index + 1}`, view: "main", purpose: `Apply Generated Set variant ${index + 1} to the theme draft and live preview.`, where: "Generated Set variant grid." })),
            { name: "theme-edit-unsaved-dialog", view: "main", purpose: "Choose how to handle the current unsaved draft before opening a theme requested from Settings.", where: "Theme Editor request confirmation." },
            { name: "theme-edit-cancel", view: "main", purpose: "Keep the current draft and restore its live preview.", where: "Unsaved theme changes dialog." },
            { name: "theme-edit-discard", view: "main", purpose: "Discard the current draft and open the requested theme.", where: "Unsaved theme changes dialog." },
            { name: "theme-edit-save", view: "main", purpose: "Save and apply the current draft, then open the requested theme.", where: "Unsaved theme changes dialog." },
            { name: "generate-dark", view: "main", purpose: "Generate a contrast-checked dark theme (background, text, accent), respecting locked blocks.", where: "Generator view heading." },
            { name: "generate-light", view: "main", purpose: "Generate a contrast-checked light theme (background, text, accent), respecting locked blocks.", where: "Generator view heading." },
            ...GENERATOR_BLOCKS.map((block) => ({ name: `lock-${block.key}`, view: "main", purpose: `Lock or unlock the ${block.key} block during randomization.`, where: `Generator view, ${block.label} block.` })),
            ...overrideKeys.flatMap((key) => {
                const suffix = key.replaceAll(":", "-");
                return [
                    { name: `override-${suffix}`, view: "main", purpose: `Set a pinned CSS color override for ${key}; empty removes the override.`, where: "Details view, the matching palette row." },
                    { name: `reset-${suffix}`, view: "main", purpose: `Remove the pinned override for ${key} and restore its derived value.`, where: "Details view, the matching palette row." },
                ];
            }),
        ];
        const elementParts = aiVision.createElements(declarations);
        const model = {
            aiVision: {
                kind: "ThemeEditor",
                summary: "The Theme Editor's live model for the user's open, unsaved theme draft.",
                overview: "Read draft, themes, derived, contrast, and previewStatus for the current board draft.\nUse setBaseColor, setMode, and setOverride to edit it and preview valid changes.\nUse save/saveAs to persist and apply; revert discards draft edits.",
                help: [
                    "This model edits the draft currently open in the user's Theme Editor board, not a separate app.themes object.",
                    "Settings Edit requests a specific theme through theme.edit@1; the request is accepted immediately before source loading. A custom theme loads its saved file, while a built-in loads as an exact, unsaved \"<name> copy\" and opens Generator. The Settings + action creates an id-less dirty draft with the active theme's base colors, Auto mode, and no pinned overrides, named \"New <active name>\", then opens and generates Generated Set.",
                    "Generated Set is created lazily the first time its tab is selected; Regenerate replaces the in-memory 100-variant set. The Both / Dark / Light switch makes a mixed, all-dark or all-light set (Both by default; a locked Background fixes the polarity). Candidates are contrast-ranked, sorted by background hue and lightness, and display illustrative palettes, not controls. Select a tile to apply its base colors and polarity to the shared draft and live preview. A busy generation reports progress and rejects AiVision mutations.",
                    "A dirty or restored draft is never replaced by a repeated Settings request. Save persists it and then opens the requested source; Discard drops it and opens that source; Cancel keeps the draft and reapplies its live preview.",
                    "Changes preview live; there is no separate apply step. Revert restores the saved theme.",
                    "An opened theme keeps its exact colors (stored as overrides) and the generator controls only show where its base colors sit. The first setBaseColor, setMode or randomize call hands every one of those exact colors back to the generator; overrides set with setOverride stay. Revert returns to the exact colors.",
                    "Rename, Save, Save as, and Revert are Persephone page-toolbar controls (board-toolbar-control-rename/save/save-as/revert); Delete theme, Export JSON, and Import JSON are at the top of the page toolbar's … menu (board-toolbar-more). The toolbar text slot shows 'Theme: <name>'. Prefer the model methods below.",
                    "Auto mode maps to isDark: null; dark and light map to true and false. Optional base colors link, error, warning, and success can be removed with null or an empty string; the required background, text, and accent cannot.",
                    "Overrides pin CSS colors. setOverride accepts CSS color syntax validated with CSS.supports; null or empty removes that override. resetOverride removes one pin; clearOverrides removes all pins.",
                    "Invalid UI drafts remain visible and keep the last valid live preview. save and saveAs reject an invalid draft. derived and contrast are the latest completed authoritative bridge reports; previewStatus reports whether a refresh is pending or superseded.",
                    "Busy persistence/source operations reject another model operation promptly. Rename and delete model methods do not open dialogs. UI rename/delete still ask for confirmation.",
                    "save and saveAs(name?) write persistent theme data and apply the saved appearance. rename(name) renames a saved custom theme in place, or only the draft name of a built-in copy. deleteThemeCore immediately removes a saved custom theme without agent confirmation or undo; the board then loads Persephone's fallback theme.",
                    "randomize({blocks?, seed?, mode?}) uses the Generator's locked-block behavior and returns the best contrast result. Blocks are background, text, accent, link, error, warning, and success. mode \"dark\" or \"light\" forces that polarity (the draft's mode becomes Auto); without it the current mode is kept. A locked background of the other polarity rejects the call.",
                ].join("\n"),
                members: [
                    { name: "draft", kind: "property", summary: "A cloned snapshot of the live draft: id when present, schemaVersion, name, base, isDark, and overrides." },
                    { name: "sourceId", kind: "property", summary: "Selected saved theme id, or null for a new draft." },
                    { name: "sourceKind", kind: "property", summary: 'Source type: "new", "builtin", or "custom".' },
                    { name: "themes", kind: "property", summary: "Saved theme choices as id/name/custom-or-built-in summaries." },
                    { name: "derived", kind: "property", summary: "Latest completed authoritative theme derivation from Persephone, or null before one completes." },
                    { name: "contrast", kind: "property", summary: "Latest completed authoritative contrast report from Persephone; it may lag while previewStatus.pending is true." },
                    { name: "busy", kind: "property", summary: "True while generation or another load, save, revert, rename, or delete operation is running." },
                    { name: "dirty", kind: "property", summary: "Whether the open draft differs from its baseline and is marked modified in Persephone." },
                    { name: "valid", kind: "property", summary: "Whether the current draft has a non-empty name and valid required colors, optional colors, and overrides." },
                    { name: "validationError", kind: "property", summary: "Readable validation error for the current draft, or an empty string when valid." },
                    { name: "previewStatus", kind: "property", summary: "Current preview state, including pending refresh and whether another selection superseded this preview." },
                    { name: "setBaseColor", kind: "method", signature: "setBaseColor(key: string, value: string | null)", summary: "Change a base color and update derived colors, contrast, dirty state, and valid live preview. Optional colors accept null/empty; required colors do not." },
                    { name: "setMode", kind: "method", signature: 'setMode(mode: "auto" | "dark" | "light")', summary: "Set the draft color mode and refresh its valid live preview." },
                    { name: "setOverride", kind: "method", signature: "setOverride(key: string, value: string | null)", summary: "Pin a CSS color override or remove it with null/empty; updates the live draft and preview." },
                    { name: "resetOverride", kind: "method", signature: "resetOverride(key: string)", summary: "Remove one pinned override, refresh its derived value, and update the valid live preview." },
                    { name: "clearOverrides", kind: "method", signature: "clearOverrides()", summary: "Remove all pinned overrides and refresh the valid live preview." },
                    { name: "revert", kind: "method", signature: "revert()", summary: "Discard draft edits, restore the saved source, and end this board's live preview only if it still owns it." , caution: "Discards the current draft immediately." },
                    { name: "save", kind: "method", signature: "save()", summary: "Persist this draft to its theme file and apply it; rejects if the draft is invalid." , caution: "Writes persistent theme data and changes Persephone's active appearance." },
                    { name: "saveAs", kind: "method", signature: "saveAs(name?: string)", summary: "Write this draft as a new custom theme (named name, or the draft name) and apply it; rejects if invalid." , caution: "Creates a persistent theme file and changes Persephone's active appearance." },
                    { name: "rename", kind: "method", signature: "rename(name: string)", summary: "Rename the saved custom theme in place (unsaved edits stay unsaved), or set the draft name of an unsaved built-in copy; requires a non-empty name." , caution: "For a custom theme it writes the saved file immediately. It does not open the UI dialog." },
                    { name: "deleteThemeCore", kind: "method", signature: "deleteThemeCore()", summary: "Delete the selected saved custom theme, then load the theme Persephone falls back to." , caution: "Immediately removes the saved custom theme with no agent-side confirmation or undo." },
                    { name: "randomize", kind: "method", signature: 'randomize(options?: { blocks?: string[], seed?: number | string, mode?: "dark" | "light" })', summary: "Generate base colors for selected unlocked blocks, update the live draft and preview, and return whether all four required AA checks passed or the best fallback result." },
                    { name: "setLock", kind: "method", signature: "setLock(block: string, locked: boolean)", summary: "Set whether a Generator block is held fixed during randomization; does not change the draft or preview." },
                    { name: "regenerateSet", kind: "method", signature: "regenerateSet()", summary: "Generate and return 100 fresh contrast-ranked variants for Generated Set." },
                    { name: "setSetMode", kind: "method", signature: 'setSetMode(mode: "both" | "dark" | "light")', summary: "Choose whether Generated Set makes dark and light, only dark, or only light variants, and regenerate it." },
                    { name: "applySetTile", kind: "method", signature: "applySetTile(index: number)", summary: "Apply a zero-based Generated Set tile index (0–99) to the shared draft and live preview." },
                    { name: "setView", kind: "method", signature: 'setView(view: "set" | "generator" | "details")', summary: "Change the visible tab; selecting set generates it once on first use." },
                    ...elementParts.members,
                ],
                elements: declarations,
                provide: elementParts.provide,
                summarize: () => ({
                    kind: "ThemeEditor",
                    sourceId: state.sourceId,
                    sourceKind: state.sourceKind,
                    name: state.draft?.name || "",
                    isDark: state.draft?.isDark ?? null,
                    dirty: state.dirty,
                    valid: validDraft().valid,
                    busy: state.busy,
                    previewStatus: state.previewSuperseded ? "superseded" : state.hasPreview ? "active" : "none",
                    overrideCount: state.draft ? Object.keys(state.draft.overrides).length : 0,
                }),
            },
            get draft() {
                if (!state.draft) return null;
                const snapshot = { schemaVersion: state.draft.schemaVersion, name: state.draft.name, base: clone(state.draft.base), isDark: state.draft.isDark, overrides: clone(state.draft.overrides) };
                if (state.draft.id) snapshot.id = state.draft.id;
                return snapshot;
            },
            get sourceId() { return state.sourceId; },
            get sourceKind() { return state.sourceKind; },
            get themes() { return state.themes.map((theme) => ({ id: theme.id, name: theme.name, kind: theme.id.startsWith("custom-") ? "custom" : "built-in" })); },
            get derived() { return state.derived ? clone(state.derived) : null; },
            get contrast() { return state.contrast ? clone(state.contrast) : null; },
            get busy() { return state.busy; },
            get dirty() { return state.dirty; },
            get valid() { return validDraft().valid; },
            get validationError() { return validDraft().message; },
            get previewStatus() { return { status: state.previewSuperseded ? "superseded" : state.hasPreview ? "active" : "none", hasPreview: state.hasPreview, superseded: state.previewSuperseded, pending: !!state.previewTimer || !!state.previewResolve || state.busy }; },
            async setBaseColor(key, value) { assertModelEditable(); const result = mutateBaseColor(key, value); await queueDraftRefresh(); return result; },
            async setMode(mode) { assertModelEditable(); const result = mutateMode(mode); await queueDraftRefresh(); return result; },
            async setOverride(key, value) { assertModelEditable(); const result = mutateOverride(key, value); await queueDraftRefresh(); return result; },
            async resetOverride(key) { assertModelEditable(); const result = resetOverrideCore(key); await queueDraftRefresh(); return result; },
            async clearOverrides() { assertModelEditable(); const result = clearOverridesCore(); await queueDraftRefresh(); return result; },
            async revert() { assertModelEditable(); return await revertDraftCore(); },
            async save() { assertModelEditable(); return await saveDraftCore(false); },
            async saveAs(name) { assertModelEditable(); return await saveDraftCore(true, name); },
            async rename(name) { assertModelEditable(); return await renameThemeCore(name); },
            async deleteThemeCore() { assertModelEditable(); return await deleteThemeCore(); },
            async randomize(options) { assertModelEditable(); return await randomizeCore(options); },
            setLock(block, locked) { assertModelEditable(); if (typeof locked !== "boolean") throw new Error("locked must be true or false."); setBlockLock(block, locked); return state.locks[block]; },
            async regenerateSet() { assertModelEditable(); return await ensureGeneratedSet(true); },
            async setSetMode(mode) { assertModelEditable(); return await setGeneratedSetMode(mode); },
            async applySetTile(index) { assertModelEditable(); return await applySetTile(index); },
            setView(view) { assertModelEditable(); setView(view); return state.view; },
        };
        function assertModelEditable() {
            if (state.busy) throw new Error("Theme Editor is busy with another operation; try again when it finishes.");
            if (!state.draft) throw new Error("The theme draft is not ready.");
        }
        aiVision.expose(model);
    }

    async function initialize() {
        makeBaseControls();
        makePaletteGroups();
        makeGeneratorBlocks();
        ui.polarityButtons = [...$("#polarity").querySelectorAll("button")];
        for (const button of ui.polarityButtons) button.addEventListener("click", () => {
            mutateMode(button.dataset.mode);
        });
        const clearOverrides = () => {
            if (!state.draft) return;
            clearOverridesCore();
        };
        ui.clearOverrides.addEventListener("click", clearOverrides);
        ui.generatorClearOverrides.addEventListener("click", clearOverrides);
        ui.generateButtons[0].addEventListener("click", () => { void randomize(undefined, "dark"); });
        ui.generateButtons[1].addEventListener("click", () => { void randomize(undefined, "light"); });
        for (const button of ui.setModeButtons) button.addEventListener("click", () => {
            if (state.busy || button.dataset.mode === state.setMode) return;
            void setGeneratedSetMode(button.dataset.mode).catch((error) => reportError(error, t("theme.error.generate")));
        });
        ui.setRegenerate.addEventListener("click", () => { void ensureGeneratedSet(true).catch((error) => reportError(error, t("theme.error.generate"))); });
        ui.setTiles.addEventListener("click", (event) => {
            const tile = event.target.closest(".set-tile");
            if (!tile || state.busy) return;
            void applySetTile(Number(tile.dataset.index)).catch((error) => reportError(error, t("theme.error.apply")));
        });
        for (const tab of document.querySelectorAll(".view-tab")) tab.addEventListener("click", () => setView(tab.dataset.view));
        setView(state.view);
        declarePageToolbar();
        persephone.toolbar.onAction(onPageToolbarAction);
        ui.chooseImportFile.addEventListener("click", () => { ui.importDialog.close(); ui.importFile.click(); });
        ui.importFile.addEventListener("change", () => { if (ui.importFile.files?.[0]) void importFile(ui.importFile.files[0]); });
        ui.deleteDialog.addEventListener("close", async () => {
            if (ui.deleteDialog.returnValue !== "delete") return;
            try { await deleteThemeCore(); }
            catch (error) { reportError(error, t("theme.error.delete")); }
        });
        ui.renameDialog.addEventListener("close", async () => {
            if (ui.renameDialog.returnValue !== "confirm") return;
            if (state.nameDialogMode === "saveAs") { void saveDraft(true, ui.renameInput.value); return; }
            try { await renameThemeCore(ui.renameInput.value); }
            catch (error) { reportError(error, t("theme.error.rename")); }
        });
        try {
            state.themes = await persephone.themes.list();
            state.current = await persephone.themes.current();
            const serialized = await persephone.pageState.get("draft");
            let restored = null;
            if (serialized) {
                try { restored = JSON.parse(serialized); } catch { restored = null; }
            }
            if (restored?.draft && restored?.baseline && restored.draft.base && restored.draft.overrides) {
                state.sourceId = restored.sourceId || null;
                state.sourceKind = restored.sourceKind || "new";
                state.draft = clone(restored.draft);
                state.baseline = clone(restored.baseline);
                state.sourceExact = new Set(Array.isArray(restored.sourceExact)
                    ? restored.sourceExact.filter((key) => Object.hasOwn(state.draft.overrides, key))
                    : Object.keys(state.draft.overrides));
                state.restoredDraft = true;
                renderEditorFields();
                await queueDraftRefresh();
                ui.generatorMessage.textContent = t("theme.message.restoredToolbar");
                ui.generatorMessage.hidden = false;
                setMessage(t("theme.message.restored"));
            } else if (!state.intentPending) {
                await loadSource(state.current.id);
            }
            persephone.onSaveRequest(async () => {
                const saved = await saveDraft(false);
                return saved === true && !state.dirty;
            });
            // Don't Save: drop the draft kept for app restarts, or the reloaded board would restore it.
            persephone.onDiscardRequest(async () => {
                clearTimeout(state.persistTimer);
                await persephone.pageState.remove("draft");
            });
            updateActiveLabel(state.current);
            state.unlistenTheme = persephone.onThemeChange(scheduleExternalRefresh);
            exposeAiVisionModel();
        } catch (error) { reportError(error, t("theme.error.connect")); }
    }
    window.addEventListener("beforeunload", () => {
        clearTimeout(state.externalTimer);
        clearTimeout(state.previewTimer);
        clearTimeout(state.persistTimer);
        if (state.unlistenTheme) state.unlistenTheme();
    });
    initializationPromise = initialize();
    persephone.intent.onRequest(onIntentRequest);
})();
