import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import { generateAvatar } from '../../packages/core/dist/index.js';
import { catalog, flat2dHairFits } from '../../packages/design-tokens/dist/index.js';
import { svgRenderer } from '../../packages/renderer-svg/dist/index.js';
import { renderPng } from '../../packages/renderer-png/dist/index.js';

const silhouettes = [
  ...new Map(catalog.templates.map((template) => [template.hat.type, template])).values(),
];
describe('occupational hat output', () => {
  it.each(silhouettes)(
    '$hat.type retains transparent clearance at every export size',
    (template) => {
      for (const size of [64, 128, 256, 512]) {
        const { svg } = generateAvatar({ templateId: template.id, size }, catalog, svgRenderer);
        const png = PNG.sync.read(Buffer.from(renderPng(svg, size)));
        for (let coordinate = 0; coordinate < size; coordinate++) {
          for (const [x, y] of [
            [coordinate, 0],
            [coordinate, size - 1],
            [0, coordinate],
            [size - 1, coordinate],
          ]) {
            expect(png.data[(y * size + x) * 4 + 3]).toBe(0);
          }
        }
      }
    },
    15_000,
  );
  it('keeps every occupational emblem legible against its fixed surface', () => {
    const luminance = (hex) => {
      const channels = [1, 3, 5]
        .map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255)
        .map((channel) =>
          channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
        );
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    for (const template of catalog.templates) {
      const backing = ['badge-git', 'badge-terminal'].includes(template.hat.badge)
        ? catalog.colors.ink
        : catalog.colors[template.hat.color];
      const values = [luminance(backing), luminance(catalog.colors[template.hat.badgeColor])].sort(
        (a, b) => b - a,
      );
      expect((values[0] + 0.05) / (values[1] + 0.05), template.id).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('additions to the approved visual family', () => {
  const raster = (templateId, style = 'hair-sweep') =>
    PNG.sync.read(
      Buffer.from(
        renderPng(
          generateAvatar({ templateId, instance: { hair: { style } } }, catalog, svgRenderer).svg,
          256,
        ),
      ),
    );
  const pixel = (png, x, y) => [...png.data.subarray((y * 256 + x) * 4, (y * 256 + x) * 4 + 4)];
  it('renders solid lenses and frames instead of empty goggle outlines', () => {
    const png = raster('deploy-aviator');
    for (const x of [98, 158])
      expect(
        pixel(png, x, 106).every(
          (value, index) => Math.abs(value - [199, 229, 238, 255][index]) <= 2,
        ),
      ).toBe(true);
    for (const x of [78, 178])
      expect(
        pixel(png, x, 106).every(
          (value, index) => Math.abs(value - [51, 75, 112, 255][index]) <= 2,
        ),
      ).toBe(true);
  });
  it('adds optional hats without replacing the approved role defaults', () => {
    for (const [role, original, addition] of [
      ['docs', 'docs', 'docs-editor'],
      ['security', 'caretaker', 'security-officer'],
      ['deploy', 'deploy', 'deploy-aviator'],
    ]) {
      expect(catalog.roles[role]).toBe(original);
      const base = catalog.templates.find((template) => template.id === original);
      const variant = catalog.templates.find((template) => template.id === addition);
      expect(variant.role).toBe(base.role);
      expect(variant.hat.type).not.toBe(base.hat.type);
    }
  });
});

describe('soft layered hat accessories', () => {
  it('keeps physical accessories above the printed emblem and invariant across states', async () => {
    const { composeSvg } = await import('../../packages/renderer-svg/dist/index.js');
    let baseline;
    for (const state of ['idle', 'working', 'waiting', 'success', 'error', 'offline']) {
      const { avatar } = generateAvatar(
        { templateId: 'deploy-aviator', state },
        catalog,
        svgRenderer,
      );
      const children = composeSvg(avatar).children;
      const pieces = children.filter((node) =>
        node.attributes?.['data-layer']?.startsWith('hat-pilot-'),
      );
      expect(pieces.map((node) => node.attributes['data-layer'])).toEqual([
        'hat-pilot-strap',
        'hat-pilot-frame',
        'hat-pilot-lenses',
      ]);
      expect(children.indexOf(pieces[0])).toBeGreaterThan(
        children.findIndex((node) => node.attributes?.['data-layer'] === 'hat-badge'),
      );
      expect(children.indexOf(pieces[2])).toBeLessThan(
        children.findIndex((node) => node.attributes?.['data-layer'] === 'state'),
      );
      if (baseline) expect(pieces).toEqual(baseline);
      else baseline = pieces;
    }
  });
  it('adds visible contact shade on the crown without changing pixels outside its receiver', async () => {
    const { readFileSync } = await import('node:fs');
    const { svg } = generateAvatar({ templateId: 'deploy-aviator' }, catalog, svgRenderer);
    const withoutAccessoryShadows = svg.replace(
      /(<filter id="avatar-contact-shadow-hat-pilot-(?:frame|strap)"[\s\S]*?flood-opacity=")[^"]+/g,
      (_match, prefix) => prefix + '0',
    );
    expect(withoutAccessoryShadows).not.toBe(svg);
    const shaded = PNG.sync.read(Buffer.from(renderPng(svg, 256)));
    const unshaded = PNG.sync.read(Buffer.from(renderPng(withoutAccessoryShadows, 256)));
    const receiver = PNG.sync.read(
      Buffer.from(renderPng(readFileSync('assets/parts/flat-2d/hats/pilot.svg', 'utf8'), 256)),
    );
    let changed = 0;
    for (let offset = 0; offset < shaded.data.length; offset += 4) {
      const differs = shaded.data
        .subarray(offset, offset + 4)
        .some((value, index) => value !== unshaded.data[offset + index]);
      if (differs) {
        changed++;
        expect(receiver.data[offset + 3]).toBeGreaterThan(0);
      }
    }
    expect(changed).toBeGreaterThan(100);
    const belowFrame = (123 * 256 + 98) * 4;
    expect(shaded.data[belowFrame]).toBeLessThan(unshaded.data[belowFrame]);
  });
});

const isPlum = (red, green, blue, alpha) =>
  alpha > 200 && red < 150 && blue < 150 && green < red && red - green > 8 && red > 40;
const plumHair = (png, x, y) => {
  const offset = (y * 256 + x) * 4;
  return isPlum(png.data[offset], png.data[offset + 1], png.data[offset + 2], png.data[offset + 3]);
};
const plumCount = (png) => {
  let count = 0;
  for (let index = 0; index < png.data.length; index += 4)
    if (isPlum(png.data[index], png.data[index + 1], png.data[index + 2], png.data[index + 3]))
      count += 1;
  return count;
};

describe('hat-visible hairstyles', () => {
  const styles = ['hair-fringe', 'hair-side-fringe', 'hair-wisps'];
  const render = (templateId, style) =>
    PNG.sync.read(
      Buffer.from(
        renderPng(
          generateAvatar(
            { templateId, instance: { hair: { style, color: 'plum' } } },
            catalog,
            svgRenderer,
          ).svg,
          256,
        ),
      ),
    );

  it('appends three public styles without reordering the existing choices', () => {
    expect(catalog.hair).toEqual([
      'hair-sweep',
      'hair-crop',
      'hair-wave',
      'hair-fringe',
      'hair-side-fringe',
      'hair-wisps',
    ]);
    expect(catalog.hairBack).toMatchObject({
      'hair-sweep': 'hair-sweep-back',
      'hair-crop': 'hair-crop-back',
      'hair-wave': 'hair-crop-back',
      'hair-fringe': 'hair-fringe-back',
      'hair-side-fringe': 'hair-side-fringe-back',
      'hair-wisps': 'hair-wisps-back',
    });
    for (const template of catalog.templates) {
      const existing =
        template.id === 'assistant'
          ? ['hair-sweep', 'hair-crop']
          : ['hair-sweep', 'hair-crop', 'hair-wave'];
      expect(template.allowedHair.slice(0, existing.length)).toEqual(existing);
      expect(template.allowedHair).toEqual(expect.arrayContaining(styles));
    }
    expect(flat2dHairFits['hat-bucket']['hair-sweep']).toEqual({
      front: 'hair-sweep-bucket',
      back: 'hair-sweep-bucket-back',
    });
    for (const style of styles) expect(flat2dHairFits['hat-bucket'][style]).toBeUndefined();
  });

  it('keeps seeded full-list hair on crop and the stage-2 beanie on sweep', () => {
    expect(generateAvatar({ templateId: 'docs' }, catalog, svgRenderer).avatar.hair.style).toBe(
      'hair-crop',
    );
    expect(
      generateAvatar(
        { templateId: 'assistant', instance: { seed: 'stage-2' } },
        catalog,
        svgRenderer,
      ).avatar.hair.style,
    ).toBe('hair-sweep');
  });

  it.each(['assistant', 'docs', 'debug'])(
    'shows distinct fringe, side fringe, and wisps under %s',
    (templateId) => {
      const pictures = Object.fromEntries(
        styles.map((style) => [style, render(templateId, style)]),
      );
      const template = catalog.templates.find((item) => item.id === templateId);
      const wave = template.allowedHair.includes('hair-wave')
        ? render(templateId, 'hair-wave')
        : null;
      expect(plumHair(pictures['hair-fringe'], 128, 140)).toBe(true);
      expect(plumHair(pictures['hair-fringe'], 64, 150)).toBe(false);
      expect(plumHair(pictures['hair-fringe'], 190, 146)).toBe(false);
      expect(plumHair(pictures['hair-side-fringe'], 64, 150)).toBe(true);
      expect(plumHair(pictures['hair-side-fringe'], 128, 140)).toBe(false);
      expect(plumHair(pictures['hair-side-fringe'], 190, 146)).toBe(false);
      expect(plumHair(pictures['hair-wisps'], 128, 140)).toBe(false);
      expect(plumHair(pictures['hair-wisps'], 64, 150)).toBe(true);
      expect(plumHair(pictures['hair-wisps'], 200, 150)).toBe(true);
      expect(plumHair(pictures['hair-fringe'], 200, 150)).toBe(false);
      expect(plumHair(pictures['hair-side-fringe'], 200, 150)).toBe(false);
      for (const style of styles) {
        expect(plumHair(pictures[style], 96, 185)).toBe(false);
        expect(plumHair(pictures[style], 164, 185)).toBe(false);
        const result = generateAvatar(
          { templateId, instance: { hair: { style, color: 'plum' } } },
          catalog,
          svgRenderer,
        );
        expect(result.avatar.hair).toMatchObject({ style, back: catalog.hairBack[style] });
        expect(
          generateAvatar(
            { templateId, instance: { hair: { style, color: 'plum' } } },
            catalog,
            svgRenderer,
          ).svg,
        ).toBe(result.svg);
      }
      if (wave) {
        expect(plumHair(wave, 128, 140)).toBe(true);
        expect(plumHair(wave, 64, 150)).toBe(true);
        expect(plumCount(pictures['hair-wisps'])).toBeLessThan(plumCount(wave) / 2);
      }
      const states = ['idle', 'working', 'waiting', 'success', 'error', 'offline'];
      for (const style of styles) {
        const seen = new Set();
        for (const state of states) {
          const result = generateAvatar(
            { templateId, state, instance: { hair: { style, color: 'plum' } } },
            catalog,
            svgRenderer,
          );
          expect(result.avatar.hair.style).toBe(style);
          seen.add(result.svg);
        }
        expect(seen.size).toBe(states.length);
      }
    },
  );
});

describe('occupational hardhat palettes', () => {
  it('offers yellow and red hardhats with stable identity across all states', () => {
    const hats = catalog.templates.filter((template) => template.hat.type === 'hat-hardhat');
    expect(hats.map((template) => template.hat.color).sort()).toEqual([
      'safety-red',
      'safety-yellow',
    ]);
    expect(catalog.roles.build).toBe('build');
    for (const template of hats) {
      let identity;
      for (const state of ['idle', 'working', 'waiting', 'success', 'error', 'offline']) {
        const request = { templateId: template.id, instance: { seed: 'hardhat-review' }, state };
        const result = generateAvatar(request, catalog, svgRenderer);
        expect(generateAvatar(request, catalog, svgRenderer).svg).toBe(result.svg);
        expect(result.svg).toContain(catalog.colors[template.hat.color]);
        expect(result.svg).toContain(catalog.colors[template.hat.badgeColor]);
        if (identity) expect(result.avatar.hat).toEqual(identity);
        else identity = result.avatar.hat;
      }
    }
  });
});
