// ==UserScript==
// @name         Gemini watermark remover
// @description Removes Gemini's sparkle watermark from downloaded/generated images in-browser.
//
//              Download or copy the full resolution image and the watermark is removed!
//
//              (watermark still shows in the chat)
// @namespace    mina-nageh
// @version      2.1.0
// @author       mina nageh
// @match        https://gemini.google.com/*
// @grant        none
// @run-at       document-end
// ==/UserScript==
(function () {
    'use strict';
    if (window.__geminiWatermarkRemoverActive) {
        console.debug('[Gemini watermark remover] Already active on this page.');
        return;
    }
    window.__geminiWatermarkRemoverActive = true;
    /**
     * Gemini watermark remover
     * Removes synthetic watermarks (SynthID/Pixels) from Gemini generated images
     * with local template matching, alpha subtraction, and residual cleanup.
     * No data leaves your device.
     */
    const CONSTANTS = {
        ALPHA_THRESHOLD: 0.002,
        MAX_ALPHA: 0.99,
        LOGO_VALUE: 255,
        DOM_SCAN_DEBOUNCE_MS: 120,
        URL_PATTERN: /^https:\/\/lh3\.googleusercontent\.com\/rd-gg(?:-dl)?\/.+=s(?!0-d\?).*/
    };
    const PRIMARY_MATCH_MIN_SCORES = {
        48: 0.75,
        96: 0.75
    };
    const DEFAULT_PLACEMENT_MIN_SCORES = {
        48: 0.64,
        96: 0.75
    };
    const SECONDARY_MATCH_RATIO = 0.75;
    const TEMPLATE_CACHE = new Map();
    const RESIDUAL_HEAL_CONFIG = {
        grayThreshold: 212,
        saturationThreshold: 18,
        windowWidth: 90,
        windowHeight: 90,
        minArea: 250,
        dilationRadius: 2,
        iterations: 400,
        cornerSeedGrayFloor: 180,
        cornerSeedSaturationMax: 30,
        cornerSeedResidualMin: 2.4,
        cornerSeedSearchXRatio: 0.6,
        cornerSeedSearchYRatio: 0.8,
        cornerSeedRadius: 3,
        cornerSeedMinScore: 4.6,
        cornerEllipseRadiusX: 9,
        cornerEllipseRadiusY: 9,
        cornerIterations: 160,
        lowContrastStripWidthRatio: 0.39,
        lowContrastMaskStartXRatio: 0.45,
        lowContrastResidualMin: 8,
        lowContrastSaturationMax: 28,
        lowContrastMinArea: 80,
        lowContrastMaxBoxes: 3,
        lowContrastBoxPadding: 6
    };
    // Alpha Maps for the watermark patterns (48px and 96px versions)
    // These are standard static assets required for the pixel subtraction math.
    const ASSETS = {
        bg48: "data:image/png;base64,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",
        bg96: "data:image/png;base64,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"
    }
    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }
    function createBounds(x, y, size) {
        return { x0: x, y0: y, x1: x + size - 1, y1: y + size - 1 };
    }
    function overlapsBounds(bounds, suppressed, padding = 0) {
        return suppressed.some((entry) => (
            bounds.x0 <= entry.x1 + padding &&
            bounds.x1 >= entry.x0 - padding &&
            bounds.y0 <= entry.y1 + padding &&
            bounds.y1 >= entry.y0 - padding
        ));
    }
    function isDefaultPlacementMatch(png, match, logoSize) {
        if (!match || !Number.isFinite(match.score)) return false;
        const expectedMargin = logoSize === 96 ? 64 : 32;
        const rightMargin = png.width - (match.x + logoSize);
        const bottomMargin = png.height - (match.y + logoSize);
        const tolerance = logoSize === 96 ? 12 : 8;
        return Math.abs(rightMargin - expectedMargin) <= tolerance && Math.abs(bottomMargin - expectedMargin) <= tolerance;
    }
    function createCanvas(width, height) {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        return canvas;
    }
    function rasterFromImage(imgSource) {
        const canvas = createCanvas(imgSource.width, imgSource.height);
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(imgSource, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        return { width: canvas.width, height: canvas.height, data: new Uint8ClampedArray(imageData.data) };
    }
    function canvasFromRaster(png) {
        const canvas = createCanvas(png.width, png.height);
        const ctx = canvas.getContext('2d');
        const imageData = ctx.createImageData(png.width, png.height);
        imageData.data.set(png.data);
        ctx.putImageData(imageData, 0, 0);
        return canvas;
    }
    function buildGrayscale(png) {
        const gray = new Float32Array(png.width * png.height);
        for (let i = 0; i < gray.length; i += 1) {
            const idx = i << 2;
            gray[i] = (png.data[idx] + png.data[idx + 1] + png.data[idx + 2]) / 3;
        }
        return gray;
    }
    function calculateAlphaMap(png) {
        const alphaMap = new Float32Array(png.width * png.height);
        for (let i = 0; i < alphaMap.length; i += 1) {
            const idx = i << 2;
            alphaMap[i] = Math.max(png.data[idx], png.data[idx + 1], png.data[idx + 2]) / 255;
        }
        return alphaMap;
    }
    function solve3(matrix, vector) {
        const A = matrix.map((row) => row.slice());
        const B = vector.slice();
        for (let col = 0; col < 3; col += 1) {
            let pivot = col;
            for (let row = col + 1; row < 3; row += 1) {
                if (Math.abs(A[row][col]) > Math.abs(A[pivot][col])) pivot = row;
            }
            if (Math.abs(A[pivot][col]) < 1e-9) return [0, 0, 0];
            [A[col], A[pivot]] = [A[pivot], A[col]];
            [B[col], B[pivot]] = [B[pivot], B[col]];
            const divisor = A[col][col];
            for (let k = col; k < 3; k += 1) A[col][k] /= divisor;
            B[col] /= divisor;
            for (let row = 0; row < 3; row += 1) {
                if (row === col) continue;
                const factor = A[row][col];
                for (let k = col; k < 3; k += 1) A[row][k] -= factor * A[col][k];
                B[row] -= factor * B[col];
            }
        }
        return B;
    }
    function fitPlane(png, x0, y0, width, height, mask, channel, leftStripOnly = false) {
        let sx = 0, sy = 0, sv = 0, sxx = 0, syy = 0, sxy = 0, sxv = 0, syv = 0, count = 0;
        const maxX = leftStripOnly ? Math.max(12, Math.floor(width * RESIDUAL_HEAL_CONFIG.lowContrastStripWidthRatio)) : width;
        for (let y = 0; y < height; y += 1) {
            for (let x = 0; x < maxX; x += 1) {
                if (mask && mask[y * width + x]) continue;
                const idx = ((y0 + y) * png.width + (x0 + x)) << 2;
                const value = channel === 3
                    ? (png.data[idx] + png.data[idx + 1] + png.data[idx + 2]) / 3
                    : png.data[idx + channel];
                sx += x; sy += y; sv += value; sxx += x * x; syy += y * y; sxy += x * y; sxv += x * value; syv += y * value; count += 1;
            }
        }
        if (count < 12) return [0, 0, 0];
        return solve3([[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, count]], [sxv, syv, sv]);
    }
    function dilateMask(mask, width, height, radius) {
        const next = new Uint8Array(mask);
        for (let y = 0; y < height; y += 1) {
            for (let x = 0; x < width; x += 1) {
                if (!mask[y * width + x]) continue;
                for (let dy = -radius; dy <= radius; dy += 1) {
                    for (let dx = -radius; dx <= radius; dx += 1) {
                        const nx = x + dx, ny = y + dy;
                        if (nx >= 0 && ny >= 0 && nx < width && ny < height) next[ny * width + nx] = 1;
                    }
                }
            }
        }
        return next;
    }
    function addEllipse(mask, width, height, centerX, centerY, radiusX, radiusY) {
        for (let y = 0; y < height; y += 1) {
            for (let x = 0; x < width; x += 1) {
                const dx = (x - centerX) / radiusX;
                const dy = (y - centerY) / radiusY;
                if ((dx * dx) + (dy * dy) <= 1) mask[y * width + x] = 1;
            }
        }
    }
    function maskEdgeDistance(mask, width, height, x, y, maxDistance) {
        for (let distance = 1; distance <= maxDistance; distance += 1) {
            for (let dy = -distance; dy <= distance; dy += 1) {
                for (let dx = -distance; dx <= distance; dx += 1) {
                    if (Math.max(Math.abs(dx), Math.abs(dy)) !== distance) continue;
                    const nx = x + dx, ny = y + dy;
                    if (nx < 0 || ny < 0 || nx >= width || ny >= height || !mask[ny * width + nx]) return distance;
                }
            }
        }
        return maxDistance + 1;
    }
    function buildResidualMask(png, x0, y0, width, height) {
        const cfg = RESIDUAL_HEAL_CONFIG;
        const [gx, gy, gc] = fitPlane(png, x0, y0, width, height, null, 3, true);
        const mask = new Uint8Array(width * height);
        const minX = Math.floor(width * cfg.lowContrastMaskStartXRatio);
        let count = 0;
        let bestSeed = null;
        for (let y = 0; y < height; y += 1) {
            for (let x = minX; x < width; x += 1) {
                const idx = ((y0 + y) * png.width + (x0 + x)) << 2;
                const r = png.data[idx], g = png.data[idx + 1], b = png.data[idx + 2];
                const gray = (r + g + b) / 3;
                const saturation = Math.max(r, g, b) - Math.min(r, g, b);
                const residual = gray - ((gx * x) + (gy * y) + gc);
                const brightEdge = gray > cfg.grayThreshold && saturation < cfg.saturationThreshold && x >= width - 4;
                const lowContrast = saturation <= cfg.lowContrastSaturationMax && residual >= cfg.lowContrastResidualMin;
                if (brightEdge || lowContrast) {
                    mask[y * width + x] = 1;
                    count += 1;
                }
                if (gray >= cfg.cornerSeedGrayFloor && saturation <= cfg.cornerSeedSaturationMax && residual >= cfg.cornerSeedResidualMin) {
                    const score = residual + (x / Math.max(1, width - 1)) + (y / Math.max(1, height - 1));
                    if (!bestSeed || score > bestSeed.score) bestSeed = { x, y, score };
                }
            }
        }
        if (bestSeed && bestSeed.score >= cfg.cornerSeedMinScore) {
            addEllipse(mask, width, height, bestSeed.x, bestSeed.y, cfg.cornerEllipseRadiusX, cfg.cornerEllipseRadiusY);
            count += 1;
        }
        return count >= cfg.lowContrastMinArea ? dilateMask(mask, width, height, cfg.lowContrastBoxPadding) : null;
    }
    function fillResidualMask(png, x0, y0, width, height, mask) {
        const planes = [0, 1, 2].map((channel) => fitPlane(png, x0, y0, width, height, mask, channel, false));
        for (let y = 0; y < height; y += 1) {
            for (let x = 0; x < width; x += 1) {
                if (!mask[y * width + x]) continue;
                const idx = ((y0 + y) * png.width + (x0 + x)) << 2;
                const alpha = clamp(maskEdgeDistance(mask, width, height, x, y, 4) / 4, 0, 1);
                for (let channel = 0; channel < 3; channel += 1) {
                    const [ax, ay, c] = planes[channel];
                    const predicted = clamp(Math.round((ax * x) + (ay * y) + c), 0, 255);
                    png.data[idx + channel] = Math.round((png.data[idx + channel] * (1 - alpha)) + (predicted * alpha));
                }
            }
        }
    }
    function smoothMask(png, x0, y0, width, height, mask, iterations) {
        const neighbors = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        for (let iteration = 0; iteration < iterations; iteration += 1) {
            const next = new Uint8ClampedArray(png.data);
            for (let y = 0; y < height; y += 1) {
                for (let x = 0; x < width; x += 1) {
                    if (!mask[y * width + x]) continue;
                    const sums = [0, 0, 0];
                    let count = 0;
                    for (const [dx, dy] of neighbors) {
                        const nx = x + dx, ny = y + dy;
                        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
                        const nIdx = ((y0 + ny) * png.width + (x0 + nx)) << 2;
                        sums[0] += png.data[nIdx]; sums[1] += png.data[nIdx + 1]; sums[2] += png.data[nIdx + 2]; count += 1;
                    }
                    const idx = ((y0 + y) * png.width + (x0 + x)) << 2;
                    next[idx] = Math.round(sums[0] / count);
                    next[idx + 1] = Math.round(sums[1] / count);
                    next[idx + 2] = Math.round(sums[2] / count);
                }
            }
            png.data.set(next);
        }
    }
    function healResidualCorner(png, primaryMatch) {
        if (primaryMatch.logoSize !== 96 || primaryMatch.confidence < 0.8) return;
        const x0 = clamp(primaryMatch.x + Math.floor(primaryMatch.logoSize * 0.58), 0, png.width - 1);
        const y0 = clamp(primaryMatch.y + Math.floor(primaryMatch.logoSize * 0.5), 0, png.height - 1);
        const width = Math.min(RESIDUAL_HEAL_CONFIG.windowWidth, png.width - x0);
        const height = Math.min(RESIDUAL_HEAL_CONFIG.windowHeight, png.height - y0);
        if (width < 20 || height < 20) return;
        const mask = buildResidualMask(png, x0, y0, width, height);
        if (!mask) return;
        fillResidualMask(png, x0, y0, width, height, mask);
        smoothMask(png, x0, y0, width, height, mask, RESIDUAL_HEAL_CONFIG.cornerIterations);
    }
    function prepareTemplate(logoSize, alphaMap) {
        const N = logoSize * logoSize;
        let tSum = 0;
        for (let i = 0; i < N; i += 1) tSum += alphaMap[i];
        const tMean = tSum / N;
        let tVar = 0;
        const tDiffs = new Float32Array(N);
        for (let i = 0; i < N; i += 1) {
            const diff = alphaMap[i] - tMean;
            tDiffs[i] = diff;
            tVar += diff * diff;
        }
        const tNorm = Math.sqrt(tVar);
        const stride = 3;
        let coarseCount = 0, tSumCoarse = 0;
        for (let r = 0; r < logoSize; r += stride) {
            for (let c = 0; c < logoSize; c += stride) {
                tSumCoarse += alphaMap[r * logoSize + c];
                coarseCount += 1;
            }
        }
        const tMeanCoarse = tSumCoarse / coarseCount;
        let tVarCoarse = 0;
        const tDiffsCoarse = new Float32Array(N);
        for (let r = 0; r < logoSize; r += stride) {
            for (let c = 0; c < logoSize; c += stride) {
                const idx = r * logoSize + c;
                const diff = alphaMap[idx] - tMeanCoarse;
                tDiffsCoarse[idx] = diff;
                tVarCoarse += diff * diff;
            }
        }
        const tNormCoarse = Math.sqrt(tVarCoarse);
        return { logoSize, alphaMap, stride, N, coarseCount, tDiffs, tNorm, tDiffsCoarse, tNormCoarse };
    }
    function findWatermarkNCC(png, template, gray, suppressed) {
        const { logoSize, stride, N, coarseCount, tDiffs, tNorm, tDiffsCoarse, tNormCoarse } = template;
        const startX = Math.floor(png.width * 0.5);
        const startY = Math.floor(png.height * 0.5);
        const endX = png.width - logoSize;
        const endY = png.height - logoSize;
        if (endX < startX || endY < startY) return { x: 0, y: 0, score: -Infinity };
        let best = null, bestScore = -Infinity;
        for (let y = startY; y <= endY; y += stride) {
            for (let x = startX; x <= endX; x += stride) {
                if (overlapsBounds(createBounds(x, y, logoSize), suppressed, Math.floor(logoSize / 3))) continue;
                let pSum = 0;
                for (let r = 0; r < logoSize; r += stride) {
                    const rowStart = (y + r) * png.width + x;
                    for (let c = 0; c < logoSize; c += stride) pSum += gray[rowStart + c];
                }
                const pMean = pSum / coarseCount;
                let pVar = 0, cov = 0;
                for (let r = 0; r < logoSize; r += stride) {
                    const rowStart = (y + r) * png.width + x;
                    const tRow = r * logoSize;
                    for (let c = 0; c < logoSize; c += stride) {
                        const pDiff = gray[rowStart + c] - pMean;
                        pVar += pDiff * pDiff;
                        cov += pDiff * tDiffsCoarse[tRow + c];
                    }
                }
                if (pVar === 0) continue;
                const score = cov / (tNormCoarse * Math.sqrt(pVar));
                if (score > bestScore) {
                    bestScore = score;
                    best = { x, y };
                }
            }
        }
        if (!best) return { x: 0, y: 0, score: -Infinity };
        let fine = { x: best.x, y: best.y, score: -Infinity };
        for (let y = best.y - stride; y <= best.y + stride; y += 1) {
            for (let x = best.x - stride; x <= best.x + stride; x += 1) {
                if (x < 0 || y < 0 || x > endX || y > endY) continue;
                if (overlapsBounds(createBounds(x, y, logoSize), suppressed, Math.floor(logoSize / 3))) continue;
                let pSum = 0;
                for (let r = 0; r < logoSize; r += 1) {
                    const rowStart = (y + r) * png.width + x;
                    for (let c = 0; c < logoSize; c += 1) pSum += gray[rowStart + c];
                }
                const pMean = pSum / N;
                let pVar = 0, cov = 0;
                for (let r = 0; r < logoSize; r += 1) {
                    const rowStart = (y + r) * png.width + x;
                    const tRow = r * logoSize;
                    for (let c = 0; c < logoSize; c += 1) {
                        const pDiff = gray[rowStart + c] - pMean;
                        pVar += pDiff * pDiff;
                        cov += pDiff * tDiffs[tRow + c];
                    }
                }
                if (pVar === 0) continue;
                const score = cov / (tNorm * Math.sqrt(pVar));
                if (score > fine.score) fine = { x, y, score };
            }
        }
        return { ...fine, bbox: createBounds(fine.x, fine.y, logoSize) };
    }
    function loadImage(src) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = src;
        });
    }
    async function getAlphaTemplate(logoSize) {
        if (TEMPLATE_CACHE.has(logoSize)) return TEMPLATE_CACHE.get(logoSize);
        const image = await loadImage(logoSize === 48 ? ASSETS.bg48 : ASSETS.bg96);
        const raster = rasterFromImage(image);
        const template = prepareTemplate(logoSize, calculateAlphaMap(raster));
        TEMPLATE_CACHE.set(logoSize, template);
        return template;
    }
    async function planWatermarkRemoval(png, onMatch) {
        const [template48, template96] = await Promise.all([getAlphaTemplate(48), getAlphaTemplate(96)]);
        const gray = buildGrayscale(png);
        const suppressed = [];
        const matches = [];
        let primaryConfidence = null;
        let lastMatch48 = { score: -Infinity };
        let lastMatch96 = { score: -Infinity };
        for (let index = 0; index < 4; index += 1) {
            const match48 = findWatermarkNCC(png, template48, gray, suppressed);
            const match96 = findWatermarkNCC(png, template96, gray, suppressed);
            lastMatch48 = match48;
            lastMatch96 = match96;
            const secondaryThreshold = primaryConfidence === null
                ? -Infinity
                : Math.max(0.75, primaryConfidence * SECONDARY_MATCH_RATIO);
            const acceptPrimary96 = match96.score > PRIMARY_MATCH_MIN_SCORES[96];
            const acceptPrimary48 = match48.score > PRIMARY_MATCH_MIN_SCORES[48] || (
                primaryConfidence === null &&
                match48.score > DEFAULT_PLACEMENT_MIN_SCORES[48] &&
                isDefaultPlacementMatch(png, match48, 48)
            );
            let chosen = null;
            if (match96.score > match48.score && (primaryConfidence === null ? acceptPrimary96 : match96.score > secondaryThreshold)) {
                chosen = { ...match96, logoSize: 96, alphaMap: template96.alphaMap, confidence: match96.score };
            } else if (primaryConfidence === null ? acceptPrimary48 : match48.score > secondaryThreshold) {
                chosen = { ...match48, logoSize: 48, alphaMap: template48.alphaMap, confidence: match48.score };
            }
            if (!chosen) break;
            matches.push(chosen);
            primaryConfidence ??= chosen.confidence;
            suppressed.push(chosen.bbox);
            onMatch(chosen);
        }
        if (matches.length) return { found: true, matches, confidence: matches[0].confidence };
        const confidence = Math.max(lastMatch48.score, lastMatch96.score);
        return { found: false, matches: [], confidence: Number.isFinite(confidence) ? confidence : 0 };
    }
    function applySubtraction(png, match) {
        const { ALPHA_THRESHOLD, MAX_ALPHA, LOGO_VALUE } = CONSTANTS;
        for (let row = 0; row < match.logoSize; row += 1) {
            for (let col = 0; col < match.logoSize; col += 1) {
                let alpha = match.alphaMap[row * match.logoSize + col];
                if (alpha < ALPHA_THRESHOLD) continue;
                alpha = Math.min(alpha, MAX_ALPHA);
                const targetX = match.x + col;
                const targetY = match.y + row;
                if (targetX < 0 || targetY < 0 || targetX >= png.width || targetY >= png.height) continue;
                const idx = (targetY * png.width + targetX) << 2;
                const oneMinusAlpha = 1 - alpha;
                for (let channel = 0; channel < 3; channel += 1) {
                    png.data[idx + channel] = clamp(Math.round((png.data[idx + channel] - (alpha * LOGO_VALUE)) / oneMinusAlpha), 0, 255);
                }
            }
        }
    }
    class WatermarkEngine {
        static async create() {
            await Promise.all([getAlphaTemplate(48), getAlphaTemplate(96)]);
            return new WatermarkEngine();
        }
        async processImage(imgSource, onMatch = () => {}) {
            const png = rasterFromImage(imgSource);
            const plan = await planWatermarkRemoval(png, onMatch);
            if (!plan.found) return { changed: false, canvas: null, plan };
            for (const match of plan.matches) applySubtraction(png, match);
            healResidualCorner(png, plan.matches[0]);
            return { changed: true, canvas: canvasFromRaster(png), plan };
        }
    }
    class GeminiWatermarkRemover {
        constructor() {
            this.engine = null;
            this.originalFetch = window.fetch.bind(window);
            this.objectUrls = new Set();
            this.cleaningByUrl = new Map();
            this.pendingDomScan = null;
            this.observer = null;
            void this.init();
        }
        async init() {
            try {
                this.engine = await WatermarkEngine.create();
                this.setupNetworkInterceptor();
                this.setupDOMObserver();
                this.installPublicApi();
                this.processExistingImages();
                this.log('Ready. Monitoring Gemini images.');
            } catch (error) {
                console.error('[Gemini watermark remover] Init failed:', error);
            }
        }
        log(message, ...args) {
            console.log(`%c Gemini watermark remover %c ${message}`,
                'background:#1f2937; color:#f9fafb; padding:2px 6px; border-radius:4px;',
                'color:#2563eb;',
                ...args);
        }
        cleanUrl(url) {
            return url.replace(/=s\d+(?=[-?#]|$)/, '=s0');
        }
        buildFetchInput(input, highResUrl) {
            if (typeof input === 'string' || input instanceof URL) return highResUrl;
            if (input instanceof Request) return new Request(highResUrl, input);
            return input;
        }
        installPublicApi() {
            window.geminiWatermarkRemover = Object.freeze({
                rescan: () => this.processExistingImages(),
                stats: () => ({
                    activeObjectUrls: this.objectUrls.size,
                    activeCleanups: this.cleaningByUrl.size,
                    templatesCached: TEMPLATE_CACHE.size
                })
            });
        }
        async cleanImageBlob(blob, label) {
            const bitmap = await createImageBitmap(blob);
            try {
                const result = await this.engine.processImage(bitmap, (match) => {
                    this.log(`${label}: locked ${match.logoSize}px at x:${match.x}, y:${match.y} (${(match.confidence * 100).toFixed(1)}%)`);
                });
                if (!result.changed || !result.canvas) return { blob, changed: false, plan: result.plan };
                const cleanedBlob = await new Promise((resolve, reject) => {
                    result.canvas.toBlob((value) => value ? resolve(value) : reject(new Error('Canvas encoding failed.')), 'image/png');
                });
                return { blob: cleanedBlob, changed: true, plan: result.plan };
            } finally {
                if (typeof bitmap.close === 'function') bitmap.close();
            }
        }
        async cleanBlobForUrl(cleanUrl, blob, label) {
            if (this.cleaningByUrl.has(cleanUrl)) return this.cleaningByUrl.get(cleanUrl);
            const cleanup = this.cleanImageBlob(blob, label)
                .finally(() => this.cleaningByUrl.delete(cleanUrl));
            this.cleaningByUrl.set(cleanUrl, cleanup);
            return cleanup;
        }
        setupNetworkInterceptor() {
            const originalFetch = this.originalFetch;
            window.fetch = async (input, init) => {
                const url = typeof input === 'string'
                    ? input
                    : input instanceof URL
                        ? input.href
                        : input?.url;
                if (!url || !CONSTANTS.URL_PATTERN.test(url)) return originalFetch(input, init);
                const cleanUrl = this.cleanUrl(url);
                const response = await originalFetch(this.buildFetchInput(input, cleanUrl), init);
                if (!this.engine || !response.ok) return response;
                const originalResponse = response.clone();
                try {
                    const blob = await response.blob();
                    const result = await this.cleanBlobForUrl(cleanUrl, blob, 'download');
                    if (!result.changed) return originalResponse;
                    this.log(`Download cleaned (${result.plan.matches.length} match${result.plan.matches.length === 1 ? '' : 'es'}).`);
                    return new Response(result.blob, {
                        status: response.status,
                        statusText: response.statusText,
                        headers: new Headers(response.headers)
                    });
                } catch (error) {
                    console.warn('[Gemini watermark remover] Download processing failed, returning original:', error);
                    return originalResponse;
                }
            };
        }
        releaseImageObjectUrl(img) {
            const objectUrl = img.dataset.gwrObjectUrl;
            if (!objectUrl || !this.objectUrls.has(objectUrl)) return;
            URL.revokeObjectURL(objectUrl);
            this.objectUrls.delete(objectUrl);
            delete img.dataset.gwrObjectUrl;
        }
        async replaceImageElementSource(img, blob) {
            this.releaseImageObjectUrl(img);
            const objectUrl = URL.createObjectURL(blob);
            this.objectUrls.add(objectUrl);
            img.dataset.gwrCleaned = 'true';
            img.dataset.gwrObjectUrl = objectUrl;
            img.src = objectUrl;
            if (img.srcset) img.srcset = objectUrl;
        }
        async processImageElement(img) {
            if (!this.engine || img.dataset.gwrProcessed === 'true') return;
            const currentUrl = img.currentSrc || img.src;
            if (!currentUrl || !CONSTANTS.URL_PATTERN.test(currentUrl)) return;
            if (!img.closest('generated-image, .generated-image-container')) return;
            img.dataset.gwrProcessed = 'true';
            img.dataset.gwrStatus = 'processing';
            try {
                const cleanUrl = this.cleanUrl(currentUrl);
                const response = await this.originalFetch(cleanUrl);
                if (!response.ok) {
                    img.dataset.gwrStatus = 'fetch-failed';
                    return;
                }
                const result = await this.cleanBlobForUrl(cleanUrl, await response.blob(), 'cached image');
                if (!result.changed) {
                    img.dataset.gwrStatus = 'unchanged';
                    return;
                }
                await this.replaceImageElementSource(img, result.blob);
                img.dataset.gwrStatus = 'cleaned';
                this.log('Replaced cached image element with cleaned output.');
            } catch (error) {
                img.dataset.gwrStatus = 'failed';
                console.warn('[Gemini watermark remover] Cached image processing failed:', error);
            }
        }
        cleanupRemovedNodes(nodes) {
            for (const node of nodes) {
                if (node.nodeType !== Node.ELEMENT_NODE) continue;
                if (node.isConnected) continue;
                if (node.matches?.('img[data-gwr-object-url]') && !node.isConnected) this.releaseImageObjectUrl(node);
                node.querySelectorAll?.('img[data-gwr-object-url]').forEach((img) => {
                    if (!img.isConnected) this.releaseImageObjectUrl(img);
                });
            }
        }
        scheduleProcessExistingImages() {
            if (this.pendingDomScan !== null) return;
            this.pendingDomScan = window.setTimeout(() => {
                this.pendingDomScan = null;
                this.processExistingImages();
            }, CONSTANTS.DOM_SCAN_DEBOUNCE_MS);
        }
        setupDOMObserver() {
            this.observer = new MutationObserver((mutations) => {
                let shouldScan = false;
                for (const mutation of mutations) {
                    if (mutation.removedNodes.length > 0) this.cleanupRemovedNodes(mutation.removedNodes);
                    if (mutation.addedNodes.length > 0) shouldScan = true;
                }
                if (shouldScan) this.scheduleProcessExistingImages();
            });
            this.observer.observe(document.body, { childList: true, subtree: true });
            window.addEventListener('pagehide', () => {
                for (const objectUrl of this.objectUrls) URL.revokeObjectURL(objectUrl);
                this.objectUrls.clear();
            }, { once: true });
        }
        processExistingImages() {
            const images = document.querySelectorAll('img[src*="googleusercontent.com"]:not([data-gwr-processed])');
            images.forEach((img) => void this.processImageElement(img));
        }
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => new GeminiWatermarkRemover());
    } else {
        new GeminiWatermarkRemover();
    }
})();
