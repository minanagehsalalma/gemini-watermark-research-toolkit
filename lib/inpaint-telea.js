// Adapted from antimatter15/inpaint.js (commit e77a530) for typed-array use.
// Implements a fast-marching Telea-style masked fill.

class MinHeap {
  constructor() {
    this.items = [];
  }

  get length() {
    return this.items.length;
  }

  push(item) {
    const items = this.items;
    items.push(item);
    let index = items.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (items[parent][0] <= item[0]) break;
      items[index] = items[parent];
      index = parent;
    }
    items[index] = item;
  }

  pop() {
    const items = this.items;
    const first = items[0];
    const last = items.pop();
    if (items.length === 0) return first;
    let index = 0;
    while (true) {
      let child = (index << 1) + 1;
      if (child >= items.length) break;
      if (child + 1 < items.length && items[child + 1][0] < items[child][0]) child += 1;
      if (items[child][0] >= last[0]) break;
      items[index] = items[child];
      index = child;
    }
    items[index] = last;
    return first;
  }
}

function inpaintTelea(width, height, image, mask, radius = 5) {
  const KNOWN = 0;
  const BAND = 1;
  const UNKNOWN = 2;
  const LARGE = 1e6;
  const SMALL = 1e-6;
  const size = width * height;
  const state = new Uint8Array(size);
  const distance = new Float32Array(size);
  const heap = new MinHeap();
  const fourNeighbors = [-width, -1, width, 1];

  for (let index = 0; index < size; index += 1) {
    if (mask[index]) {
      state[index] = UNKNOWN;
      distance[index] = LARGE;
    }
  }

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      if (state[index] !== UNKNOWN) continue;
      if (fourNeighbors.some((offset) => state[index + offset] === KNOWN)) {
        state[index] = BAND;
        distance[index] = 0;
        heap.push([0, index]);
      }
    }
  }

  const circle = [];
  for (let dy = -radius; dy <= radius; dy += 1) {
    const span = Math.floor(Math.sqrt(radius * radius - dy * dy));
    for (let dx = -span; dx <= span; dx += 1) circle.push([dx, dy]);
  }

  function gradient(array, index, step) {
    const forwardKnown = state[index + step] !== UNKNOWN;
    const backwardKnown = state[index - step] !== UNKNOWN;
    if (forwardKnown && backwardKnown) return (array[index + step] - array[index - step]) * 0.5;
    if (forwardKnown) return array[index + step] - array[index];
    if (backwardKnown) return array[index] - array[index - step];
    return 0;
  }

  function solveEikonal(first, second) {
    const firstKnown = state[first] === KNOWN;
    const secondKnown = state[second] === KNOWN;
    if (firstKnown && secondKnown) {
      const difference = distance[first] - distance[second];
      const root = Math.sqrt(Math.max(0, 2 - difference * difference));
      let result = (distance[first] + distance[second] - root) * 0.5;
      if (result >= distance[first] && result >= distance[second]) return result;
      result += root;
      return result >= distance[first] && result >= distance[second] ? result : LARGE;
    }
    if (firstKnown) return 1 + distance[first];
    if (secondKnown) return 1 + distance[second];
    return LARGE;
  }

  function fillPoint(index) {
    const centerX = index % width;
    const centerY = Math.floor(index / width);
    const normalX = gradient(distance, index, 1);
    const normalY = gradient(distance, index, width);
    let weightedValue = 0;
    let totalWeight = 0;

    for (const [dx, dy] of circle) {
      if (dx === 0 && dy === 0) continue;
      const x = centerX + dx;
      const y = centerY + dy;
      if (x <= 0 || y <= 0 || x >= width - 1 || y >= height - 1) continue;
      const neighbor = y * width + x;
      if (state[neighbor] !== KNOWN) continue;
      const squaredDistance = dx * dx + dy * dy;
      const spatialWeight = 1 / (squaredDistance * Math.sqrt(squaredDistance));
      const levelWeight = 1 / (1 + Math.abs(distance[neighbor] - distance[index]));
      const directionWeight = Math.abs(dx * normalX + dy * normalY) + SMALL;
      const weight = spatialWeight * levelWeight * directionWeight;
      weightedValue += weight * image[neighbor];
      totalWeight += weight;
    }

    if (totalWeight > 0) image[index] = weightedValue / totalWeight;
  }

  while (heap.length > 0) {
    const [queuedDistance, index] = heap.pop();
    if (state[index] === KNOWN || queuedDistance > distance[index]) continue;
    state[index] = KNOWN;
    const x = index % width;
    const y = Math.floor(index / width);
    if (x <= 1 || y <= 1 || x >= width - 2 || y >= height - 2) continue;

    for (const offset of fourNeighbors) {
      const neighbor = index + offset;
      if (state[neighbor] === KNOWN) continue;
      const nextDistance = Math.min(
        solveEikonal(neighbor - width, neighbor - 1),
        solveEikonal(neighbor + width, neighbor - 1),
        solveEikonal(neighbor - width, neighbor + 1),
        solveEikonal(neighbor + width, neighbor + 1),
      );
      if (nextDistance >= distance[neighbor]) continue;
      distance[neighbor] = nextDistance;
      if (state[neighbor] === UNKNOWN) {
        state[neighbor] = BAND;
        fillPoint(neighbor);
      }
      heap.push([nextDistance, neighbor]);
    }
  }

  return image;
}

module.exports = { inpaintTelea };
