const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const source = path.join(projectRoot, "public");
const output = path.join(projectRoot, "dist");

// Only this generated directory may be removed. Never follow a redirected output.
if (path.dirname(output) !== projectRoot || path.basename(output) !== "dist") {
  throw new Error("Unexpected build output directory");
}
if (fs.existsSync(output) && fs.lstatSync(output).isSymbolicLink()) {
  throw new Error("Build output must not be a symbolic link");
}
fs.rmSync(output, { recursive: true, force: true });

// Server releases contain public/ only. xhs/ belongs to the separate mini-tool.
fs.cpSync(source, path.join(output, "public"), {
  recursive: true,
  filter(file) {
    if (path.relative(source, file).split(path.sep).some((part) => part.toLowerCase() === "xhs")) return false;
    if (fs.lstatSync(file).isSymbolicLink()) {
      throw new Error(`Refusing to publish symbolic link: ${file}`);
    }
    return true;
  },
});
console.log("Website build ready: dist/public (xhs excluded)");
