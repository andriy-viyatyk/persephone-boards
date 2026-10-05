# Certificate Viewer — board notes

## Purpose

Read-only, offline inspection of X.509 certificates, PEM bundles, DER files, CSRs, PKCS#7
certificate collections, and PKCS#12 (`.pfx` / `.p12`) files. The board is a simple custom editor
for `.cer`, `.crt`, `.der`, `.pem`, `.pfx`, `.p12`, `.p7b`, and `.p7c`. It displays public
certificate data only. It does not validate certificate signatures, chains, trust, or revocation.

## How it works

`app.js` reads the hosted file with `persephone.getFilePath()` and
`persephone.readFile(path, { encoding: "binary" })`; `cert-parser.js` detects PEM/DER from bytes
and creates normalized records using the local `window.x509` API. The pinned x509 UMD bundle
calls `Reflect.getMetadata` during startup but does not bundle the reflect-metadata polyfill;
`x509-reflect-shim.js` supplies the small Reflect metadata API it needs before the bundle loads.
Original DER byte sequences are
retained for SHA-1/SHA-256 fingerprints. For PFX/P12, Forge is injected from the local `lib/` only
after the input is identified as PKCS#12. It handles PKCS#12 PBE and ASN.1 transport; certificate
objects are created by Peculiar X.509. A board-owned `<dialog>` asks for a password after the
initial empty-password attempt.

The PFX adapter walks the original PFX AuthenticatedSafe ASN.1. It verifies the PKCS#12 MAC with
Forge's PKCS#12 KDF/HMAC primitives, decrypts encrypted SafeContents with Forge PBE primitives,
and reads SafeBag OIDs directly. It obtains certificate octets from each CertBag's OCTET STRING
and passes those bytes directly to `X509Certificate`. It never calls Forge's `pkcs12FromAsn1()`
reader, whose bag loop would parse certificates and decode private-key bags. No private-key object
or key bytes are materialized by this board. Private material is never part of UI data, output,
clipboard, or diagnostics. Forge is not used for X.509/PKCS#7 parsing or signature/chain validation.

## Key files

| File | Role |
|---|---|
| `index.html` / `style.css` | Certificate list, report tabs, details, and accessible password dialog. No in-board header or footer: Reload is a host toolbar button and the format summary and scope note are host status-bar items. Panels and cards use the page background with borders only (no lighter fills), and no text is smaller than 12px. `board-base.css` is linked first and kept as scaffolded. |
| `app.js` | Readable browser script for the host toolbar (`persephone.toolbar.set`, Reload) and status bar (`persephone.statusBar.set`, summary + scope note), reload, password retry, text-only rendering, public-field clipboard actions, and fingerprint calculation. |
| `cert-parser.js` | Readable browser script for PEM/DER detection, CSR and PKCS#7 parsing, PFX decryption/SafeContents traversal, signature formatting, and best-effort issuer/subject ordering. |
| `x509-reflect-shim.js` | Local minimal Reflect metadata compatibility required because the Peculiar UMD calls `Reflect.getMetadata` without bundling reflect-metadata. |
| `lib/peculiar-x509/` | @peculiar/x509 2.1.0, MIT; certificate, CSR, and PKCS#7 parsing. |
| `lib/node-forge/` | node-forge 1.4.0; lazy PFX PBE/ASN.1 helper only. See its VERSION.txt for the single CSP patch. |
| `board-manifest.json` | All-false permissions, simple-editor masks, and minimum app/bridge versions. |
| `_test/cert-viewer/` | Repo-only synthetic OpenSSL inputs and expected SHA-256 fingerprints. |

The public-key label uses public algorithm names (`RSA · 2048 bits`, `ECDSA · P-256`,
`Ed25519`), not WebCrypto signature-scheme names. Certificate and CSR signature algorithms share
one formatter so the same OID is displayed consistently (for example, `RSA with SHA-256`).

## Run and review

Open a matching certificate file in Persephone, or use the editor switch on an open page. Use
Reload after changing input or board code. A useful synthetic set is described in
`../../_test/cert-viewer/README.md`; generate it with its PowerShell script. Check every certificate's
SHA-256 against that file, including both certificates in the two encrypted multi-cert PFX files.
Exercise empty and wrong passwords, cancel/keyboard behavior, copy actions, all three report tabs,
theme changes, and malformed input. Certificate ordering is best-effort; show the static ordering
note only for multiple certificates and show a dynamic note only for ambiguous/disconnected sets.
When no certificate is present, Overview is the only tab and contains the CSR or private-key
summary. Inspect `ui.log` for CSP/runtime errors. Capture the catalog screenshot from the live
board content area at 1120×700 using synthetic data.

## Gotchas

- The object-form manifest keeps every permission false. Bridge 1.32.0 is required so the board can
  read its exact hosted file without general filesystem access. There is no save/export path.
- Forge is lazy-loaded only for PFX/P12. The global shim's single `new Function` expression was
  changed unconditionally to `globalThis`; no other vendor bytes were changed.
- @peculiar/x509's browser bundle requires Reflect metadata for its tsyringe registrations and does
  not include the polyfill. `x509-reflect-shim.js` supplies the small metadata API before the UMD
  script without adding an npm dependency.
- Current node-forge advisories include a high-severity RSA signature-verification issue affecting
  1.4.0. This viewer never invokes Forge signature verification; it uses Forge only for PBE, MAC,
  and ASN.1 transport. Keep certificate inspection clearly separate from trust decisions.
- Issuer/subject matching gives a best-effort leaf-first display order. Disconnected and ambiguous
  certificate sets retain deterministic source order. Parsing success is not a trust statement.
- All certificate-provided strings are assigned as text nodes. Do not use HTML insertion, native
  `window.prompt`, `window.confirm`, or `window.alert`. Use the `--p-*` theme contract for every
  surface, color, focus state, spacing, and typography. The external Forge script URL is relative
  to this board and subject to the board CSP; no CDN or remote fetch is used.

## Reference

For the canonical bridge, CSP, permissions, and `--p-*` contract, see Persephone's
`persephone://guides/boards` resource.
