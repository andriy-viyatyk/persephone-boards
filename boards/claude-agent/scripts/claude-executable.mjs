import { stat } from "node:fs/promises";
import path from "node:path";

const exists = async (candidate) => {
  try { return (await stat(candidate)).isFile(); } catch { return false; }
};

export async function resolveClaudeExecutable(override = "", env = process.env) {
  const extensions = (env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean);
  if (override) {
    if (!path.isAbsolute(override)) throw Object.assign(new Error("Claude executable override must be an absolute path."), { code: "protocol-error" });
    if (!(await exists(override))) throw Object.assign(new Error("The configured Claude executable was not found."), { code: "cli-not-found" });
    return path.resolve(override);
  }
  const pathValue = env.PATH || env.Path || "";
  const candidates = process.platform === "win32" ? ["claude", ...extensions.map((ext) => `claude${ext}`)] : ["claude"];
  for (const dir of pathValue.split(path.delimiter).filter(Boolean)) {
    for (const name of candidates) {
      const candidate = path.resolve(dir, name);
      if (await exists(candidate)) return candidate;
    }
  }
  throw Object.assign(new Error("The installed claude executable was not found on PATH."), { code: "cli-not-found" });
}
