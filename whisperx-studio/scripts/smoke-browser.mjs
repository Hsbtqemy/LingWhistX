#!/usr/bin/env node
/**
 * Smoke navigateur minimal (E2E léger) : bundle de prod + shell React monté.
 * Ne remplace pas un test Tauri desktop ; vérifie que le SPA se charge et que la nav Studio est présente.
 *
 * Prérequis : `npm run build` (dossier `dist/`).
 *
 * Usage :
 *   npm run smoke:browser
 *   SMOKE_URL=http://127.0.0.1:4173/ npm run smoke:browser   # preview déjà lancé ailleurs
 *
 * Variables :
 *   SMOKE_URL        — URL du preview (défaut : lance `vite preview` sur 127.0.0.1:4173)
 *   SMOKE_HEADLESS   — "0" pour voir le navigateur (défaut headless)
 *   PUPPETEER_*      — voir la doc Puppeteer (ex. binaire Chromium en CI exotique)
 */

import http from "node:http";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import puppeteer from "puppeteer";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, "..");

const DEFAULT_PREVIEW = "http://127.0.0.1:4173/";

function waitForHttpOk(url, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  const target = new URL(url);

  return new Promise((resolve, reject) => {
    const attempt = () => {
      if (Date.now() > deadline) {
        reject(new Error(`Timeout waiting for HTTP 200: ${url}`));
        return;
      }
      const req = http.request(
        {
          hostname: target.hostname,
          port: target.port || (target.protocol === "https:" ? 443 : 80),
          path: target.pathname + target.search,
          method: "GET",
          timeout: 5000,
        },
        (res) => {
          res.resume();
          if (res.statusCode >= 200 && res.statusCode < 400) {
            resolve();
          } else {
            setTimeout(attempt, 300);
          }
        },
      );
      req.on("error", () => setTimeout(attempt, 300));
      req.on("timeout", () => {
        req.destroy();
        setTimeout(attempt, 300);
      });
      req.end();
    };
    attempt();
  });
}

async function main() {
  const presetUrl = process.env.SMOKE_URL?.trim();
  let child = null;
  let browser = null;
  const url = presetUrl || DEFAULT_PREVIEW;

  try {
    if (!presetUrl) {
      child = spawn(
        "npm",
        ["run", "preview", "--", "--host", "127.0.0.1", "--port", "4173", "--strictPort"],
        {
          cwd: projectRoot,
          stdio: "inherit",
          shell: true,
        },
      );
      child.on("error", (err) => {
        console.error("smoke-browser: failed to spawn vite preview:", err);
        process.exit(1);
      });
      console.log("smoke-browser: waiting for preview at", url);
      await waitForHttpOk(url);
    }

    const headless = process.env.SMOKE_HEADLESS !== "0";

    browser = await puppeteer.launch({
      headless,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });
    // `load` évite les aléas de `networkidle` (WS / pollers) en CI.
    await page.goto(url, { waitUntil: "load", timeout: 60_000 });

    await page.waitForSelector('[data-testid="studio-app-root"]', { timeout: 30_000 });

    const workspaceTab = await page.$("#studio-tab-workspace");
    if (!workspaceTab) {
      throw new Error('Missing #studio-tab-workspace — nav Studio not rendered');
    }

    const helpBtn = await page.$(".studio-nav-help-btn");
    if (!helpBtn) {
      throw new Error("Missing .studio-nav-help-btn — top bar incomplete");
    }

    console.log("smoke-browser: OK (shell + onglet Studio + aide)");
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    if (child && !child.killed) {
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
      await new Promise((r) => setTimeout(r, 500));
      if (!child.killed) {
        try {
          child.kill("SIGKILL");
        } catch {
          /* ignore */
        }
      }
    }
  }
}

main().catch((err) => {
  console.error("smoke-browser:", err);
  process.exit(1);
});
