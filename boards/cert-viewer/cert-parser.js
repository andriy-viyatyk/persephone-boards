/* Offline X.509/PEM/PKCS#7/PKCS#12 inspection. Never returns private-key bytes or key objects. */
(function () {
    "use strict";

    const X = window.x509;
    const OID = {
        certBag: "1.2.840.113549.1.12.10.1.3",
        keyBag: "1.2.840.113549.1.12.10.1.1",
        shroudedKeyBag: "1.2.840.113549.1.12.10.1.2",
        safeContentsBag: "1.2.840.113549.1.12.10.1.6",
        x509Cert: "1.2.840.113549.1.9.22.1",
        data: "1.2.840.113549.1.7.1",
        encryptedData: "1.2.840.113549.1.7.6",
    };

    const EXT = {
        "2.5.29.15": "Key Usage",
        "2.5.29.37": "Extended Key Usage",
        "2.5.29.17": "Subject Alternative Name",
        "2.5.29.19": "Basic Constraints",
        "2.5.29.35": "Authority Key Identifier",
        "2.5.29.14": "Subject Key Identifier",
        "2.5.29.31": "CRL Distribution Points",
        "1.3.6.1.5.5.7.1.1": "Authority Information Access",
        "2.5.29.32": "Certificate Policies",
        "2.5.29.18": "Issuer Alternative Name",
        "2.5.29.30": "Name Constraints",
        "2.5.29.36": "Policy Constraints",
    };

    const SIGNATURE_OIDS = {
        "1.2.840.113549.1.1.5": "RSA with SHA-1",
        "1.2.840.113549.1.1.11": "RSA with SHA-256",
        "1.2.840.113549.1.1.12": "RSA with SHA-384",
        "1.2.840.113549.1.1.13": "RSA with SHA-512",
        "1.2.840.113549.1.1.10": "RSA-PSS",
        "1.2.840.10045.4.3.2": "ECDSA with SHA-256",
        "1.2.840.10045.4.3.3": "ECDSA with SHA-384",
        "1.2.840.10045.4.3.4": "ECDSA with SHA-512",
        "1.3.101.112": "Ed25519",
        "1.3.101.113": "Ed448",
    };

    // Convert Uint8Array chunks to Forge's binary-string representation without argument limits.
    function bytesToBinary(bytes) {
        let output = "";
        const stride = 0x8000;
        for (let index = 0; index < bytes.length; index += stride) {
            output += String.fromCharCode(...bytes.subarray(index, index + stride));
        }
        return output;
    }

    function binaryToBytes(value) {
        const output = new Uint8Array(value.length);
        for (let index = 0; index < value.length; index += 1) {
            output[index] = value.charCodeAt(index) & 255;
        }
        return output;
    }

    // Validate PEM base64 before decoding so malformed blocks can be reported safely.
    function pemBytes(body) {
        const compact = body.replace(/[\s]/g, "");
        if (!/^[A-Za-z0-9+/]*={0,2}$/.test(compact) || compact.length % 4 === 1) {
            throw new Error("Malformed PEM base64 data.");
        }
        return binaryToBytes(atob(compact));
    }

    // Extract complete PEM blocks while preserving per-block decode errors.
    function pemBlocks(text) {
        const blocks = [];
        const expression = /-----BEGIN ([A-Z0-9][A-Z0-9 -]*)-----([\s\S]*?)-----END \1-----/g;
        let match;

        while ((match = expression.exec(text))) {
            const label = match[1].trim();
            try {
                blocks.push({ label, bytes: pemBytes(match[2]) });
            } catch (error) {
                blocks.push({ label, error: error.message });
            }
        }
        return blocks;
    }

    // Keep raw extension bytes even when no safe typed decoder is available.
    function extData(cert) {
        return (cert.extensions || []).map((extension) => {
            const item = {
                oid: String(extension.type),
                name: EXT[extension.type] || "Unknown extension",
                critical: Boolean(extension.critical),
                rawHex: hex(new Uint8Array(extension.value || [])),
            };

            try {
                const known = {
                    "2.5.29.15": X.KeyUsagesExtension,
                    "2.5.29.37": X.ExtendedKeyUsageExtension,
                    "2.5.29.17": X.SubjectAlternativeNameExtension,
                    "2.5.29.19": X.BasicConstraintsExtension,
                    "2.5.29.35": X.AuthorityKeyIdentifierExtension,
                    "2.5.29.14": X.SubjectKeyIdentifierExtension,
                    "2.5.29.31": X.CRLDistributionPointsExtension,
                    "1.3.6.1.5.5.7.1.1": X.AuthorityInfoAccessExtension,
                    "2.5.29.32": X.CertificatePolicyExtension,
                }[extension.type];

                if (known) {
                    const value = cert.getExtension(known);
                    if (value) item.decoded = formatExtension(value, extension.type);
                }
            } catch (_) {
                // Keep the raw extension value if the typed decoder rejects it.
            }

            return item;
        });
    }

    // Format certificate and CSR signatures through the same OID/name mapping.
    function formatSignatureAlgorithm(value) {
        if (value == null) return "";
        if (typeof value === "number") return String(value);

        const object = typeof value === "object" ? value : null;
        const oid = object && (object.algorithmId || object.algorithm || object.oid);
        const knownName = oid && SIGNATURE_OIDS[oid];
        if (knownName && knownName !== "RSA-PSS") return knownName;

        const name = object && object.name ? String(object.name) : "";
        const hash = object && object.hash && object.hash.name
            ? String(object.hash.name).replace(/-/g, "").toUpperCase()
            : "";

        if (/ed25519/i.test(name) || oid === "1.3.101.112") return "Ed25519";
        if (/ed448/i.test(name) || oid === "1.3.101.113") return "Ed448";
        if (hash && /pss/i.test(name)) return "RSA-PSS with " + readableHash(hash);
        if (hash && /ecdsa|ec/i.test(name)) return "ECDSA with " + readableHash(hash);
        if (hash && /rsa/i.test(name)) return "RSA with " + readableHash(hash);
        if (knownName) return knownName;
        return name || oid || String(value);
    }

    function readableHash(hash) {
        const match = /^SHA(\d+)$/.exec(hash);
        return match ? "SHA-" + match[1] : hash;
    }

    // Render the common typed extensions; unknown structures remain visible as raw hex.
    function formatExtension(value, type) {
        if (type === "2.5.29.15") {
            const names = [
                [1, "Digital Signature"],
                [2, "Non Repudiation"],
                [4, "Key Encipherment"],
                [8, "Data Encipherment"],
                [16, "Key Agreement"],
                [32, "Certificate Sign"],
                [64, "CRL Sign"],
                [128, "Encipher Only"],
                [256, "Decipher Only"],
            ];
            return names
                .filter(([bit]) => (value.usages & bit) !== 0)
                .map((entry) => entry[1])
                .join(", ") || "No usages";
        }

        if (type === "2.5.29.37") {
            const known = {
                "1.3.6.1.5.5.7.3.1": "TLS Web Server Authentication",
                "1.3.6.1.5.5.7.3.2": "TLS Web Client Authentication",
                "1.3.6.1.5.5.7.3.3": "Code Signing",
                "1.3.6.1.5.5.7.3.4": "Email Protection",
                "1.3.6.1.5.5.7.3.8": "Time Stamping",
            };
            return (value.usages || []).map((usage) => known[usage] || usage).join(", ");
        }

        if (type === "2.5.29.17") {
            const names = {
                dns: "DNS",
                email: "Email",
                ip: "IP",
                url: "URI",
                dn: "Directory Name",
            };
            const items = value.names && value.names.items || [];
            return items
                .map((name) => {
                    const label = names[name.type] || String(name.type || "Name");
                    return label + ": " + String(name.value || "(unavailable)");
                })
                .join("\n") || "No names";
        }

        if (type === "2.5.29.19") {
            return "CA: " + (value.ca ? "true" : "false") +
                (value.pathLength != null ? "; path length: " + value.pathLength : "");
        }

        if (type === "2.5.29.14" || type === "2.5.29.35") {
            const identifier = String(value.keyId || "").toUpperCase();
            return identifier
                ? "Key identifier: " + identifier.match(/.{1,2}/g).join(":")
                : "Key identifier unavailable";
        }

        if (type === "2.5.29.31") {
            return simpleList(value.distributionPoints || value.points);
        }
        if (type === "1.3.6.1.5.5.7.1.1") {
            return simpleList(value.accessDescriptions || value.accessDescription);
        }
        if (type === "2.5.29.32") return simpleList(value.policies);
        return "";
    }

    function simpleList(items) {
        if (!items) return "";
        try {
            return Array.from(items)
                .map((item) => {
                    if (typeof item === "string") return item;
                    if (item.value) return String(item.value);
                    if (item.type && item.name) {
                        return String(item.type) + ": " + String(item.name);
                    }
                    return Object.keys(item)
                        .filter((key) => key !== "asn" && key !== "value")
                        .map((key) => key + ": " + String(item[key]))
                        .join(", ");
                })
                .filter(Boolean)
                .join("\n");
        } catch (_) {
            return "";
        }
    }

    function hex(bytes) {
        return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"))
            .join("")
            .toUpperCase();
    }

    // Normalize WebCrypto key names while keeping useful RSA size and EC curve details.
    function keyInfo(key) {
        const algorithm = key && key.algorithm || {};
        const sourceName = algorithm.name || "Unknown";

        if (/rsa/i.test(sourceName)) {
            const details = algorithm.modulusLength
                ? "RSA · " + algorithm.modulusLength + " bits"
                : "RSA";
            return { name: "RSA", details };
        }
        if (/ec|ecdsa/i.test(sourceName)) {
            const details = algorithm.namedCurve
                ? "ECDSA · " + algorithm.namedCurve
                : "ECDSA";
            return { name: "ECDSA", details };
        }
        if (/ed25519/i.test(sourceName)) return { name: "Ed25519", details: "Ed25519" };
        if (/ed448/i.test(sourceName)) return { name: "Ed448", details: "Ed448" };
        return { name: sourceName, details: sourceName };
    }

    // Build a normalized public-certificate record while preserving its original DER bytes.
    function makeRecord(der, source, sourceIndex) {
        const cert = new X.X509Certificate(der);
        const publicKey = keyInfo(cert.publicKey);
        let version = "v1";

        try {
            const rawVersion = cert.asn && cert.asn.tbsCertificate && cert.asn.tbsCertificate.version;
            const number = typeof rawVersion === "number"
                ? rawVersion
                : rawVersion && rawVersion.valueBlock && rawVersion.valueBlock.valueDec;
            if (Number.isFinite(number)) version = "v" + (number + 1);
        } catch (_) {
            // The library's version property below remains the fallback.
        }
        if (cert.version) version = String(cert.version);

        return {
            kind: "certificate",
            cert,
            der: der.slice(),
            source,
            sourceIndex,
            subject: String(cert.subject || "(subject unavailable)"),
            issuer: String(cert.issuer || "(issuer unavailable)"),
            notBefore: cert.notBefore,
            notAfter: cert.notAfter,
            serial: String(cert.serialNumber || ""),
            version: String(version),
            signatureAlgorithm: formatSignatureAlgorithm(cert.signatureAlgorithm || ""),
            publicKeyAlgorithm: publicKey.name,
            publicKeyDetails: publicKey.details,
            extensions: extData(cert),
        };
    }

    function normalizeName(name) {
        return String(name || "").replace(/\s+/g, "").toLowerCase();
    }

    // Order connected certificate sets by subject/issuer names without asserting trust.
    function orderCerts(records) {
        if (records.length < 2) return records;

        const leaves = records.filter((record) => !records.some((other) =>
            other !== record && normalizeName(other.issuer) === normalizeName(record.subject)));
        const roots = records.filter((record) => !records.some((other) =>
            other !== record && normalizeName(other.issuer) === normalizeName(record.subject)));
        const result = [];
        const used = new Set();

        for (const leaf of leaves) {
            let current = leaf;
            let guard = 0;
            while (current && !used.has(current) && guard++ <= records.length) {
                used.add(current);
                result.push(current);
                current = records.find((other) =>
                    !used.has(other) && normalizeName(other.subject) === normalizeName(current.issuer));
            }
        }

        for (const record of records) {
            if (!used.has(record)) result.push(record);
        }
        result.forEach((record, index) => {
            record.orderIndex = index;
        });

        if (leaves.length !== 1 || roots.length !== 1) {
            result.orderNote = "Certificate order is ambiguous or disconnected; source order is used for remaining items.";
        }
        return result;
    }

    // Parse all recognized PEM blocks and classify private-key or unsupported labels safely.
    function rawCerts(bytes, filename) {
        const text = tryUtf8(bytes);
        const hasPem = /-----BEGIN [A-Z0-9][A-Z0-9 -]*-----/.test(text);
        if (!hasPem) {
            return {
                certs: [makeRecord(bytes, filename, 0)],
                rows: [],
                privateKey: false,
                isCsr: false,
                format: "DER certificate",
            };
        }

        const blocks = pemBlocks(text);
        if (!blocks.length) throw new Error("PEM header found but no complete PEM blocks were readable.");

        const certs = [];
        const rows = [];
        let privateKey = false;
        let isCsr = false;
        let isPkcs7 = false;

        for (let index = 0; index < blocks.length; index += 1) {
            const block = blocks[index];
            const label = block.label;
            if (block.error) {
                rows.push({ kind: "error", label, error: block.error });
                continue;
            }

            if (/^(?:CERTIFICATE|TRUSTED CERTIFICATE)$/.test(label)) {
                try {
                    certs.push(makeRecord(block.bytes, filename, index));
                } catch (error) {
                    rows.push({ kind: "error", label, error: error.message });
                }
            } else if (/^(?:PKCS7|CMS)$/.test(label)) {
                isPkcs7 = true;
                try {
                    for (const cert of new X.X509Certificates(block.bytes)) {
                        certs.push(makeRecord(new Uint8Array(cert.rawData), filename, index));
                    }
                } catch (error) {
                    rows.push({ kind: "error", label, error: error.message });
                }
            } else if (/^(?:CERTIFICATE REQUEST|NEW CERTIFICATE REQUEST)$/.test(label)) {
                isCsr = true;
                try {
                    rows.push(parseCsr(block.bytes));
                } catch (error) {
                    rows.push({ kind: "error", label, error: error.message });
                }
            } else if (/PRIVATE KEY$/.test(label) || label === "RSA PRIVATE KEY" || label === "EC PRIVATE KEY") {
                privateKey = true;
                rows.push({ kind: "private-key", label });
            } else {
                rows.push({ kind: "unsupported", label });
            }
        }

        return {
            certs,
            rows,
            privateKey,
            isCsr,
            format: isPkcs7 ? "PEM PKCS#7" : "PEM",
        };
    }

    function tryUtf8(bytes) {
        try {
            return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        } catch (_) {
            return "";
        }
    }

    // Parse a CSR and its requested extensions without exposing private signing material.
    function parseCsr(bytes) {
        const csr = new X.Pkcs10CertificateRequest(bytes);
        const publicKey = keyInfo(csr.publicKey);
        const requested = [];

        try {
            const attributes = csr.attributes || [];
            for (const attribute of attributes) {
                if (attribute.type !== "1.2.840.113549.1.9.14") continue;
                for (const extension of attribute.items || []) {
                    requested.push({
                        oid: extension.type,
                        name: EXT[extension.type] || "Requested extension",
                        critical: Boolean(extension.critical),
                        decoded: formatExtension(extension, extension.type),
                        rawHex: hex(new Uint8Array(extension.value || [])),
                    });
                }
            }
        } catch (_) {
            // Keep the CSR summary even when its optional extension attributes are malformed.
        }

        const algorithm = csr.asn && csr.asn.signatureAlgorithm &&
            csr.asn.signatureAlgorithm.algorithm;
        return {
            kind: "csr",
            subject: String(csr.subject || "(subject unavailable)"),
            publicKeyAlgorithm: publicKey.name,
            publicKeyDetails: publicKey.details,
            signatureAlgorithm: formatSignatureAlgorithm(algorithm),
            extensions: requested,
        };
    }

    // Try a DER certificate, then CSR and PKCS#7 parsing before returning the certificate error.
    function parseDer(bytes, filename) {
        if (bytes.length < 2 || bytes[0] !== 0x30) {
            throw new Error("Input is neither a supported PEM file nor a DER certificate.");
        }

        try {
            return {
                certs: [makeRecord(bytes, filename, 0)],
                rows: [],
                privateKey: false,
                isCsr: false,
                format: "DER certificate",
            };
        } catch (certError) {
            try {
                const csr = parseCsr(bytes);
                return {
                    certs: [],
                    rows: [csr],
                    privateKey: false,
                    isCsr: true,
                    format: "DER certificate request",
                };
            } catch (_) {
                // Continue to the PKCS#7 decoder.
            }

            try {
                const certs = Array.from(
                    new X.X509Certificates(bytes),
                    (cert) => makeRecord(new Uint8Array(cert.rawData), filename, 0),
                );
                if (certs.length) {
                    return {
                        certs,
                        rows: [],
                        privateKey: false,
                        isCsr: false,
                        format: "DER PKCS#7",
                    };
                }
            } catch (_) {
                // Preserve the first useful certificate parse error below.
            }

            throw certError;
        }
    }

    // Inject the self-hosted Forge bundle only for PKCS#12 inputs.
    function loadForge() {
        if (window.forge) return Promise.resolve(window.forge);
        return new Promise((resolve, reject) => {
            const script = document.createElement("script");
            script.src = "./lib/node-forge/forge.min.js";
            script.onload = () => window.forge
                ? resolve(window.forge)
                : reject(new Error("Forge did not initialize."));
            script.onerror = () => reject(new Error("Could not load the local PKCS#12 helper."));
            document.head.appendChild(script);
        });
    }

    function nodeBytes(node) {
        return node && typeof node.value === "string"
            ? binaryToBytes(node.value)
            : new Uint8Array(0);
    }

    function oid(forge, node) {
        return forge.asn1.derToOid(node.value);
    }

    function children(node) {
        return node && Array.isArray(node.value) ? node.value : [];
    }

    // Unwrap implicit context-specific containers used by PKCS#12 SafeContents.
    function unwrap(node) {
        let current = node;
        while (
            current &&
            current.tagClass === forgeClassContext() &&
            children(current).length === 1
        ) {
            current = children(current)[0];
        }
        return current;
    }

    function forgeClassContext() {
        return window.forge.asn1.Class.CONTEXT_SPECIFIC;
    }

    // Verify the PFX MAC before decrypting its contents or accepting an empty password.
    function verifyPfxMac(forge, pfxParts, authSafe, password) {
        if (!pfxParts[2]) return;

        const macData = children(pfxParts[2]);
        const digestInfo = children(macData[0] || {});
        const algorithm = children(digestInfo[0] || {});
        const algorithmOid = algorithm[0] && oid(forge, algorithm[0]);
        const hashInfo = {
            "1.3.14.3.2.26": [forge.md.sha1, 20],
            "2.16.840.1.101.3.4.2.1": [forge.md.sha256, 32],
            "2.16.840.1.101.3.4.2.2": [forge.md.sha384, 48],
            "2.16.840.1.101.3.4.2.3": [forge.md.sha512, 64],
            "1.2.840.113549.2.5": [forge.md.md5, 16],
        }[algorithmOid];

        if (!hashInfo || !digestInfo[1] || !macData[1]) {
            throw new Error("Unsupported PKCS#12 MAC parameters.");
        }

        const digest = nodeBytes(digestInfo[1]);
        const salt = nodeBytes(macData[1]);
        let iterations = 1;
        if (macData[2]) {
            const rawIterations = nodeBytes(macData[2]);
            iterations = 0;
            for (const byte of rawIterations) iterations = iterations * 256 + byte;
            if (rawIterations[0] & 128) {
                iterations -= Math.pow(256, rawIterations.length);
            }
        }

        if (!Number.isSafeInteger(iterations) || iterations < 1 || iterations > 1000000) {
            throw new Error("PKCS#12 MAC iteration count is outside the supported limit.");
        }

        const md = hashInfo[0].create();
        const key = forge.pkcs12.generateKey(
            password,
            forge.util.createBuffer(bytesToBinary(salt)),
            3,
            iterations,
            hashInfo[1],
            md,
        );
        const hmac = forge.hmac.create();
        hmac.start(md, key);
        hmac.update(authSafe);
        const actual = hmac.getMac().getBytes();

        if (actual.length !== digest.length) {
            throw new Error("PKCS#12 MAC could not be verified.");
        }
        let difference = 0;
        for (let index = 0; index < actual.length; index += 1) {
            difference |= actual.charCodeAt(index) ^ digest[index];
        }
        if (difference !== 0) throw new Error("PKCS#12 MAC could not be verified.");
    }

    // Inspect bag OIDs and retain only certificate DER bytes and a private-key presence flag.
    function extractSafeBags(forge, safeBytes, output, depth) {
        if (depth > 8) throw new Error("PKCS#12 SafeContents nesting limit exceeded.");

        const root = forge.asn1.fromDer(safeBytes, false);
        for (const bagNode of children(root)) {
            const bagParts = children(bagNode);
            if (bagParts.length < 2) continue;

            const type = oid(forge, bagParts[0]);
            const bagValue = unwrap(bagParts[1]);
            if (type === OID.keyBag || type === OID.shroudedKeyBag) {
                output.hasPrivateKey = true;
            }

            if (type === OID.certBag) {
                const certParts = children(bagValue);
                if (certParts.length >= 2 && oid(forge, certParts[0]) === OID.x509Cert) {
                    const octets = unwrap(certParts[1]);
                    if (octets && octets.type === forge.asn1.Type.OCTETSTRING) {
                        output.certs.push(nodeBytes(octets));
                    }
                }
            } else if (type === OID.safeContentsBag) {
                const nested = forge.asn1.toDer(bagValue).getBytes();
                extractSafeBags(forge, nested, output, depth + 1);
            }
        }
    }

    // Decrypt PFX SafeContents and extract original certificate OCTET STRING values.
    function extractPfxDer(forge, bytes, password) {
        const pfxNode = forge.asn1.fromDer(bytesToBinary(bytes), false);
        const pfxParts = children(pfxNode);
        if (pfxParts.length < 2) throw new Error("Malformed PKCS#12 container.");

        const authInfo = children(pfxParts[1]);
        const authContent = unwrap(authInfo[1]);
        if (!authContent || authContent.type !== forge.asn1.Type.OCTETSTRING) {
            throw new Error("Unsupported PKCS#12 content wrapper.");
        }

        verifyPfxMac(forge, pfxParts, authContent.value, password);
        const authSafe = forge.asn1.fromDer(authContent.value, false);
        const result = { certs: [], hasPrivateKey: false };

        for (const contentInfo of children(authSafe)) {
            const parts = children(contentInfo);
            if (parts.length < 2) continue;

            const type = oid(forge, parts[0]);
            const wrapped = unwrap(parts[1]);
            let safeBytes;

            if (type === OID.data) {
                if (wrapped.type !== forge.asn1.Type.OCTETSTRING) continue;
                safeBytes = wrapped.value;
            } else if (type === OID.encryptedData) {
                const encryptedInfo = children(wrapped)[1];
                const encryptedParts = children(encryptedInfo);
                const algorithm = encryptedParts[1];
                const algorithmOid = children(algorithm)[0];
                const parameters = children(algorithm)[1];
                const encryptedContent = encryptedParts[2];
                const encryptedBytes = encryptedContent &&
                    (typeof encryptedContent.value === "string"
                        ? encryptedContent.value
                        : children(encryptedContent).map((item) => item.value || "").join(""));
                const cipher = forge.pki.pbe.getCipher(
                    oid(forge, algorithmOid),
                    parameters,
                    password,
                );
                cipher.update(forge.util.createBuffer(encryptedBytes));
                if (!cipher.finish()) {
                    throw new Error("Could not decrypt PKCS#12 safe contents.");
                }
                safeBytes = cipher.output.getBytes();
            } else {
                continue;
            }

            extractSafeBags(forge, safeBytes, result, 0);
        }

        return result;
    }

    // Convert extracted DER records to X.509 models while hiding password/decryption errors.
    async function parsePfx(bytes, filename, password) {
        const forge = await loadForge();
        let extracted;
        try {
            extracted = extractPfxDer(forge, bytes, password);
        } catch (_) {
            throw new Error("Could not open PKCS#12. Check the password and file format.");
        }

        const certs = [];
        let index = 0;
        for (const der of extracted.certs) {
            certs.push(makeRecord(der, filename, index));
            index += 1;
        }
        if (!certs.length) {
            throw new Error("This PKCS#12 file contains no supported X.509 certificates.");
        }

        return {
            certs,
            rows: [],
            privateKey: extracted.hasPrivateKey,
            isCsr: false,
            format: "PKCS#12",
            orderNote: "",
        };
    }

    // Identify a PKCS#12 container from its ASN.1 content OID, independent of filename.
    function looksPfx(bytes) {
        function read(offset) {
            if (offset + 2 > bytes.length) return null;
            const tag = bytes[offset];
            offset += 1;
            let length = bytes[offset];
            offset += 1;

            if (length & 128) {
                const count = length & 127;
                if (!count || count > 4 || offset + count > bytes.length) return null;
                length = 0;
                for (let index = 0; index < count; index += 1) {
                    length = length * 256 + bytes[offset];
                    offset += 1;
                }
            }
            return { tag, start: offset, end: offset + length };
        }

        const root = read(0);
        if (!root || root.tag !== 0x30) return false;
        const version = read(root.start);
        if (!version || version.tag !== 0x02 || version.end - version.start !== 1 || bytes[version.start] !== 3) {
            return false;
        }
        const auth = read(version.end);
        if (!auth || auth.tag !== 0x30) return false;
        const data = read(auth.start);
        if (!data || data.tag !== 0x06 || data.end - data.start !== 9) return false;
        return bytes.subarray(data.start, data.end).join(",") === "42,134,72,134,247,13,1,7,1";
    }

    // Detect the container from bytes first, then apply best-effort ordering to certificate sets.
    async function parse(bytes, filename, password) {
        if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);

        if (/\.(?:pfx|p12)$/i.test(filename || "") || looksPfx(bytes)) {
            const result = await parsePfx(bytes, filename, password == null ? "" : password);
            if (result.certs.length > 1) {
                result.certs = orderCerts(result.certs);
                result.orderNote = result.certs.orderNote || "";
            }
            return result;
        }

        const text = tryUtf8(bytes);
        const hasPem = /-----BEGIN [A-Z0-9][A-Z0-9 -]*-----/.test(text);
        const result = hasPem ? rawCerts(bytes, filename) : parseDer(bytes, filename);
        const isBundle = result.format.indexOf("PKCS#7") >= 0 || result.certs.length > 1;
        if (result.certs.length && isBundle) {
            result.certs = orderCerts(result.certs);
            result.orderNote = result.certs.orderNote || "";
        }
        return result;
    }

    window.CertParser = { parse, parseCsr, hex, looksPfx };
}());
