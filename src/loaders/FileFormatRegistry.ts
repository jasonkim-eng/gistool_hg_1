/**
 * FileFormatRegistry — Maps file extensions to loader functions.
 * Provides a single place to register/query supported formats.
 * UI components query this registry instead of hardcoding extension lists.
 */

import type { LayerItem } from '../stores/useLayerStore';

export interface LoadResult {
  layerId: string;
  success: boolean;
  error?: string;
}

/**
 * A file loader must implement this interface.
 * Each loader handles one or more file extensions.
 */
export interface IFileLoader {
  /** File extensions this loader handles (e.g., ['.obj', '.fbx']) */
  readonly supportedExtensions: string[];
  /** Human-readable format name for file dialogs (e.g., '3D Models') */
  readonly formatName: string;
  /**
   * Load a file and add it to the scene.
   * @param filePath Absolute file path
   * @param buffer File contents as ArrayBuffer (null for formats that use protocol URLs)
   */
  load(filePath: string, buffer: ArrayBuffer | null): Promise<LoadResult>;
}

interface RegistryEntry {
  loader: IFileLoader;
  extension: string;
}

const entries: RegistryEntry[] = [];

/**
 * Register a loader for its supported extensions.
 */
export function registerLoader(loader: IFileLoader): void {
  for (const ext of loader.supportedExtensions) {
    const normalized = ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
    // Remove existing entry for this extension if any
    const idx = entries.findIndex((e) => e.extension === normalized);
    if (idx >= 0) entries.splice(idx, 1);
    entries.push({ loader, extension: normalized });
  }
}

/**
 * Get the loader for a given file extension.
 */
export function getLoaderForExtension(ext: string): IFileLoader | null {
  const normalized = ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
  const entry = entries.find((e) => e.extension === normalized);
  return entry?.loader ?? null;
}

/**
 * Check if an extension is supported.
 */
export function isExtensionSupported(ext: string): boolean {
  return getLoaderForExtension(ext) !== null;
}

/**
 * Get all registered extensions.
 */
export function getAllSupportedExtensions(): string[] {
  return entries.map((e) => e.extension);
}

/**
 * Get Electron dialog filter groups.
 * Returns filters grouped by formatName for use in file open dialogs.
 */
export function getDialogFilters(): { name: string; extensions: string[] }[] {
  const groups = new Map<string, string[]>();
  for (const entry of entries) {
    const name = entry.loader.formatName;
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name)!.push(entry.extension.replace('.', ''));
  }

  const filters: { name: string; extensions: string[] }[] = [];
  for (const [name, exts] of groups) {
    filters.push({ name, extensions: exts });
  }
  filters.push({ name: 'All Files', extensions: ['*'] });
  return filters;
}

/**
 * Get all registered loaders (unique).
 */
export function getAllLoaders(): IFileLoader[] {
  const seen = new Set<IFileLoader>();
  return entries.filter((e) => {
    if (seen.has(e.loader)) return false;
    seen.add(e.loader);
    return true;
  }).map((e) => e.loader);
}
