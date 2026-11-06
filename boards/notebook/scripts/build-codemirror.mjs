// CodeMirror build: bundles the pinned local dependencies and records their license provenance.

import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const ENTRY_FILE = "src/codemirror-entry.js";
const OUTPUT_FILE = "lib/codemirror.js";
const LICENSE_CANDIDATES = ["LICENSE", "LICENSE.txt", "LICENSE.md"];
const BUILD_COMMAND = "npm ci && npm run build:codemirror";

await mkdir("lib", { recursive: true });

const buildResult = await build({
    entryPoints: [ENTRY_FILE],
    outfile: OUTPUT_FILE,
    bundle: true,
    minify: true,
    platform: "browser",
    format: "esm",
    target: "es2022",
    metafile: true,
    legalComments: "none",
});

const lockfile = JSON.parse(await readFile("package-lock.json", "utf8"));
const dependencyNames = findBundledDependencies(buildResult.metafile.inputs);
const dependencyEntries = dependencyNames
    .sort()
    .map((name) => [name, lockfile.packages[`node_modules/${name}`]]);

const licenseTexts = await Promise.all(dependencyEntries.map(readDependencyLicense));
const versionLines = dependencyEntries.map(([name, packageInfo]) => (
    `${name} ${packageInfo.version} (${packageInfo.license})`
));

await writeFile("lib/LICENSE", licenseTexts.join("\n"));
await writeFile("lib/VERSION.txt", [
    ...versionLines,
    `Sources: npm packages in package-lock.json`,
    `Build: ${BUILD_COMMAND}`,
    "",
].join("\n"));

function findBundledDependencies(inputs) {
    const dependencyNames = new Set();
    for (const inputPath of Object.keys(inputs)) {
        if (!inputPath.startsWith("node_modules/")) {
            continue;
        }
        const pathParts = inputPath.split("/");
        const packageName = pathParts[1].startsWith("@")
            ? pathParts.slice(1, 3).join("/")
            : pathParts[1];
        dependencyNames.add(packageName);
    }
    return [...dependencyNames];
}

async function readDependencyLicense([packageName, packageInfo]) {
    if (!packageInfo) {
        throw new Error(`No lockfile entry exists for bundled dependency ${packageName}.`);
    }
    for (const licenseFile of LICENSE_CANDIDATES) {
        try {
            const licenseText = await readFile(`node_modules/${packageName}/${licenseFile}`, "utf8");
            return `===== ${packageName} ${packageInfo.version} (${packageInfo.license}) =====\n${licenseText.trim()}\n`;
        } catch (error) {
            if (error.code !== "ENOENT") {
                throw error;
            }
        }
    }
    throw new Error(`Could not find a license file for bundled dependency ${packageName}.`);
}
