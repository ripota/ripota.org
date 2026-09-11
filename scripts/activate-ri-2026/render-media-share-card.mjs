#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

const root = new URL("../../", import.meta.url);
const photo = await readFile(new URL("public/assets/rhode-island-coast-hero.jpg", root));
const logo = await readFile(new URL("public/assets/logos/ri-pota-coastal-signal.svg", root));
const source = await readFile(new URL(import.meta.url));
const fingerprint = createHash("sha256").update(source).update(photo).update(logo).digest("hex");
const imagePath = new URL("public/assets/activate-ri-2026-media-share-card.png", root);
const metadataPath = new URL("public/assets/activate-ri-2026-media-share-card.meta.json", root);

// Compose the card from repository-owned artwork. User uploads remain governed
// by the gallery's live visibility checks instead of being copied into Git.
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1, colorScheme: "light" });
  await page.setContent(`<!doctype html><html lang="en"><head><meta charset="utf-8">
    <style>
      * { box-sizing: border-box; }
      body { margin: 0; width: 1200px; height: 630px; overflow: hidden; background: #18312f; color: #fffaf0; font-family: Arial, sans-serif; }
      .glow { position: absolute; width: 710px; height: 710px; border-radius: 50%; left: 540px; top: -40px; background: #264643; }
      .brand { position: absolute; left: 58px; top: 40px; display: flex; align-items: center; gap: 15px; font-size: 23px; font-weight: 700; }
      .brand img { width: 58px; height: 58px; }
      .copy { position: absolute; left: 62px; top: 155px; width: 550px; }
      .event { margin: 0 0 22px; color: #efc992; font-size: 19px; font-weight: 700; letter-spacing: 3px; }
      h1 { margin: 0; font-family: Georgia, serif; font-size: 91px; line-height: .98; letter-spacing: -3px; }
      .description { margin: 25px 0 0; color: #dce7df; font-size: 26px; line-height: 1.4; }
      .footer { position: absolute; left: 62px; bottom: 44px; display: flex; align-items: center; gap: 24px; }
      .cta { background: #efc992; color: #18312f; border-radius: 7px; padding: 15px 20px; font-size: 20px; font-weight: 700; }
      .url { font-size: 20px; color: #dce7df; }
      .back { position: absolute; top: 84px; right: 44px; width: 445px; height: 480px; border: 2px solid #a8bbb1; border-radius: 20px; transform: rotate(4deg); }
      .photo { position: absolute; top: 61px; right: 72px; width: 452px; height: 494px; margin: 0; padding: 13px; border-radius: 18px; background: #f7f4ed; transform: rotate(-3deg); box-shadow: 0 18px 32px #0b191d66; }
      .photo > img { display: block; width: 100%; height: 398px; object-fit: cover; object-position: 48% center; border-radius: 9px; }
      figcaption { padding: 23px 7px; font-size: 22px; font-weight: 700; color: #18312f; }
      .formats { position: absolute; right: 10px; bottom: 35px; display: flex; align-items: center; gap: 12px; border: 1px solid #e2ebdf; border-radius: 30px; padding: 13px 18px; background: #fffaf0; color: #18312f; transform: rotate(3deg); box-shadow: 0 5px 15px #0b191d33; }
      .formats svg { width: 26px; height: 26px; }
    </style></head><body>
      <div class="glow"></div>
      <div class="brand"><img alt="RI POTA" src="data:image/svg+xml;base64,${logo.toString("base64")}">Rhode Island POTA</div>
      <div class="copy"><p class="event">ACTIVATE ALL RI 2026</p><h1>Photos &amp;<br>videos</h1>
        <p class="description">Shared by the activators<br>who were there.</p></div>
      <div class="footer"><span class="cta">Explore the gallery ↗</span><span class="url">ripota.org</span></div>
      <div class="back"></div>
      <figure class="photo"><img alt="Rhode Island shoreline" src="data:image/jpeg;base64,${photo.toString("base64")}">
        <figcaption>From the field.</figcaption>
        <div class="formats" aria-label="Photos and videos">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 5-5 4 4 3-3 6 5"/></svg>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="m10 8 6 4-6 4z" fill="currentColor" stroke="none"/></svg>
        </div>
      </figure>
    </body></html>`, { waitUntil: "load" });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map((image) => image.decode()));
  });
  const temporaryPath = `${imagePath.pathname}.tmp.png`;
  await page.screenshot({ path: temporaryPath, animations: "disabled" });
  await rename(temporaryPath, imagePath);
  await writeFile(metadataPath, `${JSON.stringify({ fingerprint, width: 1200, height: 630 }, null, 2)}\n`);
  console.log("Regenerated the Activate RI media gallery share card (1200×630).");
} finally {
  await browser.close();
}
