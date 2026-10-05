"use strict";

const P = window.persephone;
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

const TAB_DEFS = [
    { id: "overview", label: "Overview" },
    { id: "extensions", label: "Extensions" },
    { id: "details", label: "Raw / Details" },
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
            const button = node("button", "copy-btn", "Copy");
            button.type = "button";
            button.title = "Copy public certificate field";
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
        P.notify("Copied public certificate value", "success");
    } catch (error) {
        P.notify("Copy failed: " + errorText(error), "error");
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

    if (Number.isFinite(end) && end < now) return ["Expired", "status-expired"];
    if (Number.isFinite(start) && start > now) return ["Not yet valid", "status-soon"];
    if (Number.isFinite(end) && end - now < 30 * 86400000) {
        return ["Expires within 30 days", "status-soon"];
    }
    return ["Within stated validity dates", "status-good"];
}

function certName(cert) {
    return cert.subject || "Certificate";
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

    countEl.textContent = certs.length ? String(certs.length) : "none";
    $("order-note").hidden = certs.length <= 1;
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
    const status = certStatus(cert);
    appendCard(panelEl, "Identity & validity", [
        ["Subject", cert.subject, "", true],
        ["Issuer", cert.issuer, "", true],
        ["Status", status[0], status[1]],
        ["Valid from", dateText(cert.notBefore)],
        ["Valid until", dateText(cert.notAfter)],
        ["Serial number", cert.serial, "mono", true],
        ["X.509 version", cert.version],
        ["Signature algorithm", cert.signatureAlgorithm],
        ["Public key", cert.publicKeyDetails],
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

    appendCard(panelEl, "Common extensions", [
        ["Key usage", keyUsage && keyUsage.decoded],
        ["Extended key usage", extendedKeyUsage && extendedKeyUsage.decoded],
        ["Subject alternative names", subjectAltName && subjectAltName.decoded],
        ["Basic constraints", basicConstraints && basicConstraints.decoded],
        ["Authority key identifier", authorityKeyId && authorityKeyId.decoded],
        ["Subject key identifier", subjectKeyId && subjectKeyId.decoded],
        ["CRL distribution points", crlDistribution && crlDistribution.decoded],
        ["Authority information access", authorityInfo && authorityInfo.decoded],
        ["Certificate policies", policies && policies.decoded],
    ]);

    const fingerprintCard = node("section", "card");
    fingerprintCard.appendChild(
        node("h3", "", "Certificate fingerprints (original DER bytes)"),
    );
    const pending = node("p", "note", "Computing SHA-1 and SHA-256…");
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

                const button = node("button", "copy-btn", "Copy");
                button.type = "button";
                button.addEventListener("click", () => copy(value));
                td.appendChild(button);
                tr.append(th, td);
                table.appendChild(tr);
            }

            fingerprintCard.appendChild(table);
        })
        .catch((error) => {
            pending.textContent = "Fingerprints unavailable: " + errorText(error);
        });
}

function ext(cert, oid) {
    return (cert.extensions || []).find((item) => item.oid === oid);
}

function dateText(date) {
    const value = new Date(date);
    return Number.isFinite(value.getTime())
        ? value.toISOString().replace("T", " ").replace(".000Z", " UTC")
        : "Unavailable";
}

function renderExtensions(cert) {
    panelEl.textContent = "";
    if (!cert.extensions || !cert.extensions.length) {
        panelEl.appendChild(node("p", "note", "No extensions are present."));
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
                extension.decoded || "Raw extension value (DER hex; not semantically decoded).",
            ),
        );
        item.appendChild(node("pre", "raw mono", extension.rawHex || "(empty)"));
        panelEl.appendChild(item);
    }
}

function renderDetails(cert) {
    panelEl.textContent = "";
    appendCard(panelEl, "Certificate details", [
        ["Subject", cert.subject, "", true],
        ["Issuer", cert.issuer, "", true],
        ["Serial number", cert.serial, "mono", true],
        ["Version", cert.version],
        ["Signature algorithm", cert.signatureAlgorithm],
        ["Public key algorithm", cert.publicKeyAlgorithm],
        ["Public key size / curve", cert.publicKeyDetails],
    ]);
    renderExtensions(cert);
}

// Summarize PEM requests and unsupported blocks without exposing their raw content.
function renderRows() {
    const box = node("section", "card");
    box.appendChild(node("h3", "", "Input contents"));

    for (const row of data.rows || []) {
        let text = "";
        if (row.kind === "private-key") {
            text = "Private key block detected (" + row.label + "); key material is hidden.";
        } else if (row.kind === "csr") {
            text = "Certificate request (PKCS#10)";
        } else if (row.kind === "unsupported") {
            text = "Unsupported PEM block: " + row.label + " (contents hidden).";
        } else {
            text = "Could not parse " + row.label + ": " + row.error;
        }

        box.appendChild(node("p", "note", text));
        if (row.kind === "csr") {
            appendCard(box, "Request summary", [
                ["Request version", "v1"],
                ["Subject", row.subject],
                ["Public key", row.publicKeyDetails],
                ["Signature algorithm", row.signatureAlgorithm],
                [
                    "Requested extensions",
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
        titleEl.textContent = certName(cert);
        if (tab === "overview") renderOverview(cert);
        else if (tab === "extensions") renderExtensions(cert);
        else renderDetails(cert);
        return;
    }

    titleEl.textContent = data && data.isCsr ? "Certificate request" : "Input summary";
    panelEl.appendChild(renderRows());
}

// One status-bar line: the input format and what it holds, or progress and errors.
function setStatus(text, tone) {
    P.statusBar.update("summary", { text, tone: tone || "muted" });
}

function setSummary(dataValue) {
    const count = dataValue.certs.length;
    const parts = [dataValue.format || "Certificate input"];
    if (count) parts.push(count === 1 ? "1 certificate" : count + " certificates");
    if (dataValue.isCsr) parts.push("certificate request");
    setStatus(parts.join(" · "), "normal");
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
            "Contains a private key (not shown)",
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
                passwordError.textContent = "Password or file was not accepted. Try again, or cancel.";
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
    const token = ++loadToken;
    setReloadEnabled(false);

    try {
        state("Loading certificate file…");
        data = null;
        setStatus("Loading…");

        const path = await P.getFilePath();
        filePath = path || "";
        if (!filePath) {
            setStatus("No file open");
            state("Open a .cer, .crt, .der, .pem, .pfx, .p12, .p7b or .p7c file to inspect it.");
            return;
        }

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
            state("Password entry cancelled.");
            setStatus("Password entry cancelled");
            return;
        }
        if (!parsed.certs.length && !parsed.rows.length) {
            throw new Error("No supported certificates, requests, or recognizable public blocks were found.");
        }

        install(parsed);
    } catch (error) {
        const message = errorText(error);
        state("Could not inspect this file.\n" + message, true);
        P.notify(message, "error");
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
    { id: "reload", type: "button", title: "Reload file", icon: { name: "refresh" } },
]);
P.statusBar.set([
    { id: "summary", type: "text", text: "Loading…", tone: "muted" },
    {
        id: "scope",
        type: "text",
        text: "Descriptive parsing only · no chain validation or revocation checks",
        tone: "muted",
        align: "end",
    },
]);
P.toolbar.onAction(({ id }) => {
    if (id === "reload") load();
});

load();
