const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { PNG } = require('pngjs');

const fixturePath = process.env.GEMINI_REAL_FIXTURE;
const repoRoot = path.join(__dirname, '..');
const userscriptSource = fs.readFileSync(path.join(repoRoot, 'remove-gemini-watermark.userscript.js'), 'utf8');
const teleaSource = fs.readFileSync(path.join(repoRoot, 'lib', 'inpaint-telea.js'), 'utf8')
  .replace('module.exports = { inpaintTelea };', 'globalThis.InpaintTelea = inpaintTelea;');
const blankPng = PNG.sync.write(new PNG({ width: 128, height: 128 }));

async function openHarness(page, options = {}) {
  const imageBytes = options.useFixture !== false && fixturePath ? fs.readFileSync(fixturePath) : blankPng;
  const duplicateCount = options.duplicateCount || 1;
  const imageMarkup = Array.from({ length: duplicateCount }, (_, index) => {
    const imageId = index < 2 ? 'test-image' : `hidden-history-${index}`;
    const style = index === 0 ? 'display:block;width:100%;height:auto' : 'display:none';
    const imageUrl = `https://lh3.googleusercontent.com/rd-gg/${imageId}=s1024`;
    if (index === 0) {
      return `<img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==" srcset="${imageUrl} 1x" style="${style}">`;
    }
    return `<img src="${imageUrl}" style="${style}">`;
  }).join('');
  const nativeDownloadHandler = options.nativeDownload === false ? '' : `
        document.addEventListener('click', (event) => {
          if (!event.composedPath().some((entry) => entry && entry.dataset && entry.dataset.nativeDownload)) return;
          const request = new XMLHttpRequest();
          request.open('GET', 'https://lh3.googleusercontent.com/rd-gg-dl/test-image=s0');
          request.responseType = 'blob';
          request.addEventListener('load', () => {
            const channel = new MessageChannel();
            channel.port2.addEventListener('message', (channelEvent) => {
              const anchor = document.createElement('a');
              anchor.href = URL.createObjectURL(channelEvent.data);
              anchor.download = 'Gemini_Generated_Image.png';
              anchor.dataset.gwrBypass = 'true';
              document.body.appendChild(anchor);
              anchor.click();
              anchor.remove();
            }, { once: true });
            channel.port2.start();
            channel.port1.postMessage(request.response);
          });
          request.send();
        });`;
  const nativeCopyHandler = options.nativeCopy !== true ? '' : `
        document.addEventListener('click', (event) => {
          if (!event.composedPath().some((entry) => entry && entry.dataset && entry.dataset.nativeCopy)) return;
          const request = new XMLHttpRequest();
          request.open('GET', 'https://lh3.googleusercontent.com/rd-gg/test-image=s1024');
          request.responseType = 'blob';
          request.addEventListener('load', async () => {
            try {
              await navigator.clipboard.write([new ClipboardItem({ 'image/png': request.response })]);
              window.copyDone = true;
            } catch (error) {
              window.copyError = String(error && error.stack || error);
            }
          });
          request.send();
        });`;
  let fullResolutionRequests = 0;
  const trustedTypesPolicy = options.blockWorkerPolicy
    ? "trusted-types 'none';"
    : 'trusted-types gemini-watermark-remover-worker;';
  await page.addInitScript({ content: teleaSource });
  await page.addInitScript({ content: userscriptSource });
  await page.route('https://gemini.google.com/**', async (route) => {
    await route.fulfill({
      contentType: 'text/html',
      headers: {
        'content-security-policy': `require-trusted-types-for 'script'; ${trustedTypesPolicy} connect-src 'self' https://*.googleusercontent.com data:`,
      },
      body: `<!doctype html><html><head><script>
        window.addEventListener('click', (event) => {
          if (event.composedPath().some((entry) => entry && entry.dataset && entry.dataset.nativeDownload)) {
            event.preventDefault();
          }
        }, true);
        ${nativeDownloadHandler}
        ${nativeCopyHandler}
      </script></head><body style="margin:0;background:#f5f5f5">
        <section class="current-image-shell" style="display:block;box-sizing:border-box;width:640px;max-width:100%;padding:24px">
          ${imageMarkup}
          ${options.nativeCopy === true ? '<copy-button><button data-native-copy="true" type="button" aria-label="Copy image"><span>Copy image</span></button></copy-button>' : ''}
          <button data-native-download="true" type="button" aria-label="Download full size image" style="display:block;margin:12px 0 0 auto"><span>Download</span></button>
        </section>
      </body></html>`,
    });
  });
  await page.route('https://lh3.googleusercontent.com/**', async (route) => {
    if (route.request().url().includes('=s0')) fullResolutionRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: 'image/png',
      headers: {
        'access-control-allow-origin': 'https://gemini.google.com',
        'access-control-allow-credentials': 'true',
      },
      body: imageBytes,
    });
  });
  await page.goto('https://gemini.google.com/test-harness');
  await expect(page.locator('#gemini-watermark-remover-panel').locator('#message')).toHaveText('Ready');
  return { fullResolutionRequests: () => fullResolutionRequests };
}

async function switchVisibleImageToBlob(page, maxSize = null) {
  return page.locator('.current-image-shell img').first().evaluate(async (image, targetSize) => {
    const response = await fetch(image.currentSrc || image.src);
    let blob = await response.blob();
    if (targetSize) {
      const bitmap = await createImageBitmap(blob);
      const scale = Math.min(1, targetSize / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    }
    const blobUrl = URL.createObjectURL(blob);
    image.removeAttribute('srcset');
    image.src = blobUrl;
    await image.decode();
    return blobUrl;
  }, maxSize);
}

function assertFixtureCleanup(cleanedBytes) {
  const original = PNG.sync.read(fs.readFileSync(fixturePath));
  const cleaned = PNG.sync.read(cleanedBytes);
  assert.equal(cleaned.width, original.width);
  assert.equal(cleaned.height, original.height);
  let changedInside = 0;
  let changedOutside = 0;
  let newlyNearBlack = 0;
  for (let y = 0; y < cleaned.height; y += 1) {
    for (let x = 0; x < cleaned.width; x += 1) {
      const offset = (y * cleaned.width + x) << 2;
      const inWatermarkRegion = x >= 1752 && x <= 1863 && y >= 1752 && y <= 1863;
      const originalLuma = (original.data[offset] + original.data[offset + 1] + original.data[offset + 2]) / 3;
      const cleanedLuma = (cleaned.data[offset] + cleaned.data[offset + 1] + cleaned.data[offset + 2]) / 3;
      if (inWatermarkRegion && originalLuma > 80 && cleanedLuma < 8) newlyNearBlack += 1;
      const changed = original.data[offset] !== cleaned.data[offset]
        || original.data[offset + 1] !== cleaned.data[offset + 1]
        || original.data[offset + 2] !== cleaned.data[offset + 2];
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
}

test('interactive panel survives Trusted Types and exposes working desktop/mobile controls', async ({ page }) => {
  await openHarness(page);
  const host = page.locator('#gemini-watermark-remover-panel');
  const panel = host.locator('.panel');
  const desktopBox = await panel.boundingBox();
  assert.ok(desktopBox.width <= 36);
  assert.ok(desktopBox.height <= 36);
  assert.ok(desktopBox.x >= 1280 - 56 && desktopBox.x + desktopBox.width <= 1280);
  assert.ok(desktopBox.y >= 0 && desktopBox.y <= 24);
  await expect(host.locator('.body')).toBeHidden();
  await expect(host.locator('#collapse')).toHaveText('\u2726');
  await expect(host.locator('#collapse')).toHaveAttribute('aria-label', 'Open watermark cleaner');

  await host.locator('#collapse').click();
  await expect(host.locator('.body')).toBeVisible();
  await expect(host.locator('#collapse')).toHaveText('\u2212');
  await expect(host.locator('#collapse')).toHaveAttribute('aria-label', 'Minimize watermark cleaner');

  await host.locator('.track').click();
  await expect(host.locator('#message')).toHaveText('Auto-clean paused');
  await host.locator('.track').click();
  await expect(host.locator('#message')).toHaveText('Auto-clean enabled');
  await host.locator('#collapse').click();
  await expect(host.locator('.body')).toBeHidden();

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileBox = await panel.boundingBox();
  assert.ok(mobileBox.x >= 0 && mobileBox.x + mobileBox.width <= 390);
  assert.ok(mobileBox.y >= 0 && mobileBox.y + mobileBox.height <= 844);
  await page.screenshot({ path: path.join(repoRoot, 'test-results', 'userscript-panel-mobile.png') });
});

test('manual controls rescan, clean the latest image, and accept a local file', async ({ page }) => {
  const harness = await openHarness(page, { useFixture: false, duplicateCount: 4 });
  const host = page.locator('#gemini-watermark-remover-panel');
  const blobUrl = await switchVisibleImageToBlob(page);
  assert.match(blobUrl, /^blob:https:\/\/gemini\.google\.com\//);
  await host.locator('#collapse').click();
  await expect(host.locator('.body')).toBeVisible();

  await host.locator('#rescan').click();
  await expect(host.locator('#message')).toHaveText('Page image unchanged');
  assert.equal(harness.fullResolutionRequests(), 0);
  let stats = await page.evaluate(() => window.geminiWatermarkRemover.stats());
  assert.equal(stats.unchanged, 1);
  assert.equal(stats.activePageScan, false);

  await host.locator('#rescan').click();
  await expect(host.locator('#message')).toHaveText('No new page images found');
  assert.equal(harness.fullResolutionRequests(), 0);

  const latestDownload = page.waitForEvent('download');
  await host.locator('#clean-latest').click();
  await latestDownload;
  await expect(host.locator('#message')).toHaveText('No watermark match');

  const fileDownload = page.waitForEvent('download');
  await host.locator('#file').setInputFiles({
    name: 'blank.png',
    mimeType: 'image/png',
    buffer: blankPng,
  });
  await fileDownload;
  await expect(host.locator('#message')).toHaveText('No watermark match');

  stats = await page.evaluate(() => window.geminiWatermarkRemover.stats());
  assert.equal(stats.attempts, 2);
  assert.equal(stats.cleaned, 0);
  assert.equal(stats.unchanged, 3);
  assert.equal(stats.failures, 0);
});

test('downscaled Gemini blob preview accepts the 48px near-corner watermark', async ({ page }) => {
  test.skip(!fixturePath, 'Set GEMINI_REAL_FIXTURE to run the browser preview regression.');
  await openHarness(page);
  await switchVisibleImageToBlob(page, 1024);
  await page.locator('.current-image-shell img').first().evaluate((image) => {
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    window.__previewBefore = context.getImageData(0, 0, canvas.width, canvas.height);
  });
  const host = page.locator('#gemini-watermark-remover-panel');
  await host.locator('#collapse').click();
  await host.locator('#rescan').click();
  await expect.poll(
    () => page.evaluate(() => window.geminiWatermarkRemover.stats().activePageScan),
  ).toBe(false);
  const stats = await page.evaluate(() => window.geminiWatermarkRemover.stats());
  assert.equal(
    await host.locator('#message').textContent(),
    'Page image cleaned',
    JSON.stringify(stats.lastAnalysis),
  );
  assert.equal(stats.cleaned, 1);
  assert.equal(stats.failures, 0);
  assert.equal(stats.lastMatch.logoSize, 48);
  assert.ok(stats.lastMatch.confidence >= 0.52);
  const pixelDiff = await page.locator('.current-image-shell img').first().evaluate((image, match) => {
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    const after = context.getImageData(0, 0, canvas.width, canvas.height);
    const before = window.__previewBefore;
    let changedInside = 0;
    let changedOutside = 0;
    const padding = 64;
    for (let y = 0; y < after.height; y += 1) {
      for (let x = 0; x < after.width; x += 1) {
        const offset = (y * after.width + x) * 4;
        const changed = after.data[offset] !== before.data[offset]
          || after.data[offset + 1] !== before.data[offset + 1]
          || after.data[offset + 2] !== before.data[offset + 2];
        if (!changed) continue;
        const inside = x >= match.x - padding && x < match.x + match.logoSize + padding
          && y >= match.y - padding && y < match.y + match.logoSize + padding;
        if (inside) changedInside += 1;
        else changedOutside += 1;
      }
    }
    return { changedInside, changedOutside };
  }, stats.lastMatch);
  assert.ok(pixelDiff.changedInside > 100);
  assert.equal(pixelDiff.changedOutside, 0);
});

test('an unobserved native download leaves the busy state after a bounded wait', async ({ page }) => {
  await openHarness(page, { useFixture: false, nativeDownload: false });
  await switchVisibleImageToBlob(page, 1024);
  const host = page.locator('#gemini-watermark-remover-panel');
  await host.locator('#collapse').click();
  await page.locator('[data-native-download] span').click();
  await expect(host.locator('#message')).toHaveText('Preparing full-size download');
  await expect(host.locator('#message')).toHaveText('Download was not cleaned', { timeout: 10000 });
  const stats = await page.evaluate(() => window.geminiWatermarkRemover.stats());
  assert.equal(stats.attempts, 0);
  assert.equal(stats.failures, 1);
});

test('download click cleans the real fixture and reports the accepted match', async ({ page }) => {
  test.skip(!fixturePath, 'Set GEMINI_REAL_FIXTURE to run the browser download regression.');
  const harness = await openHarness(page);
  const sourceUrl = await switchVisibleImageToBlob(page, 1024);
  assert.match(sourceUrl, /^blob:https:\/\/gemini\.google\.com\//);
  let stats = await page.evaluate(() => window.geminiWatermarkRemover.stats());
  assert.equal(stats.transferHooks.worker, true);
  const downloadPromise = page.waitForEvent('download');
  await page.locator('[data-native-download] span').click();
  await expect.poll(
    () => page.evaluate(() => JSON.stringify(window.geminiWatermarkRemover.stats())),
    { timeout: 5000, message: 'The download control was not intercepted.' },
  ).toMatch(/"attempts":1/);
  const download = await downloadPromise;
  const outputPath = path.join(repoRoot, 'test-results', 'userscript-cleaned.png');
  await download.saveAs(outputPath);

  stats = await page.evaluate(() => window.geminiWatermarkRemover.stats());
  assert.equal(stats.cleaned, 1);
  assert.equal(stats.failures, 0);
  assert.equal(stats.lastMatch.logoSize, 96);
  assert.equal(stats.lastMatch.x, 1760);
  assert.equal(stats.lastMatch.y, 1760);
  assert.equal(stats.lastMatch.reconstruction.method, 'directional-global');
  assert.deepEqual(stats.lastMatch.reconstruction.direction, [0, 1]);
  assert.equal(stats.lastMatch.reconstruction.workerUsed, true, JSON.stringify(stats.lastMatch.reconstruction));
  assert.ok(stats.lastMatch.reconstruction.candidates.length >= 4);
  assert.ok(stats.lastDurationMs < 3000, `Full-size cleaning took ${stats.lastDurationMs}ms.`);
  await expect(page.locator('#gemini-watermark-remover-panel').locator('#message')).toHaveText('Full-size download cleaned');

  assertFixtureCleanup(fs.readFileSync(outputPath));
  assert.equal(harness.fullResolutionRequests(), 1);
});

test('download cleaning falls back when CSP forbids a Worker Trusted Types policy', async ({ page }) => {
  test.skip(!fixturePath, 'Set GEMINI_REAL_FIXTURE to run the browser download regression.');
  await openHarness(page, { blockWorkerPolicy: true });
  await switchVisibleImageToBlob(page, 1024);
  const downloadPromise = page.waitForEvent('download');
  await page.locator('[data-native-download] span').click();
  const download = await downloadPromise;
  const outputPath = path.join(repoRoot, 'test-results', 'userscript-csp-fallback-cleaned.png');
  await download.saveAs(outputPath);

  const stats = await page.evaluate(() => window.geminiWatermarkRemover.stats());
  assert.equal(stats.cleaned, 1);
  assert.equal(stats.failures, 0);
  assert.equal(stats.lastMatch.reconstruction.workerUsed, false);
  assert.match(stats.lastMatch.reconstruction.workerError, /TrustedScriptURL|policy/i);
  assert.ok(stats.lastDurationMs < 3000, `CSP fallback cleaning took ${stats.lastDurationMs}ms.`);
  assertFixtureCleanup(fs.readFileSync(outputPath));
});

test('Copy image writes the cleaned fixture to the native clipboard', async ({ page, context }) => {
  test.skip(!fixturePath, 'Set GEMINI_REAL_FIXTURE to run the browser clipboard regression.');
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://gemini.google.com' });
  await openHarness(page, { nativeCopy: true, nativeDownload: false });
  const statsBefore = await page.evaluate(() => window.geminiWatermarkRemover.stats());
  assert.equal(statsBefore.clipboardHooks.item, true);
  assert.equal(statsBefore.clipboardHooks.write, true);

  await page.locator('[data-native-copy] span').click();
  await expect.poll(
    () => page.evaluate(() => window.copyError || (window.copyDone ? 'done' : 'pending')),
    { timeout: 10000, message: 'Gemini did not finish its native clipboard write.' },
  ).toBe('done');
  await expect(page.locator('#gemini-watermark-remover-panel').locator('#message')).toHaveText('Copied cleaned image');

  const clipboardDownload = page.waitForEvent('download');
  await page.evaluate(async () => {
    const items = await navigator.clipboard.read();
    const item = items.find((entry) => entry.types.includes('image/png'));
    if (!item) throw new Error('Clipboard does not contain an image/png item.');
    const blob = await item.getType('image/png');
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(blob);
    anchor.download = 'clipboard-cleaned.png';
    anchor.dataset.gwrBypass = 'true';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  });
  const copied = await clipboardDownload;
  const outputPath = path.join(repoRoot, 'test-results', 'userscript-clipboard-cleaned.png');
  await copied.saveAs(outputPath);

  const statsAfter = await page.evaluate(() => window.geminiWatermarkRemover.stats());
  assert.equal(statsAfter.cleaned, 1);
  assert.equal(statsAfter.failures, 0);
  assert.equal(statsAfter.waitingForClipboard, false);
  assert.equal(statsAfter.lastMatch.reconstruction.workerUsed, true, JSON.stringify(statsAfter.lastMatch.reconstruction));
  assert.ok(statsAfter.lastMatch.reconstruction.candidates.length >= 4);
  assert.ok(statsAfter.lastDurationMs < 3000, `Clipboard cleaning took ${statsAfter.lastDurationMs}ms.`);
  assertFixtureCleanup(fs.readFileSync(outputPath));
});
