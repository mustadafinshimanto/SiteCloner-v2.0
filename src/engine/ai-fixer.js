/**
 * AIFixer V12 — The Robust Fidelity Engine.
 * 
 * This engine focuses on surgical repairs with high reliability and 
 * lower complexity to ensure zero-error cloning.
 */

import fs from 'fs';
import path from 'path';
import axios from 'axios';

function ensureDirSync(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function safeNewPage(browser, retries = 2) {
  for (let i = 0; i < retries; i++) {
    try {
      return await browser.newPage();
    } catch (err) {
      if (err.message.includes('Session with given id not found') && i < retries - 1) {
        console.warn(`[system] Neural Session Lost (AIFixer). Attempting reconnection (${i + 1}/${retries})...`);
        await delay(2000);
        continue;
      }
      throw err;
    }
  }
}

function readTextSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

function base64FromFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath).toString('base64');
  } catch {
    return null;
  }
}

/**
 * Self-healing JSON extraction with structural repair logic.
 */
function extractJsonFromText(text) {
  if (!text) return null;
  // Try to find Markdown JSON block first
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  let jsonCandidate = fenced ? fenced[1] : text;
  
  const firstBrace = jsonCandidate.indexOf('{');
  const lastBrace = jsonCandidate.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1) return null;
  
  let result = jsonCandidate.slice(firstBrace, lastBrace + 1).trim();
  // Simple trailing comma removal for some objects/arrays
  result = result.replace(/,\s*([\]}])/g, '$1');
  return result;
}

export class AIFixer {
  constructor({ apiKey, model = 'gemini-1.5-flash', onProgress = () => {} } = {}) {
    this.apiKey = apiKey;
    this.model = model;
    this.onProgress = onProgress;

    // Balanced Context Limits for High Reliability
    this.maxCssFiles = 10; 
    this.maxTotalCssChars = 100000; 
    this.maxFileChars = 100000; 
  }

  emit(progress) {
    this.onProgress(progress);
  }

  /**
   * Main Healing Workflow (V12 Robust)
   */
  async finish({ url, outputDir, jobId, viewport, userAgent, browser, targetFile = 'index.html' }) {
    const port = process.env.PORT || 3000;
    const baseUrl = `http://localhost:${port}`;
    // Normalize targetFile to avoid path issues
    const normalizedTargetFile = targetFile.startsWith('/') ? targetFile.slice(1) : targetFile;
    const clonePreviewUrl = `${baseUrl}/api/preview/${jobId}/${normalizedTargetFile}`;

    ensureDirSync(path.join(outputDir, 'ai'));

    this.emit({ phase: 'ai', message: 'Analyzing Fidelity: Capturing System Diagnostics...', percent: 87 });

    const ownBrowser = !browser;
    let localBrowser = browser;
    try {
      if (ownBrowser) {
        const puppeteer = await import('puppeteer');
        localBrowser = await puppeteer.default.launch({
          headless: true,
          args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-web-security'],
        });
      }

      const viewportToUse = viewport || { width: 1920, height: 1080 };

      // Pass 1: Capture Diagnostics (Sequential for Stability)
      const labelPrefix = normalizedTargetFile.replace(/[/\\]/g, '_');
      
      const [originalDiag, originalScreenshotPath] = await this.captureDeepDiagnostics({
        browser: localBrowser,
        targetUrl: url,
        label: `original-${labelPrefix}`,
        outputDir,
        viewport: viewportToUse,
        userAgent,
      });

      // Brief pause to allow the local server to breathe if needed
      await delay(500);

      const [cloneDiag, cloneScreenshotPath] = await this.captureDeepDiagnostics({
        browser: localBrowser,
        targetUrl: clonePreviewUrl,
        label: `clone-${labelPrefix}`,
        outputDir,
        viewport: viewportToUse,
        userAgent,
      });

      this.emit({ phase: 'ai', message: `AI Healing Page: ${normalizedTargetFile}...`, percent: 88.5 });
      const patchInput = this.buildHyperContext(outputDir, normalizedTargetFile);

      this.emit({ phase: 'ai', message: 'Activating AI Engine...', percent: 88 });

      let modelResponse;
      try {
        modelResponse = await this.callAI({
          url,
          originalDiag,
          cloneDiag,
          originalScreenshotPath,
          cloneScreenshotPath,
          patchInput,
        });
      } catch (err) {
        console.error(`[ai] Neural Bypass Error Detail: ${err.message}`);
        if (err.response) console.error(`[ai] Response Status: ${err.response.status}, Data:`, JSON.stringify(err.response.data).slice(0, 500));
        this.emit({ 
          phase: 'ai', 
          message: `Neural Bypass Activated. Proceeding with static fidelity.`, 
          percent: 90 
        });
        return {
          appliedPatches: 0,
          note: `AI Healing bypassed: ${err.message}`,
          screenshots: { original: originalScreenshotPath, clone: cloneScreenshotPath },
        };
      }

      const jsonText = extractJsonFromText(modelResponse);
      if (!jsonText) {
        return {
          appliedPatches: 0,
          note: 'AI analysis completed without patch generation.',
          screenshots: { original: originalScreenshotPath, clone: cloneScreenshotPath },
        };
      }

      try {
        const parsed = JSON.parse(jsonText);
        const patches = Array.isArray(parsed.patches) ? parsed.patches : [];

        this.emit({ phase: 'ai', message: 'Applying Surgical Patches...', percent: 89 });
        const patchResult = this.applyPatchesRobustly(outputDir, patches);

        return {
          model: this.model,
          appliedPatches: patchResult.applied,
          skippedPatches: patchResult.skipped,
          screenshots: { original: originalScreenshotPath, clone: cloneScreenshotPath },
          note: patchResult.note,
          status: 'Fidelity Restored'
        };
      } catch (parseErr) {
        console.error(`[ai] JSON Parse Error:`, parseErr.message, jsonText);
        return {
          appliedPatches: 0,
          note: 'AI generated invalid patch data.',
          screenshots: { original: originalScreenshotPath, clone: cloneScreenshotPath },
        };
      }
    } finally {
      if (ownBrowser && localBrowser) {
        await localBrowser.close().catch(() => {});
      }
    }
  }

  /**
   * Captures error traces and screenshots with high stability.
   */
  async captureDeepDiagnostics({ browser, targetUrl, label, outputDir, viewport, userAgent }) {
    const page = await safeNewPage(browser);
    const screenshotPath = path.join(outputDir, 'ai', `${label}.png`);
    const diagnostics = { console: [], network: [] };

    try {
      await page.setViewport(viewport);
      if (userAgent) await page.setUserAgent(userAgent);
      await page.setBypassCSP(true).catch(() => {});

      page.on('console', (msg) => {
        diagnostics.console.push({ type: msg.type(), text: msg.text().slice(0, 500) });
      });

      page.on('requestfailed', (req) => {
        diagnostics.network.push({ url: req.url().slice(0, 500), error: req.failure()?.errorText });
      });

      // V2.19: Use domcontentloaded for SPA compatibility, then manually wait for rendering
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(e => {
        console.warn(`[ai] Diagnostic navigation warning for ${targetUrl}: ${e.message}`);
      });
      
      // Wait for SPA content to hydrate and render
      await delay(3000);
      
      // Scroll to trigger lazy-loaded content
      await page.evaluate(async () => {
        window.scrollTo(0, document.body.scrollHeight / 2);
        await new Promise(r => setTimeout(r, 500));
        window.scrollTo(0, 0);
      }).catch(() => {});
      
      // Final render buffer
      await delay(2000);

      await page.screenshot({ path: screenshotPath, fullPage: false }).catch(() => {
        console.warn(`[ai] Could not capture screenshot for ${label}`);
      });

      return [diagnostics, screenshotPath];
    } catch (err) {
      console.error(`[ai] Diagnostic capture error for ${label}:`, err.message);
      return [diagnostics, screenshotPath];
    } finally {
      await page.close().catch(() => {});
    }
  }

  /**
   * Build a concise context map for the target page.
   */
  buildHyperContext(outputDir, targetFile) {
    const targetPath = path.join(outputDir, targetFile);
    const targetHtml = readTextSafe(targetPath) || '';

    const cssFiles = [];
    const cssDir = path.join(outputDir, 'css');
    
    if (fs.existsSync(cssDir)) {
      const files = fs.readdirSync(cssDir);
      for (const f of files) {
        if (cssFiles.length >= this.maxCssFiles) break;
        if (f.endsWith('.css')) {
          const content = readTextSafe(path.join(cssDir, f));
          if (content) {
            cssFiles.push({ 
              file: `css/${f}`, 
              content: content.slice(0, 20000) // Truncate per file for context efficiency
            });
          }
        }
      }
    }

    return {
      targetFile,
      targetHtml: targetHtml.length > this.maxFileChars ? targetHtml.slice(0, this.maxFileChars) : targetHtml,
      cssFiles: cssFiles
    };
  }

  async callAI(params) {
    // Add simple retry logic for network stability
    let lastErr;
    for (let i = 0; i < 2; i++) {
        try {
            return await this.callGemini(params);
        } catch (e) {
            lastErr = e;
            if (i === 0) await delay(2000);
        }
    }
    throw lastErr;
  }

  async callGemini({ url, originalDiag, cloneDiag, originalScreenshotPath, cloneScreenshotPath, patchInput }) {
    const apiKey = this.apiKey;
    const parts = [];

    if (originalScreenshotPath && fs.existsSync(originalScreenshotPath)) {
      const base64 = base64FromFile(originalScreenshotPath);
      if (base64) parts.push({ inlineData: { mimeType: 'image/png', data: base64 } });
    }
    if (cloneScreenshotPath && fs.existsSync(cloneScreenshotPath)) {
      const base64 = base64FromFile(cloneScreenshotPath);
      if (base64) parts.push({ inlineData: { mimeType: 'image/png', data: base64 } });
    }

    const prompt = `
YOU ARE A WEB FIDELITY EXPERT. COMPARE THE ORIGINAL SITE AND THE CLONED VERSION.
IDENTIFY AND FIX LAYOUT BREAKS, MISSING STYLES, OR BROKEN ELEMENTS.

DIAGNOSTIC DATA:
Target URL: ${url}
Original Diagnostics: ${JSON.stringify(originalDiag).slice(0, 2000)}
Clone Diagnostics: ${JSON.stringify(cloneDiag).slice(0, 2000)}

YOUR MISSION:
1. Compare screenshots. If layout/colors differ, provide CSS fixes.
2. Remove any leftovers from Captchas or cookie banners that block content.
3. Fix relative path errors (404s) in HTML attributes.

OUTPUT FORMAT (JSON ONLY):
{
  "patches": [
    {
      "file": "filename",
      "search": "exact string to find",
      "replace": "new content",
      "reason": "explanation"
    }
  ]
}

FILES AVAILABLE TO PATCH:
${JSON.stringify(patchInput, null, 2)}
`;

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${apiKey}`;
    
    try {
      const resp = await axios.post(endpoint, {
        contents: [{ role: 'user', parts: [{ text: prompt }, ...parts] }]
      }, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 60000 // 60s timeout for large visionary analysis
      });
      
      return resp.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    } catch (err) {
      const msg = err.response?.data?.error?.message || err.message;
      throw new Error(`Gemini API Error: ${msg}`);
    }
  }

  applyPatchesRobustly(outputDir, patches) {
    let applied = 0;
    let skipped = 0;

    for (const patch of patches) {
      if (!patch.file || !patch.search) { skipped++; continue; }
      const absPath = path.join(outputDir, patch.file);
      if (!fs.existsSync(absPath)) { skipped++; continue; }

      try {
        let content = fs.readFileSync(absPath, 'utf-8');
        if (content.includes(patch.search)) {
          // Use replaceAll if possible or just replace the first instance
          content = content.replace(patch.search, patch.replace);
          fs.writeFileSync(absPath, content, 'utf-8');
          applied++;
        } else {
          // Minimal fuzzy check: handle whitespace normalization? 
          // For now, stick to exact to avoid accidental breakage.
          skipped++;
        }
      } catch (err) {
        console.error(`[ai] Failed to apply patch to ${patch.file}:`, err.message);
        skipped++;
      }
    }

    return { applied, skipped, note: `AI Healing applied ${applied} patches.` };
  }
}
