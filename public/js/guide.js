import { drawSingle, drawTriple, drawShifted } from "./gabor.js";

// Fixed examples use the same renderer as training, with clearer contrast for illustration.
export function drawGuideExamples() {
  const common = { background: 158, sigma: 23, frequency: 0.047, angle: 90, phase: 0 };
  document.querySelectorAll("canvas[data-guide-example]").forEach((canvas) => {
    const example = canvas.dataset.guideExample;
    if (example.startsWith("single") || example.startsWith("darker")) {
      drawSingle(canvas, {
        ...common,
        visible: example !== "single-blank",
        contrast: example === "darker-faint" ? 0.10 : 0.34,
      });
    } else if (example.startsWith("triple")) {
      drawTriple(canvas, {
        ...common, layoutAngle: 0, spacing: 100, flankerContrast: 0.46,
        targetContrast: 0.24, showTarget: example === "triple-target",
      });
    } else {
      const vertical = example === "left" || example === "right";
      drawShifted(canvas, {
        ...common, angle: vertical ? 0 : 90, layoutAngle: vertical ? 90 : 0,
        spacing: 90, contrast: 0.34,
        offsetSigned: example === "up" || example === "right" ? -22 : 22,
      });
    }
  });
}
