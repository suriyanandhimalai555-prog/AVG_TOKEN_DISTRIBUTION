import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const indexPath = path.join(root, "dist", "index.html");

if (!fs.existsSync(indexPath)) {
  console.error("verify-build: dist/index.html not found — run vite build first");
  process.exit(1);
}

const html = fs.readFileSync(indexPath, "utf8");

if (html.includes("/src/main.tsx") || html.includes("main.tsx")) {
  console.error(
    "verify-build: dist/index.html still references main.tsx.\n" +
      "Production must not deploy source index.html — run `npm run build` and deploy dist/ only."
  );
  process.exit(1);
}

if (!/\/assets\/index-[a-zA-Z0-9_-]+\.js/.test(html)) {
  console.error(
    "verify-build: dist/index.html missing hashed JS bundle under /assets/.\n" +
      "Build may have failed — check `npm run build` output."
  );
  process.exit(1);
}

console.log("verify-build: OK — dist/index.html references production assets");
