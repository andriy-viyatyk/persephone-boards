# BT-030: Certificate Viewer

## Status

**Status:** Done  
**Priority:** Medium  
**Board id:** `cert-viewer`  
**Started:** 2026-10-05  
**Completed:** —

## Goal

Create a fully offline, read-only Persephone simple custom editor for X.509 certificate files and bundles. Show certificate identity, validity, fingerprints, public-key metadata, and useful extensions while never displaying or copying private-key material from PEM or PKCS#12 inputs.

## Background

- **Spec seed:** `doc/tasks/backlog.md`, “New viewer boards” → “Certificate Viewer”. This task expands its masks to include `.p7b` and `.p7c` and makes the implementation decisions explicit.
- **Closest precedent:** `boards/pe-viewer/`. Follow its `editorKind: "simple"` path based loading, read-only permissions, tabbed report, defensive rendering with text nodes, error state plus `persephone.notify`, `WHATS-NEW.md`, and screenshot rules. Its current reader uses `persephone.readFile(path, { encoding: "binary" })`; older revisions used base64 and a manual decode. Use `binary` here because the shipped guide calls it the right choice for binary input and it avoids a base64 expansion and decode pass.
- **Reusable parser code:** `boards/pe-viewer/pe-parser.js` has a best-effort Authenticode scan that finds common-name OIDs in a PKCS#7 blob. It is not reusable as an X.509/PKCS#7 parser: it extracts only heuristic names, has no certificate model or extension decoding, and explicitly does not validate a chain. Reuse only the caution to label parsing/display as inspection rather than trust validation.
- **Generic authoring reference:** `C:/projects/persephone/assets/board-template/CLAUDE.md`, `C:/projects/persephone/assets/guides/agents/boards.md`, `C:/projects/persephone/assets/guides/boards.md`, and the linked scripting `api/fs.md`, `api/io.md`, `api/downloads.md` and `screens/dialogs.md`. The board guide documents self-hosted scripts, the `--p-*` theme contract, `readFile`, CSP, and permission gates. An in-board HTML dialog is the established pattern (`boards/todo/app.js`, `boards/force-graph/graph-ui.js`); `window.prompt`, `window.confirm`, and `window.alert` are unsuitable in board frames and can wedge them.
- **Bridge and app versions:** source `C:/projects/persephone/src/shared/board-bridge-version.ts` currently declares `BOARD_BRIDGE_VERSION = "1.34.0"`; its history includes the `1.32.0` change allowing `readFile()` to read the exact current hosted file when `fileSystem: false`. Set `minBridgeVersion` to `1.32.0`, the minimum required by this board's read path. Set `minAppVersion` to `5.0.8`, from `C:/projects/persephone/package.json`.
- **Permissions:** all object-form permission flags remain false. `readFile(getFilePath(), { encoding: "binary" })` is allowed with `fileSystem: false` on bridge 1.32+. Clipboard writes need no permission, so field-copy actions can use `persephone.clipboard.writeText`. Native `saveFileDialog` needs `fileSystem: "board"` or `"full"`; therefore omit PEM export rather than increasing permissions. No bridge download/save API available to an all-false board is documented. Do not add a `fileSystem` grant for export.
- **File association:** `src/renderer/editors/base/editor-matchers.ts` has Monaco as the priority-0 fallback and no built-in matcher for `.cer`, `.crt`, `.der`, `.pem`, `.pfx`, `.p12`, `.p7b` or `.p7c`; built-in image/archive/video/etc. matchers do not claim them. Existing catalog manifests do not use these masks. Use `editorPriority: 100`, matching PE/SQLite/PDF viewers and exceeding the built-in fallback. The manifest masks are exactly `*.cer`, `*.crt`, `*.der`, `*.pem`, `*.pfx`, `*.p12`, `*.p7b`, `*.p7c`.
- **Library decision — use two narrowly scoped libraries.** Parse all public certificates, PEM/DER, PKCS#7, and CSRs with **`@peculiar/x509` 2.1.0**, from its standalone `build/x509.js` browser bundle. This is the parser for RSA, EC/ECDSA, and EdDSA keys and certificates; it also exposes typed extensions, PKCS#7 certificate collections, PKCS#10 requests, and thumbprints. Do not use `node-forge` as the X.509 parser: its `certificateFromAsn1` public-key handling is RSA-only and throws for non-RSA certificates, and its PKCS#7 certificate loop does not guard that error. The Peculiar browser UMD exposes the `x509` global (`window.x509`) but calls `Reflect.getMetadata` without bundling reflect-metadata. The board loads a small local `x509-reflect-shim.js` before the bundle; this is not a separate package dependency. Display SHA-1/SHA-256 from each preserved original DER byte sequence with `crypto.subtle.digest`, avoiding any re-encoding ambiguity.
- **PFX-only helper:** Use **`node-forge` 1.4.0** only to decrypt PKCS#12 safe contents using legacy 3DES/RC2 PBE and PBES2, and obtain the certificate bags' original DER bytes. Its PBE dispatcher handles the two legacy OIDs and PBES2 (including AES-256), with PRF mapping through `prfOidToMessageDigest`; do not call Forge's X.509 or PKCS#7 certificate parsers. For a certificate bag, capture the OCTET STRING bytes from the CertBag in its original/decrypted SafeContents ASN.1 before turning it into a certificate model. Forge's `bag.asn1` is a fallback where available, but if Forge parsed a bag and retained only `bag.cert`, do not use `certificateToAsn1()` to make fingerprint bytes. Traverse/decrypt the SafeContents structure with Forge ASN.1/PBE primitives as needed to preserve the source certificate octets. Pass only those DER bytes to `window.x509.X509Certificate`.
- **Bundle, license, and size:** Vendor `@peculiar/x509` 2.1.0 `build/x509.js` (222,828 bytes, MIT) and node-forge 1.4.0 `dist/forge.min.js` (283,279 bytes, BSD-3-Clause option from its dual BSD-3-Clause OR GPL-2.0 license). The Peculiar file is a standalone browser bundle with no `require()` and provides `window.x509`; it requires a Reflect metadata polyfill, so the board loads its small local `x509-reflect-shim.js` before the bundle. Load it before certificate parsing. Its thumbprint API defaults to its CryptoProvider, but the board will pass the frame's `window.crypto` explicitly where used. Keep the separate `crypto.subtle.digest` path over original DER as the displayed fingerprint source of truth.
- **Lazy Forge loading and CSP:** Load Peculiar's X.509 script for certificate/report handling, but inject the local node-forge script only when a `.pfx`/`.p12` is opened. The Forge bundle's global-object shim expression `new Function("return this")()` is unconditionally patched to `globalThis` per the implementation decision. Only that expression changes; the original and replacement are recorded in `lib/node-forge/VERSION.txt`. Do not use CDN output.
- **Comparison:** `pkijs` is BSD-3-Clause, requires `asn1js` and runtime dependencies, and delegates crypto to WebCrypto, so it does not supply node-forge's legacy PKCS#12 decryption on this browser frame. `@peculiar/x509` is MIT and handles all certificate formats/public key algorithms and CSR/PKCS#7 parsing needed for display, while Forge supplies only PFX decryption and exact cert-bag extraction. This split addresses the RSA-only limitation of Forge without asking WebCrypto to implement RC2/legacy PKCS#12 PBE.
- **Vendor precedent:** `boards/drawio-viewer/lib/` and `boards/sqlite-viewer/lib/` keep `LICENSE` and `VERSION.txt` beside vendored code. Use separate `lib/peculiar-x509/` and `lib/node-forge/` subfolders, each with its own upstream license and version/size record. Pin the specified releases and review current upstream advisories before adoption.
- **Fixture tooling:** `_test/` is already a repo-only home for test boards, samples, and screenshot inputs; add only `_test/cert-viewer/` there. OpenSSL 3.5.7 and Node.js v24.18.0 are available in this workspace. Generate all certs/keys locally with OpenSSL and keep them synthetic, test-only artifacts. No personal/real certificates.

## Implementation Plan

- [x] Scaffold `boards/cert-viewer/` through Persephone `boards.createBoard("cert-viewer", "C:/projects/persephone-boards/boards")` when the running app/MCP is available; use the copied starter `CLAUDE.md` and `board-base.css`. Keep this task as a plan until implementation starts; do not hand-create a board folder.
- [x] Set `boards/cert-viewer/board-manifest.json`: display name/description, `minAppVersion: "5.0.8"`, `minBridgeVersion: "1.32.0"`, all permissions false, masks listed above, `editorName: "Certificate Viewer"`, `editorKind: "simple"`, `editorPriority: 100`, and `screenshot: "screenshot.png"`. Do not declare `editorSources` or network access.
- [x] Vendor `@peculiar/x509` 2.1.0 under `boards/cert-viewer/lib/peculiar-x509/`: `x509.js` (222,828 bytes), its MIT `LICENSE`, and `VERSION.txt` containing exact npm version, source URL, UMD global (`window.x509`), license, and byte count. Load this local plain script for all cert/PEM/DER/PKCS#7/CSR parsing. The vendored build needs Reflect metadata; provide the small local `x509-reflect-shim.js` before it and confirm initialization.
- [x] Vendor node-forge 1.4.0 under `boards/cert-viewer/lib/node-forge/`: `forge.min.js` (283,279 bytes), its BSD-3-Clause license/notice, and `VERSION.txt` with version, source URL, selected license, exact byte count, and any local CSP patch. Load it lazily by injecting this local script only after an input is identified as `.pfx`/`.p12`; ordinary PEM/DER/PKCS#7/CSR opens must not load Forge. Use Forge solely for PKCS#12 PBE/decryption and SafeContents ASN.1 traversal, not its X.509/PKCS#7 certificate parser.
- [x] Implement `boards/cert-viewer/cert-parser.js` to accept raw `Uint8Array` bytes and filename, detect PEM versus DER from bytes rather than extension, decode every PEM block including CRLF/multiple blocks, and normalize certificate records while retaining original DER bytes. Parse X.509 PEM/DER with `window.x509.X509Certificate`; parse PKCS#7 PEM/DER (`.p7b`/`.p7c`) using `window.x509.X509Certificates`; parse CSRs using `window.x509.Pkcs10CertificateRequest`; parse PFX/P12 by lazily loading Forge, extracting original certBag OCTET STRING bytes, then constructing Peculiar certificate objects. A `.cer` may be PEM or DER, and a wrong extension must not prevent content detection.
- [x] For `.pfx`/`.p12`, show a board-owned modal password form (password input, submit/cancel, clear error text); never invoke native `window.prompt/confirm/alert`. First try an empty password. On failure, show the dialog and retry on each submission; wrong passwords must leave the prompt open with an actionable error. Do not retain the password after successful/failed attempts. Parse PFX only to collect certificate bags and determine whether a key bag exists; never render, copy, log, stringify, or export any key object or key bytes. Report only “Contains a private key (not shown)” when one is present. This implementation reads SafeBag OIDs directly and does not call Forge `pkcs12FromAsn1()`, so it does not decode or materialize private-key bags.
- [x] Recognize PEM block labels. Show public certificate blocks. If a PEM contains only a private key or encrypted private key, identify it and say key material is hidden; never show private-key PEM text or bytes. For a CSR, show a v1 summary with subject, public key algorithm/size or curve, requested SAN/extensions, and signature algorithm using `Pkcs10CertificateRequest`; do not expose any private material. Unsupported/malformed blocks get a per-file error or safe “unsupported block” row without dumping raw content.
- [x] Derive display order for bundle certificates leaf first using subject/issuer DN matching (prefer normalized ASN.1 Name values; AKI/SKI may help disambiguate). `X509ChainBuilder` may be used only if its behavior is confirmed to build ordering without asserting trust; plain DN matching is the default. Preserve source order as a deterministic fallback for ambiguous/disconnected sets. Label ordering best-effort; do not claim signature validation, trust, or chain validity. A PKCS#7/PFX with multiple independent certs still lists all certificates.
- [x] Implement `boards/cert-viewer/index.html`, `style.css`, and `app.js` in the PE Viewer's visual language: compact file/header row, report tabs, list of certificates in best-effort chain order, and a detail pane for the selected cert. Tabs should include Overview, Extensions, and Raw/Details; lazily build panels if appropriate. Render every supplied string as text, not HTML. Include clear empty/loading/error states and a Reload action.
- [x] Format `app.js`, `cert-parser.js`, `style.css`, and `x509-reflect-shim.js` as readable browser source: one statement per line, one declaration per `const`/`let`, four-space JavaScript indentation, and one CSS declaration per line. Preserve the live-reviewed body font fix using `system-ui, sans-serif` and `--p-font-base` as the font size.
- [x] Normalize public-key labels to RSA, ECDSA, and Ed25519 names; use one readable signature-algorithm formatter for certificates and CSRs.
- [x] Show the static best-effort ordering note only for multiple certificates and retain only ambiguity/disconnection ordering warnings. With no certificates, show only the Overview tab and keep the sidebar count as `none`.
- [x] Detail pane fields: subject, issuer, validity start/end with expired and expiring-soon (<30 days from now) highlighting, serial, X.509 version, signature algorithm, public key algorithm and RSA bit size or EC curve, SHA-1 and SHA-256 certificate fingerprints via `crypto.subtle.digest`, key usage, extended key usage, SAN, basic constraints, AKI/SKI, CRL distribution points, AIA, certificate policies, and unknown/other extensions as OID plus raw extension-value hex. Copy buttons appear only on public field values/fingerprints. Never offer copy for private key material. Label unknown/unparsed extension structures as raw, not semantically decoded.
- [x] Keep the report explicitly descriptive: display certificate fields and date status, but do not claim cryptographic chain validation, revocation checks, trust, or certificate authenticity. Use each certificate's original DER bytes for SHA-1/SHA-256 fingerprints, including certs extracted from PFX; compare every fixture against `openssl x509 -noout -fingerprint -sha256` output. Never fingerprint a re-encoded Peculiar or Forge model.
- [x] Omit “Export certificate as PEM” for v1: the bridge's native save dialog is permission-gated, while all board permissions must stay false. A browser download link is not a permissionless Persephone save API and does not satisfy the requested bridge facility condition.
- [x] Use only Persephone `--p-*` theme tokens for colors, spacing, typography, chrome, and focus states; link `board-base.css` first and follow PE Viewer's themed tabs, cards, chips, and tables. Add no hard-coded light/dark palette. Custom password overlay must use the same tokens and trap/restore focus accessibly.
- [x] Add `boards/cert-viewer/WHATS-NEW.md` with a `## 1.0.0` heading and terse initial release notes. Add `icon.svg`.
- [x] Capture `screenshot.png` from the live board content area at 1120×700 (16:10), populated by a synthetic fixture, with no personal data, and keep it under ~300 KB. *(Reviewer-owned live capture.)*
- [x] Add `_test/cert-viewer/README.md` and `_test/cert-viewer/generate-fixtures.ps1` documenting reproducible local generation with OpenSSL 3.x; generated files remain under `_test/cert-viewer/`. Create: one single-certificate PEM; one DER `.cer`; a PEM chain with an EC P-256 leaf and RSA intermediate/root; an Ed25519 single-cert PEM; expired and expiring-soon certificates; synthetic private-key-only PEM and CSR PEM inputs; password-protected PFX using legacy 3DES and containing an EC certificate; password-protected PFX using AES-256 PBES2; a no-password/empty-password PFX; and a `.p7b` SignedData cert bundle containing an EC certificate. The script may also emit `.p7c` if needed to exercise that alias. Use fresh synthetic keys and names such as `CN=BT-030 Test Leaf`; never commit actual user certificates or keys. Prefer OpenSSL commands such as `req -x509`/`req -new`, `x509`, `pkcs12 -export` with explicit `-keypbe` / `-certpbe` selection (and `-legacy` only if needed for a desired RC2 case), and `crl2pkcs7 -certfile ... -nocrl` for the P7B fixture. Record fixture passwords only in this test README, not in the board UI.
- [x] Live reviewer check: every fixture parses; all SHA-256 fingerprints match this README, including certificates inside PFX; legacy 3DES, AES-256, and empty-password PFX work; wrong-password retry works; private keys never appear; `ui.log` is clean.
- [ ] Remaining live manual checks: editor association/default selection and built-in switch; detail-field completeness and raw extension fallback; CSR summary fields; expired/expiring-soon display; public copy buttons; dialog keyboard/cancel behavior; theme changes; malformed input.

## Concerns / Open Questions

- [x] **Confirm PFX fixture compatibility with the exact pinned browser bundle.** Live review confirmed AES-256 PBES2, legacy 3DES, empty-password and EC-certificate PFX fixtures, plus wrong-password retry.
- [x] **Check X.509 bundle startup and thumbprints.** The x509 UMD bundle calls `Reflect.getMetadata` but does not bundle reflect-metadata, so the board uses a small local `x509-reflect-shim.js` before the UMD script. Live review confirmed startup and matching fingerprints from original DER bytes for all fixtures.
- [x] **Check Forge CSP shim.** Forge 1.4.0 global-object shim was patched unconditionally from `new Function("return this")()` to `globalThis`, with the exact patch recorded in the Forge version file.
- [x] **Library/license/security review.** Pin @peculiar/x509 2.1.0 and node-forge 1.4.0, select Forge's BSD-3-Clause terms from its dual license, include both license notices, and review current advisories on 2026-10-05. Forge 1.4.0 has an advisory for RSA signature verification (not called here); PBE/ASN.1 parsing does not invoke that verification path. Parse only locally opened files, but malformed ASN.1 can still consume frame resources; handle exceptions and do not equate successful decoding with trust.
- [x] **PFX key handling.** The adapter avoids Forge `pkcs12FromAsn1()` and detects key-bag OIDs during direct SafeContents traversal, so it never decodes private-key bags. UI state and diagnostics contain only the presence flag.
- [x] **Chain order is best-effort.** Multiple leaves, cross-signing, absent issuer certs, and duplicate names can make subject/issuer DN ordering ambiguous. List all certificates and make the fallback explicit; do not validate trust or signatures.
- [x] **Some extensions are uncommon or library-specific.** Preserve original OID and extension-value bytes in hex whenever there is no safe typed decoder. Define exact support/error treatment for unknown public-key algorithms, malformed SAN entries, and a `.p7c` that is not a certificate-only SignedData object during implementation.
- [x] **PFX raw certificate bytes.** Verified original certificate OCTET STRING extraction from PFX SafeContents in a throwaway Node VM using Forge for PBE/ASN.1 transport; fixture SHA-256 values match OpenSSL. Forge's parsed cert model is not a safe source for exact fingerprint input.
- [x] **PEM export remains omitted.** Adding native save would require a permission and contradicts the all-false requirement. Revisit only if Persephone later provides a documented permissionless board export API.

## Acceptance Criteria

- [ ] `cert-viewer` opens matching `.cer`, `.crt`, `.der`, `.pem`, `.pfx`, `.p12`, `.p7b`, and `.p7c` files by default with `editorKind: "simple"`, priority 100, `minAppVersion: "5.0.8"`, and `minBridgeVersion: "1.32.0"`.
- [ ] Manifest permissions are all false; there is no CDN, network access, execute path, write path, or remote code.
- [ ] DER and PEM formats are detected from content; multiple PEM blocks and CRLF are supported; `.cer` can be either encoding.
- [ ] All supported public certificates in PEM, PFX/P12, and PKCS#7 bundles appear in a useful leaf-first best-effort order with clear ambiguity handling.
- [ ] Required certificate fields, status highlighting, public field copying, SHA-1/SHA-256 fingerprints, and unknown extension OID/hex output work from the original certificate bytes.
- [ ] PFX starts with an empty-password attempt, retries after a wrong password, and reports key presence without displaying, copying, or logging key material. Private-key-only PEM is identified without exposing content; CSR PEM shows a v1 public summary.
- [ ] No native prompt/confirm/alert calls; password entry uses an in-board themed dialog.
- [x] Styling uses `--p-*` tokens, `board-base.css`, and PE Viewer visual conventions. `WHATS-NEW.md`, icon, and compliant synthetic-data screenshot are included.
- [ ] `_test/cert-viewer/` contains the local OpenSSL fixture generator and all requested synthetic fixtures; no real/personal certificate material is used.
- [ ] Reviewer completes the manual Persephone MCP checklist; `ui.log` has no unexplained CSP/runtime errors (any Forge global-shim patch is recorded in VERSION.txt). No unit tests.
- [ ] Fully offline, including library loading.

## Files Changed

| File | Change |
|------|--------|
| `boards/cert-viewer/board-manifest.json` | New — identity, eight masks, simple editor association, versions, all-false permissions, screenshot declaration |
| `boards/cert-viewer/CLAUDE.md` | New — board-specific authoring, format, privacy, and test notes |
| `boards/cert-viewer/board-base.css` | Existing scaffold file — kept unchanged |
| `boards/cert-viewer/index.html` | New — file header, tab strip, list/detail layout, status overlay, in-board password dialog shell |
| `boards/cert-viewer/style.css` | New — responsive, `--p-*` only visual styling |
| `boards/cert-viewer/app.js` | New — read/reload flow, report tabs, detail rendering, clipboard actions, password retries, safe error states |
| `boards/cert-viewer/cert-parser.js` | New — encoding/container detection, Forge adapter, PEM block classification, certificate normalization and best-effort ordering |
| `boards/cert-viewer/lib/peculiar-x509/x509.js` | New — @peculiar/x509 2.1.0 standalone browser bundle, 222,828 bytes; global `x509` |
| `boards/cert-viewer/lib/peculiar-x509/LICENSE` | New — upstream MIT license |
| `boards/cert-viewer/lib/peculiar-x509/VERSION.txt` | New — exact release, source URL, UMD global, license, bundle byte count |
| `boards/cert-viewer/lib/node-forge/forge.min.js` | Existing vendored node-forge 1.4.0 browser bundle; patched size 283,260 bytes and loaded lazily for PFX/P12 |
| `boards/cert-viewer/lib/node-forge/LICENSE` | New — upstream BSD-3-Clause option/notice |
| `boards/cert-viewer/lib/node-forge/VERSION.txt` | New — exact release, source URL, selected license, byte counts, and unconditional `new Function("return this")()` → `globalThis` patch |
| `boards/cert-viewer/icon.svg` | New — certificate-themed board icon |
| `boards/cert-viewer/WHATS-NEW.md` | New — initial 1.0.0 notes |
| `_test/cert-viewer/README.md` | New — fixture names, passwords, and regeneration instructions |
| `_test/cert-viewer/generate-fixtures.ps1` | New — local OpenSSL 3 fixture generator |
| `_test/cert-viewer/single.pem` | New — synthetic single PEM certificate fixture |
| `_test/cert-viewer/der.cer` | New — synthetic DER certificate fixture |
| `_test/cert-viewer/chain.pem` | New — synthetic PEM chain with EC P-256 leaf and RSA intermediate/root |
| `_test/cert-viewer/ed25519.pem` | New — synthetic Ed25519 single-certificate PEM fixture |
| `_test/cert-viewer/expired.pem` | New — synthetic expired certificate fixture |
| `_test/cert-viewer/expiring-soon.pem` | New — synthetic certificate expiring within 30 days |
| `_test/cert-viewer/private-key.pem` | New — synthetic private-key-only PEM for hidden-key classification |
| `_test/cert-viewer/request.csr.pem` | New — synthetic CSR PEM for safe type identification |
| `_test/cert-viewer/legacy-3des.p12` | New — synthetic password-protected legacy PFX containing an EC certificate |
| `_test/cert-viewer/pbes2-aes256.p12` | New — synthetic password-protected PBES2/AES-256 PFX fixture |
| `_test/cert-viewer/empty-password.p12` | New — synthetic PFX with no password (empty-password attempt should open it) |
| `_test/cert-viewer/certs.p7b` | New — synthetic PKCS#7 SignedData bundle containing an EC certificate |
| `doc/active-work.md` | Update — moved BT-030 from Planned to Active |
| `doc/tasks/backlog.md` | Update — mark the Certificate Viewer idea moved to BT-030 |

## Notes

- Live Persephone review confirmed all fixtures parse, all recorded SHA-256 fingerprints match, all three PFX password/encryption flows work (including wrong-password retry), private keys remain hidden, and `ui.log` is clean. Screenshot capture is still pending.
- User review (2026-10-05): the in-board header and footer moved to Persephone's chrome — Reload is a `persephone.toolbar` button, and the format/count summary and the "descriptive parsing only" note are `persephone.statusBar` items. No text below 12px. Panels and cards use the page background with borders only.
- The pinned `@peculiar/x509` UMD bundle calls `Reflect.getMetadata` without bundling reflect-metadata. The local shim provides that metadata API before the x509 bundle loads.
- Frontend and parser scripts were reformatted for maintainability; RSA key labels now use `RSA · <bits> bits`, certificate and CSR signature labels share a formatter, and empty-certificate inputs show only Overview.
- `screenshot.png` is catalog decoration and excluded from board release ZIPs; it still belongs in the board folder and manifest.
- The board's report describes parsed certificate properties; parsing is not a trust decision and makes no revocation or chain-validation claim.

## References

- [`pe-viewer`](../../../boards/pe-viewer/)
- [Persephone agent board guide](https://github.com/andriy-viyatyk/persephone/blob/main/assets/guides/agents/boards.md)
- [node-forge npm package](https://www.npmjs.com/package/node-forge)
- [node-forge PBE implementation](https://github.com/digitalbazaar/forge/blob/main/lib/pbe.js)
- [PKI.js npm package](https://www.npmjs.com/package/pkijs)
- [@peculiar/x509 npm package](https://www.npmjs.com/package/%40peculiar/x509)
- [@peculiar/x509 browser usage](https://peculiarventures.github.io/x509/docs/usage/)
- [@peculiar/x509 X509Certificate API](https://peculiarventures.github.io/x509/docs/api/classes/X509Certificate/)
- [@peculiar/x509 X509Certificates API](https://peculiarventures.github.io/x509/docs/api/classes/X509Certificates/)
