import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { getRegisteredSegment, loadSegmentsFromDirectory, renderSegment, resetCustomSegmentsForTests } from "./segment-registry.js";
import type { SegmentContext } from "./types.js";

function createTempSegmentsDir(): string {
  return mkdtempSync(join(tmpdir(), "powerline-segments-"));
}

function writeFile(dir: string, relativePath: string, content: string): void {
  const fullPath = join(dir, relativePath);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content);
}

function createSegmentContext(options: Record<string, unknown> = {}): SegmentContext {
  return {
    model: undefined,
    thinkingLevel: "off",
    sessionId: undefined,
    usageStats: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
    contextPercent: 0,
    contextWindow: 0,
    autoCompactEnabled: false,
    usingSubscription: false,
    sessionStartTime: Date.now(),
    git: { branch: null, staged: 0, unstaged: 0, untracked: 0 },
    extensionStatuses: new Map(),
    options,
    theme: {} as never,
    colors: {},
  };
}

describe("custom segment registry", () => {
  beforeEach(() => {
    resetCustomSegmentsForTests();
  });

  afterEach(() => {
    resetCustomSegmentsForTests();
  });

  test("loads direct ts/js entrypoints", async () => {
    const dir = createTempSegmentsDir();
    writeFile(dir, "verbosity.ts", `
      export default function ({ registerSegment }) {
        registerSegment({
          id: 'verbosity',
          render(_ctx, options) {
            return { content: String(options?.label ?? 'none'), visible: true };
          },
        });
      }
    `);
    writeFile(dir, "session-badge.js", `
      export default function ({ registerSegment }) {
        registerSegment({
          id: 'session_badge',
          render(ctx) {
            return { content: ctx.sessionId ? '#' + ctx.sessionId.slice(0, 4) : 'none', visible: true };
          },
        });
      }
    `);

    const result = await loadSegmentsFromDirectory(dir);

    expect(result.loadedIds).toEqual(["session_badge", "verbosity"]);
    expect(result.errors).toEqual([]);
    expect(renderSegment("verbosity", createSegmentContext({ verbosity: { label: "low" } }))).toEqual({
      content: "low",
      visible: true,
    });
    expect(renderSegment("session_badge", {
      ...createSegmentContext(),
      sessionId: "abcdef12",
    })).toEqual({
      content: "#abcd",
      visible: true,
    });
  });

  test("loads package manifests and multi-segment packages", async () => {
    const dir = createTempSegmentsDir();
    writeFile(dir, "toolbox/package.json", JSON.stringify({
      name: "toolbox",
      pi: { segments: ["./src/index.ts"] },
    }, null, 2));
    writeFile(dir, "toolbox/src/index.ts", `
      import { suffix } from './label.ts';
      export default function ({ registerSegment }) {
        registerSegment({
          id: 'stacked',
          render(_ctx, options) {
            return { content: String((options?.label ?? 'dir') + suffix), visible: true };
          },
        });
        registerSegment({
          id: 'extra_badge',
          render() {
            return { content: 'extra', visible: true };
          },
        });
      }
    `);
    writeFile(dir, "toolbox/src/label.ts", `export const suffix = '-helper';`);

    const result = await loadSegmentsFromDirectory(dir);

    expect(result.loadedIds).toEqual(["stacked", "extra_badge"]);
    expect(result.errors).toEqual([]);
    expect(renderSegment("stacked", createSegmentContext({ stacked: { label: "multi" } }))).toEqual({
      content: "multi-helper",
      visible: true,
    });
    expect(renderSegment("extra_badge", createSegmentContext())).toEqual({
      content: "extra",
      visible: true,
    });
  });

  test("supports package-local node_modules resolution", async () => {
    const dir = createTempSegmentsDir();
    writeFile(dir, "deps/package.json", JSON.stringify({
      name: "deps-segment",
      pi: { segments: ["./src/index.ts"] },
    }, null, 2));
    writeFile(dir, "deps/src/index.ts", `
      import label from 'tiny-label';
      export default function ({ registerSegment }) {
        registerSegment({
          id: 'dep_segment',
          render() {
            return { content: label, visible: true };
          },
        });
      }
    `);
    writeFile(dir, "deps/node_modules/tiny-label/package.json", JSON.stringify({
      name: "tiny-label",
      version: "1.0.0",
      main: "./index.js",
    }, null, 2));
    writeFile(dir, "deps/node_modules/tiny-label/index.js", `module.exports = 'dep-ok';`);

    const result = await loadSegmentsFromDirectory(dir);

    expect(result.errors).toEqual([]);
    expect(renderSegment("dep_segment", createSegmentContext())).toEqual({
      content: "dep-ok",
      visible: true,
    });
  });

  test("surfaces runtime entrypoint failures", async () => {
    const dir = createTempSegmentsDir();
    writeFile(dir, "broken.ts", `export default { id: 'broken', render() { return { content: 'x', visible: true }; } };`);

    const result = await loadSegmentsFromDirectory(dir);

    expect(result.loadedIds).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("broken.ts");
  });

  test("custom files override builtin segments", async () => {
    const dir = createTempSegmentsDir();
    writeFile(dir, "path.ts", `
      export default function ({ registerSegment }) {
        registerSegment({
          id: 'path',
          render() {
            return { content: 'file-path', visible: true };
          },
        });
      }
    `);

    const result = await loadSegmentsFromDirectory(dir);

    expect(result.errors).toEqual([]);
    expect(getRegisteredSegment("path")?.render(createSegmentContext())).toEqual({
      content: "file-path",
      visible: true,
    });
    expect(renderSegment("path", createSegmentContext())).toEqual({
      content: "file-path",
      visible: true,
    });
  });
});
