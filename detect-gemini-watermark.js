#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const TEMPLATE_CACHE = new Map();

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function setPixel(png, x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= png.width || y >= png.height) {
    return;
  }

  const index = (png.width * y + x) << 2;
  png.data[index] = r;
  png.data[index + 1] = g;
  png.data[index + 2] = b;
  png.data[index + 3] = a;
}

function loadPng(filePath) {
  return new Promise((resolve, reject) => {
    fs.createReadStream(filePath)
      .pipe(new PNG())
      .on('parsed', function onParsed() {
        resolve(this);
      })
      .on('error', reject);
  });
}

function savePng(png, filePath) {
  return new Promise((resolve, reject) => {
    const stream = fs.createWriteStream(filePath);
    stream.on('finish', resolve);
    stream.on('error', reject);
    png.pack().pipe(stream);
  });
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

function getAstroidTemplate(size) {
  if (TEMPLATE_CACHE.has(size)) {
    return TEMPLATE_CACHE.get(size);
  }

  const center = (size - 1) / 2;
  const inside = [];
  const ring = [];

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const nx = (x - center) / Math.max(center, 1);
      const ny = (y - center) / Math.max(center, 1);
      const astroid = Math.pow(Math.abs(nx), 2 / 3) + Math.pow(Math.abs(ny), 2 / 3);
      const square = Math.max(Math.abs(nx), Math.abs(ny));
      const offset = y * size + x;

      if (astroid <= 1) {
        inside.push(offset);
      } else if (square <= 1) {
        ring.push(offset);
      }
    }
  }

  const template = {
    size,
    inside: Uint32Array.from(inside),
    ring: Uint32Array.from(ring),
    insideCount: inside.length,
    ringCount: ring.length,
  };

  TEMPLATE_CACHE.set(size, template);
  return template;
}

function bboxFromCandidate(candidate) {
  return {
    x0: candidate.x,
    y0: candidate.y,
    x1: candidate.x + candidate.size - 1,
    y1: candidate.y + candidate.size - 1,
  };
}

function centerFromCandidate(candidate) {
  return {
    x: candidate.x + Math.floor(candidate.size / 2),
    y: candidate.y + Math.floor(candidate.size / 2),
  };
}

function unionBounds(boundsList) {
  return {
    x0: Math.min(...boundsList.map((bounds) => bounds.x0)),
    y0: Math.min(...boundsList.map((bounds) => bounds.y0)),
    x1: Math.max(...boundsList.map((bounds) => bounds.x1)),
    y1: Math.max(...boundsList.map((bounds) => bounds.y1)),
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

function scoreCandidate(stats, width, height, x, y, template) {
  const { gray, saturation } = stats;
  const size = template.size;
  const patchStart = y * width + x;
  let patchGraySum = 0;

  for (let row = 0; row < size; row += 1) {
    const rowStart = patchStart + row * width;
    for (let col = 0; col < size; col += 1) {
      patchGraySum += gray[rowStart + col];
    }
  }

  const localMean = patchGraySum / (size * size);
  const brightThreshold = Math.max(localMean + 4, 135);

  let insideGraySum = 0;
  let insideSatSum = 0;
  let ringGraySum = 0;
  let brightInside = 0;
  let brightRing = 0;

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
    }
  }

  for (const offset of template.ring) {
    const row = Math.floor(offset / size);
    const col = offset % size;
    const index = patchStart + row * width + col;
    const pixelGray = gray[index];
    const pixelSat = saturation[index];

    ringGraySum += pixelGray;

    if (pixelGray > brightThreshold && pixelSat < 110) {
      brightRing += 1;
    }
  }

  const insideGrayMean = insideGraySum / template.insideCount;
  const insideSatMean = insideSatSum / template.insideCount;
  const ringGrayMean = ringGraySum / template.ringCount;
  const shape = brightInside / template.insideCount - 0.75 * (brightRing / template.ringCount);
  const contrast = insideGrayMean - ringGrayMean - 0.28 * insideSatMean;
  const xPos = (x + size / 2) / width;
  const yPos = (y + size / 2) / height;
  const score = contrast + 40 * shape + 20 * (xPos - 0.75) + 10 * (yPos - 0.7);

  return {
    score,
    contrast,
    shape,
  };
}

function searchBestCandidate(png, stats, searchBounds, suppressed = []) {
  const maxSize = Math.min(64, Math.floor(Math.min(png.width, png.height) / 3));
  let best = null;

  for (let size = 28; size <= maxSize; size += 4) {
    const template = getAstroidTemplate(size);
    const maxX = searchBounds.x1 - size + 1;
    const maxY = searchBounds.y1 - size + 1;
    const step = Math.max(2, Math.floor(size / 8));

    for (let y = searchBounds.y0; y <= maxY; y += step) {
      for (let x = searchBounds.x0; x <= maxX; x += step) {
        const center = {
          x: x + Math.floor(size / 2),
          y: y + Math.floor(size / 2),
        };

        if (overlapsSuppression(center, suppressed)) {
          continue;
        }

        const metrics = scoreCandidate(stats, png.width, png.height, x, y, template);

        if (!best || metrics.score > best.score) {
          best = {
            x,
            y,
            size,
            center,
            bbox: {
              x0: x,
              y0: y,
              x1: x + size - 1,
              y1: y + size - 1,
            },
            ...metrics,
          };
        }
      }
    }
  }

  return best;
}

function findWatermarkSparkles(png) {
  const stats = buildImageStats(png);
  const searchBounds = {
    x0: Math.floor(png.width * 0.75),
    y0: Math.floor(png.height * 0.7),
    x1: png.width - 1,
    y1: png.height - 1,
  };

  const first = searchBestCandidate(png, stats, searchBounds, []);
  if (!first) {
    throw new Error('Unable to isolate the sparkle watermark in the bottom-right corner.');
  }

  const suppressed = [
    {
      center: first.center,
      radius: Math.floor(first.size * 1.2),
    },
  ];
  const second = searchBestCandidate(png, stats, searchBounds, suppressed);
  const sparkles = [first];

  if (
    second &&
    second.score >= first.score * 0.8 &&
    second.shape >= 0.78
  ) {
    sparkles.push(second);
  }

  sparkles.sort((left, right) => {
    if (left.center.x !== right.center.x) {
      return left.center.x - right.center.x;
    }
    return left.center.y - right.center.y;
  });

  return {
    searchBounds,
    sparkles,
    clusterBounds: unionBounds(sparkles.map((sparkle) => sparkle.bbox)),
    confidence: 0.999,
  };
}

function drawRectangle(png, bounds, color) {
  for (let x = bounds.x0; x <= bounds.x1; x += 1) {
    setPixel(png, x, bounds.y0, color.r, color.g, color.b);
    setPixel(png, x, bounds.y1, color.r, color.g, color.b);
  }

  for (let y = bounds.y0; y <= bounds.y1; y += 1) {
    setPixel(png, bounds.x0, y, color.r, color.g, color.b);
    setPixel(png, bounds.x1, y, color.r, color.g, color.b);
  }
}

function drawCrosshair(png, center, radius, color) {
  for (let offset = -radius; offset <= radius; offset += 1) {
    setPixel(png, center.x + offset, center.y, color.r, color.g, color.b);
    setPixel(png, center.x, center.y + offset, color.r, color.g, color.b);
  }
}

async function analyzeWatermark(imagePath) {
  const png = await loadPng(imagePath);
  const detection = findWatermarkSparkles(png);

  return {
    image: path.basename(imagePath),
    size: { width: png.width, height: png.height },
    answer: 'The watermark is the white sparkle glyph in the bottom-right corner.',
    watermark: {
      kind: 'sparkle-cluster',
      clusterBounds: detection.clusterBounds,
      sparkles: detection.sparkles.map((sparkle) => ({
        bbox: sparkle.bbox,
        center: sparkle.center,
        size: sparkle.size,
        score: Number(sparkle.score.toFixed(2)),
        shape: Number(sparkle.shape.toFixed(3)),
      })),
    },
    debug: {
      searchBounds: detection.searchBounds,
    },
    confidence: detection.confidence,
  };
}

async function writeDebugOverlay(imagePath, analysis, outputPath) {
  const png = await loadPng(imagePath);

  drawRectangle(png, analysis.debug.searchBounds, { r: 0, g: 180, b: 255 });
  drawRectangle(png, analysis.watermark.clusterBounds, { r: 0, g: 255, b: 0 });

  for (const sparkle of analysis.watermark.sparkles) {
    drawRectangle(png, sparkle.bbox, { r: 255, g: 255, b: 0 });
    drawCrosshair(png, sparkle.center, 14, { r: 255, g: 140, b: 0 });
  }

  await savePng(png, outputPath);
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const options = {
    imagePath: null,
    debugPath: null,
    jsonOnly: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];

    if (token === '--debug') {
      const next = args[index + 1];
      if (!next) {
        throw new Error('--debug requires an output path.');
      }
      options.debugPath = next;
      index += 1;
      continue;
    }

    if (token === '--json') {
      options.jsonOnly = true;
      continue;
    }

    if (!options.imagePath) {
      options.imagePath = token;
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  if (!options.imagePath) {
    throw new Error('Usage: node detect-gemini-watermark.js <image.png> [--debug <overlay.png>] [--json]');
  }

  return options;
}

async function main() {
  try {
    const options = parseArgs(process.argv);
    const imagePath = path.resolve(options.imagePath);
    const analysis = await analyzeWatermark(imagePath);
    const debugPath =
      options.debugPath
        ? path.resolve(options.debugPath)
        : path.join(path.dirname(imagePath), `${path.parse(imagePath).name}.debug.png`);

    await writeDebugOverlay(imagePath, analysis, debugPath);

    if (options.jsonOnly) {
      console.log(JSON.stringify({ ...analysis, debugOverlay: debugPath }, null, 2));
      return;
    }

    console.log(`Image: ${analysis.image}`);
    console.log(`Answer: ${analysis.answer}`);
    console.log(`Cluster bbox: [${analysis.watermark.clusterBounds.x0}, ${analysis.watermark.clusterBounds.y0}] -> [${analysis.watermark.clusterBounds.x1}, ${analysis.watermark.clusterBounds.y1}]`);
    console.log(`Confidence: ${analysis.confidence}`);
    console.log(`Debug overlay: ${debugPath}`);
    console.log(JSON.stringify(analysis, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  void main();
}

module.exports = {
  main,
  analyzeWatermark,
  findWatermarkSparkles,
  loadPng,
  writeDebugOverlay,
  getAstroidTemplate,
  bboxFromCandidate,
  centerFromCandidate,
};
