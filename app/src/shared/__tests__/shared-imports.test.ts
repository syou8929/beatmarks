import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SHARED = join(dirname(fileURLToPath(import.meta.url)), "..");

function tsFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "__tests__" || name === "__fixtures__") continue;
      out.push(...tsFilesUnder(p));
    } else if (name.endsWith(".ts") && name !== "ipc.ts") {
      out.push(p);
    }
  }
  return out;
}

describe("shared の純度", () => {
  it("shared/(ipc.ts除く)は相対import以外を持たない", () => {
    const offenders: string[] = [];
    for (const file of tsFilesUnder(SHARED)) {
      const src = readFileSync(file, "utf-8");
      for (const m of src.matchAll(/from\s+["']([^"']+)["']/g)) {
        const spec = m[1]!;
        if (!spec.startsWith("./") && !spec.startsWith("../")) {
          offenders.push(`${file}: ${spec}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
