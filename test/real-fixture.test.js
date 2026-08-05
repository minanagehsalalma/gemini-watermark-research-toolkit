const assert = require('node:assert/strict');
const test = require('node:test');

const {
  loadPng,
  planWatermarkRemoval,
  removeWatermark,
} = require('../remove-gemini-watermark.js');

const fixturePath = process.env.GEMINI_REAL_FIXTURE;

async function withoutLogs(callback) {
  const originalLog = console.log;
  console.log = () => {};
  try {
    return await callback();
  } finally {
    console.log = originalLog;
  }
}

test('real 2048px fixture removes the true mark, preserves unrelated pixels, and becomes a no-op', {
  skip: fixturePath ? false : 'Set GEMINI_REAL_FIXTURE to run the private-image regression.',
}, async () => {
  const png = await loadPng(fixturePath);
  const original = Buffer.from(png.data);
  const plan = await withoutLogs(() => planWatermarkRemoval(png));

  assert.equal(plan.found, true);
  assert.equal(plan.logoSize, 96);
  assert.equal(plan.x, 1760);
  assert.equal(plan.y, 1760);
  assert.equal(plan.matches[0].source, 'geometry-placement-search');
  assert.ok(plan.confidence >= 0.52);

  const cleaned = await withoutLogs(() => removeWatermark(png));
  let changedInside = 0;
  let changedOutside = 0;
  let newlyNearBlack = 0;

  for (let y = 0; y < cleaned.height; y += 1) {
    for (let x = 0; x < cleaned.width; x += 1) {
      const offset = (y * cleaned.width + x) << 2;
      const inWatermarkRegion = x >= 1752 && x <= 1863 && y >= 1752 && y <= 1863;
      const originalLuma = (original[offset] + original[offset + 1] + original[offset + 2]) / 3;
      const cleanedLuma = (cleaned.data[offset] + cleaned.data[offset + 1] + cleaned.data[offset + 2]) / 3;
      if (inWatermarkRegion && originalLuma > 80 && cleanedLuma < 8) newlyNearBlack += 1;
      const changed = original[offset] !== cleaned.data[offset]
        || original[offset + 1] !== cleaned.data[offset + 1]
        || original[offset + 2] !== cleaned.data[offset + 2];
      if (!changed) continue;

      if (inWatermarkRegion) changedInside += 1;
      else changedOutside += 1;
    }
  }

  assert.ok(changedInside > 1000);
  assert.equal(changedOutside, 0);
  assert.ok(newlyNearBlack < 500, `Cleanup introduced ${newlyNearBlack} near-black pixels.`);
  const boundaryXs = [];
  for (let y = 1750; y <= 1870; y += 1) {
    let strongest = { x: 0, gradient: -1 };
    for (let x = 1738; x < 1810; x += 1) {
      const left = ((y * cleaned.width) + x) << 2;
      const right = left + 4;
      const gradient = Math.abs(cleaned.data[right] - cleaned.data[left])
        + Math.abs(cleaned.data[right + 1] - cleaned.data[left + 1])
        + Math.abs(cleaned.data[right + 2] - cleaned.data[left + 2]);
      if (gradient > strongest.gradient) strongest = { x, gradient };
    }
    boundaryXs.push(strongest.x);
  }
  const edgeRoughness = boundaryXs.slice(1).reduce((total, x, index) => total + Math.abs(x - boundaryXs[index]), 0);
  assert.ok(edgeRoughness < 60, `Reconstructed edge roughness was ${edgeRoughness}.`);
  const secondPlan = await withoutLogs(() => planWatermarkRemoval(cleaned));
  assert.equal(secondPlan.found, false);
});
