import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";

describe("repository contents", () => {
  it("keeps generated/local agent docs out of the pushed repository", () => {
    const result = spawnSync("git", ["ls-files"], {
      encoding: "utf8",
    });

    assert.equal(result.status, 0);
    const trackedFiles = result.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    assert.equal(trackedFiles.includes("AGENTS.md"), false);
    assert.equal(trackedFiles.some((file) => file.startsWith("docs/")), false);
  });
});
