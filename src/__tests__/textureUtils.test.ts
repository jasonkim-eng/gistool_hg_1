import { describe, it, expect } from 'vitest';
import { extractTextureFilenames, mimeFromExt } from '../loaders/shared/textureUtils';

describe('extractTextureFilenames', () => {
  it('should extract map_Kd textures', () => {
    const mtl = `newmtl material1
map_Kd texture.jpg`;

    const result = extractTextureFilenames(mtl);
    expect(result).toContain('texture.jpg');
  });

  it('should extract multiple texture types', () => {
    const mtl = `newmtl material1
map_Kd diffuse.jpg
map_Ka ambient.png
map_Ks specular.jpg
map_Bump normal.png
bump bumpmap.jpg
map_d alpha.png
map_Ns shininess.jpg`;

    const result = extractTextureFilenames(mtl);
    expect(result).toHaveLength(7);
    expect(result).toContain('diffuse.jpg');
    expect(result).toContain('ambient.png');
    expect(result).toContain('specular.jpg');
    expect(result).toContain('normal.png');
    expect(result).toContain('bumpmap.jpg');
    expect(result).toContain('alpha.png');
    expect(result).toContain('shininess.jpg');
  });

  it('should deduplicate filenames', () => {
    const mtl = `newmtl mat1
map_Kd shared.jpg
newmtl mat2
map_Kd shared.jpg`;

    const result = extractTextureFilenames(mtl);
    expect(result).toHaveLength(1);
    expect(result).toContain('shared.jpg');
  });

  it('should return empty array for MTL without textures', () => {
    const mtl = `newmtl material1
Kd 0.5 0.5 0.5`;

    const result = extractTextureFilenames(mtl);
    expect(result).toHaveLength(0);
  });

  it('should trim whitespace from filenames', () => {
    const mtl = `map_Kd   texture.jpg  `;

    const result = extractTextureFilenames(mtl);
    expect(result).toContain('texture.jpg');
  });
});

describe('mimeFromExt', () => {
  it('should return image/png for .png', () => {
    expect(mimeFromExt('texture.png')).toBe('image/png');
  });

  it('should return image/jpeg for .jpg', () => {
    expect(mimeFromExt('texture.jpg')).toBe('image/jpeg');
  });

  it('should return image/jpeg for unknown extensions', () => {
    expect(mimeFromExt('texture.bmp')).toBe('image/jpeg');
  });
});
