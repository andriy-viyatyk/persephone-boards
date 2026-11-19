import path from "node:path";

export function dataRoot(env = process.env) {
  const configured = env.PERSEPHONE_BOARD_DATA;
  if (typeof configured === "string" && path.isAbsolute(configured) && !configured.startsWith("\\\\")) return path.resolve(configured);
  const local = env.LOCALAPPDATA;
  if (typeof local !== "string" || !path.isAbsolute(local)) throw new Error("LOCALAPPDATA is not available; cannot store Agent Chat data.");
  return path.resolve(local, "Persephone", "board-data", "claude-agent");
}
