import { getAgentDir } from "@mariozechner/pi-coding-agent";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { createJiti } from "@mariozechner/jiti";

import { isRecord } from "./json.js";
import { SEGMENTS as BUILTIN_SEGMENTS } from "./segments.js";
import type {
  BuiltinStatusLineSegmentId,
  RenderedSegment,
  SegmentContext,
  StatusLineSegment,
  StatusLineSegmentId,
} from "./types.js";

const SUPPORTED_SEGMENT_EXTENSIONS = [".ts", ".js"] as const;
const SUPPORTED_DIRECTORY_ENTRYPOINTS = ["index.ts", "index.js"] as const;
const programmaticSegments = new Map<string, StatusLineSegment>();
const programmaticSources = new Map<string, string>();
const fileSegments = new Map<string, StatusLineSegment>();
const fileSources = new Map<string, string>();
let fileLoadErrors: string[] = [];

export interface SegmentLoadResult {
  directory: string;
  loadedIds: string[];
  errors: string[];
}

interface SegmentEntrypoint {
  source: string;
  filePath: string;
}

interface SegmentLoaderAPI {
  registerSegment(segment: unknown): StatusLineSegment;
}

function normalizeSegmentId(id: unknown): string | null {
  if (typeof id !== "string") {
    return null;
  }

  const normalized = id.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function validateSegment(segment: unknown): StatusLineSegment {
  if (!isRecord(segment)) {
    throw new Error("segment registration must be an object");
  }

  const id = normalizeSegmentId(segment.id);
  if (!id) {
    throw new Error("segment id must be a non-empty string");
  }

  if (typeof segment.render !== "function") {
    throw new Error(`segment \"${id}\" must provide a render(ctx, options) function`);
  }

  return {
    id: id as StatusLineSegmentId,
    render: segment.render as StatusLineSegment["render"],
  };
}

function getExistingCustomSource(id: string, layer: "programmatic" | "file"): string | undefined {
  return layer === "programmatic"
    ? programmaticSources.get(id)
    : fileSources.get(id);
}

function assertSegmentIdAvailable(id: string, source: string, layer: "programmatic" | "file"): void {
  const existingSource = getExistingCustomSource(id, layer);
  if (existingSource) {
    throw new Error(`segment \"${id}\" from ${source} is already registered by ${existingSource}`);
  }
}

function registerLoadedSegment(segment: unknown, source: string): StatusLineSegment {
  const normalized = validateSegment(segment);
  assertSegmentIdAvailable(normalized.id, source, "file");
  fileSegments.set(normalized.id, normalized);
  fileSources.set(normalized.id, source);
  return normalized;
}

function clearFileSegments(): void {
  for (const id of fileSegments.keys()) {
    fileSources.delete(id);
  }
  fileSegments.clear();
  fileLoadErrors = [];
}

function isSegmentFile(name: string): boolean {
  return SUPPORTED_SEGMENT_EXTENSIONS.some((ext) => name.endsWith(ext));
}

function readSegmentManifest(packageJsonPath: string): { segments?: string[] } | null {
  try {
    const content = readFileSync(packageJsonPath, "utf-8");
    const parsed = JSON.parse(content);
    if (!isRecord(parsed)) {
      return null;
    }

    const pi = parsed.pi;
    if (!isRecord(pi)) {
      return null;
    }

    return Array.isArray(pi.segments)
      ? { segments: pi.segments.filter((value): value is string => typeof value === "string") }
      : null;
  } catch {
    return null;
  }
}

function resolveSegmentEntries(dir: string): SegmentEntrypoint[] | null {
  const packageJsonPath = join(dir, "package.json");
  if (existsSync(packageJsonPath)) {
    const manifest = readSegmentManifest(packageJsonPath);
    if (manifest?.segments?.length) {
      const entries: SegmentEntrypoint[] = [];
      for (const segmentPath of manifest.segments) {
        const resolvedPath = resolve(dir, segmentPath);
        if (existsSync(resolvedPath)) {
          entries.push({
            source: `${dir.replace(/.*[\\/]/, "")}/${segmentPath}`,
            filePath: resolvedPath,
          });
        }
      }
      if (entries.length > 0) {
        return entries;
      }
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

  try {
    const discovered: SegmentEntrypoint[] = [];
    const entries = readdirSync(directory, { withFileTypes: true, encoding: "utf8" })
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const entryPath = join(directory, entry.name);

      if ((entry.isFile() || entry.isSymbolicLink()) && isSegmentFile(entry.name)) {
        discovered.push({ source: entry.name, filePath: entryPath });
        continue;
      }

      if (entry.isDirectory() || entry.isSymbolicLink()) {
        const resolvedEntries = resolveSegmentEntries(entryPath);
        if (resolvedEntries) {
          discovered.push(...resolvedEntries);
        }
      }
    }

    return discovered;
  } catch {
    return [];
  }
}

async function loadSegmentEntrypoint(entrypoint: SegmentEntrypoint): Promise<string[]> {
  const jiti = createJiti(import.meta.url, {
    moduleCache: false,
  });

  const factory = await jiti.import(entrypoint.filePath, { default: true });
  if (typeof factory !== "function") {
    throw new Error("segment entrypoint must export a default function");
  }

  const loadedIds: string[] = [];
  const api: SegmentLoaderAPI = {
    registerSegment(segment: unknown): StatusLineSegment {
      const registered = registerLoadedSegment(segment, entrypoint.source);
      loadedIds.push(registered.id);
      return registered;
    },
  };

  await factory(api);
  return loadedIds;
}

export function getCustomSegmentsDir(): string {
  return join(getAgentDir(), "powerline", "segments");
}

export function registerSegment(segment: unknown, source: string = "registerSegment()"): StatusLineSegment {
  const normalized = validateSegment(segment);
  assertSegmentIdAvailable(normalized.id, source, "programmatic");
  programmaticSegments.set(normalized.id, normalized);
  programmaticSources.set(normalized.id, source);
  return normalized;
}

export async function loadSegmentsFromDirectory(directory: string = getCustomSegmentsDir()): Promise<SegmentLoadResult> {
  clearFileSegments();

  const result: SegmentLoadResult = {
    directory,
    loadedIds: [],
    errors: [],
  };

  for (const entrypoint of discoverSegmentEntrypoints(directory)) {
    try {
      const ids = await loadSegmentEntrypoint(entrypoint);
      result.loadedIds.push(...ids);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.errors.push(`Failed to load custom segment from ${entrypoint.source}: ${message}`);
    }
  }

  fileLoadErrors = [...result.errors];
  return result;
}

export function getRegisteredSegment(id: StatusLineSegmentId): StatusLineSegment | undefined {
  const normalizedId = normalizeSegmentId(id);
  if (!normalizedId) {
    return undefined;
  }

  return fileSegments.get(normalizedId)
    ?? programmaticSegments.get(normalizedId)
    ?? BUILTIN_SEGMENTS[normalizedId as BuiltinStatusLineSegmentId];
}

export function getCustomSegmentLoadErrors(): readonly string[] {
  return fileLoadErrors;
}

export function renderSegment(id: StatusLineSegmentId, ctx: SegmentContext): RenderedSegment {
  const segment = getRegisteredSegment(id);
  if (!segment) {
    return { content: "", visible: false };
  }

  return segment.render(ctx, ctx.options[segment.id]);
}

export function resetCustomSegmentsForTests(): void {
  programmaticSegments.clear();
  programmaticSources.clear();
  clearFileSegments();
}
