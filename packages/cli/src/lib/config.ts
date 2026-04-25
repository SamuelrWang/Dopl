import { homedir } from "os";
import { dirname, join } from "path";
import { mkdir, readFile, rm, writeFile } from "fs/promises";

const DEFAULT_BASE_URL = "https://www.usedopl.com";

export interface DoplConfig {
  apiKey?: string;
  baseUrl?: string;
}

function configPath(): string {
  const override = process.env.DOPL_CONFIG_PATH;
  if (override) return override;
  if (process.platform === "win32") {
    const appData =
      process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
    return join(appData, "dopl", "config.json");
  }
  const xdg = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return join(xdg, "dopl", "config.json");
}

export async function readConfig(): Promise<DoplConfig> {
  try {
    const raw = await readFile(configPath(), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const cfg = parsed as Record<string, unknown>;
    const out: DoplConfig = {};
    if (typeof cfg.apiKey === "string") out.apiKey = cfg.apiKey;
    if (typeof cfg.baseUrl === "string") out.baseUrl = cfg.baseUrl;
    return out;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }
}

export async function writeConfig(config: DoplConfig): Promise<void> {
  const path = configPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
}

export async function clearConfig(): Promise<boolean> {
  const path = configPath();
  try {
    await rm(path);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}

export function configFilePath(): string {
  return configPath();
}

export function defaultBaseUrl(): string {
  return DEFAULT_BASE_URL;
}
