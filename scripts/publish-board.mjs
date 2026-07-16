#!/usr/bin/env node
// Publishes every board under boards/ whose board-manifest.json `version` has no
// matching `<id>-v<version>` git release tag yet.
//
// Dual-mode: run by the GitHub Action (.github/workflows/publish-boards.yml on push
// to main) or locally as a manual fallback. Requires `gh` (authenticated, repo +
// workflow scopes) and `git` on PATH. No npm dependencies.
//
// For each board that needs a release it:
//   1. zips the board folder CONTENTS (entries at top level, no wrapper dir),
//      excluding dev junk (ui.log, versions-manifest.json, .git, node_modules),
//   2. `gh release create <id>-v<version> <id>.zip` (per-board tag),
//   3. computes the asset's size + sha256 (of the exact uploaded bytes),
//   4. rewrites that board's entry in boards-manifest.json (latest only),
//   5. prepends the version to boards/<id>/versions-manifest.json (full history),
//   6. commits + pushes the manifest changes.
//
// The board-manifest.json `version` is the single source of truth. Both catalog
// manifests are machine-written here — never hand-edited.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const boardsDir = path.join(repoRoot, "boards");
const catalogPath = path.join(repoRoot, "boards-manifest.json");

// Names excluded from a published ZIP (dev junk + catalog metadata that is not board content).
const EXCLUDE = new Set(["ui.log", "versions-manifest.json", ".git", "node_modules"]);

function run(cmd, args, opts = {}) {
    return execFileSync(cmd, args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        ...opts,
    }).trim();
}

/** owner/repo parsed from the origin remote (https or ssh form). */
function repoSlug() {
    const url = run("git", ["-C", repoRoot, "config", "--get", "remote.origin.url"]);
    const m = url.match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/i);
    if (!m) throw new Error(`Cannot parse owner/repo from origin remote: ${url}`);
    return { owner: m[1], repo: m[2] };
}

function tagExists(tag) {
    const out = run("git", ["-C", repoRoot, "tag", "--list", tag]);
    return out.split(/\r?\n/).map((s) => s.trim()).includes(tag);
}

/** Copy a board folder into a fresh temp dir, dropping excluded entries. */
function stageClean(srcDir) {
    const staging = fs.mkdtempSync(path.join(os.tmpdir(), "persephone-board-"));
    copyInto(srcDir, staging);
    return staging;
}

function copyInto(src, dst) {
    fs.mkdirSync(dst, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        if (EXCLUDE.has(entry.name)) continue;
        const s = path.join(src, entry.name);
        const d = path.join(dst, entry.name);
        if (entry.isDirectory()) copyInto(s, d);
        else if (entry.isFile()) fs.copyFileSync(s, d);
    }
}

/** Zip the CONTENTS of stageDir into outZip (entries rooted at top level). */
function zipContents(stageDir, outZip) {
    fs.rmSync(outZip, { force: true });
    if (process.platform === "win32") {
        // PowerShell Compress-Archive; `dir\*` roots entries at the top level (no wrapper folder).
        run("powershell", [
            "-NoProfile",
            "-Command",
            `Compress-Archive -Path '${stageDir}\\*' -DestinationPath '${outZip}' -Force`,
        ]);
    } else {
        // `zip -r . ` from inside the staged dir → entries rooted at top level. -X drops extra attrs.
        run("zip", ["-r", "-X", "-q", outZip, "."], { cwd: stageDir });
    }
}

function sha256File(file) {
    return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function readJson(file, fallback) {
    try {
        return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
        return fallback;
    }
}

function writeJson(file, value) {
    fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

/** Resolve the catalog `standalone` value (explicit wins; else derived from fileMasks). */
function resolveStandalone(m) {
    if (typeof m.standalone === "boolean") return m.standalone;
    return !(Array.isArray(m.fileMasks) && m.fileMasks.length > 0);
}

/** Build the boards-manifest.json entry for a board (drops undefined fields). */
function buildCatalogEntry(id, m, archive) {
    const entry = {
        id,
        version: m.version,
        name: m.name ?? id,
        description: m.description,
        fileMasks: m.fileMasks,
        editorName: m.editorName,
        editorKind: m.editorKind,
        standalone: resolveStandalone(m),
        minAppVersion: m.minAppVersion,
        archive,
    };
    for (const k of Object.keys(entry)) if (entry[k] === undefined) delete entry[k];
    return entry;
}

function isoDate() {
    return new Date().toISOString().slice(0, 10);
}

function main() {
    if (!fs.existsSync(boardsDir)) {
        console.log("No boards/ directory — nothing to publish.");
        return;
    }
    const { owner, repo } = repoSlug();
    const boardIds = fs
        .readdirSync(boardsDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);

    const published = [];
    for (const id of boardIds) {
        const boardPath = path.join(boardsDir, id);
        const manifestPath = path.join(boardPath, "board-manifest.json");
        const m = readJson(manifestPath, null);
        if (!m) {
            console.log(`- ${id}: no readable board-manifest.json — skipped.`);
            continue;
        }
        if (!m.version) {
            console.log(`- ${id}: manifest has no "version" — skipped (nothing to release).`);
            continue;
        }
        const tag = `${id}-v${m.version}`;
        if (tagExists(tag)) {
            console.log(`- ${id}: ${tag} already released — skipped.`);
            continue;
        }

        console.log(`- ${id}: releasing ${tag} …`);
        const zipPath = path.join(repoRoot, `${id}.zip`);
        const staging = stageClean(boardPath);
        try {
            zipContents(staging, zipPath);
        } finally {
            fs.rmSync(staging, { recursive: true, force: true });
        }

        // Create the release with the ZIP asset. gh also creates the git tag.
        run("gh", [
            "release",
            "create",
            tag,
            zipPath,
            "--repo",
            `${owner}/${repo}`,
            "--title",
            `${m.name ?? id} v${m.version}`,
            "--notes",
            `Automated release of ${m.name ?? id} v${m.version}.`,
        ]);

        const size = fs.statSync(zipPath).size;
        const sha256 = sha256File(zipPath);
        const url = `https://github.com/${owner}/${repo}/releases/download/${tag}/${id}.zip`;
        const archive = { url, size, sha256 };
        fs.rmSync(zipPath, { force: true });

        // 4. Rewrite the catalog entry (replace-by-id, keep the rest).
        const catalog = readJson(catalogPath, { schemaVersion: 1, boards: [] });
        catalog.schemaVersion = catalog.schemaVersion || 1;
        catalog.boards = Array.isArray(catalog.boards) ? catalog.boards : [];
        catalog.boards = catalog.boards.filter((b) => b.id !== id);
        catalog.boards.push(buildCatalogEntry(id, m, archive));
        catalog.boards.sort((a, b) => a.id.localeCompare(b.id));
        writeJson(catalogPath, catalog);

        // 5. Prepend to the per-board version history.
        const vmPath = path.join(boardPath, "versions-manifest.json");
        const vm = readJson(vmPath, { schemaVersion: 1, id, versions: [] });
        vm.schemaVersion = vm.schemaVersion || 1;
        vm.id = id;
        vm.versions = Array.isArray(vm.versions) ? vm.versions : [];
        vm.versions = vm.versions.filter((v) => v.version !== m.version);
        const historyEntry = { version: m.version, date: isoDate(), archive };
        if (m.minAppVersion) historyEntry.minAppVersion = m.minAppVersion;
        vm.versions.unshift(historyEntry);
        writeJson(vmPath, vm);

        published.push({ id, tag, size, sha256 });
    }

    if (published.length === 0) {
        console.log("Nothing to publish — all board versions are already released.");
        return;
    }

    // 6. Commit + push the manifest changes. In CI the checkout token + configured
    //    identity make the push work; GITHUB_TOKEN commits don't retrigger the workflow.
    run("git", ["-C", repoRoot, "add", "-A"]);
    const summary = published.map((p) => p.tag).join(", ");
    run("git", ["-C", repoRoot, "commit", "-m", `Publish ${summary}`]);
    run("git", ["-C", repoRoot, "push"]);

    console.log(`\nPublished: ${summary}`);
    for (const p of published) console.log(`  ${p.tag}  ${p.size} bytes  sha256=${p.sha256}`);
}

main();
