import { fetch } from "undici";
import * as fs from "fs";
import * as readline from "readline";
import { CONFIG_FILE, loadConfigFile, writeConfigFile } from "./config.js";

function ask(prompt: string, hidden = false): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    if (hidden) {
      const origWrite = process.stderr.write.bind(process.stderr);
      let muted = false;
      (process.stderr as any).write = (chunk: any, ...args: any[]) => {
        if (muted) return true;
        return origWrite(chunk, ...args);
      };
      rl.question(prompt, (answer) => {
        muted = true;
        (process.stderr as any).write = origWrite;
        process.stderr.write("\n");
        rl.close();
        resolve(answer.trim());
      });
    } else {
      rl.question(prompt, (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    }
  });
}

async function gql(baseUrl: string, token: string, query: string): Promise<any> {
  const res = await fetch(`${baseUrl}/graphql`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
      "User-Agent": "affine-mcp-server/1.5.0",
    },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json() as any;
  if (json.errors) throw new Error(json.errors.map((e: any) => e.message).join("; "));
  return json.data;
}

async function login() {
  console.error("Affine MCP Server — Login\n");

  const existing = loadConfigFile();
  if (existing.AFFINE_API_TOKEN) {
    console.error(`Existing config: ${CONFIG_FILE}`);
    console.error(`  URL:       ${existing.AFFINE_BASE_URL || "(default)"}`);
    console.error(`  Token:     ${existing.AFFINE_API_TOKEN.slice(0, 10)}...`);
    console.error(`  Workspace: ${existing.AFFINE_WORKSPACE_ID || "(none)"}\n`);
    const overwrite = await ask("Overwrite? [y/N] ");
    if (!/^[yY]$/.test(overwrite)) {
      console.error("Keeping existing config.");
      return;
    }
    console.error("");
  }

  const defaultUrl = "https://app.affine.pro";
  const baseUrl = (await ask(`Affine URL [${defaultUrl}]: `)) || defaultUrl;

  console.error("\nTo generate a token:");
  console.error(`  1. Open ${baseUrl} in your browser`);
  console.error("  2. Settings → Access Tokens → Generate New Token");
  console.error("  3. Copy the token\n");

  const token = await ask("API token: ", true);
  if (!token) {
    console.error("No token provided. Aborting.");
    process.exit(1);
  }

  console.error("Testing connection...");
  try {
    const data = await gql(baseUrl, token, "query { currentUser { name email } }");
    console.error(`✓ Authenticated as: ${data.currentUser.name} <${data.currentUser.email}>\n`);
  } catch (err: any) {
    console.error(`✗ Authentication failed: ${err.message}`);
    process.exit(1);
  }

  console.error("Detecting workspaces...");
  let workspaceId = "";
  try {
    const data = await gql(baseUrl, token, "query { workspaces { id } }");
    const ids: string[] = data.workspaces.map((w: any) => w.id);
    if (ids.length === 0) {
      console.error("  No workspaces found.");
    } else if (ids.length === 1) {
      workspaceId = ids[0];
      console.error(`  Found 1 workspace: ${workspaceId} (auto-selected)`);
    } else {
      console.error(`  Found ${ids.length} workspaces:`);
      ids.forEach((id, i) => console.error(`    ${i + 1}) ${id}`));
      const choice = (await ask(`\nSelect [1]: `)) || "1";
      workspaceId = ids[parseInt(choice, 10) - 1] || "";
      if (!workspaceId) {
        console.error("Invalid selection.");
        process.exit(1);
      }
    }
  } catch (err: any) {
    console.error(`  Could not list workspaces: ${err.message}`);
  }

  writeConfigFile({
    AFFINE_BASE_URL: baseUrl,
    AFFINE_API_TOKEN: token,
    AFFINE_WORKSPACE_ID: workspaceId,
  });

  console.error(`\n✓ Saved to ${CONFIG_FILE} (mode 600)`);
  console.error("The MCP server will use these credentials automatically.");
}

async function status() {
  const config = loadConfigFile();
  if (!config.AFFINE_API_TOKEN) {
    console.error("Not logged in. Run: affine-mcp login");
    process.exit(1);
  }
  console.error(`Config: ${CONFIG_FILE}`);
  console.error(`URL:       ${config.AFFINE_BASE_URL || "(default)"}`);
  console.error(`Token:     ${config.AFFINE_API_TOKEN.slice(0, 10)}...`);
  console.error(`Workspace: ${config.AFFINE_WORKSPACE_ID || "(none)"}\n`);

  try {
    const data = await gql(
      config.AFFINE_BASE_URL || "https://app.affine.pro",
      config.AFFINE_API_TOKEN,
      "query { currentUser { name email } workspaces { id } }"
    );
    console.error(`User: ${data.currentUser.name} <${data.currentUser.email}>`);
    console.error(`Workspaces: ${data.workspaces.length}`);
  } catch (err: any) {
    console.error(`Connection failed: ${err.message}`);
    process.exit(1);
  }
}

function logout() {
  if (fs.existsSync(CONFIG_FILE)) {
    fs.unlinkSync(CONFIG_FILE);
    console.error(`Removed ${CONFIG_FILE}`);
  } else {
    console.error("No config file found.");
  }
}

const COMMANDS: Record<string, () => Promise<void> | void> = { login, status, logout };

export async function runCli(command: string): Promise<boolean> {
  const fn = COMMANDS[command];
  if (!fn) return false;
  await fn();
  return true;
}
