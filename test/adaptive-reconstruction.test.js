const assert = require('node:assert/strict');
const test = require('node:test');

const { adaptiveReconstructRegion } = require('../lib/adaptive-reconstruction.js');

function createRgb(width, height, pixel) {
  const rgb = new Uint8ClampedArray(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = ((y * width) + x) * 3;
      const value = pixel(x, y).map((channel) => Math.max(0, Math.min(255, Math.round(channel))));
      rgb[offset] = value[0];
      rgb[offset + 1] = value[1];
      rgb[offset + 2] = value[2];
    }
  }
  return rgb;
}

function createMask(width, height) {
  const mask = new Uint8Array(width * height);
  const alpha = new Float32Array(width * height);
  const centerX = (width - 1) / 2;
  const centerY = (height - 1) / 2;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const distance = Math.abs(x - centerX) + Math.abs(y - centerY);
      const value = Math.max(0, Math.min(0.5, (34 - distance) * 0.12));
      const index = (y * width) + x;
      alpha[index] = value;
      if (value >= 0.015) mask[index] = 1;
    }
  }
  return { mask, alpha };
}

function watermarkAndOversubtract(original, alpha, opacityScale, nominalAlpha = alpha) {
  const watermarked = new Uint8ClampedArray(original);
  const subtracted = new Uint8ClampedArray(original);
  for (let index = 0; index < alpha.length; index += 1) {
    const actualAlpha = alpha[index] * opacityScale;
    const subtractionAlpha = Math.min(nominalAlpha[index], 0.94);
    const offset = index * 3;
    for (let channel = 0; channel < 3; channel += 1) {
      watermarked[offset + channel] = Math.round((original[offset + channel] * (1 - actualAlpha)) + (255 * actualAlpha));
      subtracted[offset + channel] = subtractionAlpha < 0.002
        ? watermarked[offset + channel]
        : Math.max(0, Math.min(255, Math.round((watermarked[offset + channel] - (subtractionAlpha * 255)) / (1 - subtractionAlpha))));
    }
  }
  return { watermarked, subtracted };
}

function shiftAlpha(alpha, width, height, offsetX, offsetY) {
  const shifted = new Float32Array(alpha.length);
  const sample = (x, y) => {
    if (x < 0 || y < 0 || x > width - 1 || y > height - 1) return 0;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = Math.min(width - 1, x0 + 1);
    const y1 = Math.min(height - 1, y0 + 1);
    const wx = x - x0;
    const wy = y - y0;
    const top = alpha[y0 * width + x0] * (1 - wx) + alpha[y0 * width + x1] * wx;
    const bottom = alpha[y1 * width + x0] * (1 - wx) + alpha[y1 * width + x1] * wx;
    return top * (1 - wy) + bottom * wy;
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) shifted[y * width + x] = sample(x - offsetX, y - offsetY);
  }
  return shifted;
}

function meanMaskedError(actual, expected, mask) {
  let error = 0;
  let count = 0;
  for (let index = 0; index < mask.length; index += 1) {
    if (!mask[index]) continue;
    const offset = index * 3;
    for (let channel = 0; channel < 3; channel += 1) {
      error += Math.abs(actual[offset + channel] - expected[offset + channel]);
      count += 1;
    }
  }
  return error / Math.max(1, count);
}

const scenes = {
  gradient: (x, y) => [45 + (x * 1.2), 70 + (y * 0.8), 95 + ((x + y) * 0.45)],
  straightEdge: (x, y) => x < 45
    ? [154 + (y * 0.2), 137 + (y * 0.15), 63 + (y * 0.1)]
    : [25 + (y * 0.16), 21 + (y * 0.12), 23 + (y * 0.14)],
  curvedEdge: (x, y) => x < 42 + (((y - 48) * (y - 48)) / 320)
    ? [145 + (y * 0.18), 128 + (y * 0.12), 58]
    : [28 + (y * 0.12), 23 + (y * 0.1), 25 + (y * 0.1)],
  crossingEdges: (x, y) => {
    if (x < 48 && y < 48) return [160, 78, 66];
    if (x >= 48 && y < 48) return [42, 45, 116];
    if (x < 48) return [72, 138, 77];
    return [30, 27, 31];
  },
  texture: (x, y) => {
    const texture = (Math.sin(x * 0.48) * 24) + (Math.cos(y * 0.39) * 19) + (Math.sin((x + y) * 0.23) * 11);
    return [112 + texture, 96 + (texture * 0.8), 78 + (texture * 0.55)];
  },
};

for (const [name, scene] of Object.entries(scenes)) {
  test(`adaptive reconstruction improves ${name} ground truth`, () => {
    const width = 96;
    const height = 96;
    const original = createRgb(width, height, scene);
    const { mask, alpha } = createMask(width, height);
    const { watermarked, subtracted } = watermarkAndOversubtract(original, alpha, 0.6);
    const damagedError = meanMaskedError(subtracted, original, mask);
    const result = adaptiveReconstructRegion({ width, height, mask, alpha, watermarkedRgb: watermarked, subtractedRgb: subtracted });
    const reconstructedError = meanMaskedError(result.rgb, original, mask);

    assert.ok(reconstructedError < damagedError * 0.65, `${name} error ${reconstructedError} did not sufficiently improve ${damagedError}.`);
    assert.ok(result.diagnostics.opacityScale > 0.4 && result.diagnostics.opacityScale < 0.8);
    assert.ok(result.diagnostics.candidates.length >= 4);
    assert.ok(result.diagnostics.candidates.every((candidate) => Number.isFinite(candidate.metrics.score)));
    assert.ok(result.diagnostics.candidates.some((candidate) => candidate.name === 'directional-local'));
    assert.ok(result.diagnostics.candidates.some((candidate) => candidate.name === 'multiscale'));
    if (name === 'texture') {
      assert.ok(
        result.diagnostics.candidates.some((candidate) => candidate.name === 'exemplar-patch'),
        `Texture diagnostics: ${JSON.stringify(result.diagnostics)}`,
      );
    }
  });
}

test('adaptive reconstruction calibrates a half-pixel template offset', () => {
  const width = 96;
  const height = 96;
  const original = createRgb(width, height, scenes.gradient);
  const { mask, alpha } = createMask(width, height);
  const shifted = shiftAlpha(alpha, width, height, 0.5, -0.5);
  const { watermarked, subtracted } = watermarkAndOversubtract(original, shifted, 0.6, alpha);
  const result = adaptiveReconstructRegion({ width, height, mask, alpha, watermarkedRgb: watermarked, subtractedRgb: subtracted });

  assert.deepEqual(result.diagnostics.subpixelOffset, [0.5, -0.5]);
  assert.ok(meanMaskedError(result.rgb, original, mask) < meanMaskedError(subtracted, original, mask) * 0.65);
});

test('artifact scoring prevents oversubtraction from becoming a dark silhouette', () => {
  const width = 96;
  const height = 96;
  const original = createRgb(width, height, (x, y) => [32 + x * 0.18, 27 + y * 0.12, 30 + (x + y) * 0.05]);
  const { mask, alpha } = createMask(width, height);
  const { watermarked, subtracted } = watermarkAndOversubtract(original, alpha, 0.52);
  const result = adaptiveReconstructRegion({ width, height, mask, alpha, watermarkedRgb: watermarked, subtractedRgb: subtracted });
  const countDark = (rgb) => {
    let count = 0;
    for (let index = 0; index < mask.length; index += 1) {
      if (!mask[index]) continue;
      const offset = index * 3;
      if ((rgb[offset] + rgb[offset + 1] + rgb[offset + 2]) / 3 < 4) count += 1;
    }
    return count;
  };

  assert.ok(countDark(subtracted) > 100);
  assert.ok(countDark(result.rgb) < 10);
  assert.ok(result.diagnostics.candidates.every((candidate) => Number.isFinite(candidate.metrics.clippingRate)));
  assert.ok(result.diagnostics.candidates.every((candidate) => Number.isFinite(candidate.metrics.watermarkCorrelation)));
  assert.equal(typeof result.diagnostics.artifactRejected, 'boolean');
});
