function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function draw(canvas, width, height, patches, background = 158, frameBorder = false) {
  if (!canvas || !width || !height) return;
  const context = canvas.getContext("2d"), image = context.createImageData(width, height);
  for (let index = 0; index < image.data.length; index += 4) { image.data[index] = background; image.data[index + 1] = background; image.data[index + 2] = background; image.data[index + 3] = 255; }
  patches.forEach((patch) => paint(image.data, width, height, patch, background));
  if (frameBorder) paintFrameBorder(image.data, width, height);
  context.putImageData(image, 0, 0);
}
function paintFrameBorder(data, width, height) {
  const thickness = Math.max(4, Math.round(width / 80));
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (x >= thickness && x < width - thickness && y >= thickness && y < height - thickness) continue;
      const index = (y * width + x) * 4;
      data[index] = 240; data[index + 1] = 68; data[index + 2] = 68; data[index + 3] = 255;
    }
  }
}
function paint(data, width, height, patch, background) {
  const scale = width / 480, sigma = patch.sigma * scale, radius = Math.ceil(sigma * 3), centerX = patch.x * scale, centerY = patch.y * scale;
  const theta = patch.angle * Math.PI / 180, cos = Math.cos(theta), sin = Math.sin(theta);
  for (let py = -radius; py <= radius; py += 1) { const y = Math.round(centerY + py); if (y < 0 || y >= height) continue;
    for (let px = -radius; px <= radius; px += 1) { const x = Math.round(centerX + px); if (x < 0 || x >= width) continue;
      const envelope = Math.exp(-(px * px + py * py) / (2 * sigma * sigma)); if (envelope < .002) continue;
      const rotatedX = px * cos + py * sin, wave = Math.cos(2 * Math.PI * (patch.frequency / scale) * rotatedX + patch.phase);
      const waveGray = clamp(background + background * patch.contrast * wave, 0, 255), value = Math.round(background + (waveGray - background) * envelope), index = (y * width + x) * 4;
      data[index] = value; data[index + 1] = value; data[index + 2] = value;
    }
  }
}
function vector(angle, distance) { const radians = angle * Math.PI / 180; return { x: Math.cos(radians) * distance, y: Math.sin(radians) * distance }; }
function basePatch(trial, x, y, contrast, phase) { return { x, y, sigma: trial.sigma, frequency: trial.frequency, angle: trial.angle, phase: phase == null ? trial.phase : phase, contrast }; }
function blank(canvas, width, height) { const context = canvas.getContext("2d"); context.fillStyle = "rgb(158,158,158)"; context.fillRect(0, 0, width, height); }
function temporal(canvas, width, height, trial, interval) {
  const center = 240, phase = trial.mode === "darker" ? trial.phase : trial.phase + interval * .35;
  if (trial.mode === "single") return draw(canvas, width, height, String(interval) === trial.correctAnswer ? [basePatch(trial, center, center, trial.contrast, phase)] : [], 158, true);
  if (trial.mode === "darker") return draw(canvas, width, height, [basePatch(trial, center, center, String(interval) === trial.correctAnswer ? trial.clearerContrast : trial.faintContrast, phase)], 158, true);
  const offset = vector(trial.layoutAngle, trial.spacing), patches = [basePatch(trial, center - offset.x, center - offset.y, trial.flankerContrast, phase), basePatch(trial, center + offset.x, center + offset.y, trial.flankerContrast, phase)];
  if (String(interval) === trial.correctAnswer) patches.splice(1, 0, basePatch(trial, center, center, trial.targetContrast, phase)); draw(canvas, width, height, patches, 158, true);
}
function shifted(canvas, width, height, trial) {
  const center = 240, offset = vector(trial.layoutAngle, trial.spacing), move = vector(trial.layoutAngle + 90, trial.offsetSigned);
  draw(canvas, width, height, [basePatch(trial, center - offset.x, center - offset.y, trial.contrast), basePatch(trial, center + move.x, center + move.y, trial.contrast), basePatch(trial, center + offset.x, center + offset.y, trial.contrast)], 158, true);
}
module.exports = { blank, temporal, shifted };
