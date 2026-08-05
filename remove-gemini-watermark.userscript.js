// ==UserScript==
// @name         Gemini watermark remover
// @description Removes Gemini's sparkle watermark from downloaded or copied generated images in-browser.
//
//              Cleans downloads, clipboard copies, and visible Gemini image previews locally.
// @namespace    mina-nageh
// @version      2.15.0
// @author       mina nageh
// @match        https://gemini.google.com/*
// @require      https://cdn.jsdelivr.net/gh/antimatter15/inpaint.js@e77a5305e997464e23bd650085121322a1b565dc/heapqueue.js
// @require      https://cdn.jsdelivr.net/gh/antimatter15/inpaint.js@e77a5305e997464e23bd650085121322a1b565dc/inpaint.js
// @grant        none
// @run-at       document-start
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
        URL_PATTERN: /^https:\/\/(?:[^/]+\.)?googleusercontent\.com\/rd-gg(?:-dl)?\//,
        DOWNLOAD_URL_PATTERN: /^https:\/\/(?:[^/]+\.)?googleusercontent\.com\/rd-gg-dl\//
    };
    const PRIMARY_MATCH_MIN_SCORES = {
        48: 0.75,
        96: 0.75
    };
    const DEFAULT_PLACEMENT_MIN_SCORES = {
        48: 0.64,
        96: 0.58
    };
    const SCALED_MATCH_SIZES = [56, 64, 72, 80, 88];
    const SCALED_MATCH_MIN_SCORE = 0.57;
    const SCALED_MATCH_ADVANTAGE = 0.1;
    const NEAR_CORNER_MIN_SCORES = { 48: 0.52, 96: 0.52 };
    const DETECTOR_GUIDED_MIN_SCORE = 0.57;
    const SECONDARY_MATCH_RATIO = 0.75;
    const FULL_SIZE_WAIT_TIMEOUT_MS = 6000;
    const CLIPBOARD_WAIT_TIMEOUT_MS = 10000;
    const TEMPLATE_CACHE = new Map();
    const SCALED_TEMPLATE_CACHE = new Map();
    const SPARKLE_TEMPLATE_CACHE = new Map();
    let reconstructionWorkerPolicy = null;
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
    function isNearCornerPlacement(png, match, logoSize) {
        if (!match || !Number.isFinite(match.x) || !Number.isFinite(match.y)) return false;
        const rightMargin = png.width - (match.x + logoSize);
        const bottomMargin = png.height - (match.y + logoSize);
        const marginLimitX = Math.max(96, Math.floor(png.width * 0.12));
        const marginLimitY = Math.max(96, Math.floor(png.height * 0.12));
        return rightMargin >= 0 && bottomMargin >= 0 &&
            rightMargin <= marginLimitX &&
            bottomMargin <= marginLimitY;
    }
    function getCornerSearchBounds(png, logoSize) {
        const searchWidth = Math.max(192, Math.floor(png.width * 0.18), logoSize * 4 + 32);
        const searchHeight = Math.max(192, Math.floor(png.height * 0.18), logoSize * 4 + 32);
        return {
            startX: Math.max(0, png.width - searchWidth - logoSize),
            startY: Math.max(0, png.height - searchHeight - logoSize),
            endX: png.width - logoSize,
            endY: png.height - logoSize
        };
    }
    function getNearCornerSearchBounds(png, logoSize) {
        const marginLimitX = Math.max(96, Math.floor(png.width * 0.12));
        const marginLimitY = Math.max(96, Math.floor(png.height * 0.12));
        return {
            startX: Math.max(0, png.width - marginLimitX - logoSize),
            startY: Math.max(0, png.height - marginLimitY - logoSize),
            endX: png.width - logoSize,
            endY: png.height - logoSize
        };
    }
    function getDownscaledPreviewSearchBounds(png, logoSize) {
        const expectedX = png.width - logoSize - Math.round(png.width * 3 / 32);
        const expectedY = png.height - logoSize - Math.round(png.height * 3 / 32);
        const radius = Math.max(12, Math.round(logoSize / 4));
        return {
            startX: Math.max(0, expectedX - radius),
            startY: Math.max(0, expectedY - radius),
            endX: Math.min(png.width - logoSize, expectedX + radius),
            endY: Math.min(png.height - logoSize, expectedY + radius)
        };
    }
    function getLocalScaleSearchBounds(png, logoSize, referenceMatch) {
        const nearCorner = getNearCornerSearchBounds(png, logoSize);
        const centerX = referenceMatch.x + referenceMatch.logoSize / 2;
        const centerY = referenceMatch.y + referenceMatch.logoSize / 2;
        const expectedX = Math.round(centerX - logoSize / 2);
        const expectedY = Math.round(centerY - logoSize / 2);
        const radius = Math.max(24, Math.floor(logoSize / 3));
        return {
            startX: clamp(expectedX - radius, nearCorner.startX, nearCorner.endX),
            startY: clamp(expectedY - radius, nearCorner.startY, nearCorner.endY),
            endX: clamp(expectedX + radius, nearCorner.startX, nearCorner.endX),
            endY: clamp(expectedY + radius, nearCorner.startY, nearCorner.endY)
        };
    }
    function getSparkleSearchBounds(png) {
        const searchWidth = Math.max(192, Math.floor(png.width * 0.18));
        const searchHeight = Math.max(192, Math.floor(png.height * 0.18));
        return {
            x0: Math.max(0, png.width - searchWidth),
            y0: Math.max(0, png.height - searchHeight),
            x1: png.width - 1,
            y1: png.height - 1
        };
    }
    function createCanvas(width, height) {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        return canvas;
    }
    function rasterFromImage(imgSource) {
        const width = imgSource.naturalWidth || imgSource.videoWidth || imgSource.width;
        const height = imgSource.naturalHeight || imgSource.videoHeight || imgSource.height;
        const canvas = createCanvas(width, height);
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
    function buildImageStats(png) {
        const pixels = png.width * png.height;
        const gray = new Float32Array(pixels);
        const saturation = new Float32Array(pixels);
        for (let index = 0; index < pixels; index += 1) {
            const offset = index << 2;
            const r = png.data[offset];
            const g = png.data[offset + 1];
            const b = png.data[offset + 2];
            gray[index] = (r + g + b) / 3;
            saturation[index] = Math.max(r, g, b) - Math.min(r, g, b);
        }
        return { gray, saturation };
    }
    function calculateAlphaMap(png) {
        const alphaMap = new Float32Array(png.width * png.height);
        for (let i = 0; i < alphaMap.length; i += 1) {
            const idx = i << 2;
            alphaMap[i] = Math.max(png.data[idx], png.data[idx + 1], png.data[idx + 2]) / 255;
        }
        return alphaMap;
    }
    function resizeAlphaMap(alphaMap, sourceSize, targetSize) {
        if (sourceSize === targetSize) return new Float32Array(alphaMap);
        const scaled = new Float32Array(targetSize * targetSize);
        const sourceLast = Math.max(1, sourceSize - 1);
        const targetLast = Math.max(1, targetSize - 1);
        for (let y = 0; y < targetSize; y += 1) {
            const srcY = (y / targetLast) * sourceLast;
            const y0 = Math.floor(srcY);
            const y1 = Math.min(sourceSize - 1, y0 + 1);
            const wy = srcY - y0;
            for (let x = 0; x < targetSize; x += 1) {
                const srcX = (x / targetLast) * sourceLast;
                const x0 = Math.floor(srcX);
                const x1 = Math.min(sourceSize - 1, x0 + 1);
                const wx = srcX - x0;
                const a00 = alphaMap[y0 * sourceSize + x0];
                const a10 = alphaMap[y0 * sourceSize + x1];
                const a01 = alphaMap[y1 * sourceSize + x0];
                const a11 = alphaMap[y1 * sourceSize + x1];
                const top = a00 * (1 - wx) + a10 * wx;
                const bottom = a01 * (1 - wx) + a11 * wx;
                scaled[y * targetSize + x] = top * (1 - wy) + bottom * wy;
            }
        }
        return scaled;
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
    function buildEllipseMask(width, height, centerX, centerY, radiusX, radiusY) {
        const mask = new Uint8Array(width * height);
        addEllipse(mask, width, height, centerX, centerY, radiusX, radiusY);
        return mask;
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
    function fitPlaneFromRing(png, x0, y0, width, height, box, mask, channel) {
        const samplePadding = 10;
        const sampleX0 = Math.max(0, box.x0 - samplePadding);
        const sampleY0 = Math.max(0, box.y0 - samplePadding);
        const sampleX1 = Math.min(width - 1, box.x1 + samplePadding);
        const sampleY1 = Math.min(height - 1, box.y1 + samplePadding);
        let sx = 0, sy = 0, sv = 0, sxx = 0, syy = 0, sxy = 0, sxv = 0, syv = 0, count = 0;
        for (let y = sampleY0; y <= sampleY1; y += 1) {
            for (let x = sampleX0; x <= sampleX1; x += 1) {
                if (mask[y * width + x]) continue;
                const idx = ((y0 + y) * png.width + (x0 + x)) << 2;
                const value = png.data[idx + channel];
                sx += x; sy += y; sv += value; sxx += x * x; syy += y * y; sxy += x * y; sxv += x * value; syv += y * value; count += 1;
            }
        }
        if (count < 12) return [0, 0, 0];
        return solve3([[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, count]], [sxv, syv, sv]);
    }
    function fillMaskFromPlanes(png, x0, y0, width, height, box, mask) {
        const planes = [0, 1, 2].map((channel) => fitPlaneFromRing(png, x0, y0, width, height, box, mask, channel));
        for (let y = box.y0; y <= box.y1; y += 1) {
            for (let x = box.x0; x <= box.x1; x += 1) {
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
    function fillMaskByRowInterpolation(png, x0, y0, width, height, box, mask) {
        const sampleOffset = 8;
        for (let y = box.y0; y <= box.y1; y += 1) {
            let x = box.x0;
            while (x <= box.x1) {
                if (!mask[y * width + x]) {
                    x += 1;
                    continue;
                }
                const runStart = x;
                while (x <= box.x1 && mask[y * width + x]) x += 1;
                const runEnd = x - 1;
                let sourceLeft = runStart - 1;
                while (sourceLeft >= 0 && mask[y * width + sourceLeft]) sourceLeft -= 1;
                if (sourceLeft >= 0) sourceLeft = Math.max(0, sourceLeft - sampleOffset);
                let sourceRight = runEnd + 1;
                while (sourceRight < width && mask[y * width + sourceRight]) sourceRight += 1;
                if (sourceRight < width) sourceRight = Math.min(width - 1, sourceRight + sampleOffset);
                for (let fillX = runStart; fillX <= runEnd; fillX += 1) {
                    const dstIdx = ((y0 + y) * png.width + (x0 + fillX)) << 2;
                    for (let channel = 0; channel < 3; channel += 1) {
                        let value = 0;
                        if (sourceLeft >= 0 && sourceRight < width) {
                            const leftIdx = ((y0 + y) * png.width + (x0 + sourceLeft)) << 2;
                            const rightIdx = ((y0 + y) * png.width + (x0 + sourceRight)) << 2;
                            const span = Math.max(1, sourceRight - sourceLeft);
                            const t = (fillX - sourceLeft) / span;
                            value = Math.round((png.data[leftIdx + channel] * (1 - t)) + (png.data[rightIdx + channel] * t));
                        } else if (sourceLeft >= 0) {
                            const leftIdx = ((y0 + y) * png.width + (x0 + sourceLeft)) << 2;
                            value = png.data[leftIdx + channel];
                        } else if (sourceRight < width) {
                            const rightIdx = ((y0 + y) * png.width + (x0 + sourceRight)) << 2;
                            value = png.data[rightIdx + channel];
                        } else {
                            value = png.data[dstIdx + channel];
                        }
                        png.data[dstIdx + channel] = value;
                    }
                }
            }
        }
    }
    async function healScaledTemplateMatch(png, match) {
        const requiresMaskHealing = [
            'scaled-search',
            'near-corner-search',
            'geometry-placement-search',
            'downscaled-preview-placement-search'
        ].includes(match?.source);
        if (!match || (!requiresMaskHealing && (match.logoSize === 48 || match.logoSize === 96)) || !match.alphaMap) return false;
        const alphaThreshold = 0.015;
        const dilateRadius = Math.max(1, Math.floor(match.logoSize * 0.015));
        const pad = 8;
        const x0 = Math.max(0, match.x - pad);
        const y0 = Math.max(0, match.y - pad);
        const x1 = Math.min(png.width - 1, match.x + match.logoSize - 1 + pad);
        const y1 = Math.min(png.height - 1, match.y + match.logoSize - 1 + pad);
        const width = x1 - x0 + 1;
        const height = y1 - y0 + 1;
        const mask = new Uint8Array(width * height);
        const maskPixels = [];
        for (let row = 0; row < match.logoSize; row += 1) {
            for (let col = 0; col < match.logoSize; col += 1) {
                const alpha = match.alphaMap[row * match.logoSize + col];
                if (alpha < alphaThreshold) continue;
                const localX = match.x - x0 + col;
                const localY = match.y - y0 + row;
                if (localX < 0 || localY < 0 || localX >= width || localY >= height) continue;
                mask[localY * width + localX] = 1;
                maskPixels.push([localX, localY]);
            }
        }
        if (maskPixels.length === 0) return false;
        const dilatedMask = dilateMask(mask, width, height, dilateRadius);
        const snapshot = match.watermarkedRegion;
        if (!snapshot || snapshot.x0 !== x0 || snapshot.y0 !== y0 || snapshot.width !== width || snapshot.height !== height) {
            match.reconstruction = { ...inpaintMaskStructureAware(png, x0, y0, width, height, dilatedMask), workerUsed: false };
            return true;
        }
        const subtractedRgb = new Uint8ClampedArray(width * height * 3);
        const alphaRegion = new Float32Array(width * height);
        for (let y = 0; y < height; y += 1) {
            for (let x = 0; x < width; x += 1) {
                const sourceOffset = ((y0 + y) * png.width + x0 + x) << 2;
                const targetOffset = ((y * width) + x) * 3;
                subtractedRgb[targetOffset] = png.data[sourceOffset];
                subtractedRgb[targetOffset + 1] = png.data[sourceOffset + 1];
                subtractedRgb[targetOffset + 2] = png.data[sourceOffset + 2];
            }
        }
        for (let row = 0; row < match.logoSize; row += 1) {
            for (let col = 0; col < match.logoSize; col += 1) {
                const localX = match.x - x0 + col;
                const localY = match.y - y0 + row;
                if (localX < 0 || localY < 0 || localX >= width || localY >= height) continue;
                alphaRegion[localY * width + localX] = match.alphaMap[row * match.logoSize + col];
            }
        }
        const reconstruction = await runAdaptiveReconstruction({
            width,
            height,
            mask: dilatedMask,
            alpha: alphaRegion,
            watermarkedRgb: snapshot.rgb,
            subtractedRgb
        });
        for (let y = 0; y < height; y += 1) {
            for (let x = 0; x < width; x += 1) {
                const index = y * width + x;
                if (!dilatedMask[index]) continue;
                const sourceOffset = index * 3;
                const targetOffset = ((y0 + y) * png.width + x0 + x) << 2;
                png.data[targetOffset] = reconstruction.rgb[sourceOffset];
                png.data[targetOffset + 1] = reconstruction.rgb[sourceOffset + 1];
                png.data[targetOffset + 2] = reconstruction.rgb[sourceOffset + 2];
            }
        }
        match.reconstruction = reconstruction.diagnostics;
        delete match.watermarkedRegion;
        return true;
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
    function inpaintMask(png, x0, y0, width, height, mask, iterations) {
        for (let y = 0; y < height; y += 1) {
            for (let x = 0; x < width; x += 1) {
                if (!mask[y * width + x]) continue;
                let sourceX = x - 1;
                while (sourceX >= 0 && mask[y * width + sourceX]) sourceX -= 1;
                const srcX = x0 + (sourceX >= 0 ? sourceX : 0);
                const srcY = y0 + y;
                const srcIdx = (srcY * png.width + srcX) << 2;
                const dstIdx = ((y0 + y) * png.width + (x0 + x)) << 2;
                png.data[dstIdx] = png.data[srcIdx];
                png.data[dstIdx + 1] = png.data[srcIdx + 1];
                png.data[dstIdx + 2] = png.data[srcIdx + 2];
            }
        }
        smoothMask(png, x0, y0, width, height, mask, iterations);
    }
    function inpaintMaskFromNearestBoundary(png, x0, y0, width, height, mask) {
        const pixelCount = width * height;
        const sourceByPixel = new Int32Array(pixelCount);
        sourceByPixel.fill(-1);
        const queue = new Int32Array(pixelCount);
        let queueStart = 0, queueEnd = 0;
        const neighbors = [
            [-1, -1], [0, -1], [1, -1],
            [-1, 0], [1, 0],
            [-1, 1], [0, 1], [1, 1]
        ];
        for (let y = 0; y < height; y += 1) {
            for (let x = 0; x < width; x += 1) {
                const index = y * width + x;
                if (mask[index]) continue;
                const touchesMask = neighbors.some(([dx, dy]) => {
                    const nx = x + dx, ny = y + dy;
                    return nx >= 0 && ny >= 0 && nx < width && ny < height && mask[ny * width + nx];
                });
                if (touchesMask) {
                    sourceByPixel[index] = index;
                    queue[queueEnd++] = index;
                }
            }
        }
        while (queueStart < queueEnd) {
            const index = queue[queueStart++];
            const x = index % width, y = Math.floor(index / width);
            for (const [dx, dy] of neighbors) {
                const nx = x + dx, ny = y + dy;
                if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
                const neighborIndex = ny * width + nx;
                if (!mask[neighborIndex] || sourceByPixel[neighborIndex] !== -1) continue;
                sourceByPixel[neighborIndex] = sourceByPixel[index];
                queue[queueEnd++] = neighborIndex;
            }
        }
        const original = new Uint8ClampedArray(png.data);
        for (let y = 0; y < height; y += 1) {
            for (let x = 0; x < width; x += 1) {
                const index = y * width + x;
                const sourceIndex = sourceByPixel[index];
                if (!mask[index] || sourceIndex < 0) continue;
                const sourceX = sourceIndex % width, sourceY = Math.floor(sourceIndex / width);
                const sourceOffset = ((y0 + sourceY) * png.width + x0 + sourceX) << 2;
                const targetOffset = ((y0 + y) * png.width + x0 + x) << 2;
                png.data[targetOffset] = original[sourceOffset];
                png.data[targetOffset + 1] = original[sourceOffset + 1];
                png.data[targetOffset + 2] = original[sourceOffset + 2];
            }
        }
    }
    function inpaintMaskTelea(png, x0, y0, width, height, mask) {
        if (typeof InpaintTelea !== 'function') {
            inpaintMaskFromNearestBoundary(png, x0, y0, width, height, mask);
            return;
        }
        for (let channel = 0; channel < 3; channel += 1) {
            const values = new Float32Array(width * height);
            for (let y = 0; y < height; y += 1) {
                for (let x = 0; x < width; x += 1) {
                    const sourceOffset = ((y0 + y) * png.width + x0 + x) << 2;
                    values[y * width + x] = png.data[sourceOffset + channel];
                }
            }
            InpaintTelea(width, height, values, mask, 3);
            for (let y = 0; y < height; y += 1) {
                for (let x = 0; x < width; x += 1) {
                    const index = y * width + x;
                    if (!mask[index]) continue;
                    const targetOffset = ((y0 + y) * png.width + x0 + x) << 2;
                    png.data[targetOffset + channel] = clamp(Math.round(values[index]), 0, 255);
                }
            }
        }
    }

    const STRUCTURE_DIRECTIONS = [
        [0, 1], [1, 0], [1, 1], [1, -1],
        [1, 2], [2, 1], [1, -2], [2, -1]
    ];
    function findDirectionalEndpoint(mask, width, height, x, y, dx, dy, sign) {
        const limit = Math.max(width, height);
        for (let distance = 1; distance <= limit; distance += 1) {
            const nextX = x + (dx * distance * sign);
            const nextY = y + (dy * distance * sign);
            if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) return null;
            const index = (nextY * width) + nextX;
            if (!mask[index]) return { index, distance };
        }
        return null;
    }
    function rankStructureDirections(rgb, mask, width, height) {
        return STRUCTURE_DIRECTIONS.map(([dx, dy]) => {
            const differences = [];
            let eligible = 0;
            for (let y = 0; y < height; y += 1) {
                for (let x = (y & 1); x < width; x += 2) {
                    if (!mask[(y * width) + x]) continue;
                    eligible += 1;
                    const first = findDirectionalEndpoint(mask, width, height, x, y, dx, dy, -1);
                    const second = findDirectionalEndpoint(mask, width, height, x, y, dx, dy, 1);
                    if (!first || !second) continue;
                    const firstOffset = first.index * 3;
                    const secondOffset = second.index * 3;
                    differences.push((
                        Math.abs(rgb[firstOffset] - rgb[secondOffset]) +
                        Math.abs(rgb[firstOffset + 1] - rgb[secondOffset + 1]) +
                        Math.abs(rgb[firstOffset + 2] - rgb[secondOffset + 2])
                    ) / 3);
                }
            }
            if (differences.length === 0) return { dx, dy, score: Infinity, coverage: 0 };
            differences.sort((a, b) => a - b);
            const median = differences[Math.floor(differences.length * 0.5)];
            const upperQuartile = differences[Math.floor(differences.length * 0.75)];
            const coverage = differences.length / Math.max(1, eligible);
            return {
                dx,
                dy,
                score: median + (upperQuartile * 0.35) + ((1 - coverage) * 100),
                coverage
            };
        }).sort((a, b) => a.score - b.score);
    }
    function smoothStructureFill(rgb, mask, width, height) {
        const source = new Uint8ClampedArray(rgb);
        const radius = 2;
        const colorSigmaSquared = 18 * 18 * 2;
        for (let y = 0; y < height; y += 1) {
            for (let x = 0; x < width; x += 1) {
                const index = (y * width) + x;
                if (!mask[index]) continue;
                const offset = index * 3;
                const sums = [0, 0, 0];
                let totalWeight = 0;
                for (let dy = -radius; dy <= radius; dy += 1) {
                    for (let dx = -radius; dx <= radius; dx += 1) {
                        const nextX = x + dx;
                        const nextY = y + dy;
                        if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) continue;
                        const nextOffset = ((nextY * width) + nextX) * 3;
                        let colorDistance = 0;
                        for (let channel = 0; channel < 3; channel += 1) {
                            const difference = source[nextOffset + channel] - source[offset + channel];
                            colorDistance += difference * difference;
                        }
                        const spatialWeight = Math.exp(-((dx * dx) + (dy * dy)) / 4);
                        const colorWeight = Math.exp(-colorDistance / colorSigmaSquared);
                        const weight = spatialWeight * colorWeight;
                        totalWeight += weight;
                        for (let channel = 0; channel < 3; channel += 1) sums[channel] += source[nextOffset + channel] * weight;
                    }
                }
                if (totalWeight <= 0) continue;
                for (let channel = 0; channel < 3; channel += 1) rgb[offset + channel] = Math.round(sums[channel] / totalWeight);
            }
        }
    }
    function inpaintMaskStructureAware(png, x0, y0, width, height, mask) {
        const rgb = new Uint8ClampedArray(width * height * 3);
        for (let y = 0; y < height; y += 1) {
            for (let x = 0; x < width; x += 1) {
                const sourceOffset = ((y0 + y) * png.width + x0 + x) << 2;
                const targetOffset = ((y * width) + x) * 3;
                rgb[targetOffset] = png.data[sourceOffset];
                rgb[targetOffset + 1] = png.data[sourceOffset + 1];
                rgb[targetOffset + 2] = png.data[sourceOffset + 2];
            }
        }
        const rankedDirections = rankStructureDirections(rgb, mask, width, height);
        const bestDirection = rankedDirections[0];
        if (!bestDirection || !Number.isFinite(bestDirection.score) || bestDirection.score > 38) {
            inpaintMaskTelea(png, x0, y0, width, height, mask);
            return { method: 'telea', direction: null, score: bestDirection?.score ?? Infinity };
        }
        const original = new Uint8ClampedArray(rgb);
        for (let y = 0; y < height; y += 1) {
            for (let x = 0; x < width; x += 1) {
                const index = (y * width) + x;
                if (!mask[index]) continue;
                let endpoints = null;
                for (const direction of rankedDirections) {
                    const first = findDirectionalEndpoint(mask, width, height, x, y, direction.dx, direction.dy, -1);
                    const second = findDirectionalEndpoint(mask, width, height, x, y, direction.dx, direction.dy, 1);
                    if (first && second) {
                        endpoints = { first, second };
                        break;
                    }
                }
                if (!endpoints) continue;
                const totalDistance = endpoints.first.distance + endpoints.second.distance;
                const targetOffset = index * 3;
                const firstOffset = endpoints.first.index * 3;
                const secondOffset = endpoints.second.index * 3;
                for (let channel = 0; channel < 3; channel += 1) {
                    rgb[targetOffset + channel] = Math.round((
                        (original[firstOffset + channel] * endpoints.second.distance) +
                        (original[secondOffset + channel] * endpoints.first.distance)
                    ) / totalDistance);
                }
            }
        }
        if (bestDirection.score < 12) smoothStructureFill(rgb, mask, width, height);
        for (let y = 0; y < height; y += 1) {
            for (let x = 0; x < width; x += 1) {
                const index = (y * width) + x;
                if (!mask[index]) continue;
                const sourceOffset = index * 3;
                const targetOffset = ((y0 + y) * png.width + x0 + x) << 2;
                png.data[targetOffset] = rgb[sourceOffset];
                png.data[targetOffset + 1] = rgb[sourceOffset + 1];
                png.data[targetOffset + 2] = rgb[sourceOffset + 2];
            }
        }
        return { method: 'directional', direction: [bestDirection.dx, bestDirection.dy], score: bestDirection.score };
    }
    // BEGIN SYNCED ADAPTIVE RECONSTRUCTION
    function adaptiveReconstructRegion(input) {
      const width = input.width;
      const height = input.height;
      const mask = new Uint8Array(input.mask);
      const alpha = new Float32Array(input.alpha);
      const watermarked = new Uint8ClampedArray(input.watermarkedRgb);
      const subtracted = new Uint8ClampedArray(input.subtractedRgb);
      const DIRECTIONS = [
        [0, 1], [1, 0], [1, 1], [1, -1],
        [1, 2], [2, 1], [1, -2], [2, -1],
      ];
      const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
      const rgbOffset = (x, y) => ((y * width) + x) * 3;

      function endpoint(x, y, dx, dy, sign) {
        const limit = Math.max(width, height);
        for (let distance = 1; distance <= limit; distance += 1) {
          const nextX = x + (dx * distance * sign);
          const nextY = y + (dy * distance * sign);
          if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) return null;
          const index = (nextY * width) + nextX;
          if (!mask[index]) return { index, distance };
        }
        return null;
      }

      function scoreDirection(rgb, dx, dy, bounds = null) {
        const differences = [];
        let eligible = 0;
        const startX = bounds?.x0 ?? 0;
        const startY = bounds?.y0 ?? 0;
        const endX = bounds?.x1 ?? (width - 1);
        const endY = bounds?.y1 ?? (height - 1);
        for (let y = startY; y <= endY; y += 1) {
          for (let x = startX + ((y - startY) & 1); x <= endX; x += 2) {
            if (!mask[(y * width) + x]) continue;
            eligible += 1;
            const first = endpoint(x, y, dx, dy, -1);
            const second = endpoint(x, y, dx, dy, 1);
            if (!first || !second) continue;
            const firstOffset = first.index * 3;
            const secondOffset = second.index * 3;
            differences.push((
              Math.abs(rgb[firstOffset] - rgb[secondOffset]) +
              Math.abs(rgb[firstOffset + 1] - rgb[secondOffset + 1]) +
              Math.abs(rgb[firstOffset + 2] - rgb[secondOffset + 2])
            ) / 3);
          }
        }
        if (differences.length === 0) return { dx, dy, score: Infinity, coverage: 0 };
        differences.sort((a, b) => a - b);
        const median = differences[Math.floor(differences.length * 0.5)];
        const upperQuartile = differences[Math.floor(differences.length * 0.75)];
        const coverage = differences.length / Math.max(1, eligible);
        return {
          dx,
          dy,
          score: median + (upperQuartile * 0.35) + ((1 - coverage) * 100),
          coverage,
        };
      }

      function rankDirections(rgb, bounds = null) {
        return DIRECTIONS.map(([dx, dy]) => scoreDirection(rgb, dx, dy, bounds))
          .sort((first, second) => first.score - second.score);
      }

      function predictAlongDirection(rgb, x, y, direction) {
        const first = endpoint(x, y, direction.dx, direction.dy, -1);
        const second = endpoint(x, y, direction.dx, direction.dy, 1);
        if (!first || !second) return null;
        const totalDistance = first.distance + second.distance;
        const firstOffset = first.index * 3;
        const secondOffset = second.index * 3;
        return [0, 1, 2].map((channel) => Math.round((
          (rgb[firstOffset + channel] * second.distance) +
          (rgb[secondOffset + channel] * first.distance)
        ) / totalDistance));
      }

      function smoothLowVariationFill(rgb) {
        const source = new Uint8ClampedArray(rgb);
        const colorSigmaSquared = 18 * 18 * 2;
        for (let y = 0; y < height; y += 1) {
          for (let x = 0; x < width; x += 1) {
            const index = (y * width) + x;
            if (!mask[index]) continue;
            const offset = index * 3;
            const sums = [0, 0, 0];
            let totalWeight = 0;
            for (let dy = -2; dy <= 2; dy += 1) {
              for (let dx = -2; dx <= 2; dx += 1) {
                const nextX = x + dx;
                const nextY = y + dy;
                if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) continue;
                const nextOffset = rgbOffset(nextX, nextY);
                let colorDistance = 0;
                for (let channel = 0; channel < 3; channel += 1) {
                  const difference = source[nextOffset + channel] - source[offset + channel];
                  colorDistance += difference * difference;
                }
                const weight = Math.exp(-((dx * dx) + (dy * dy)) / 4)
                  * Math.exp(-colorDistance / colorSigmaSquared);
                totalWeight += weight;
                for (let channel = 0; channel < 3; channel += 1) sums[channel] += source[nextOffset + channel] * weight;
              }
            }
            if (totalWeight <= 0) continue;
            for (let channel = 0; channel < 3; channel += 1) rgb[offset + channel] = Math.round(sums[channel] / totalWeight);
          }
        }
      }

      function globalDirectionalCandidate() {
        const ranked = rankDirections(watermarked);
        const output = new Uint8ClampedArray(subtracted);
        for (let y = 0; y < height; y += 1) {
          for (let x = 0; x < width; x += 1) {
            if (!mask[(y * width) + x]) continue;
            let prediction = null;
            for (const direction of ranked) {
              prediction = predictAlongDirection(watermarked, x, y, direction);
              if (prediction) break;
            }
            if (!prediction) continue;
            const offset = rgbOffset(x, y);
            output[offset] = prediction[0];
            output[offset + 1] = prediction[1];
            output[offset + 2] = prediction[2];
          }
        }
        if (ranked[0]?.score < 12) smoothLowVariationFill(output);
        return { name: 'directional-global', rgb: output, direction: ranked[0], ranked };
      }

      function localDirectionalCandidate(globalCandidate) {
        const tileSize = 24;
        const columns = Math.ceil(width / tileSize);
        const rows = Math.ceil(height / tileSize);
        const tileDirections = new Array(columns * rows);
        let scoreTotal = 0;
        let scoreCount = 0;
        for (let tileY = 0; tileY < rows; tileY += 1) {
          for (let tileX = 0; tileX < columns; tileX += 1) {
            const bounds = {
              x0: tileX * tileSize,
              y0: tileY * tileSize,
              x1: Math.min(width - 1, ((tileX + 1) * tileSize) - 1),
              y1: Math.min(height - 1, ((tileY + 1) * tileSize) - 1),
            };
            const best = rankDirections(watermarked, bounds)[0];
            tileDirections[(tileY * columns) + tileX] = best;
            if (Number.isFinite(best?.score)) {
              scoreTotal += best.score;
              scoreCount += 1;
            }
          }
        }
        const output = new Uint8ClampedArray(globalCandidate.rgb);
        for (let y = 0; y < height; y += 1) {
          for (let x = 0; x < width; x += 1) {
            if (!mask[(y * width) + x]) continue;
            const tileX = Math.floor(x / tileSize);
            const tileY = Math.floor(y / tileSize);
            const direction = tileDirections[(tileY * columns) + tileX];
            if (!direction || !Number.isFinite(direction.score)) continue;
            const prediction = predictAlongDirection(watermarked, x, y, direction);
            if (!prediction) continue;
            const offset = rgbOffset(x, y);
            output[offset] = prediction[0];
            output[offset + 1] = prediction[1];
            output[offset + 2] = prediction[2];
          }
        }
        return {
          name: 'directional-local',
          rgb: output,
          averageDirectionScore: scoreTotal / Math.max(1, scoreCount),
          tileDirections,
        };
      }

      function sampleAlpha(source, x, y) {
        if (x < 0 || y < 0 || x > width - 1 || y > height - 1) return 0;
        const x0 = Math.floor(x);
        const y0 = Math.floor(y);
        const x1 = Math.min(width - 1, x0 + 1);
        const y1 = Math.min(height - 1, y0 + 1);
        const wx = x - x0;
        const wy = y - y0;
        const top = source[(y0 * width) + x0] * (1 - wx) + source[(y0 * width) + x1] * wx;
        const bottom = source[(y1 * width) + x0] * (1 - wx) + source[(y1 * width) + x1] * wx;
        return top * (1 - wy) + bottom * wy;
      }

      function shiftedAlpha(offsetX, offsetY) {
        const shifted = new Float32Array(alpha.length);
        for (let y = 0; y < height; y += 1) {
          for (let x = 0; x < width; x += 1) shifted[(y * width) + x] = sampleAlpha(alpha, x - offsetX, y - offsetY);
        }
        return shifted;
      }

      function estimateOpacityScale(shifted, guide) {
        let numerator = 0;
        let denominator = 0;
        for (let index = 0; index < mask.length; index += 1) {
          const templateAlpha = shifted[index];
          if (!mask[index] || templateAlpha < 0.02) continue;
          const offset = index * 3;
          for (let channel = 0; channel < 3; channel += 1) {
            const x = templateAlpha * (255 - guide[offset + channel]);
            const y = watermarked[offset + channel] - guide[offset + channel];
            if (x < 8 || y < -4) continue;
            numerator += x * y;
            denominator += x * x;
          }
        }
        let scale = clamp(numerator / Math.max(1, denominator), 0.25, 1.25);
        numerator = 0;
        denominator = 0;
        for (let index = 0; index < mask.length; index += 1) {
          const templateAlpha = shifted[index];
          if (!mask[index] || templateAlpha < 0.02) continue;
          const offset = index * 3;
          for (let channel = 0; channel < 3; channel += 1) {
            const x = templateAlpha * (255 - guide[offset + channel]);
            const y = watermarked[offset + channel] - guide[offset + channel];
            if (x < 8 || y < -4 || Math.abs(y - (scale * x)) > 18) continue;
            numerator += x * y;
            denominator += x * x;
          }
        }
        if (denominator > 0) scale = clamp(numerator / denominator, 0.25, 1.25);
        return scale;
      }

      function calibratedAlphaCandidate(guide) {
        const offsets = [-0.5, 0, 0.5];
        let best = null;
        for (const offsetY of offsets) {
          for (const offsetX of offsets) {
            const refinedAlpha = shiftedAlpha(offsetX, offsetY);
            const opacityScale = estimateOpacityScale(refinedAlpha, guide);
            const output = new Uint8ClampedArray(subtracted);
            let guideError = 0;
            let samples = 0;
            let clipped = 0;
            for (let index = 0; index < mask.length; index += 1) {
              if (!mask[index]) continue;
              const effectiveAlpha = clamp(refinedAlpha[index] * opacityScale, 0, 0.94);
              const offset = index * 3;
              if (effectiveAlpha < 0.002) continue;
              for (let channel = 0; channel < 3; channel += 1) {
                const raw = (watermarked[offset + channel] - (effectiveAlpha * 255)) / (1 - effectiveAlpha);
                if (raw < 0 || raw > 255) clipped += 1;
                const value = clamp(Math.round(raw), 0, 255);
                output[offset + channel] = value;
                guideError += Math.min(40, Math.abs(value - guide[offset + channel]));
                samples += 1;
              }
            }
            const calibrationScore = (guideError / Math.max(1, samples)) + ((clipped / Math.max(1, samples)) * 80);
            if (!best || calibrationScore < best.calibrationScore) {
              best = {
                name: 'calibrated-alpha',
                rgb: output,
                alpha: refinedAlpha,
                opacityScale,
                offsetX,
                offsetY,
                calibrationScore,
              };
            }
          }
        }
        return best;
      }

      function downsample(source, sourceMask) {
        const smallWidth = Math.max(2, Math.ceil(width / 2));
        const smallHeight = Math.max(2, Math.ceil(height / 2));
        const rgb = new Uint8ClampedArray(smallWidth * smallHeight * 3);
        const smallMask = new Uint8Array(smallWidth * smallHeight);
        for (let y = 0; y < smallHeight; y += 1) {
          for (let x = 0; x < smallWidth; x += 1) {
            const sums = [0, 0, 0];
            let count = 0;
            let masked = 0;
            for (let dy = 0; dy < 2; dy += 1) {
              for (let dx = 0; dx < 2; dx += 1) {
                const sourceX = (x * 2) + dx;
                const sourceY = (y * 2) + dy;
                if (sourceX >= width || sourceY >= height) continue;
                const index = (sourceY * width) + sourceX;
                const offset = index * 3;
                for (let channel = 0; channel < 3; channel += 1) sums[channel] += source[offset + channel];
                masked += sourceMask[index];
                count += 1;
              }
            }
            const targetIndex = (y * smallWidth) + x;
            const targetOffset = targetIndex * 3;
            for (let channel = 0; channel < 3; channel += 1) rgb[targetOffset + channel] = Math.round(sums[channel] / count);
            smallMask[targetIndex] = masked >= Math.max(1, Math.ceil(count / 2)) ? 1 : 0;
          }
        }
        return { width: smallWidth, height: smallHeight, rgb, mask: smallMask };
      }

      function fillSmallDirectional(small) {
        const output = new Uint8ClampedArray(small.rgb);
        const smallEndpoint = (x, y, dx, dy, sign) => {
          for (let distance = 1; distance <= Math.max(small.width, small.height); distance += 1) {
            const nextX = x + (dx * distance * sign);
            const nextY = y + (dy * distance * sign);
            if (nextX < 0 || nextY < 0 || nextX >= small.width || nextY >= small.height) return null;
            const index = (nextY * small.width) + nextX;
            if (!small.mask[index]) return { index, distance };
          }
          return null;
        };
        let best = null;
        for (const [dx, dy] of DIRECTIONS) {
          let total = 0;
          let count = 0;
          for (let y = 0; y < small.height; y += 2) {
            for (let x = 0; x < small.width; x += 2) {
              if (!small.mask[(y * small.width) + x]) continue;
              const first = smallEndpoint(x, y, dx, dy, -1);
              const second = smallEndpoint(x, y, dx, dy, 1);
              if (!first || !second) continue;
              for (let channel = 0; channel < 3; channel += 1) {
                total += Math.abs(small.rgb[(first.index * 3) + channel] - small.rgb[(second.index * 3) + channel]);
              }
              count += 3;
            }
          }
          const score = total / Math.max(1, count);
          if (!best || score < best.score) best = { dx, dy, score };
        }
        if (!best) return output;
        for (let y = 0; y < small.height; y += 1) {
          for (let x = 0; x < small.width; x += 1) {
            const index = (y * small.width) + x;
            if (!small.mask[index]) continue;
            const first = smallEndpoint(x, y, best.dx, best.dy, -1);
            const second = smallEndpoint(x, y, best.dx, best.dy, 1);
            if (!first || !second) continue;
            const totalDistance = first.distance + second.distance;
            for (let channel = 0; channel < 3; channel += 1) {
              output[(index * 3) + channel] = Math.round((
                (small.rgb[(first.index * 3) + channel] * second.distance) +
                (small.rgb[(second.index * 3) + channel] * first.distance)
              ) / totalDistance);
            }
          }
        }
        return output;
      }

      function multiscaleCandidate(globalCandidate) {
        const small = downsample(watermarked, mask);
        const filled = fillSmallDirectional(small);
        const output = new Uint8ClampedArray(globalCandidate.rgb);
        for (let y = 0; y < height; y += 1) {
          for (let x = 0; x < width; x += 1) {
            const index = (y * width) + x;
            if (!mask[index]) continue;
            const sourceX = x / 2;
            const sourceY = y / 2;
            const x0 = Math.floor(sourceX);
            const y0 = Math.floor(sourceY);
            const x1 = Math.min(small.width - 1, x0 + 1);
            const y1 = Math.min(small.height - 1, y0 + 1);
            const wx = sourceX - x0;
            const wy = sourceY - y0;
            const targetOffset = index * 3;
            for (let channel = 0; channel < 3; channel += 1) {
              const top = filled[((y0 * small.width + x0) * 3) + channel] * (1 - wx)
                + filled[((y0 * small.width + x1) * 3) + channel] * wx;
              const bottom = filled[((y1 * small.width + x0) * 3) + channel] * (1 - wx)
                + filled[((y1 * small.width + x1) * 3) + channel] * wx;
              const lowFrequency = top * (1 - wy) + bottom * wy;
              output[targetOffset + channel] = Math.round((globalCandidate.rgb[targetOffset + channel] * 0.65) + (lowFrequency * 0.35));
            }
          }
        }
        return { name: 'multiscale', rgb: output };
      }

      function textureEnergy(rgb, includeMasked) {
        let total = 0;
        let count = 0;
        for (let y = 1; y < height - 1; y += 1) {
          for (let x = 1; x < width - 1; x += 1) {
            const index = (y * width) + x;
            if (Boolean(mask[index]) !== includeMasked) continue;
            const offset = index * 3;
            const right = offset + 3;
            const down = offset + (width * 3);
            for (let channel = 0; channel < 3; channel += 1) {
              total += Math.abs(rgb[offset + channel] - rgb[right + channel]);
              total += Math.abs(rgb[offset + channel] - rgb[down + channel]);
              count += 2;
            }
          }
        }
        return total / Math.max(1, count);
      }

      function patchCandidate(globalCandidate, knownTexture) {
        if (knownTexture < 4) return null;
        const patchRadius = 2;
        const blockRadius = 1;
        const sources = [];
        for (let y = patchRadius; y < height - patchRadius; y += 2) {
          for (let x = patchRadius; x < width - patchRadius; x += 2) {
            let valid = true;
            for (let dy = -patchRadius; dy <= patchRadius && valid; dy += 1) {
              for (let dx = -patchRadius; dx <= patchRadius; dx += 1) {
                if (mask[((y + dy) * width) + x + dx]) {
                  valid = false;
                  break;
                }
              }
            }
            if (valid) sources.push([x, y]);
          }
        }
        if (sources.length < 8) return null;
        const output = new Uint8ClampedArray(globalCandidate.rgb);
        for (let targetY = patchRadius; targetY < height - patchRadius; targetY += 3) {
          for (let targetX = patchRadius; targetX < width - patchRadius; targetX += 3) {
            if (!mask[(targetY * width) + targetX]) continue;
            let best = null;
            for (const [sourceX, sourceY] of sources) {
              let error = 0;
              for (let dy = -patchRadius; dy <= patchRadius; dy += 1) {
                for (let dx = -patchRadius; dx <= patchRadius; dx += 1) {
                  const targetOffset = rgbOffset(targetX + dx, targetY + dy);
                  const sourceOffset = rgbOffset(sourceX + dx, sourceY + dy);
                  for (let channel = 0; channel < 3; channel += 1) {
                    const difference = globalCandidate.rgb[targetOffset + channel] - watermarked[sourceOffset + channel];
                    error += Math.min(2500, difference * difference);
                  }
                }
              }
              error += (((targetX - sourceX) ** 2) + ((targetY - sourceY) ** 2)) * 0.08;
              if (!best || error < best.error) best = { sourceX, sourceY, error };
            }
            if (!best) continue;
            for (let dy = -blockRadius; dy <= blockRadius; dy += 1) {
              for (let dx = -blockRadius; dx <= blockRadius; dx += 1) {
                const x = targetX + dx;
                const y = targetY + dy;
                if (!mask[(y * width) + x]) continue;
                const targetOffset = rgbOffset(x, y);
                const sourceOffset = rgbOffset(best.sourceX + dx, best.sourceY + dy);
                for (let channel = 0; channel < 3; channel += 1) output[targetOffset + channel] = watermarked[sourceOffset + channel];
              }
            }
          }
        }
        return { name: 'exemplar-patch', rgb: output };
      }

      function correlationWithAlpha(rgb, guide) {
        let sumX = 0;
        let sumY = 0;
        let sumXX = 0;
        let sumYY = 0;
        let sumXY = 0;
        let count = 0;
        for (let index = 0; index < mask.length; index += 1) {
          if (!mask[index] || alpha[index] < 0.01) continue;
          const offset = index * 3;
          const x = alpha[index];
          const y = ((rgb[offset] + rgb[offset + 1] + rgb[offset + 2])
            - (guide[offset] + guide[offset + 1] + guide[offset + 2])) / 3;
          sumX += x;
          sumY += y;
          sumXX += x * x;
          sumYY += y * y;
          sumXY += x * y;
          count += 1;
        }
        const covariance = sumXY - ((sumX * sumY) / Math.max(1, count));
        const varianceX = sumXX - ((sumX * sumX) / Math.max(1, count));
        const varianceY = sumYY - ((sumY * sumY) / Math.max(1, count));
        return Math.abs(covariance / Math.sqrt(Math.max(1e-6, varianceX * varianceY)));
      }

      function scoreCandidate(candidate, guide, calibration, knownTexture) {
        let calibrationError = 0;
        let clipping = 0;
        let samples = 0;
        let boundaryError = 0;
        let boundarySamples = 0;
        for (let y = 0; y < height; y += 1) {
          for (let x = 0; x < width; x += 1) {
            const index = (y * width) + x;
            if (!mask[index]) continue;
            const offset = index * 3;
            const effectiveAlpha = clamp(calibration.alpha[index] * calibration.opacityScale, 0, 0.94);
            for (let channel = 0; channel < 3; channel += 1) {
              const predicted = candidate.rgb[offset + channel] * (1 - effectiveAlpha) + (255 * effectiveAlpha);
              calibrationError += Math.min(40, Math.abs(predicted - watermarked[offset + channel]));
              if (candidate.rgb[offset + channel] < 3 && watermarked[offset + channel] > 55) clipping += 1;
              samples += 1;
            }
            const neighbors = [[1, 0], [-1, 0], [0, 1], [0, -1]];
            for (const [dx, dy] of neighbors) {
              const nextX = x + dx;
              const nextY = y + dy;
              if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) continue;
              const nextIndex = (nextY * width) + nextX;
              if (mask[nextIndex]) continue;
              const nextOffset = nextIndex * 3;
              for (let channel = 0; channel < 3; channel += 1) {
                boundaryError += Math.abs(candidate.rgb[offset + channel] - watermarked[nextOffset + channel]);
                boundarySamples += 1;
              }
            }
          }
        }
        const insideTexture = textureEnergy(candidate.rgb, true);
        const texturePenalty = Math.abs(Math.log((insideTexture + 1) / (knownTexture + 1)));
        const watermarkCorrelation = correlationWithAlpha(candidate.rgb, guide);
        const metrics = {
          calibrationError: calibrationError / Math.max(1, samples),
          clippingRate: clipping / Math.max(1, samples),
          boundaryError: boundaryError / Math.max(1, boundarySamples),
          textureEnergy: insideTexture,
          texturePenalty,
          watermarkCorrelation,
        };
        metrics.score = (metrics.calibrationError * 0.35)
          + (metrics.clippingRate * 90)
          + (metrics.boundaryError * 0.035)
          + (metrics.texturePenalty * 4)
          + (metrics.watermarkCorrelation * 20);
        return metrics;
      }

      function blendWithConfidence(selected, calibration, globalScore) {
        const output = new Uint8ClampedArray(subtracted);
        for (let index = 0; index < mask.length; index += 1) {
          if (!mask[index]) continue;
          const offset = index * 3;
          const templateAlpha = calibration.alpha[index];
          let reconstructionWeight = clamp(templateAlpha / 0.035, 0.35, 1);
          if (globalScore < 12) reconstructionWeight = Math.max(reconstructionWeight, 0.92);
          let alphaTrust = 0;
          if (globalScore >= 12) {
            let disagreement = 0;
            for (let channel = 0; channel < 3; channel += 1) {
              disagreement += Math.abs(calibration.rgb[offset + channel] - selected.rgb[offset + channel]);
            }
            disagreement /= 3;
            alphaTrust = clamp((3 - disagreement) / 3, 0, 1) * clamp(templateAlpha / 0.12, 0, 1) * 0.65;
          }
          for (let channel = 0; channel < 3; channel += 1) {
            const reconstructed = (selected.rgb[offset + channel] * (1 - alphaTrust))
              + (calibration.rgb[offset + channel] * alphaTrust);
            output[offset + channel] = Math.round((subtracted[offset + channel] * (1 - reconstructionWeight))
              + (reconstructed * reconstructionWeight));
          }
        }
        return output;
      }

      const globalCandidate = globalDirectionalCandidate();
      const localCandidate = localDirectionalCandidate(globalCandidate);
      const multiscale = multiscaleCandidate(globalCandidate);
      const knownTexture = textureEnergy(watermarked, false);
      const patch = patchCandidate(globalCandidate, knownTexture);
      const calibration = calibratedAlphaCandidate(globalCandidate.rgb);
      const candidates = [globalCandidate, localCandidate, multiscale, calibration];
      if (patch) candidates.push(patch);
      const scored = candidates.map((candidate) => ({
        ...candidate,
        metrics: scoreCandidate(candidate, globalCandidate.rgb, calibration, knownTexture),
      })).sort((first, second) => first.metrics.score - second.metrics.score);

      let selected = scored[0];
      if (globalCandidate.direction.score < 12) {
        selected = scored.find((candidate) => candidate.name === 'directional-global');
      } else if (
        localCandidate.averageDirectionScore < globalCandidate.direction.score * 0.82 &&
        scored.find((candidate) => candidate.name === 'directional-local').metrics.score <= selected.metrics.score * 1.15
      ) {
        selected = scored.find((candidate) => candidate.name === 'directional-local');
      }
      if (selected.metrics.clippingRate > 0.08 || selected.metrics.watermarkCorrelation > 0.45) {
        selected = scored
          .filter((candidate) => candidate.metrics.clippingRate <= 0.08 && candidate.metrics.watermarkCorrelation <= 0.45)
          .sort((first, second) => first.metrics.score - second.metrics.score)[0]
          || scored.find((candidate) => candidate.name === 'directional-global');
      }

      const output = blendWithConfidence(selected, calibration, globalCandidate.direction.score);
      return {
        rgb: output,
        diagnostics: {
          method: selected.name,
          direction: [globalCandidate.direction.dx, globalCandidate.direction.dy],
          directionScore: globalCandidate.direction.score,
          knownTexture,
          opacityScale: calibration.opacityScale,
          subpixelOffset: [calibration.offsetX, calibration.offsetY],
          candidates: scored.map((candidate) => ({ name: candidate.name, metrics: candidate.metrics })),
          artifactRejected: selected !== scored[0],
        },
      };
    }
    // END SYNCED ADAPTIVE RECONSTRUCTION
    function captureMatchRegion(png, match, pad = 8) {
        const x0 = Math.max(0, match.x - pad);
        const y0 = Math.max(0, match.y - pad);
        const x1 = Math.min(png.width - 1, match.x + match.logoSize - 1 + pad);
        const y1 = Math.min(png.height - 1, match.y + match.logoSize - 1 + pad);
        const width = x1 - x0 + 1;
        const height = y1 - y0 + 1;
        const rgb = new Uint8ClampedArray(width * height * 3);
        for (let y = 0; y < height; y += 1) {
            for (let x = 0; x < width; x += 1) {
                const sourceOffset = ((y0 + y) * png.width + x0 + x) << 2;
                const targetOffset = (y * width + x) * 3;
                rgb[targetOffset] = png.data[sourceOffset];
                rgb[targetOffset + 1] = png.data[sourceOffset + 1];
                rgb[targetOffset + 2] = png.data[sourceOffset + 2];
            }
        }
        return { x0, y0, width, height, rgb };
    }
    async function runAdaptiveReconstruction(input) {
        let workerError = null;
        if (typeof Worker === 'function' && typeof Blob === 'function') {
            let worker = null;
            let workerUrl = null;
            try {
                const source = `const adaptiveReconstructRegion = ${adaptiveReconstructRegion.toString()};\n` +
                    `self.onmessage = ({ data }) => { try { const result = adaptiveReconstructRegion(data); self.postMessage(result, [result.rgb.buffer]); } catch (error) { self.postMessage({ error: error?.message || String(error) }); } };`;
                workerUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
                let workerScriptUrl = workerUrl;
                if (window.trustedTypes?.createPolicy) {
                    reconstructionWorkerPolicy ||= window.trustedTypes.createPolicy('gemini-watermark-remover-worker', {
                        createScriptURL: (value) => value
                    });
                    workerScriptUrl = reconstructionWorkerPolicy.createScriptURL(workerUrl);
                }
                worker = new Worker(workerScriptUrl);
                const result = await new Promise((resolve, reject) => {
                    const timeout = window.setTimeout(() => reject(new Error('Reconstruction worker timed out.')), 8000);
                    worker.onmessage = ({ data }) => {
                        window.clearTimeout(timeout);
                        if (data?.error) reject(new Error(data.error));
                        else resolve(data);
                    };
                    worker.onerror = (event) => {
                        window.clearTimeout(timeout);
                        reject(new Error(event.message || 'Reconstruction worker failed.'));
                    };
                    worker.postMessage(input);
                });
                result.diagnostics = { ...result.diagnostics, workerUsed: true };
                return result;
            } catch (error) {
                workerError = error.message;
                console.debug('[Gemini watermark remover] Worker reconstruction unavailable:', error.message);
            } finally {
                worker?.terminate();
                if (workerUrl) URL.revokeObjectURL(workerUrl);
            }
        }
        const result = adaptiveReconstructRegion(input);
        result.diagnostics = { ...result.diagnostics, workerUsed: false, workerError };
        return result;
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
    function getAstroidTemplate(size) {
        if (SPARKLE_TEMPLATE_CACHE.has(size)) return SPARKLE_TEMPLATE_CACHE.get(size);
        const center = (size - 1) / 2;
        const inside = [];
        const ring = [];
        const core = [];
        const north = [];
        const east = [];
        const south = [];
        const west = [];
        for (let y = 0; y < size; y += 1) {
            for (let x = 0; x < size; x += 1) {
                const nx = (x - center) / Math.max(center, 1);
                const ny = (y - center) / Math.max(center, 1);
                const astroid = Math.pow(Math.abs(nx), 2 / 3) + Math.pow(Math.abs(ny), 2 / 3);
                const square = Math.max(Math.abs(nx), Math.abs(ny));
                const offset = y * size + x;
                if (astroid <= 1) {
                    inside.push(offset);
                    if (square <= 0.26) {
                        core.push(offset);
                    } else if (Math.abs(nx) >= Math.abs(ny)) {
                        if (nx >= 0) east.push(offset);
                        else west.push(offset);
                    } else if (ny >= 0) {
                        south.push(offset);
                    } else {
                        north.push(offset);
                    }
                } else if (square <= 1) {
                    ring.push(offset);
                }
            }
        }
        const template = {
            size,
            inside: Uint32Array.from(inside),
            ring: Uint32Array.from(ring),
            core: Uint32Array.from(core),
            north: Uint32Array.from(north),
            east: Uint32Array.from(east),
            south: Uint32Array.from(south),
            west: Uint32Array.from(west),
            insideCount: inside.length,
            ringCount: ring.length,
            coreCount: core.length
        };
        SPARKLE_TEMPLATE_CACHE.set(size, template);
        return template;
    }
    function unionBounds(boundsList) {
        return {
            x0: Math.min(...boundsList.map((bounds) => bounds.x0)),
            y0: Math.min(...boundsList.map((bounds) => bounds.y0)),
            x1: Math.max(...boundsList.map((bounds) => bounds.x1)),
            y1: Math.max(...boundsList.map((bounds) => bounds.y1))
        };
    }
    function overlapsSuppression(center, suppressed) {
        return suppressed.some((entry) => {
            const dx = center.x - entry.center.x;
            const dy = center.y - entry.center.y;
            const distanceSquared = dx * dx + dy * dy;
            const minDistance = Math.max(entry.radius, 1);
            return distanceSquared < minDistance * minDistance;
        });
    }
    function maskCoverage(gray, saturation, width, patchStart, size, mask, brightThreshold) {
        if (!mask.length) return 0;
        let brightCount = 0;
        for (const offset of mask) {
            const row = Math.floor(offset / size);
            const col = offset % size;
            const index = patchStart + row * width + col;
            const pixelGray = gray[index];
            const pixelSat = saturation[index];
            if (pixelGray > brightThreshold && pixelSat < 120) brightCount += 1;
        }
        return brightCount / mask.length;
    }
    function scoreCandidate(stats, width, height, x, y, template) {
        const { gray, saturation } = stats;
        const size = template.size;
        const patchStart = y * width + x;
        let patchGraySum = 0;
        for (let row = 0; row < size; row += 1) {
            const rowStart = patchStart + row * width;
            for (let col = 0; col < size; col += 1) patchGraySum += gray[rowStart + col];
        }
        const localMean = patchGraySum / (size * size);
        const brightThreshold = Math.max(localMean + 3, 128);
        let insideGraySum = 0;
        let insideSatSum = 0;
        let ringGraySum = 0;
        let brightInside = 0;
        let brightRing = 0;
        let weightedX = 0;
        let weightedY = 0;
        let weightedEnergy = 0;
        for (const offset of template.inside) {
            const row = Math.floor(offset / size);
            const col = offset % size;
            const index = patchStart + row * width + col;
            const pixelGray = gray[index];
            const pixelSat = saturation[index];
            insideGraySum += pixelGray;
            insideSatSum += pixelSat;
            if (pixelGray > brightThreshold && pixelSat < 110) {
                brightInside += 1;
                const energy = pixelGray - brightThreshold + 1;
                weightedX += col * energy;
                weightedY += row * energy;
                weightedEnergy += energy;
            }
        }
        for (const offset of template.ring) {
            const row = Math.floor(offset / size);
            const col = offset % size;
            const index = patchStart + row * width + col;
            const pixelGray = gray[index];
            const pixelSat = saturation[index];
            ringGraySum += pixelGray;
            if (pixelGray > brightThreshold && pixelSat < 110) brightRing += 1;
        }
        const insideGrayMean = insideGraySum / template.insideCount;
        const insideSatMean = insideSatSum / template.insideCount;
        const ringGrayMean = ringGraySum / template.ringCount;
        const insideCoverage = brightInside / template.insideCount;
        const ringCoverage = brightRing / template.ringCount;
        const shape = insideCoverage - 0.75 * ringCoverage;
        const contrast = insideGrayMean - ringGrayMean - 0.28 * insideSatMean;
        const xPos = (x + size / 2) / width;
        const yPos = (y + size / 2) / height;
        const rightMargin = Math.max(0, width - (x + size));
        const bottomMargin = Math.max(0, height - (y + size));
        const cornerWindowX = Math.max(1, Math.floor(width * 0.18));
        const cornerWindowY = Math.max(1, Math.floor(height * 0.18));
        const cornerCloseness = clamp(
            1 - ((rightMargin / cornerWindowX) * 0.45 + (bottomMargin / cornerWindowY) * 0.55),
            0,
            1
        );
        const cornerTightness = clamp(1 - (rightMargin + bottomMargin) / (size * 1.6 + 28), 0, 1);
        const edgeTouch = {
            right: x + size >= width - 2,
            bottom: y + size >= height - 2,
            left: x <= 1,
            top: y <= 1
        };
        const armCoverage = {
            north: maskCoverage(gray, saturation, width, patchStart, size, template.north, brightThreshold),
            east: maskCoverage(gray, saturation, width, patchStart, size, template.east, brightThreshold),
            south: maskCoverage(gray, saturation, width, patchStart, size, template.south, brightThreshold),
            west: maskCoverage(gray, saturation, width, patchStart, size, template.west, brightThreshold)
        };
        const coreCoverage = maskCoverage(gray, saturation, width, patchStart, size, template.core, brightThreshold);
        const requiredArmNames = ['north', 'east', 'south', 'west'].filter((name) => {
            if (name === 'east' && edgeTouch.right) return false;
            if (name === 'south' && edgeTouch.bottom) return false;
            if (name === 'west' && edgeTouch.left) return false;
            if (name === 'north' && edgeTouch.top) return false;
            return true;
        });
        const clippedArmNames = ['north', 'east', 'south', 'west'].filter((name) => !requiredArmNames.includes(name));
        const requiredArmCoverage = requiredArmNames.length
            ? requiredArmNames.reduce((sum, name) => sum + armCoverage[name], 0) / requiredArmNames.length
            : 0;
        const clippedArmCoverage = clippedArmNames.length
            ? clippedArmNames.reduce((sum, name) => sum + armCoverage[name], 0) / clippedArmNames.length
            : 0;
        const centroidOffset = weightedEnergy > 0
            ? Math.hypot(
                weightedX / weightedEnergy - ((size - 1) / 2),
                weightedY / weightedEnergy - ((size - 1) / 2)
            ) / Math.max(size, 1)
            : 1;
        const centroidScore = clamp(1 - centroidOffset / 0.24, 0, 1);
        const edgeTouchCount = Number(edgeTouch.right) + Number(edgeTouch.bottom) + Number(edgeTouch.left) + Number(edgeTouch.top);
        const edgeClipBoost = edgeTouchCount > 0
            ? 12 * cornerTightness * clamp((requiredArmCoverage - 0.2) / 0.55, 0, 1)
            : 0;
        const geometry = shape
            + 0.12 * requiredArmCoverage
            + 0.08 * coreCoverage
            + 0.06 * centroidScore
            + 0.04 * clippedArmCoverage;
        const score = contrast
            + 40 * shape
            + 12 * (xPos - 0.82)
            + 12 * (yPos - 0.82)
            + 18 * cornerCloseness
            + 10 * cornerTightness
            + 4 * edgeClipBoost;
        return {
            score,
            contrast,
            shape,
            geometry,
            insideCoverage,
            ringCoverage,
            coreCoverage,
            armCoverage,
            requiredArmCoverage,
            clippedArmCoverage,
            centroidOffset,
            centroidScore,
            cornerCloseness,
            cornerTightness,
            edgeTouch,
            edgeTouchCount
        };
    }
    function searchCandidateGrid(png, stats, searchBounds, suppressed, sizeStart, sizeEnd, sizeStep, refineBounds = null) {
        let best = null;
        for (let size = sizeStart; size <= sizeEnd; size += sizeStep) {
            const template = getAstroidTemplate(size);
            const activeBounds = refineBounds
                ? {
                    x0: Math.max(searchBounds.x0, refineBounds.x0),
                    y0: Math.max(searchBounds.y0, refineBounds.y0),
                    x1: Math.min(searchBounds.x1, refineBounds.x1),
                    y1: Math.min(searchBounds.y1, refineBounds.y1)
                }
                : searchBounds;
            const maxX = activeBounds.x1 - size + 1;
            const maxY = activeBounds.y1 - size + 1;
            const step = refineBounds ? 1 : Math.max(2, Math.floor(size / 8));
            if (maxX < activeBounds.x0 || maxY < activeBounds.y0) continue;
            for (let y = activeBounds.y0; y <= maxY; y += step) {
                for (let x = activeBounds.x0; x <= maxX; x += step) {
                    const center = {
                        x: x + Math.floor(size / 2),
                        y: y + Math.floor(size / 2)
                    };
                    if (overlapsSuppression(center, suppressed)) continue;
                    const metrics = scoreCandidate(stats, png.width, png.height, x, y, template);
                    if (!best || metrics.score > best.score) {
                        best = {
                            x,
                            y,
                            size,
                            center,
                            bbox: createBounds(x, y, size),
                            ...metrics
                        };
                    }
                }
            }
        }
        return best;
    }
    function searchBestCandidate(png, stats, searchBounds, suppressed = []) {
        const maxSize = Math.min(64, Math.floor(Math.min(png.width, png.height) / 3));
        const coarse = searchCandidateGrid(png, stats, searchBounds, suppressed, 28, maxSize, 4);
        if (!coarse) return null;
        const refineRadius = Math.max(10, Math.floor(coarse.size * 0.55));
        const refineBounds = {
            x0: coarse.x - refineRadius,
            y0: coarse.y - refineRadius,
            x1: coarse.x + refineRadius,
            y1: coarse.y + refineRadius
        };
        const refined = searchCandidateGrid(
            png,
            stats,
            searchBounds,
            suppressed,
            Math.max(24, coarse.size - 8),
            Math.min(maxSize, coarse.size + 8),
            1,
            refineBounds
        );
        return refined && refined.score >= coarse.score ? refined : coarse;
    }
    function findWatermarkSparkles(png) {
        const stats = buildImageStats(png);
        const searchBounds = getSparkleSearchBounds(png);
        const first = searchBestCandidate(png, stats, searchBounds, []);
        if (!first) throw new Error('Unable to isolate the sparkle watermark in the bottom-right corner.');
        const suppressed = [{
            center: first.center,
            radius: Math.floor(first.size * 1.2)
        }];
        const second = searchBestCandidate(png, stats, searchBounds, suppressed);
        const sparkles = [first];
        if (second && second.score >= first.score * 0.8 && second.shape >= 0.78) sparkles.push(second);
        sparkles.sort((left, right) => (
            left.center.x !== right.center.x ? left.center.x - right.center.x : left.center.y - right.center.y
        ));
        return {
            searchBounds,
            sparkles,
            clusterBounds: unionBounds(sparkles.map((sparkle) => sparkle.bbox)),
            confidence: Number(clamp(
                0.08
                + 0.27 * clamp((first.contrast - 6) / 70, 0, 1)
                + 0.2 * clamp((first.geometry - 0.18) / 0.9, 0, 1)
                + 0.16 * clamp((first.requiredArmCoverage - 0.2) / 0.7, 0, 1)
                + 0.12 * clamp((first.coreCoverage - 0.12) / 0.7, 0, 1)
                + 0.1 * first.centroidScore
                + 0.08 * first.cornerCloseness
                + 0.08 * first.cornerTightness
                + 0.08 * clamp((first.clippedArmCoverage - 0.1) / 0.6, 0, 1)
                - (first.size <= 32 ? 0.08 : 0),
                0,
                0.995
            ).toFixed(3))
        };
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
    function findWatermarkNCC(png, template, options = {}) {
        const { logoSize, stride, N, coarseCount, tDiffs, tNorm, tDiffsCoarse, tNormCoarse } = template;
        const gray = options.gray ?? buildGrayscale(png);
        const suppressed = options.suppressed ?? [];
        const startX = options.startX ?? Math.floor(png.width * 0.5);
        const startY = options.startY ?? Math.floor(png.height * 0.5);
        const endX = options.endX ?? (png.width - logoSize);
        const endY = options.endY ?? (png.height - logoSize);
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
                if (x < startX || y < startY || x > endX || y > endY) continue;
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
    async function getScaledAlphaTemplate(baseSize, targetSize) {
        const key = `${baseSize}:${targetSize}`;
        if (SCALED_TEMPLATE_CACHE.has(key)) return SCALED_TEMPLATE_CACHE.get(key);
        const baseTemplate = await getAlphaTemplate(baseSize);
        const template = prepareTemplate(targetSize, resizeAlphaMap(baseTemplate.alphaMap, baseSize, targetSize));
        SCALED_TEMPLATE_CACHE.set(key, template);
        return template;
    }
    async function planWatermarkRemoval(png, onMatch) {
        const [template48, template96, downscaled96Template] = await Promise.all([
            getAlphaTemplate(48),
            getAlphaTemplate(96),
            getScaledAlphaTemplate(96, 48)
        ]);
        const gray = buildGrayscale(png);
        const suppressed = [];
        const matches = [];
        let primaryConfidence = null;
        let lastMatch48 = { score: -Infinity };
        let lastMatch96 = { score: -Infinity };
        const default48X = png.width - 48 - 32;
        const default48Y = png.height - 48 - 32;
        const default96X = png.width - 96 - 64;
        const default96Y = png.height - 96 - 64;
        const default48Score = findWatermarkNCC(png, template48, {
            gray,
            startX: default48X,
            endX: default48X,
            startY: default48Y,
            endY: default48Y
        });
        const default96Score = findWatermarkNCC(png, template96, {
            gray,
            startX: default96X,
            endX: default96X,
            startY: default96Y,
            endY: default96Y
        });
        const defaultCandidates = [
            { ...default48Score, logoSize: 48, alphaMap: template48.alphaMap, confidence: default48Score.score, source: 'default-placement' },
            { ...default96Score, logoSize: 96, alphaMap: template96.alphaMap, confidence: default96Score.score, source: 'default-placement' }
        ].filter((candidate) => candidate.confidence >= DEFAULT_PLACEMENT_MIN_SCORES[candidate.logoSize]);
        if (defaultCandidates.length > 0) {
            const chosen = defaultCandidates.reduce((best, candidate) => candidate.confidence > best.confidence ? candidate : best);
            onMatch(chosen);
            return { found: true, matches: [chosen], confidence: chosen.confidence };
        }
        const previewPlacementCandidates = [template48, template96, downscaled96Template].map((template, index) => {
            const match = findWatermarkNCC(png, template, {
                gray,
                ...getDownscaledPreviewSearchBounds(png, template.logoSize)
            });
            return {
                ...match,
                logoSize: template.logoSize,
                alphaMap: template.alphaMap,
                confidence: match.score,
                source: index === 2 ? 'downscaled-preview-placement-search' : 'geometry-placement-search'
            };
        });
        const previewPlacementMatch = previewPlacementCandidates
            .filter((match) => match.confidence >= NEAR_CORNER_MIN_SCORES[match.logoSize])
            .reduce((best, match) => (!best || match.confidence > best.confidence ? match : best), null);
        const supportsGeometryFastPath = png.width === png.height && (png.width === 1024 || png.width === 2048);
        if (supportsGeometryFastPath && previewPlacementMatch) {
            onMatch(previewPlacementMatch);
            return { found: true, matches: [previewPlacementMatch], confidence: previewPlacementMatch.confidence };
        }
        const nearCornerCandidates = [template48, template96, downscaled96Template].map((template, index) => {
            const match = findWatermarkNCC(png, template, {
                gray,
                ...getNearCornerSearchBounds(png, template.logoSize)
            });
            return {
                ...match,
                logoSize: template.logoSize,
                alphaMap: template.alphaMap,
                confidence: match.score,
                source: index === 2 ? 'downscaled-preview-search' : 'near-corner-search'
            };
        });
        const nearCornerMatch = nearCornerCandidates
            .filter((match) => match.confidence >= NEAR_CORNER_MIN_SCORES[match.logoSize])
            .reduce((best, match) => (!best || match.confidence > best.confidence ? match : best), null);
        if (nearCornerMatch) {
            let localScaledMatch = null;
            for (const logoSize of SCALED_MATCH_SIZES) {
                const template = await getScaledAlphaTemplate(48, logoSize);
                const match = findWatermarkNCC(png, template, {
                    gray,
                    ...getLocalScaleSearchBounds(png, logoSize, nearCornerMatch)
                });
                if (!localScaledMatch || match.score > localScaledMatch.confidence) {
                    localScaledMatch = {
                        ...match,
                        logoSize,
                        alphaMap: template.alphaMap,
                        confidence: match.score,
                        source: 'scaled-search'
                    };
                }
            }
            if (
                localScaledMatch?.confidence >= SCALED_MATCH_MIN_SCORE &&
                localScaledMatch.confidence >= nearCornerMatch.confidence + SCALED_MATCH_ADVANTAGE
            ) {
                onMatch(localScaledMatch);
                return { found: true, matches: [localScaledMatch], confidence: localScaledMatch.confidence };
            }
            onMatch(nearCornerMatch);
            return { found: true, matches: [nearCornerMatch], confidence: nearCornerMatch.confidence };
        }
        for (let index = 0; index < 4; index += 1) {
            const match48 = findWatermarkNCC(png, template48, {
                gray,
                suppressed,
                ...getCornerSearchBounds(png, template48.logoSize)
            });
            const match96 = findWatermarkNCC(png, template96, {
                gray,
                suppressed,
                ...getCornerSearchBounds(png, template96.logoSize)
            });
            lastMatch48 = match48;
            lastMatch96 = match96;
            const acceptPrimary96 = match96.score > PRIMARY_MATCH_MIN_SCORES[96] || (
                primaryConfidence === null &&
                match96.score > DEFAULT_PLACEMENT_MIN_SCORES[96] &&
                isDefaultPlacementMatch(png, match96, 96)
            );
            const acceptPrimary48 = match48.score > PRIMARY_MATCH_MIN_SCORES[48] || (
                primaryConfidence === null &&
                match48.score > DEFAULT_PLACEMENT_MIN_SCORES[48] &&
                isDefaultPlacementMatch(png, match48, 48)
            );
            const secondaryThreshold = primaryConfidence === null
                ? -Infinity
                : Math.max(
                    Math.min(PRIMARY_MATCH_MIN_SCORES[96], PRIMARY_MATCH_MIN_SCORES[48]),
                    primaryConfidence * SECONDARY_MATCH_RATIO
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
        let bestScaledMatch = null;
        for (const logoSize of SCALED_MATCH_SIZES) {
            const template = await getScaledAlphaTemplate(48, logoSize);
            const match = findWatermarkNCC(png, template, {
                gray,
                ...getCornerSearchBounds(png, logoSize)
            });
            if (
                Number.isFinite(match.score) &&
                isNearCornerPlacement(png, match, logoSize) &&
                (!bestScaledMatch || match.score > bestScaledMatch.confidence)
            ) {
                bestScaledMatch = {
                    ...match,
                    logoSize,
                    alphaMap: template.alphaMap,
                    confidence: match.score,
                    source: 'scaled-search'
                };
            }
        }
        const scaledIsClearlyBetter =
            bestScaledMatch?.confidence >= SCALED_MATCH_MIN_SCORE;
        if (scaledIsClearlyBetter) {
            onMatch(bestScaledMatch);
            return { found: true, matches: [bestScaledMatch], confidence: bestScaledMatch.confidence };
        }
        const confidence = Math.max(lastMatch48.score, lastMatch96.score);
        try {
            const detectorResult = findWatermarkSparkles(png);
            const detectorPrimary = detectorResult.sparkles[0];
            const detectedSize = Math.max(40, Math.min(72, detectorPrimary.size));
            if (detectedSize >= 56 && detectedSize <= 72 && detectorPrimary.edgeTouch.right && !detectorPrimary.edgeTouch.bottom) {
                throw new Error('Skip clipped right-edge scaled fallback');
            }
            const scaledTemplate = await getScaledAlphaTemplate(48, detectedSize);
            const refined = findWatermarkNCC(png, scaledTemplate, {
                gray,
                startX: Math.max(0, detectorPrimary.bbox.x0 - 20),
                startY: Math.max(0, detectorPrimary.bbox.y0 - 20),
                endX: Math.min(png.width - scaledTemplate.logoSize, detectorPrimary.bbox.x1 + 20),
                endY: Math.min(png.height - scaledTemplate.logoSize, detectorPrimary.bbox.y1 + 20)
            });
            const detectorReliable =
                detectorResult.confidence >= 0.72 &&
                detectorPrimary.geometry >= 0.5 &&
                detectorPrimary.requiredArmCoverage >= 0.7;
            const refinedUsable = Number.isFinite(refined.score) && refined.score >= DETECTOR_GUIDED_MIN_SCORE;
            const fallbackCandidate = refined;
            if (detectorReliable && refinedUsable && isNearCornerPlacement(png, fallbackCandidate, scaledTemplate.logoSize)) {
                const chosen = {
                    ...fallbackCandidate,
                    logoSize: scaledTemplate.logoSize,
                    alphaMap: scaledTemplate.alphaMap,
                    confidence: fallbackCandidate.score
                };
                onMatch(chosen);
                return { found: true, matches: [chosen], confidence: chosen.confidence };
            }
        } catch (error) {
            // Keep the userscript deterministic even if the geometric fallback cannot isolate a corner sparkle.
        }
        return {
            found: false,
            matches: [],
            confidence: Number.isFinite(confidence) ? confidence : 0,
            nearCornerCandidates,
            cornerCandidates: [
                { ...lastMatch48, logoSize: 48, confidence: lastMatch48.score, source: 'corner-search' },
                { ...lastMatch96, logoSize: 96, confidence: lastMatch96.score, source: 'corner-search' }
            ]
        };
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
    async function runDetectorResidualCleanup(png, primaryMatch) {
        try {
            const detectorResult = findWatermarkSparkles(png);
            const sparkle = detectorResult.sparkles[0];
            const primaryBounds = createBounds(primaryMatch.x, primaryMatch.y, primaryMatch.logoSize);
            const residualSize = Math.max(24, Math.min(48, sparkle.size));
            const residualCandidate = {
                x: sparkle.bbox.x0,
                y: sparkle.bbox.y0
            };
            if (
                overlapsBounds(sparkle.bbox, [primaryBounds]) &&
                isNearCornerPlacement(png, residualCandidate, residualSize) &&
                detectorResult.confidence >= 0.62 &&
                sparkle.geometry >= 0.55
            ) {
                const pad = 12;
                const x0 = Math.max(0, sparkle.bbox.x0 - pad);
                const y0 = Math.max(0, sparkle.bbox.y0 - pad);
                const x1 = Math.min(png.width - 1, sparkle.bbox.x1 + pad);
                const y1 = Math.min(png.height - 1, sparkle.bbox.y1 + pad);
                const width = x1 - x0 + 1;
                const height = y1 - y0 + 1;
                const mask = new Uint8Array(width * height);
                const rectX0 = Math.max(0, sparkle.bbox.x0 - x0 - 4);
                const rectY0 = Math.max(0, sparkle.bbox.y0 - y0 - 4);
                const rectX1 = Math.min(width - 1, sparkle.bbox.x1 - x0 + 4);
                const rectY1 = Math.min(height - 1, sparkle.bbox.y1 - y0 + 4);
                const box = { x0: rectX0, y0: rectY0, x1: rectX1, y1: rectY1 };
                for (let y = rectY0; y <= rectY1; y += 1) {
                    for (let x = rectX0; x <= rectX1; x += 1) mask[y * width + x] = 1;
                }
                const touchesRightEdge = sparkle.bbox.x1 >= png.width - 20;
                const touchesBottomEdge = sparkle.bbox.y1 >= png.height - 20;
                if (touchesRightEdge || touchesBottomEdge) {
                    const edgeRectX0 = Math.max(0, sparkle.bbox.x0 - x0 - 2);
                    const edgeRectY0 = Math.max(0, sparkle.bbox.y0 - y0 - 2);
                    const edgeRectX1 = Math.min(width - 1, sparkle.bbox.x1 - x0 + 6);
                    const edgeRectY1 = Math.min(height - 1, sparkle.bbox.y1 - y0 + 6);
                    for (let y = edgeRectY0; y <= edgeRectY1; y += 1) {
                        for (let x = edgeRectX0; x <= edgeRectX1; x += 1) mask[y * width + x] = 1;
                    }
                    box.x0 = Math.min(box.x0, edgeRectX0);
                    box.y0 = Math.min(box.y0, edgeRectY0);
                    box.x1 = Math.max(box.x1, edgeRectX1);
                    box.y1 = Math.max(box.y1, edgeRectY1);
                }
                if (touchesRightEdge || touchesBottomEdge) {
                    fillMaskByRowInterpolation(png, x0, y0, width, height, box, mask);
                } else {
                    fillMaskFromPlanes(png, x0, y0, width, height, box, mask);
                }
            }
        } catch (error) {
            // Ignore post-cleanup detector failures.
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
            for (const match of plan.matches) match.watermarkedRegion = captureMatchRegion(png, match);
            for (const match of plan.matches) applySubtraction(png, match);
            await healScaledTemplateMatch(png, plan.matches[0]);
            if (!['default-placement', 'geometry-placement-search', 'downscaled-preview-placement-search'].includes(plan.matches[0]?.source)) {
                await runDetectorResidualCleanup(png, plan.matches[0]);
            }
            healResidualCorner(png, plan.matches[0]);
            return { changed: true, canvas: canvasFromRaster(png), plan };
        }
    }
    class GeminiWatermarkRemover {
        constructor() {
            this.engine = null;
            this.originalFetch = window.fetch.bind(window);
            this.originalCreateObjectURL = URL.createObjectURL.bind(URL);
            this.originalRevokeObjectURL = URL.revokeObjectURL.bind(URL);
            this.originalAnchorClick = HTMLAnchorElement.prototype.click;
            this.originalClipboardItem = window.ClipboardItem;
            this.objectUrls = new Set();
            this.capturedBlobsByUrl = new Map();
            this.cleaningByUrl = new Map();
            this.pageScanPromise = null;
            this.fullSizeWaitTimer = null;
            this.clipboardCopyWaitTimer = null;
            this.transferDiagnostics = { calls: 0, blobSeen: false, lastSize: 0, pendingAtCall: false };
            this.autoCleanDownloads = true;
            this.ui = null;
            this.activity = {
                attempts: 0,
                cleaned: 0,
                unchanged: 0,
                failures: 0,
                lastMatch: null,
                lastAnalysis: null,
                lastDurationMs: null
            };
            void this.init();
        }
        async init() {
            try {
                this.setupDownloadArtifactInterceptor();
                this.setupDownloadTransferInterceptor();
                this.setupClipboardInterceptor();
                this.setupNetworkInterceptor();
                this.setupClickInterceptor();
                this.installPublicApi();
                this.setupObjectUrlCleanup();
                if (document.readyState === 'loading') {
                    await new Promise((resolve) => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
                }
                this.installPanel();
                this.setStatus('ready', 'Ready', 'Downloads and image copies will be checked automatically.');
                this.log('Ready. Download and clipboard cleanup is lazy; page images are not scanned.');
            } catch (error) {
                this.setStatus('error', 'Initialization failed', error.message);
                console.error('[Gemini watermark remover] Init failed:', error);
            }
        }
        log(message, ...args) {
            console.log(`%c Gemini watermark remover %c ${message}`,
                'background:#1f2937; color:#f9fafb; padding:2px 6px; border-radius:4px;',
                'color:#2563eb;',
                ...args);
        }
        installPanel() {
            const host = document.createElement('div');
            host.id = 'gemini-watermark-remover-panel';
            const shadow = host.attachShadow({ mode: 'open' });
            const createElement = (tagName, options = {}) => {
                const element = document.createElement(tagName);
                if (options.id) element.id = options.id;
                if (options.className) element.className = options.className;
                if (options.text !== undefined) element.textContent = options.text;
                for (const [name, value] of Object.entries(options.attributes || {})) {
                    element.setAttribute(name, value);
                }
                return element;
            };
            const style = createElement('style');
            style.textContent = `
                :host { position:fixed; right:12px; top:12px; z-index:2147483647; font-family:Arial,sans-serif; letter-spacing:0; color:#171717; }
                * { box-sizing:border-box; letter-spacing:0; }
                .panel { width:280px; max-width:calc(100vw - 24px); background:#fff; border:1px solid #d4d4d4; border-radius:7px; box-shadow:0 8px 22px rgba(0,0,0,.2); overflow:hidden; }
                .panel.collapsed { width:36px; height:36px; }
                header { min-height:40px; display:flex; align-items:center; justify-content:space-between; gap:8px; padding:6px 6px 6px 12px; background:#171717; color:#fff; }
                .panel.collapsed header { height:34px; min-height:34px; gap:0; padding:2px; }
                .panel.collapsed .title { display:none; }
                .title { min-width:0; display:flex; flex-direction:column; gap:2px; }
                strong { font-size:14px; line-height:18px; font-weight:700; }
                #summary { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:#d4d4d4; font-size:11px; line-height:14px; }
                .icon { width:30px; height:30px; flex:0 0 30px; border:0; border-radius:4px; background:transparent; color:inherit; font-size:20px; line-height:30px; padding:0; cursor:pointer; }
                .icon:hover { background:#404040; }
                .panel.collapsed .icon { position:relative; color:#f5f5f5; font-size:20px; }
                .panel.collapsed .icon::after { content:""; position:absolute; left:6px; top:14px; width:18px; height:2px; border-radius:1px; background:#34d399; transform:rotate(-42deg); pointer-events:none; }
                .body { padding:10px; display:grid; gap:8px; }
                .panel.collapsed .body { display:none; }
                .state { min-height:44px; display:grid; grid-template-columns:10px minmax(0,1fr); column-gap:8px; align-items:start; }
                .dot { width:8px; height:8px; margin-top:5px; border-radius:50%; background:#737373; }
                :host([data-state="working"]) .dot { background:#2563eb; }
                :host([data-state="success"]) .dot { background:#15803d; }
                :host([data-state="warning"]) .dot { background:#b45309; }
                :host([data-state="error"]) .dot { background:#b91c1c; }
                .message { min-width:0; }
                #message { font-size:13px; line-height:18px; font-weight:600; overflow-wrap:anywhere; }
                #detail { display:block; margin-top:2px; color:#525252; font-size:11px; line-height:15px; overflow-wrap:anywhere; }
                .actions { display:grid; grid-template-columns:1fr 1fr 34px; gap:6px; }
                button, .file-button { min-height:34px; border:1px solid #a3a3a3; border-radius:5px; background:#fafafa; color:#171717; font:600 12px/16px Arial,sans-serif; padding:8px 10px; cursor:pointer; text-align:center; }
                button:hover, .file-button:hover { background:#e5e5e5; }
                button:disabled { cursor:wait; opacity:.55; }
                .file-button { display:flex; align-items:center; justify-content:center; }
                .file-button input { display:none; }
                #rescan { width:34px; padding:0; font-size:18px; }
                .toggle-row { display:flex; align-items:center; justify-content:space-between; gap:12px; font-size:12px; line-height:18px; }
                .toggle { position:relative; width:34px; height:20px; flex:0 0 34px; }
                .toggle input { position:absolute; opacity:0; width:1px; height:1px; }
                .track { position:absolute; inset:0; border-radius:10px; background:#a3a3a3; cursor:pointer; }
                .track::after { content:""; position:absolute; top:3px; left:3px; width:14px; height:14px; border-radius:50%; background:#fff; transition:transform .15s ease; }
                .toggle input:checked + .track { background:#15803d; }
                .toggle input:checked + .track::after { transform:translateX(14px); }
                footer { border-top:1px solid #e5e5e5; padding-top:8px; color:#737373; font-size:11px; line-height:14px; }
                @media (max-width:420px) { :host { right:8px; top:8px; } .panel { max-width:calc(100vw - 16px); } }
            `;
            const panel = createElement('section', {
                className: 'panel collapsed',
                attributes: { 'aria-label': 'Gemini watermark cleaner' }
            });
            const header = createElement('header');
            const title = createElement('div', { className: 'title' });
            title.append(
                createElement('strong', { text: 'Watermark cleaner' }),
                createElement('span', { id: 'summary', text: 'Ready' })
            );
            const collapse = createElement('button', {
                id: 'collapse',
                className: 'icon',
                text: '\u2726',
                attributes: { type: 'button', title: 'Open watermark cleaner', 'aria-label': 'Open watermark cleaner' }
            });
            header.append(title, collapse);

            const body = createElement('div', { className: 'body' });
            const state = createElement('div', { className: 'state' });
            const messageBox = createElement('div', { className: 'message' });
            messageBox.append(
                createElement('div', { id: 'message', text: 'Ready' }),
                createElement('small', { id: 'detail' })
            );
            state.append(createElement('span', { className: 'dot' }), messageBox);

            const actions = createElement('div', { className: 'actions' });
            const cleanLatest = createElement('button', {
                id: 'clean-latest',
                text: 'Clean latest',
                attributes: { type: 'button' }
            });
            const fileButton = createElement('label', { className: 'file-button', text: 'Clean file' });
            const file = createElement('input', {
                id: 'file',
                attributes: { type: 'file', accept: 'image/png,image/jpeg,image/webp' }
            });
            fileButton.append(file);
            const rescan = createElement('button', {
                id: 'rescan',
                text: '\u21bb',
                attributes: {
                    type: 'button',
                    title: 'Clean images shown on the page',
                    'aria-label': 'Rescan page'
                }
            });
            actions.append(cleanLatest, fileButton, rescan);

            const toggleRow = createElement('div', { className: 'toggle-row' });
            const toggle = createElement('label', { className: 'toggle' });
            const auto = createElement('input', { id: 'auto', attributes: { type: 'checkbox' } });
            auto.checked = true;
            toggle.append(auto, createElement('span', { className: 'track' }));
            toggleRow.append(createElement('span', { text: 'Auto-clean saves & copies' }), toggle);
            body.append(
                state,
                actions,
                toggleRow,
                createElement('footer', { id: 'counts', text: '0 cleaned, 0 unchanged' })
            );
            panel.append(header, body);
            shadow.append(style, panel);
            document.documentElement.appendChild(host);
            collapse.addEventListener('click', () => {
                const collapsed = panel.classList.toggle('collapsed');
                collapse.textContent = collapsed ? '\u2726' : '\u2212';
                collapse.title = collapsed ? 'Open watermark cleaner' : 'Minimize watermark cleaner';
                collapse.setAttribute('aria-label', collapse.title);
            });
            shadow.getElementById('clean-latest').addEventListener('click', () => void this.cleanLatestImage());
            shadow.getElementById('rescan').addEventListener('click', () => this.processExistingImages());
            shadow.getElementById('auto').addEventListener('change', (event) => this.setAutoClean(event.target.checked));
            shadow.getElementById('file').addEventListener('change', (event) => {
                const [file] = event.target.files;
                if (file) void this.cleanLocalFile(file);
                event.target.value = '';
            });
            this.ui = {
                host,
                summary: shadow.getElementById('summary'),
                message: shadow.getElementById('message'),
                detail: shadow.getElementById('detail'),
                counts: shadow.getElementById('counts'),
                cleanLatest: shadow.getElementById('clean-latest'),
                file: shadow.getElementById('file'),
                rescan: shadow.getElementById('rescan'),
                auto: shadow.getElementById('auto')
            };
        }
        setStatus(state, message, detail = '') {
            if (!this.ui) return;
            this.ui.host.dataset.state = state;
            this.ui.summary.textContent = message;
            this.ui.message.textContent = message;
            this.ui.detail.textContent = detail;
            const working = state === 'working';
            this.ui.cleanLatest.disabled = working;
            this.ui.file.disabled = working;
            this.ui.rescan.disabled = working;
            this.updatePanelStats();
        }
        updatePanelStats() {
            if (!this.ui) return;
            this.ui.counts.textContent = `${this.activity.cleaned} cleaned, ${this.activity.unchanged} unchanged, ${this.activity.failures} failed`;
        }
        setAutoClean(enabled) {
            this.autoCleanDownloads = Boolean(enabled);
            if (this.ui) this.ui.auto.checked = this.autoCleanDownloads;
            this.setStatus('ready', this.autoCleanDownloads ? 'Auto-clean enabled' : 'Auto-clean paused');
            return this.autoCleanDownloads;
        }
        cleanUrl(url) {
            return url.replace(/=s\d+(?=[-?#]|$)/, '=s0');
        }
        buildFetchInput(input, highResUrl) {
            if (typeof input === 'string' || input instanceof URL) return highResUrl;
            if (input instanceof Request) return new Request(highResUrl, input);
            return input;
        }
        async fetchImage(url, options = {}) {
            const controller = new AbortController();
            const timeout = window.setTimeout(() => controller.abort(), 30000);
            try {
                return await this.originalFetch(url, { credentials: 'include', ...options, signal: controller.signal });
            } catch (error) {
                if (error?.name === 'AbortError') throw new Error('Image request timed out after 30 seconds.');
                throw error;
            } finally {
                window.clearTimeout(timeout);
            }
        }
        async getEngine() {
            if (!this.engine) this.engine = await WatermarkEngine.create();
            return this.engine;
        }
        installPublicApi() {
            window.geminiWatermarkRemover = Object.freeze({
                rescan: () => this.processExistingImages(),
                cleanBlob: (blob) => this.cleanImageBlob(blob, 'manual'),
                cleanLatest: () => this.cleanLatestImage(),
                setAutoClean: (enabled) => this.setAutoClean(enabled),
                stats: () => ({
                    engineReady: Boolean(this.engine),
                    activeObjectUrls: this.objectUrls.size,
                    activeCleanups: this.cleaningByUrl.size,
                    activePageScan: Boolean(this.pageScanPromise),
                    waitingForFullSize: Boolean(this.fullSizeWaitTimer),
                    waitingForClipboard: Boolean(this.clipboardCopyWaitTimer),
                    clipboardHooks: {
                        item: Boolean(window.ClipboardItem?.__gwrWrapped),
                        write: Boolean(window.Clipboard?.prototype.write?.__gwrWrapped)
                    },
                    transferHooks: {
                        worker: Boolean(window.Worker?.prototype.postMessage?.__gwrWrapped),
                        messagePort: Boolean(window.MessagePort?.prototype.postMessage?.__gwrWrapped),
                        broadcastChannel: Boolean(window.BroadcastChannel?.prototype.postMessage?.__gwrWrapped)
                    },
                    transferDiagnostics: { ...this.transferDiagnostics },
                    templatesCached: TEMPLATE_CACHE.size,
                    scaledTemplatesCached: SCALED_TEMPLATE_CACHE.size,
                    autoCleanDownloads: this.autoCleanDownloads,
                    ...this.activity
                })
            });
        }
        async canvasToPngBlob(canvas) {
            return new Promise((resolve, reject) => {
                canvas.toBlob((value) => value ? resolve(value) : reject(new Error('Canvas encoding failed.')), 'image/png');
            });
        }
        async imageSourceToPngBlob(source) {
            const raster = rasterFromImage(source);
            return this.canvasToPngBlob(canvasFromRaster(raster));
        }
        async cleanImageSource(source, label, originalBlob = null) {
            const engine = await this.getEngine();
            const result = await engine.processImage(source, (match) => {
                this.log(`${label}: locked ${match.logoSize}px at x:${match.x}, y:${match.y} (${(match.confidence * 100).toFixed(1)}%)`);
            });
            if (!result.changed || !result.canvas) {
                return {
                    blob: originalBlob || await this.imageSourceToPngBlob(source),
                    changed: false,
                    plan: result.plan
                };
            }
            return { blob: await this.canvasToPngBlob(result.canvas), changed: true, plan: result.plan };
        }
        async cleanImageBlob(blob, label) {
            const bitmap = await createImageBitmap(blob);
            try {
                return await this.cleanImageSource(bitmap, label, blob);
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
        async cleanImageSourceForUrl(cleanUrl, source, label) {
            if (this.cleaningByUrl.has(cleanUrl)) return this.cleaningByUrl.get(cleanUrl);
            const cleanup = this.cleanImageSource(source, label)
                .finally(() => this.cleaningByUrl.delete(cleanUrl));
            this.cleaningByUrl.set(cleanUrl, cleanup);
            return cleanup;
        }
        getImageUrlNearControl(control, eventPath = []) {
            const containerSelector = 'generated-image, .generated-image-container, [data-test-id*="generated-image"]';
            const pathContainer = eventPath.find((element) => element.matches?.(containerSelector));
            const container = pathContainer || control?.closest(containerSelector);
            const image = this.selectBestGeneratedImage(container?.querySelectorAll('img') || []);
            if (image) return this.getImageCandidateUrl(image);
            return this.getLatestImageUrl();
        }
        isProcessableImageUrl(url) {
            return Boolean(url) && (
                CONSTANTS.URL_PATTERN.test(url) ||
                url.startsWith('blob:https://gemini.google.com/')
            );
        }
        getImageCandidateUrl(image) {
            const srcsetUrls = (image?.getAttribute('srcset') || '')
                .split(',')
                .map((entry) => entry.trim().split(/\s+/)[0])
                .filter(Boolean);
            const candidates = [
                image?.currentSrc,
                image?.src,
                image?.getAttribute('src'),
                ...srcsetUrls
            ].filter(Boolean);
            return candidates.find((url) => CONSTANTS.URL_PATTERN.test(url)) ||
                candidates.find((url) => this.isProcessableImageUrl(url)) ||
                null;
        }
        isVisibleImage(image) {
            if (!image?.isConnected) return false;
            const rect = image.getBoundingClientRect();
            const style = window.getComputedStyle(image);
            return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
        }
        selectBestGeneratedImage(images) {
            let best = null;
            let bestScore = -Infinity;
            Array.from(images).forEach((image, index) => {
                const url = this.getImageCandidateUrl(image);
                if (!url) return;
                const rect = image.getBoundingClientRect();
                const renderedArea = Math.max(0, rect.width * rect.height);
                const sourceArea = Math.max(0, image.naturalWidth * image.naturalHeight);
                const longestEdge = Math.max(rect.width, rect.height, image.naturalWidth, image.naturalHeight);
                if (longestEdge < 160) return;
                const visibleBonus = this.isVisibleImage(image) ? 1e12 : 0;
                const score = visibleBonus + Math.max(renderedArea, sourceArea) + index;
                if (score > bestScore) {
                    best = image;
                    bestScore = score;
                }
            });
            return best;
        }
        getLatestImageUrl() {
            const image = this.selectBestGeneratedImage(document.querySelectorAll('img'));
            return image ? this.getImageCandidateUrl(image) : null;
        }
        findImageForUrl(url) {
            return this.selectBestGeneratedImage(
                Array.from(document.querySelectorAll('img')).filter((image) => this.getImageCandidateUrl(image) === url)
            );
        }
        isDownscaledBlobPreview(url) {
            if (!url?.startsWith('blob:')) return false;
            const image = this.findImageForUrl(url);
            return Boolean(image) && Math.max(image.naturalWidth, image.naturalHeight) <= 1024;
        }
        downloadBlob(blob, filename) {
            const objectUrl = URL.createObjectURL(blob);
            this.objectUrls.add(objectUrl);
            const anchor = document.createElement('a');
            anchor.href = objectUrl;
            anchor.download = filename || 'Gemini_Generated_Image_cleaned.png';
            anchor.dataset.gwrBypass = 'true';
            anchor.style.display = 'none';
            document.documentElement.appendChild(anchor);
            anchor.click();
            anchor.remove();
            window.setTimeout(() => {
                URL.revokeObjectURL(objectUrl);
                this.objectUrls.delete(objectUrl);
            }, 60000);
        }
        clearFullSizeWait() {
            if (!this.fullSizeWaitTimer) return;
            window.clearTimeout(this.fullSizeWaitTimer);
            this.fullSizeWaitTimer = null;
        }
        beginFullSizeWait() {
            this.clearFullSizeWait();
            this.setStatus('working', 'Preparing full-size download', 'Waiting for Gemini\'s full-resolution image...');
            this.fullSizeWaitTimer = window.setTimeout(() => {
                this.fullSizeWaitTimer = null;
                this.activity.failures += 1;
                this.updatePanelStats();
                this.setStatus('error', 'Download was not cleaned', 'Use Clean file on the downloaded image.');
            }, FULL_SIZE_WAIT_TIMEOUT_MS);
        }
        clearClipboardCopyWait() {
            if (!this.clipboardCopyWaitTimer) return;
            window.clearTimeout(this.clipboardCopyWaitTimer);
            this.clipboardCopyWaitTimer = null;
        }
        beginClipboardCopyWait() {
            this.clearClipboardCopyWait();
            this.setStatus('working', 'Preparing clean copy', 'Waiting for Gemini\'s clipboard image...');
            this.clipboardCopyWaitTimer = window.setTimeout(() => {
                this.clipboardCopyWaitTimer = null;
                this.activity.failures += 1;
                this.updatePanelStats();
                this.setStatus('error', 'Copy was not cleaned', 'Gemini did not expose an image clipboard payload.');
            }, CLIPBOARD_WAIT_TIMEOUT_MS);
        }
        async cleanClipboardBlob(blob) {
            this.clearClipboardCopyWait();
            this.activity.attempts += 1;
            this.setStatus('working', 'Cleaning clipboard image', 'Matching and reconstructing the watermark region...');
            const startedAt = performance.now();
            try {
                const result = await this.cleanImageBlob(blob, 'clipboard copy');
                this.activity.lastDurationMs = Math.round(performance.now() - startedAt);
                this.recordResult(result);
                if (result.changed) {
                    const match = result.plan.matches[0];
                    this.setStatus('success', 'Copied cleaned image', `${match.logoSize}px match at ${match.x}, ${match.y} (${(match.confidence * 100).toFixed(1)}%).`);
                } else {
                    this.setStatus('warning', 'Copied image unchanged', 'No confident watermark match was found.');
                }
                return result.blob;
            } catch (error) {
                this.activity.lastDurationMs = Math.round(performance.now() - startedAt);
                this.activity.failures += 1;
                this.updatePanelStats();
                this.setStatus('error', 'Copy was not cleaned', 'Gemini copied the original image.');
                console.warn('[Gemini watermark remover] Clipboard processing failed:', error);
                return blob;
            }
        }
        prepareClipboardItemData(data) {
            if (!this.clipboardCopyWaitTimer || !this.autoCleanDownloads || !data || typeof data !== 'object') return null;
            const entries = Object.entries(data);
            const imageEntry = entries.find(([type]) => type.toLowerCase() === 'image/png') ||
                entries.find(([type]) => type.toLowerCase().startsWith('image/'));
            if (!imageEntry) return null;
            this.clearClipboardCopyWait();
            const [imageType, imageValue] = imageEntry;
            return Object.fromEntries(entries.map(([type, value]) => [
                type,
                type === imageType
                    ? Promise.resolve(imageValue).then((resolved) => {
                        const blob = resolved instanceof Blob ? resolved : new Blob([resolved], { type: imageType });
                        return this.cleanClipboardBlob(blob);
                    })
                    : value
            ]));
        }
        prepareExistingClipboardItems(items) {
            if (!this.clipboardCopyWaitTimer || !this.autoCleanDownloads || !this.originalClipboardItem || !Array.isArray(items)) return null;
            const itemIndex = items.findIndex((item) => Array.from(item?.types || []).some((type) => type.toLowerCase().startsWith('image/')));
            if (itemIndex < 0) return null;
            const item = items[itemIndex];
            const types = Array.from(item.types);
            const imageType = types.find((type) => type.toLowerCase() === 'image/png') ||
                types.find((type) => type.toLowerCase().startsWith('image/'));
            this.clearClipboardCopyWait();
            const data = Object.fromEntries(types.map((type) => [
                type,
                type === imageType
                    ? item.getType(type).then((blob) => this.cleanClipboardBlob(blob))
                    : item.getType(type)
            ]));
            const replacement = new this.originalClipboardItem(data, { presentationStyle: item.presentationStyle });
            return items.map((entry, index) => index === itemIndex ? replacement : entry);
        }
        setupClipboardInterceptor() {
            const remover = this;
            const OriginalClipboardItem = this.originalClipboardItem;
            if (OriginalClipboardItem && !OriginalClipboardItem.__gwrWrapped) {
                const WrappedClipboardItem = function (data, options) {
                    const replacement = remover.prepareClipboardItemData(data);
                    return new OriginalClipboardItem(replacement || data, options);
                };
                Object.setPrototypeOf(WrappedClipboardItem, OriginalClipboardItem);
                WrappedClipboardItem.prototype = OriginalClipboardItem.prototype;
                Object.defineProperty(WrappedClipboardItem, '__gwrWrapped', { value: true });
                try {
                    Object.defineProperty(window, 'ClipboardItem', {
                        configurable: true,
                        writable: true,
                        value: WrappedClipboardItem
                    });
                } catch (error) {
                    console.debug('[Gemini watermark remover] ClipboardItem constructor hook unavailable:', error);
                }
            }
            const clipboardPrototype = window.Clipboard?.prototype;
            if (!clipboardPrototype?.write || clipboardPrototype.write.__gwrWrapped) return;
            const originalWrite = clipboardPrototype.write;
            const wrappedWrite = function (items) {
                const replacements = remover.prepareExistingClipboardItems(items);
                return originalWrite.call(this, replacements || items);
            };
            Object.defineProperty(wrappedWrite, '__gwrWrapped', { value: true });
            try {
                clipboardPrototype.write = wrappedWrite;
            } catch (error) {
                console.debug('[Gemini watermark remover] Clipboard write hook unavailable:', error);
            }
        }
        cleanedFilename(filename) {
            const value = filename || 'Gemini_Generated_Image.png';
            const extensionIndex = value.lastIndexOf('.');
            const base = extensionIndex > 0 ? value.slice(0, extensionIndex) : value;
            const extension = extensionIndex > 0 ? value.slice(extensionIndex) : '.png';
            return `${base.replace(/-cleaned$/i, '')}-cleaned${extension}`;
        }
        async cleanCapturedDownloadBlob(blob, filename) {
            this.clearFullSizeWait();
            this.activity.attempts += 1;
            this.setStatus('working', 'Cleaning full-size download', 'Matching and reconstructing the watermark region...');
            try {
                const result = await this.cleanImageBlob(blob, 'native download');
                this.recordResult(result);
                this.downloadBlob(result.blob, this.cleanedFilename(filename));
                if (result.changed) {
                    const match = result.plan.matches[0];
                    this.setStatus('success', 'Cleaned download saved', `${match.logoSize}px match at ${match.x}, ${match.y} (${(match.confidence * 100).toFixed(1)}%).`);
                } else {
                    this.setStatus('warning', 'No watermark match', 'The full-size image was saved unchanged.');
                }
                return result;
            } catch (error) {
                this.activity.failures += 1;
                this.updatePanelStats();
                this.setStatus('error', 'Download cleaning failed', error.message);
                console.warn('[Gemini watermark remover] Captured download processing failed:', error);
                throw error;
            }
        }
        async cleanTransferredDownloadBlob(blob) {
            this.clearFullSizeWait();
            this.activity.attempts += 1;
            this.setStatus('working', 'Cleaning full-size download', 'Using Gemini\'s native download channel...');
            const startedAt = performance.now();
            try {
                await new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
                const result = await this.cleanImageBlob(blob, 'native transfer');
                this.activity.lastDurationMs = Math.round(performance.now() - startedAt);
                this.recordResult(result);
                if (result.changed) {
                    const match = result.plan.matches[0];
                    this.setStatus('success', 'Full-size download cleaned', `${match.logoSize}px match at ${match.x}, ${match.y} (${(match.confidence * 100).toFixed(1)}%).`);
                } else {
                    this.setStatus('warning', 'No watermark match', 'Gemini will save the full-size image unchanged.');
                }
                return result.blob;
            } catch (error) {
                this.activity.lastDurationMs = Math.round(performance.now() - startedAt);
                this.activity.failures += 1;
                this.updatePanelStats();
                this.setStatus('error', 'Download cleaning failed', 'Gemini will save the original image.');
                console.warn('[Gemini watermark remover] Transferred download processing failed:', error);
                throw error;
            }
        }
        recordResult(result) {
            const summarizeMatch = (match) => match ? {
                x: match.x,
                y: match.y,
                logoSize: match.logoSize,
                confidence: match.confidence,
                source: match.source || null,
                reconstruction: match.reconstruction || null
            } : null;
            this.activity.lastAnalysis = {
                found: result.plan.found,
                confidence: result.plan.confidence,
                candidates: [
                    ...(result.plan.nearCornerCandidates || []),
                    ...(result.plan.cornerCandidates || [])
                ].map(summarizeMatch)
            };
            if (result.changed) {
                this.activity.cleaned += 1;
                this.activity.lastMatch = summarizeMatch(result.plan.matches[0]);
            } else {
                this.activity.unchanged += 1;
            }
            this.updatePanelStats();
        }
        async cleanDownloadUrl(url, filename = 'Gemini_Generated_Image_cleaned.png') {
            this.clearFullSizeWait();
            const cleanUrl = this.cleanUrl(url);
            this.activity.attempts += 1;
            this.setStatus('working', 'Cleaning download', 'Fetching the full-resolution image...');
            try {
                this.setStatus('working', 'Cleaning download', 'Matching and reconstructing the watermark region...');
                let result;
                if (cleanUrl.startsWith('blob:')) {
                    const source = this.findImageForUrl(cleanUrl);
                    if (!source) throw new Error('The displayed Gemini image is no longer available.');
                    result = await this.cleanImageSourceForUrl(cleanUrl, source, 'download click');
                } else {
                    const response = await this.fetchImage(cleanUrl);
                    if (!response.ok) throw new Error(`Image request failed (${response.status}).`);
                    result = await this.cleanBlobForUrl(cleanUrl, await response.blob(), 'download click');
                }
                this.recordResult(result);
                this.downloadBlob(result.blob, filename);
                if (result.changed) {
                    const match = result.plan.matches[0];
                    this.setStatus('success', 'Cleaned download saved', `${match.logoSize}px match at ${match.x}, ${match.y} (${(match.confidence * 100).toFixed(1)}%).`);
                } else {
                    this.setStatus('warning', 'No watermark match', 'The original image was saved unchanged.');
                }
                return result;
            } catch (error) {
                this.activity.failures += 1;
                this.setStatus('error', 'Download cleaning failed', error.message);
                console.warn('[Gemini watermark remover] Click download processing failed:', error);
                throw error;
            }
        }
        async cleanLatestImage() {
            const url = this.getLatestImageUrl();
            if (!url) {
                this.setStatus('warning', 'No generated image found');
                return null;
            }
            return this.cleanDownloadUrl(url);
        }
        async cleanLocalFile(file) {
            this.activity.attempts += 1;
            this.setStatus('working', 'Cleaning local file', file.name);
            try {
                const result = await this.cleanImageBlob(file, 'local file');
                this.recordResult(result);
                const baseName = file.name.replace(/\.[^.]+$/, '');
                this.downloadBlob(result.blob, `${baseName}-cleaned.png`);
                this.setStatus(
                    result.changed ? 'success' : 'warning',
                    result.changed ? 'Cleaned file saved' : 'No watermark match',
                    result.changed ? file.name : 'The file was saved unchanged.',
                );
                return result;
            } catch (error) {
                this.activity.failures += 1;
                this.setStatus('error', 'File cleaning failed', error.message);
                throw error;
            }
        }
        setupClickInterceptor() {
            window.addEventListener('click', (event) => {
                if (!this.autoCleanDownloads) return;
                const eventPath = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
                const elements = eventPath.filter((entry) => entry instanceof Element);
                const control = elements.find((element) => element.matches('a, button, [role="button"]'));
                if (!control) return;
                const anchor = elements.find((element) => element.matches('a[href]')) || control.closest('a[href]');
                if (anchor?.dataset.gwrBypass === 'true') return;
                const directUrl = anchor?.href && this.isProcessableImageUrl(anchor.href) ? anchor.href : null;
                const controlIndex = elements.indexOf(control);
                const labelElements = elements.slice(0, controlIndex + 1).slice(-6);
                const label = labelElements.flatMap((element) => [
                    element.getAttribute('aria-label'),
                    element.getAttribute('title'),
                    element.getAttribute('data-tooltip'),
                    element.getAttribute('data-tooltip-text'),
                    element.textContent
                ]).filter(Boolean).join(' ').toLowerCase();
                const looksLikeImageCopy = label.includes('copy image') ||
                    label.includes('copy to clipboard') ||
                    Boolean(control.closest('copy-button'));
                if (looksLikeImageCopy) {
                    this.beginClipboardCopyWait();
                    return;
                }
                const looksLikeDownload = Boolean(directUrl) || label.includes('download');
                if (!looksLikeDownload) return;
                const imageUrl = directUrl || this.getImageUrlNearControl(control, elements);
                if (!imageUrl) return;
                if (this.isDownscaledBlobPreview(imageUrl)) {
                    this.beginFullSizeWait();
                    return;
                }
                event.preventDefault();
                event.stopImmediatePropagation();
                const filename = anchor?.download || 'Gemini_Generated_Image_cleaned.png';
                void this.cleanDownloadUrl(imageUrl, filename).catch(() => {});
            }, true);
        }
        findTransferredImageBlob(value, depth = 0, seen = new WeakSet()) {
            if (value instanceof Blob) {
                const supportedType = !value.type || value.type.startsWith('image/') || value.type === 'application/octet-stream';
                return supportedType && value.size >= 100000 ? { blob: value, target: value } : null;
            }
            if (value instanceof ArrayBuffer && value.byteLength >= 100000) {
                return { blob: new Blob([value], { type: 'image/png' }), target: value };
            }
            if (ArrayBuffer.isView(value) && value.byteLength >= 100000) {
                return {
                    blob: new Blob([value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)], { type: 'image/png' }),
                    target: value
                };
            }
            if (!value || typeof value !== 'object' || depth >= 3 || seen.has(value)) return null;
            seen.add(value);
            const entries = Array.isArray(value) ? value.slice(0, 20) : Object.values(value).slice(0, 20);
            for (const entry of entries) {
                const candidate = this.findTransferredImageBlob(entry, depth + 1, seen);
                if (candidate) return candidate;
            }
            return null;
        }
        replaceTransferredImage(value, target, replacement, depth = 0, seen = new WeakSet()) {
            if (value === target) return replacement;
            if (!value || typeof value !== 'object' || depth >= 3 || seen.has(value)) return value;
            seen.add(value);
            if (Array.isArray(value)) {
                return value.map((entry) => this.replaceTransferredImage(entry, target, replacement, depth + 1, seen));
            }
            if (Object.getPrototypeOf(value) === Object.prototype) {
                return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
                    key,
                    this.replaceTransferredImage(entry, target, replacement, depth + 1, seen)
                ]));
            }
            return value;
        }
        capturePendingTransfer(value) {
            this.transferDiagnostics.calls += 1;
            this.transferDiagnostics.blobSeen = value instanceof Blob;
            this.transferDiagnostics.lastSize = value instanceof Blob ? value.size : 0;
            this.transferDiagnostics.pendingAtCall = Boolean(this.fullSizeWaitTimer);
            if (!this.fullSizeWaitTimer || !this.autoCleanDownloads) return null;
            const candidate = this.findTransferredImageBlob(value);
            if (!candidate) return null;
            this.clearFullSizeWait();
            return this.cleanTransferredDownloadBlob(candidate.blob)
                .then((cleanedBlob) => this.replaceTransferredImage(value, candidate.target, cleanedBlob))
                .catch(() => value);
        }
        setupDownloadTransferInterceptor() {
            const remover = this;
            const wrapPostMessage = (prototype) => {
                if (!prototype?.postMessage || prototype.postMessage.__gwrWrapped) return;
                const original = prototype.postMessage;
                const wrapped = function (message, ...rest) {
                    const cleanedTransfer = remover.capturePendingTransfer(message);
                    if (cleanedTransfer) {
                        void cleanedTransfer.then((cleanedMessage) => original.call(this, cleanedMessage, ...rest));
                        return undefined;
                    }
                    return original.call(this, message, ...rest);
                };
                Object.defineProperty(wrapped, '__gwrWrapped', { value: true });
                prototype.postMessage = wrapped;
            };
            wrapPostMessage(window.Worker?.prototype);
            wrapPostMessage(window.MessagePort?.prototype);
            wrapPostMessage(window.BroadcastChannel?.prototype);
            wrapPostMessage(window.Window?.prototype);
        }
        setupDownloadArtifactInterceptor() {
            const remover = this;
            URL.createObjectURL = function (value) {
                const url = remover.originalCreateObjectURL(value);
                if (value instanceof Blob) remover.capturedBlobsByUrl.set(url, value);
                return url;
            };
            URL.revokeObjectURL = function (url) {
                remover.capturedBlobsByUrl.delete(String(url));
                return remover.originalRevokeObjectURL(url);
            };
            HTMLAnchorElement.prototype.click = function () {
                const href = this.href;
                const capturedBlob = remover.capturedBlobsByUrl.get(href);
                const shouldCapture = remover.autoCleanDownloads &&
                    this.dataset.gwrBypass !== 'true' &&
                    this.hasAttribute('download');
                const looksLikeImageBlob = capturedBlob && (
                    capturedBlob.type.startsWith('image/') ||
                    /\.(?:png|jpe?g|webp)$/i.test(this.download)
                );
                if (shouldCapture && looksLikeImageBlob) {
                    void remover.cleanCapturedDownloadBlob(capturedBlob, this.download).catch(() => {});
                    return;
                }
                if (shouldCapture && CONSTANTS.URL_PATTERN.test(href)) {
                    remover.clearFullSizeWait();
                    void remover.cleanDownloadUrl(href, remover.cleanedFilename(this.download)).catch(() => {});
                    return;
                }
                return remover.originalAnchorClick.call(this);
            };
        }
        setupObjectUrlCleanup() {
            window.addEventListener('pagehide', () => {
                this.clearFullSizeWait();
                this.clearClipboardCopyWait();
                for (const objectUrl of this.objectUrls) URL.revokeObjectURL(objectUrl);
                this.objectUrls.clear();
            }, { once: true });
        }
        setupNetworkInterceptor() {
            const originalFetch = this.originalFetch;
            window.fetch = async (input, init) => {
                const url = typeof input === 'string'
                    ? input
                    : input instanceof URL
                        ? input.href
                        : input?.url;
                if (!this.autoCleanDownloads || !url || !CONSTANTS.DOWNLOAD_URL_PATTERN.test(url)) return originalFetch(input, init);
                this.clearFullSizeWait();
                const cleanUrl = this.cleanUrl(url);
                this.activity.attempts += 1;
                this.setStatus('working', 'Cleaning download', 'Intercepted Gemini image response.');
                const response = await originalFetch(this.buildFetchInput(input, cleanUrl), init);
                if (!response.ok) {
                    this.activity.failures += 1;
                    this.setStatus('error', 'Image request failed', `HTTP ${response.status}`);
                    return response;
                }
                const originalResponse = response.clone();
                try {
                    const blob = await response.blob();
                    const result = await this.cleanBlobForUrl(cleanUrl, blob, 'download');
                    this.recordResult(result);
                    if (!result.changed) {
                        this.setStatus('warning', 'No watermark match', 'Returning the original download unchanged.');
                        return originalResponse;
                    }
                    this.log(`Download cleaned (${result.plan.matches.length} match${result.plan.matches.length === 1 ? '' : 'es'}).`);
                    const match = result.plan.matches[0];
                    this.setStatus('success', 'Download cleaned', `${match.logoSize}px match (${(match.confidence * 100).toFixed(1)}%).`);
                    return new Response(result.blob, {
                        status: response.status,
                        statusText: response.statusText,
                        headers: new Headers(response.headers)
                    });
                } catch (error) {
                    this.activity.failures += 1;
                    this.setStatus('error', 'Download cleaning failed', error.message);
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
        collectPageImageGroups() {
            const groups = new Map();
            const images = document.querySelectorAll('img');
            images.forEach((image) => {
                if (image.dataset.gwrStatus === 'cleaned' || image.dataset.gwrStatus === 'unchanged') return;
                const currentUrl = this.getImageCandidateUrl(image);
                if (!currentUrl) return;
                const rect = image.getBoundingClientRect();
                const longestEdge = Math.max(rect.width, rect.height, image.naturalWidth, image.naturalHeight);
                if (longestEdge < 160) return;
                const cleanUrl = this.cleanUrl(currentUrl);
                if (!groups.has(cleanUrl)) groups.set(cleanUrl, { cleanUrl, images: [] });
                groups.get(cleanUrl).images.push(image);
            });
            return Array.from(groups.values()).filter((group) => (
                group.images.some((image) => this.isVisibleImage(image))
            )).map((group) => ({
                ...group,
                representative: this.selectBestGeneratedImage(group.images)
            }));
        }
        async processPageImageGroup(group) {
            group.images.forEach((image) => {
                image.dataset.gwrProcessed = 'true';
                image.dataset.gwrStatus = 'processing';
            });
            let result;
            if (group.cleanUrl.startsWith('blob:')) {
                result = await this.cleanImageSourceForUrl(group.cleanUrl, group.representative, 'manual image');
            } else {
                const response = await this.fetchImage(group.cleanUrl);
                if (!response.ok) throw new Error(`Image request failed (${response.status}).`);
                result = await this.cleanBlobForUrl(group.cleanUrl, await response.blob(), 'manual image');
            }
            this.recordResult(result);
            if (!result.changed) {
                group.images.forEach((image) => { image.dataset.gwrStatus = 'unchanged'; });
                return 'unchanged';
            }
            for (const image of group.images) {
                if (!image.isConnected) continue;
                await this.replaceImageElementSource(image, result.blob);
                image.dataset.gwrStatus = 'cleaned';
            }
            this.log(`Replaced ${group.images.length} duplicate image element${group.images.length === 1 ? '' : 's'} with one cleaned result.`);
            return 'cleaned';
        }
        processExistingImages() {
            if (this.pageScanPromise) {
                this.setStatus('working', 'Cleaning page image', 'The current scan is still in progress.');
                return this.pageScanPromise;
            }
            const groups = this.collectPageImageGroups();
            if (groups.length === 0) {
                this.setStatus('warning', 'No new page images found');
                return Promise.resolve({ cleaned: 0, unchanged: 0, failed: 0 });
            }
            this.pageScanPromise = (async () => {
                const totals = { cleaned: 0, unchanged: 0, failed: 0 };
                for (let index = 0; index < groups.length; index += 1) {
                    const group = groups[index];
                    this.setStatus(
                        'working',
                        groups.length === 1 ? 'Cleaning page image' : 'Cleaning page images',
                        `${index + 1} of ${groups.length} unique image${groups.length === 1 ? '' : 's'}.`
                    );
                    try {
                        const outcome = await this.processPageImageGroup(group);
                        totals[outcome] += 1;
                    } catch (error) {
                        totals.failed += 1;
                        this.activity.failures += 1;
                        group.images.forEach((image) => { image.dataset.gwrStatus = 'failed'; });
                        console.warn('[Gemini watermark remover] Page image processing failed:', error);
                    }
                }
                if (totals.failed > 0) {
                    this.setStatus('error', 'Page image cleaning failed', `${totals.failed} unique image${totals.failed === 1 ? '' : 's'} failed.`);
                } else if (totals.cleaned > 0) {
                    this.setStatus('success', 'Page image cleaned', `${totals.cleaned} unique image${totals.cleaned === 1 ? '' : 's'} cleaned.`);
                } else {
                    this.setStatus('warning', 'Page image unchanged', 'No confident watermark match.');
                }
                return totals;
            })().finally(() => {
                this.pageScanPromise = null;
            });
            return this.pageScanPromise;
        }
    }
    new GeminiWatermarkRemover();
})();
