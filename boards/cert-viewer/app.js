"use strict";

const P = window.persephone;
const t = (key, params) => P.i18n.t(key, params);
applyI18n(document);
const $ = (id) => document.getElementById(id);

const stateEl = $("state");
const reportEl = $("report");
const listEl = $("cert-list");
const countEl = $("cert-count");
const titleEl = $("selection-title");
const tabsEl = $("tabs");
const panelEl = $("panel");
const dialog = $("password-dialog");
const passwordForm = $("password-form");
const passwordInput = $("password-input");
const passwordError = $("password-error");

let filePath = "";
let data = null;
let selected = 0;
let tab = "overview";
let loadToken = 0;
let previousFocus = null;
let activeMode = "empty";
let capabilityPayload = null;
let intentSeen = false;
const processedIntentIds = new Set();
const PAGE_STATE_KEY = "certificate-chain";

const TAB_DEFS = [
    { id: "overview", label: t("tab.overview") },
    { id: "extensions", label: t("tab.extensions") },
    { id: "details", label: t("tab.details") },
];

// Create elements with text content so file-provided values are never interpreted as markup.
function node(tag, cls, text) {
    const element = document.createElement(tag);
    if (cls) element.className = cls;
    if (text != null) element.textContent = String(text);
    return element;
}

// Switch between the loading/error state and the certificate report.
function state(text, error) {
    reportEl.hidden = true;
    stateEl.hidden = false;
    stateEl.className = "state" + (error ? " error" : "");
    stateEl.textContent = text;
}

function showReport() {
    stateEl.hidden = true;
    reportEl.hidden = false;
}

function errorText(error) {
    return error && error.message ? error.message : String(error || "Unknown error");
}

// Render labeled values and add copy actions only to explicitly public fields.
function appendCard(parent, title, rows) {
    const card = node("section", "card");
    card.appendChild(node("h3", "", title));

    const table = node("table", "kv");
    for (const row of rows) {
        if (row[1] == null || row[1] === "") continue;

        const tr = document.createElement("tr");
        tr.appendChild(node("th", "", row[0]));

        const td = node("td", "value");
        const value = String(row[1]);
        td.appendChild(node("span", row[2] || "", value));

        if (row[3]) {
            const button = node("button", "copy-btn", t("action.copy"));
            button.type = "button";
            button.title = t("action.copyField.title");
            button.addEventListener("click", () => copy(value));
            td.appendChild(button);
        }

        tr.appendChild(td);
        table.appendChild(tr);
    }

    card.appendChild(table);
    parent.appendChild(card);
}

async function copy(text) {
    try {
        await P.clipboard.writeText(text);
        P.notify(t("toast.copy.success"), "success");
    } catch (error) {
        P.notify(t("toast.copy.error", {error:errorText(error)}), "error");
    }
}

// Hash the original certificate bytes, not a re-encoded certificate object.
async function fingerprint(bytes, algorithm) {
    const digest = await crypto.subtle.digest(algorithm, bytes);
    return Array.from(
        new Uint8Array(digest),
        (byte) => byte.toString(16).padStart(2, "0").toUpperCase(),
    ).join(":");
}

function certStatus(cert) {
    const now = Date.now();
    const end = new Date(cert.notAfter).getTime();
    const start = new Date(cert.notBefore).getTime();

    if (Number.isFinite(end) && end < now) return [t("validity.expired"), "status-expired"];
    if (Number.isFinite(start) && start > now) return [t("validity.notYet"), "status-soon"];
    if (Number.isFinite(end) && end - now < 30 * 86400000) {
        return [t("validity.expiring"), "status-soon"];
    }
    return [t("validity.within"), "status-good"];
}

function certName(cert) {
    return cert.subject || t("certificate.fallback");
}

// Build the selectable certificate list and keep its count visible for empty inputs.
function renderList() {
    listEl.textContent = "";
    const certs = data.certs || [];

    for (let index = 0; index < certs.length; index += 1) {
        const cert = certs[index];
        const button = node(
            "button",
            "cert-option" + (index === selected ? " selected" : ""),
        );
        button.type = "button";
        button.setAttribute("aria-pressed", String(index === selected));
        button.append(
            node("span", "cert-option-title", certName(cert)),
            node("span", "cert-option-sub", cert.publicKeyDetails),
        );

        const status = certStatus(cert);
        button.appendChild(node("span", "cert-option-sub " + status[1], status[0]));
        button.addEventListener("click", () => {
            selected = index;
            renderList();
            renderSelected();
        });
        listEl.appendChild(button);
    }

    countEl.textContent = certs.length ? new Intl.NumberFormat(P.locale.code).format(certs.length) : t("count.none");
    // A chain sent by the browser is in Chromium's verified order, so the best-effort note
    // applies only to certificates read from a file.
    $("order-note").hidden = certs.length <= 1 || Boolean(capabilityPayload);
}

// Only certificate inputs get certificate-specific tabs; CSR/key inputs show Overview alone.
function renderTabs() {
    tabsEl.textContent = "";
    const hasCertificates = Boolean(data && data.certs && data.certs.length);
    const definitions = hasCertificates ? TAB_DEFS : TAB_DEFS.slice(0, 1);
    tabsEl.hidden = false;

    for (const item of definitions) {
        const button = node(
            "button",
            "tab" + (tab === item.id ? " active" : ""),
            item.label,
        );
        button.type = "button";
        button.setAttribute("aria-selected", String(tab === item.id));
        button.addEventListener("click", () => {
            tab = item.id;
            renderSelected();
        });
        tabsEl.appendChild(button);
    }
}

// Show certificate identity, common extensions, and asynchronous source-DER fingerprints.
function renderOverview(cert) {
    panelEl.textContent = "";
    if (capabilityPayload) {
        const rows = [[t("field.title"), capabilityPayload.title]];
        if (capabilityPayload.sourceUrl) rows.push([t("field.opened.from"), capabilityPayload.sourceUrl]);
        appendCard(panelEl, t("status.siteCertificate"), rows);
    }

    const status = certStatus(cert);
    appendCard(panelEl, t("card.identityValidity"), [
        [t("field.subject"), cert.subject, "", true],
        [t("field.issuer"), cert.issuer, "", true],
        [t("field.status"), status[0], status[1]],
        [t("field.valid.from"), dateText(cert.notBefore)],
        [t("field.valid.until"), dateText(cert.notAfter)],
        [t("field.serial.number"), cert.serial, "mono", true],
        [t("field.x.509.version"), cert.version],
        [t("field.signature.algorithm"), cert.signatureAlgorithm],
        [t("field.public.key"), cert.publicKeyDetails],
    ]);

    const keyUsage = ext(cert, "2.5.29.15");
    const extendedKeyUsage = ext(cert, "2.5.29.37");
    const subjectAltName = ext(cert, "2.5.29.17");
    const basicConstraints = ext(cert, "2.5.29.19");
    const authorityKeyId = ext(cert, "2.5.29.35");
    const subjectKeyId = ext(cert, "2.5.29.14");
    const crlDistribution = ext(cert, "2.5.29.31");
    const authorityInfo = ext(cert, "1.3.6.1.5.5.7.1.1");
    const policies = ext(cert, "2.5.29.32");

    appendCard(panelEl, t("card.commonExtensions"), [
        [t("field.key.usage"), keyUsage && keyUsage.decoded],
        [t("field.extended.key.usage"), extendedKeyUsage && extendedKeyUsage.decoded],
        [t("field.subject.alternative.names"), subjectAltName && subjectAltName.decoded],
        [t("field.basic.constraints"), basicConstraints && basicConstraints.decoded],
        [t("field.authority.key.identifier"), authorityKeyId && authorityKeyId.decoded],
        [t("field.subject.key.identifier"), subjectKeyId && subjectKeyId.decoded],
        [t("field.crl.distribution.points"), crlDistribution && crlDistribution.decoded],
        [t("field.authority.information.access"), authorityInfo && authorityInfo.decoded],
        [t("field.certificate.policies"), policies && policies.decoded],
    ]);

    const fingerprintCard = node("section", "card");
    fingerprintCard.appendChild(
        node("h3", "", t("fingerprints.title")),
    );
    const pending = node("p", "note", t("fingerprints.loading"));
    fingerprintCard.appendChild(pending);
    panelEl.appendChild(fingerprintCard);

    Promise.all([
        fingerprint(cert.der, "SHA-1"),
        fingerprint(cert.der, "SHA-256"),
    ])
        .then((values) => {
            if (!data || data.certs[selected] !== cert) return;

            pending.remove();
            const table = node("table", "kv");
            const rows = [
                ["SHA-1", values[0]],
                ["SHA-256", values[1]],
            ];

            for (const [label, value] of rows) {
                const tr = document.createElement("tr");
                const th = node("th", "", label);
                const td = node("td", "value");
                td.appendChild(node("span", "mono", value));

                const button = node("button", "copy-btn", t("action.copy"));
                button.type = "button";
                button.addEventListener("click", () => copy(value));
                td.appendChild(button);
                tr.append(th, td);
                table.appendChild(tr);
            }

            fingerprintCard.appendChild(table);
        })
        .catch((error) => {
            pending.textContent = t("fingerprints.error", {error:errorText(error)});
        });
}

function ext(cert, oid) {
    return (cert.extensions || []).find((item) => item.oid === oid);
}

function dateText(date) {
    const value = new Date(date);
    return Number.isFinite(value.getTime())
        ? value.toISOString().replace("T", " ").replace(".000Z", " UTC")
        : t("date.unavailable");
}

function renderExtensions(cert) {
    if (!cert.extensions || !cert.extensions.length) {
        panelEl.appendChild(node("p", "note", t("extensions.empty")));
        return;
    }

    for (const extension of cert.extensions) {
        const item = node("section", "extension");
        const suffix = extension.critical ? " · critical" : "";
        item.appendChild(
            node("h3", "", extension.name + " · " + extension.oid + suffix),
        );
        item.appendChild(
            node(
                "pre",
                "",
                extension.decoded || t("extensions.raw"),
            ),
        );
        item.appendChild(node("pre", "raw mono", extension.rawHex || t("count.none")));
        panelEl.appendChild(item);
    }
}

// Raw view of one certificate: its algorithm details and the certificate itself as PEM,
// built from the original DER bytes. A certificate is public data, so it can be copied.
function renderDetails(cert) {
    appendCard(panelEl, t("card.certificateDetails"), [
        [t("field.version"), cert.version],
        [t("field.signature.algorithm"), cert.signatureAlgorithm],
        [t("field.public.key.algorithm"), cert.publicKeyAlgorithm],
        [t("field.public.key.size.curve"), cert.publicKeyDetails],
        [t("field.extensions"), String((cert.extensions || []).length)],
        [t("field.der.size"), new Intl.NumberFormat(P.locale.code).format(cert.der.length) + " " + t("common.bytes")],
    ]);

    const pem = certificateToPem(cert.der);
    const card = node("section", "card");
    const heading = node("div", "card-heading");
    heading.appendChild(node("h3", "", t("certificate.pem.title")));
    const button = node("button", "copy-btn", t("action.copy"));
    button.type = "button";
    button.title = t("action.copyPem.title");
    button.addEventListener("click", () => copy(pem));
    heading.appendChild(button);
    card.appendChild(heading);
    card.appendChild(node("pre", "raw mono pem", pem));
    panelEl.appendChild(card);
}

// Encode DER bytes as one PEM certificate block with 64-character lines.
function certificateToPem(der) {
    let binary = "";
    for (let index = 0; index < der.length; index++) {
        binary += String.fromCharCode(der[index]);
    }
    const lines = btoa(binary).match(/.{1,64}/g) || [];
    return ["-----BEGIN CERTIFICATE-----", ...lines, "-----END CERTIFICATE-----"].join("\n");
}

// Summarize PEM requests and unsupported blocks without exposing their raw content.
function renderRows() {
    const box = node("section", "card");
    box.appendChild(node("h3", "", t("input.contents")));

    for (const row of data.rows || []) {
        let text = "";
        if (row.kind === "private-key") {
            text = t("input.privateKey", {label:row.label});
        } else if (row.kind === "csr") {
            text = t("input.csr");
        } else if (row.kind === "unsupported") {
            text = t("input.unsupported", {label:row.label});
        } else {
            text = t("input.parseError", {label:row.label,error:row.error});
        }

        box.appendChild(node("p", "note", text));
        if (row.kind === "csr") {
            appendCard(box, t("card.requestSummary"), [
                [t("field.request.version"), "v1"],
                [t("field.subject"), row.subject],
                [t("field.public.key"), row.publicKeyDetails],
                [t("field.signature.algorithm"), row.signatureAlgorithm],
                [
                    t("field.requested.extensions"),
                    (row.extensions || [])
                        .map((item) => {
                            const value = item.decoded || "raw " + item.rawHex;
                            return item.name + " (" + item.oid + "): " + value;
                        })
                        .join("\n"),
                ],
            ]);
        }
    }

    return box;
}

// Keep no-certificate inputs on Overview and render their safe request/key summary there.
function renderSelected() {
    const certs = data && data.certs;
    const cert = certs && certs[selected];
    if (!cert) tab = "overview";

    renderTabs();
    panelEl.textContent = "";

    if (cert) {
        titleEl.textContent = capabilityPayload
            ? t("title.siteCertificate", {title:capabilityPayload.title})
            : certName(cert);
        if (tab === "overview") renderOverview(cert);
        else if (tab === "extensions") renderExtensions(cert);
        else renderDetails(cert);
        return;
    }

    titleEl.textContent = data && data.isCsr ? t("status.request") : t("title.inputSummary");
    panelEl.appendChild(renderRows());
}

// One status-bar line: the input format and what it holds, or progress and errors.
function setStatus(text, tone) {
    P.statusBar.update("summary", { text, tone: tone || "muted" });
}

function setSummary(dataValue) {
    const count = dataValue.certs.length;
    if (capabilityPayload) {
        const label = t("status.certificates", {count});
        setStatus(t("status.siteSummary", {label,title:capabilityPayload.title}), "normal");
        return;
    }

    const parts = [dataValue.format || t("status.certificateInput")];
    if (count) parts.push(t("status.certificates", {count}));
    if (dataValue.isCsr) parts.push(t("status.request"));
    setStatus(parts.join(t("status.summarySeparator")), "normal");
}

function setReloadEnabled(enabled) {
    P.toolbar.update([{ id: "reload", disabled: !enabled }]);
}

// Install parsed data and show only order warnings that need special attention.
function install(dataValue) {
    data = dataValue;
    selected = 0;
    setSummary(data);
    showReport();
    document.querySelectorAll(".summary-note").forEach((element) => element.remove());
    renderList();

    if (data.privateKey) {
        const note = node(
            "p",
            "note status-soon summary-note",
            t("input.privateKeyNote"),
        );
        document.querySelector(".cert-list-pane").appendChild(note);
    }

    if (data.orderNote) {
        const note = node("p", "note summary-note", data.orderNote);
        document.querySelector(".cert-list-pane").appendChild(note);
    }

    renderSelected();
}

// Keep password retries inside the board dialog and clear each submitted value immediately.
function passwordPrompt(bytes, path) {
    return new Promise((resolve) => {
        let settled = false;

        const finish = (value) => {
            if (settled) return;
            settled = true;
            dialog.removeEventListener("cancel", onCancel);
            resolve(value);
        };

        const onCancel = (event) => {
            event.preventDefault();
            passwordInput.value = "";
            dialog.close("cancel");
            finish(null);
        };

        previousFocus = document.activeElement;
        passwordError.textContent = "";
        passwordInput.value = "";
        dialog.showModal();
        dialog.addEventListener("cancel", onCancel);
        passwordInput.focus();

        passwordForm.onsubmit = async (event) => {
            event.preventDefault();
            const entered = passwordInput.value;
            passwordInput.value = "";
            const submit = passwordForm.querySelector('[type="submit"]');
            submit.disabled = true;

            try {
                const result = await window.CertParser.parse(bytes, path, entered);
                dialog.close("submit");
                finish(result);
            } catch (_) {
                passwordError.textContent = t("password.rejected");
                passwordInput.focus();
            } finally {
                submit.disabled = false;
            }
        };

        $("password-cancel").onclick = () => {
            passwordInput.value = "";
            dialog.close("cancel");
            finish(null);
        };
    });
}

async function openWithPassword(bytes, path) {
    try {
        return await window.CertParser.parse(bytes, path, "");
    } catch (_) {
        return passwordPrompt(bytes, path);
    }
}

// Read the hosted file, route PFX inputs through the password flow, and ignore stale reloads.
async function load() {
    if (activeMode === "capability") {
        await reloadCapability();
        return;
    }
    if (activeMode === "intent-error") return;

    await loadFileOrRestore();
}

// Decode the host's canonical base64 values without changing the original DER bytes.
function decodeBase64(value, index) {
    if (typeof value !== "string" || !value || value.length % 4 !== 0) {
        throw new Error("Certificate " + (index + 1) + " is not valid base64.");
    }
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
        throw new Error("Certificate " + (index + 1) + " is not valid base64.");
    }

    let binary;
    try {
        binary = atob(value);
    } catch (_) {
        throw new Error("Certificate " + (index + 1) + " is not valid base64.");
    }
    const bytes = new Uint8Array(binary.length);
    for (let offset = 0; offset < binary.length; offset += 1) {
        bytes[offset] = binary.charCodeAt(offset);
    }
    if (btoa(binary) !== value) {
        throw new Error("Certificate " + (index + 1) + " is not canonical base64.");
    }
    return bytes;
}

// Validate requests and saved page data at the same board-owned boundary.
function normalizeCapabilityPayload(value, saved) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("The certificate request payload must be an object.");
    }
    if (typeof value.title !== "string" || !value.title.trim()) {
        throw new Error("The certificate request needs a non-empty title.");
    }
    if (!Array.isArray(value.certificates) || !value.certificates.length) {
        throw new Error("The certificate request needs a non-empty certificates array.");
    }
    if (saved && value.sourceUrl !== undefined && typeof value.sourceUrl !== "string") {
        throw new Error("The saved certificate source URL is invalid.");
    }

    let sourceUrl;
    if (saved) {
        sourceUrl = value.sourceUrl;
    } else if (value.source !== undefined) {
        if (!value.source || typeof value.source !== "object" || Array.isArray(value.source)) {
            throw new Error("The certificate request source must be an object.");
        }
        if (typeof value.source.url !== "string") {
            throw new Error("The certificate request source URL must be a string.");
        }
        sourceUrl = value.source.url;
    }

    const certificates = value.certificates.map((item, index) => {
        if (typeof item !== "string") {
            throw new Error("Certificate " + (index + 1) + " must be a base64 string.");
        }
        return item;
    });
    return { title: value.title, certificates, sourceUrl };
}

// Parse and render one validated chain while preserving the request's leaf-first order.
function renderCapability(payload) {
    const bytes = payload.certificates.map((value, index) => decodeBase64(value, index));
    const parsed = window.CertParser.parseCertificateChain(bytes, payload.title);
    capabilityPayload = payload;
    activeMode = "capability";
    filePath = "";
    install(parsed);
}

// Handle each host request once, persist it before rendering, and always settle it.
async function handleIntent(request) {
    if (!request || processedIntentIds.has(request.requestId)) return;
    processedIntentIds.add(request.requestId);
    intentSeen = true;
    const token = ++loadToken;
    activeMode = "capability";
    setReloadEnabled(false);

    try {
        if (request.id !== "certificate.view") {
            throw new Error("Unsupported capability request: " + String(request.id || "(missing id)"));
        }
        if (request.version !== 1) {
            throw new Error("Unsupported certificate.view version: " + String(request.version));
        }
        const payload = normalizeCapabilityPayload(request.payload, false);
        const parsed = window.CertParser.parseCertificateChain(
            payload.certificates.map((value, index) => decodeBase64(value, index)),
            payload.title,
        );
        const saved = {
            title: payload.title,
            certificates: payload.certificates,
        };
        if (payload.sourceUrl !== undefined) saved.sourceUrl = payload.sourceUrl;

        await P.pageState.set(PAGE_STATE_KEY, JSON.stringify(saved));
        if (token !== loadToken) {
            request.reject("Certificate request was superseded before it could be displayed.");
            return;
        }
        capabilityPayload = payload;
        activeMode = "capability";
        filePath = "";
        install(parsed);
        request.resolve();
    } catch (error) {
        if (token === loadToken) {
            data = null;
            capabilityPayload = null;
            activeMode = "intent-error";
            state(t("errors.openSiteCertificate") + "\n" + errorText(error), true);
            setStatus(t("status.requestFailed"), "error");
            setReloadEnabled(false);
        }
        request.reject(errorText(error));
    }
}

// Restore the saved request only when no file is attached to this page.
async function restoreCapability() {
    const serialized = await P.pageState.get(PAGE_STATE_KEY);
    if (serialized === undefined) return false;

    let stored;
    try {
        stored = JSON.parse(serialized);
        const payload = normalizeCapabilityPayload(stored, true);
        renderCapability(payload);
        return true;
    } catch (error) {
        throw new Error("Saved certificate data could not be restored: " + errorText(error));
    }
}

// Re-read persisted request data so Reload exercises the restart-safe source of truth.
async function reloadCapability() {
    const token = ++loadToken;
    setReloadEnabled(false);
    try {
        state(t("status.loading"));
        setStatus(t("status.loading"));
        capabilityPayload = null;
        if (!await restoreCapability()) {
            throw new Error("No saved certificate chain is available.");
        }
    } catch (error) {
        state(t("errors.restoreSiteCertificate") + "\n" + errorText(error), true);
        setStatus(t("status.restoreFailed"), "error");
    } finally {
        if (token === loadToken) setReloadEnabled(true);
    }
}

// Preserve file loading and prefer it over saved page data on ordinary page startup.
async function loadFileOrRestore() {
    const token = ++loadToken;
    setReloadEnabled(false);

    try {
        state(t("status.loadingFile"));
        data = null;
        setStatus(t("status.loading"));

        const path = await P.getFilePath();
        filePath = path || "";
        if (intentSeen || token !== loadToken) return;
        if (!filePath) {
            try {
                const restored = await restoreCapability();
                if (intentSeen || token !== loadToken) return;
                if (restored) return;
            } catch (_) {
                // Malformed page state falls back to the normal empty-page view.
            }
            if (intentSeen || token !== loadToken) return;
            activeMode = "empty";
            capabilityPayload = null;
            setStatus(t("status.noFile"));
            state(t("empty.supportedFormats"));
            return;
        }
        activeMode = "file";
        capabilityPayload = null;

        const bytes = await P.readFile(filePath, { encoding: "binary" });
        if (token !== loadToken) return;

        let parsed;
        if (window.CertParser.looksPfx(bytes) || /\.(?:pfx|p12)$/i.test(filePath)) {
            parsed = await openWithPassword(bytes, filePath);
        } else {
            parsed = await window.CertParser.parse(bytes, filePath);
        }
        if (token !== loadToken) return;
        if (!parsed) {
            state(t("status.passwordCancelled"));
            setStatus(t("status.passwordCancelled"));
            return;
        }
        if (!parsed.certs.length && !parsed.rows.length) {
            throw new Error("No supported certificates, requests, or recognizable public blocks were found.");
        }

        install(parsed);
    } catch (error) {
        if (intentSeen || token !== loadToken) return;
        const message = errorText(error);
        state(t("errors.inspectFile") + "\n" + message, true);
        P.notify(t("errors.inspectFile"), "error");
    } finally {
        if (token === loadToken) setReloadEnabled(true);
        if (previousFocus && previousFocus.isConnected) {
            previousFocus.focus();
            previousFocus = null;
        }
    }
}

// The toolbar and status bar are Persephone's own, host-rendered. Declaring them from top-level
// code is fine: the shim queues the calls until the frame's load event, and a reload clears
// both catalogs, so this script declares them again when it runs.
P.toolbar.set([
    { id: "reload", type: "button", title: t("toolbar.reload"), icon: { name: "refresh" } },
]);
P.statusBar.set([
    { id: "summary", type: "text", text: t("status.loading"), tone: "muted" },
    {
        id: "scope",
        type: "text",
        text: t("status.scope"),
        tone: "muted",
        align: "end",
    },
]);
P.toolbar.onAction(({ id }) => {
    if (id === "reload") load();
});

const unsubscribeIntent = P.intent.onRequest((request) => {
    void handleIntent(request);
});
const initialIntent = P.intent.get();
if (initialIntent) void handleIntent(initialIntent);
window.addEventListener("pagehide", unsubscribeIntent, { once: true });

loadFileOrRestore();
