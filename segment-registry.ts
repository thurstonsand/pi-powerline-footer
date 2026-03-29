import { getAgentDir } from "@mariozechner/pi-coding-agent";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { createJiti } from "@mariozechner/jiti";

import { BUILTIN_SEGMENTS } from "./segments.js";
import type { RenderedSegment, SegmentContext, StatusLineSegment } from "./types.js";

const SUPPORTED_SEGMENT_EXTENSIONS = [".ts", ".js"] as const;
const SUPPORTED_DIRECTORY_ENTRYPOINTS = ["index.ts", "index.js"] as const;
const fileSegments = new Map<string, StatusLineSegment>();

export interface SegmentLoadResult {
  directory: string;
  loadedIds: string[];
  errors: string[];
}

interface SegmentEntrypoint {
  source: string;
  filePath: string;
}

export interface SegmentLoaderAPI {
  registerSegment<TOptions = unknown>(segment: StatusLineSegment<TOptions>): StatusLineSegment<TOptions>;
}

interface SegmentFactory {
  (api: SegmentLoaderAPI): Promise<void> | void;
}

function isSegmentFile(name: string): boolean {
  return SUPPORTED_SEGMENT_EXTENSIONS.some((ext) => name.endsWith(ext));
}

function readSegmentManifest(packageJsonPath: string): string[] | undefined {
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
  return packageJson.pi?.segments;
}

function resolveSegmentEntries(dir: string): SegmentEntrypoint[] | null {
  const packageJsonPath = join(dir, "package.json");
  if (existsSync(packageJsonPath)) {
    const entries = readSegmentManifest(packageJsonPath);
    if (entries?.length) {
      return entries
        .map((entry) => ({
          source: `${dir.replace(/.*[\\/]/, "")}/${entry}`,
          filePath: resolve(dir, entry),
        }))
        .filter((entry) => existsSync(entry.filePath));
    }
  }

  for (const entrypoint of SUPPORTED_DIRECTORY_ENTRYPOINTS) {
    const filePath = join(dir, entrypoint);
    if (existsSync(filePath)) {
      return [{
        source: `${dir.replace(/.*[\\/]/, "")}/${entrypoint}`,
        filePath,
      }];
    }
  }

  return null;
}

function discoverSegmentEntrypoints(directory: string): SegmentEntrypoint[] {
  if (!existsSync(directory)) {
    return [];
  }

  const entries = readdirSync(directory, { withFileTypes: true, encoding: "utf8" })
    .sort((a, b) => a.name.localeCompare(b.name));
  const discovered: SegmentEntrypoint[] = [];

  for (const entry of entries) {
    const entryPath = join(directory, entry.name);

    if ((entry.isFile() || entry.isSymbolicLink()) && isSegmentFile(entry.name)) {
      discovered.push({ source: entry.name, filePath: entryPath });
      continue;
    }

    if (entry.isDirectory() || entry.isSymbolicLink()) {
      const segmentEntries = resolveSegmentEntries(entryPath);
      if (segmentEntries) {
        discovered.push(...segmentEntries);
      }
    }
  }

  return discovered;
}

async function loadSegmentEntrypoint(entrypoint: SegmentEntrypoint): Promise<string[]> {
  const jiti = createJiti(import.meta.url, { moduleCache: false });
  const factory = await jiti.import(entrypoint.filePath, { default: true }) as SegmentFactory;
  const loadedIds: string[] = [];

  await factory({
    registerSegment(segment) {
      fileSegments.set(segment.id, segment as StatusLineSegment);
      loadedIds.push(segment.id);
      return segment;
    },
  });

  return loadedIds;
}

export function getCustomSegmentsDir(): string {
  return join(getAgentDir(), "powerline", "segments");
}

export async function loadSegmentsFromDirectory(directory: string = getCustomSegmentsDir()): Promise<SegmentLoadResult> {
  fileSegments.clear();

  const result: SegmentLoadResult = {
    directory,
    loadedIds: [],
    errors: [],
  };

  for (const entrypoint of discoverSegmentEntrypoints(directory)) {
    try {
      result.loadedIds.push(...await loadSegmentEntrypoint(entrypoint));
    } catch (error) {
      result.errors.push(`Failed to load custom segment from ${entrypoint.source}: ${String(error)}`);
    }
  }

  return result;
}

export function getRegisteredSegment(id: string): StatusLineSegment | undefined {
  return fileSegments.get(id) ?? BUILTIN_SEGMENTS[id as keyof typeof BUILTIN_SEGMENTS];
}

export function renderSegment(id: string, ctx: SegmentContext): RenderedSegment {
  const segment = getRegisteredSegment(id);
  if (!segment) {
    return { content: "", visible: false };
  }

  return segment.render(ctx, ctx.options[segment.id]);
}

export function resetCustomSegmentsForTests(): void {
  fileSegments.clear();
}
