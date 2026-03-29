import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerLoader,
  getLoaderForExtension,
  isExtensionSupported,
  getAllSupportedExtensions,
  getDialogFilters,
  type IFileLoader,
} from '../loaders/FileFormatRegistry';

const mockLoader: IFileLoader = {
  supportedExtensions: ['.test', '.tst'],
  formatName: 'Test Files',
  async load() {
    return { layerId: 'test_1', success: true };
  },
};

describe('FileFormatRegistry', () => {
  beforeEach(() => {
    registerLoader(mockLoader);
  });

  it('should register and find a loader by extension', () => {
    const loader = getLoaderForExtension('.test');
    expect(loader).toBe(mockLoader);
  });

  it('should normalize extensions (case insensitive)', () => {
    const loader = getLoaderForExtension('.TEST');
    expect(loader).toBe(mockLoader);
  });

  it('should handle extensions with or without leading dot', () => {
    const loader = getLoaderForExtension('test');
    expect(loader).toBe(mockLoader);
  });

  it('should return null for unknown extensions', () => {
    const loader = getLoaderForExtension('.xyz');
    expect(loader).toBeNull();
  });

  it('should check if extension is supported', () => {
    expect(isExtensionSupported('.test')).toBe(true);
    expect(isExtensionSupported('.xyz')).toBe(false);
  });

  it('should list all supported extensions', () => {
    const exts = getAllSupportedExtensions();
    expect(exts).toContain('.test');
    expect(exts).toContain('.tst');
  });

  it('should generate dialog filters grouped by formatName', () => {
    const filters = getDialogFilters();
    const testFilter = filters.find((f) => f.name === 'Test Files');
    expect(testFilter).toBeDefined();
    expect(testFilter!.extensions).toContain('test');
    expect(testFilter!.extensions).toContain('tst');

    // Should always include "All Files"
    const allFiles = filters.find((f) => f.name === 'All Files');
    expect(allFiles).toBeDefined();
  });
});
