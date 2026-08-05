'use strict';

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

if (typeof module !== 'undefined' && module.exports) module.exports = { adaptiveReconstructRegion };
