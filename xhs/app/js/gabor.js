(function () {
"use strict";
const patchCache = new Map();

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function cacheKey(options) {
  return [
    options.sigma,
    options.frequency.toFixed(4),
    options.angle,
    options.phase.toFixed(2),
    options.contrast.toFixed(4),
    options.background,
  ].join("|");
}

function createGaborPatch(options) {
  const key = cacheKey(options);
  if (patchCache.has(key)) return patchCache.get(key);

  const radius = Math.ceil(options.sigma * 3);
  const size = radius * 2;
  const patch = document.createElement("canvas");
  patch.width = size;
  patch.height = size;
  const context = patch.getContext("2d", { willReadFrequently: true });
  const image = context.createImageData(size, size);
  const theta = options.angle * Math.PI / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const background = options.background;

  for (let py = -radius; py < radius; py += 1) {
    for (let px = -radius; px < radius; px += 1) {
      const rotatedX = px * cos + py * sin;
      const envelope = Math.exp(-(px * px + py * py) / (2 * options.sigma * options.sigma));
      const wave = Math.cos(2 * Math.PI * options.frequency * rotatedX + options.phase);
      const waveGray = Math.round(background + background * options.contrast * wave);
      const gray = clamp(waveGray, 0, 255);
      const index = ((py + radius) * size + (px + radius)) * 4;
      image.data[index] = gray;
      image.data[index + 1] = gray;
      image.data[index + 2] = gray;
      image.data[index + 3] = Math.round(255 * clamp(envelope, 0, 1));
    }
  }

  context.putImageData(image, 0, 0);
  patchCache.set(key, patch);
  if (patchCache.size > 180) patchCache.delete(patchCache.keys().next().value);
  return patch;
}

function clearCanvas(canvas, background = 158) {
  const context = canvas.getContext("2d");
  context.save();
  context.globalCompositeOperation = "source-over";
  context.fillStyle = `rgb(${background}, ${background}, ${background})`;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.restore();
}

function drawGabor(canvas, x, y, options) {
  const context = canvas.getContext("2d");
  const patch = createGaborPatch(options);
  context.drawImage(patch, x - patch.width / 2, y - patch.height / 2);
}

function layoutVector(layoutAngle, distance) {
  const radians = layoutAngle * Math.PI / 180;
  return { x: Math.cos(radians) * distance, y: Math.sin(radians) * distance };
}

function drawSingle(canvas, stimulus) {
  clearCanvas(canvas, stimulus.background);
  if (!stimulus.visible) return;
  drawGabor(canvas, canvas.width / 2, canvas.height / 2, {
    sigma: stimulus.sigma,
    frequency: stimulus.frequency,
    angle: stimulus.angle,
    phase: stimulus.phase,
    contrast: stimulus.contrast,
    background: stimulus.background,
  });
}

function drawTriple(canvas, stimulus) {
  clearCanvas(canvas, stimulus.background);
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const vector = layoutVector(stimulus.layoutAngle, stimulus.spacing);
  const shared = {
    sigma: stimulus.sigma,
    frequency: stimulus.frequency,
    angle: stimulus.angle,
    phase: stimulus.phase,
    background: stimulus.background,
  };

  drawGabor(canvas, cx - vector.x, cy - vector.y, Object.assign({}, shared, { contrast: stimulus.flankerContrast }));
  if (stimulus.showTarget) drawGabor(canvas, cx, cy, Object.assign({}, shared, { contrast: stimulus.targetContrast }));
  drawGabor(canvas, cx + vector.x, cy + vector.y, Object.assign({}, shared, { contrast: stimulus.flankerContrast }));
}

function drawShifted(canvas, stimulus) {
  clearCanvas(canvas, stimulus.background);
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const vector = layoutVector(stimulus.layoutAngle, stimulus.spacing);
  const perpendicular = layoutVector(stimulus.layoutAngle + 90, stimulus.offsetSigned);
  const shared = {
    sigma: stimulus.sigma,
    frequency: stimulus.frequency,
    angle: stimulus.angle,
    phase: stimulus.phase,
    contrast: stimulus.contrast,
    background: stimulus.background,
  };

  drawGabor(canvas, cx - vector.x, cy - vector.y, shared);
  drawGabor(canvas, cx + perpendicular.x, cy + perpendicular.y, shared);
  drawGabor(canvas, cx + vector.x, cy + vector.y, shared);
}

function drawBlank(canvas, background = 158) {
  clearCanvas(canvas, background);
}

window.ToolGabor = { drawBlank, drawSingle, drawTriple, drawShifted };
})();
