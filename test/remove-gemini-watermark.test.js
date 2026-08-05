const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const detector = require('../detect-gemini-watermark.js');
const remover = require('../remove-gemini-watermark.js');

function createRaster(width, height, pixel) {
  const data = Buffer.alloc(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) << 2;
      const [r, g, b] = pixel(x, y);
      data[offset] = r;
      data[offset + 1] = g;
      data[offset + 2] = b;
      data[offset + 3] = 255;
    }
  }

  return { width, height, data };
}

function createSolidRaster(width, height, color = [40, 60, 80]) {
  return createRaster(width, height, () => color);
}

function resizeAlphaMap(alphaMap, sourceSize, targetSize) {
  const scaled = new Float32Array(targetSize * targetSize);
  const sourceLast = sourceSize - 1;
  const targetLast = targetSize - 1;

  for (let y = 0; y < targetSize; y += 1) {
    const sourceY = (y / targetLast) * sourceLast;
    const y0 = Math.floor(sourceY);
    const y1 = Math.min(sourceLast, y0 + 1);
    const weightY = sourceY - y0;

    for (let x = 0; x < targetSize; x += 1) {
      const sourceX = (x / targetLast) * sourceLast;
      const x0 = Math.floor(sourceX);
      const x1 = Math.min(sourceLast, x0 + 1);
      const weightX = sourceX - x0;
      const top = alphaMap[y0 * sourceSize + x0] * (1 - weightX)
        + alphaMap[y0 * sourceSize + x1] * weightX;
      const bottom = alphaMap[y1 * sourceSize + x0] * (1 - weightX)
        + alphaMap[y1 * sourceSize + x1] * weightX;
      scaled[y * targetSize + x] = top * (1 - weightY) + bottom * weightY;
    }
  }

  return scaled;
}

function applyWhiteTemplate(png, alphaMap, size, startX, startY) {
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const alpha = alphaMap[y * size + x];
      const offset = ((startY + y) * png.width + startX + x) << 2;

      for (let channel = 0; channel < 3; channel += 1) {
        png.data[offset + channel] = Math.round(
          png.data[offset + channel] * (1 - alpha) + 255 * alpha,
        );
      }
    }
  }
}

async function withoutLogs(callback) {
  const originalLog = console.log;
  console.log = () => {};
  try {
    return await callback();
  } finally {
    console.log = originalLog;
  }
}

test('PNG loaders reject missing files without an unhandled stream error', async () => {
  const missingPath = path.join(os.tmpdir(), `missing-watermark-fixture-${process.pid}.png`);

  await Promise.all([
    assert.rejects(detector.loadPng(missingPath), { code: 'ENOENT' }),
    assert.rejects(remover.loadPng(missingPath), { code: 'ENOENT' }),
  ]);
});

test('fixed-position NCC does not refine outside the requested bounds', async () => {
  const png = createSolidRaster(256, 256);
  const template = await remover.getAlphaTemplate(48);
  applyWhiteTemplate(png, template.alphaMap, 48, 174, 174);

  const match = remover.findWatermarkNCC(png, template.alphaMap, 48, {
    startX: 176,
    endX: 176,
    startY: 176,
    endY: 176,
  });

  assert.equal(match.x, 176);
  assert.equal(match.y, 176);
});

test('structure-aware inpainting continues a stable edge through the mask', () => {
  const width = 96;
  const height = 96;
  const original = createRaster(width, height, (x, y) => {
    const verticalLight = Math.round(y * 0.35);
    return x < 43
      ? [148 + verticalLight, 133 + verticalLight, 58 + verticalLight]
      : [24 + verticalLight, 20 + verticalLight, 22 + verticalLight];
  });
  const damaged = createRaster(width, height, (x, y) => {
    const offset = ((y * width) + x) << 2;
    return [original.data[offset], original.data[offset + 1], original.data[offset + 2]];
  });
  const mask = new Uint8Array(width * height);
  for (let y = 18; y <= 78; y += 1) {
    for (let x = 18; x <= 78; x += 1) {
      if (Math.abs(x - 48) + Math.abs(y - 48) > 46) continue;
      mask[(y * width) + x] = 1;
      const offset = ((y * width) + x) << 2;
      damaged.data[offset] = 255;
      damaged.data[offset + 1] = 255;
      damaged.data[offset + 2] = 255;
    }
  }

  const result = remover.inpaintMaskStructureAware(damaged, 0, 0, width, height, mask);
  let absoluteError = 0;
  let channelCount = 0;
  for (let index = 0; index < mask.length; index += 1) {
    if (!mask[index]) continue;
    const offset = index << 2;
    for (let channel = 0; channel < 3; channel += 1) {
      absoluteError += Math.abs(damaged.data[offset + channel] - original.data[offset + channel]);
      channelCount += 1;
    }
  }

  assert.equal(result.method, 'directional');
  assert.deepEqual(result.direction, [0, 1]);
  assert.ok(absoluteError / channelCount < 2, `Mean reconstruction error was ${absoluteError / channelCount}.`);
});

test('default-placement removal reconstructs a synthetic image and becomes a no-op', async () => {
  const png = createSolidRaster(256, 256);
  const template = await remover.getAlphaTemplate(48);
  applyWhiteTemplate(png, template.alphaMap, 48, 176, 176);

  const cleaned = await withoutLogs(() => remover.removeWatermark(png));
  let maxError = 0;

  for (let index = 0; index < cleaned.width * cleaned.height; index += 1) {
    const offset = index << 2;
    maxError = Math.max(
      maxError,
      Math.abs(cleaned.data[offset] - 40),
      Math.abs(cleaned.data[offset + 1] - 60),
      Math.abs(cleaned.data[offset + 2] - 80),
    );
  }

  assert.ok(maxError <= 1, `expected at most one level of rounding error, got ${maxError}`);
  const secondPlan = await withoutLogs(() => remover.planWatermarkRemoval(cleaned));
  assert.equal(secondPlan.found, false);
});

test('clean gradient-like content is not accepted as a watermark', async () => {
  const png = createRaster(512, 512, (x, y) => {
    const value = (x * 3 + y * 2) % 256;
    return [value, value, value];
  });

  const plan = await withoutLogs(() => remover.planWatermarkRemoval(png));
  assert.equal(plan.found, false);
});

test('detector-guided matching still finds a scaled non-default watermark', async () => {
  const png = createSolidRaster(512, 512);
  const template = await remover.getAlphaTemplate(48);
  const scaledSize = 64;
  const alphaMap = resizeAlphaMap(template.alphaMap, 48, scaledSize);
  applyWhiteTemplate(png, alphaMap, scaledSize, 400, 400);

  const plan = await withoutLogs(() => remover.planWatermarkRemoval(png));
  assert.equal(plan.found, true);
  assert.equal(plan.logoSize, scaledSize);
  assert.equal(plan.x, 400);
  assert.equal(plan.y, 400);
  assert.ok(plan.confidence > 0.99);
});

test('userscript keeps the hardened CLI matching policy', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'remove-gemini-watermark.userscript.js'),
    'utf8',
  );

  assert.match(source, /const DETECTOR_GUIDED_MIN_SCORE = 0\.57;/);
  assert.match(source, /candidate\.confidence >= DEFAULT_PLACEMENT_MIN_SCORES/);
  assert.match(source, /x < startX \|\| y < startY/);
  assert.doesNotMatch(source, /score >= 0\.15/);
});
