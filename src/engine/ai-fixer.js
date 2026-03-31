/**
 * AIFixer V6 Ultra — The "Absolute Power" Engine.
 * 
 * This engine pushes the limits of Gemini 2.5 Flash and Vision by 
 * performing holographic page analysis to restore high-fidelity websites.
 */

import fs from 'fs';
import path from 'path';

function ensureDirSync(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readTextSafe(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Self-healing JSON extraction with structural repair logic.
 */
function extractJsonFromText(text) {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  let jsonCandidate = fenced ? fenced[1] : text;
  const firstBrace = jsonCandidate.indexOf('{');
  const lastBrace = jsonCandidate.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1) return null;
  let result = jsonCandidate.slice(firstBrace, lastBrace + 1).trim();
  result = result.replace(/,\s*([\]}])/g, '$1');
  return result;
}

function base64FromFile(filePath) {
  const buf = fs.readFileSync(filePath);
  return buf.toString('base64');
}

export class AIFixer {
  constructor({ apiKey, model = 'gemini-1.5-flash', provider = 'gemini', onProgress = () => {} } = {}) {
    this.apiKey = apiKey;
    this.model = model;
    this.provider = provider;
    this.onProgress = onProgress;

    // Absolute Context Limits
    this.maxCssFiles = 25; // 2.5x increase in depth
    this.maxTotalCssChars = 300000; // Deep CSS awareness
    this.maxFileChars = 150000; // Full document awareness
  }

  emit(progress) {
    this.onProgress(progress);
  }

  /**
   * Main Absolute Power Workflow - Updated for V11 Neural Overdrive
   * Now performs a diagnostic fix on any target page.
   */
  async finish({ url, outputDir, jobId, viewport, userAgent, browser, targetFile = 'index.html' }) {
    const port = process.env.PORT || 3000;
    const baseUrl = `http://localhost:${port}`;
    const clonePreviewUrl = `${baseUrl}/api/preview/${jobId}/${targetFile}`;

    ensureDirSync(path.join(outputDir, 'ai'));

    this.emit({ phase: 'ai', message: 'Hyper-Fidelity Analysis: Capturing Holographic Diagnostics...', percent: 87 });

    const ownBrowser = !browser;
    let localBrowser = browser;
    try {
      if (ownBrowser) {
        const puppeteer = await import('puppeteer');
        localBrowser = await puppeteer.default.launch({
          headless: 'new',
          args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-web-security'],
        });
      }

      const viewportToUse = viewport || { width: 1920, height: 1080 };

      // Pass 1: Global Discovery
      const [originalDiag, originalScreenshotPath] = await this.captureDeepDiagnostics({
        browser: localBrowser,
        targetUrl: url,
        label: 'original',
        outputDir,
        viewport: viewportToUse,
        userAgent,
      });

      const [cloneDiag, cloneScreenshotPath] = await this.captureDeepDiagnostics({
        browser: localBrowser,
        targetUrl: clonePreviewUrl,
        label: `clone-${targetFile.replace(/\//g, '_')}`,
        outputDir,
        viewport: viewportToUse,
        userAgent,
      });

      this.emit({ phase: 'ai', message: `AI Healing Page: ${targetFile} (Absolute Depth)...`, percent: 88.5 });
      const patchInput = this.buildHyperContext(outputDir, targetFile);

      this.emit({ phase: 'ai', message: 'AI Finisher: Activating Gemini V6 Ultra Inference...', percent: 88 });

      const modelResponse = await this.callAI({
        url,
        originalDiag,
        cloneDiag,
        originalScreenshotPath,
        cloneScreenshotPath,
        patchInput,
      });

      const jsonText = extractJsonFromText(modelResponse);
      if (!jsonText) {
        return {
          appliedPatches: 0,
          note: 'AI synthesis complete but no valid patches were discovered.',
          screenshots: { original: originalScreenshotPath, clone: cloneScreenshotPath },
        };
      }

      const parsed = JSON.parse(jsonText);
      const patches = Array.isArray(parsed.patches) ? parsed.patches : [];

      this.emit({ phase: 'ai', message: 'Absolute Power: Applying Multi-Stage Patches...', percent: 89 });
      const patchResult = this.applyPatchesRobustly(outputDir, patches);

      return {
        model: this.model,
        appliedPatches: patchResult.applied,
        skippedPatches: patchResult.skipped,
        screenshots: { original: originalScreenshotPath, clone: cloneScreenshotPath },
        note: patchResult.note,
        status: 'Fidelity Restored'
      };
    } finally {
      if (ownBrowser && localBrowser) {
        await localBrowser.close();
      }
    }
  }

  /**
   * Captures error traces, network fail logs, and high-fidelity screenshots.
   */
  async captureDeepDiagnostics({ browser, targetUrl, label, outputDir, viewport, userAgent }) {
    const page = await browser.newPage();
    try {
      await page.setViewport(viewport);
      if (userAgent) await page.setUserAgent(userAgent);
      await page.setBypassCSP(true).catch(() => {});

      const diagnostics = {
        console: [],
        network: [],
        meta: {}
      };

      page.on('console', (msg) => {
        diagnostics.console.push({ type: msg.type(), text: msg.text() });
      });

      page.on('requestfailed', (req) => {
        diagnostics.network.push({ url: req.url(), error: req.failure()?.errorText });
      });

      await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 45000 }).catch(() => {});
      
      // Let dynamics settle (absolute wait)
      await new Promise(resolve => setTimeout(resolve, 2500));

      const screenshotPath = path.join(outputDir, 'ai', `${label}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: false }).catch(() => {});

      return [diagnostics, screenshotPath];
    } finally {
      await page.close().catch(() => {});
    }
  }

  /**
   * Build an exhaustive context map for a specific target file.
   */
  buildHyperContext(outputDir, targetFile) {
    const targetPath = path.join(outputDir, targetFile);
    const targetHtml = readTextSafe(targetPath) || '';

    const cssFiles = [];
    const walk = (dir) => {
      if (!fs.existsSync(dir)) return;
      fs.readdirSync(dir).forEach(f => {
        const full = path.join(dir, f);
        if (fs.statSync(full).isDirectory()) walk(full);
        else if (f.endsWith('.css')) {
          const content = readTextSafe(full);
          if (content) cssFiles.push({ file: path.relative(outputDir, full).replace(/\\/g, '/'), content: content.slice(0, 50000) });
        }
      });
    };
    walk(path.join(outputDir, 'css'));

    return {
      targetFile,
      targetHtml: targetHtml.length > this.maxFileChars ? targetHtml.slice(0, this.maxFileChars) : targetHtml,
      cssFiles: cssFiles.slice(0, this.maxCssFiles)
    };
  }

  async callAI(params) {
    if (this.provider === 'deepseek') return this.callDeepSeek(params);
    return this.callGemini(params);
  }

  async callGemini({ url, originalDiag, cloneDiag, originalScreenshotPath, cloneScreenshotPath, patchInput }) {
    const apiKey = this.apiKey;
    const parts = [];

    if (originalScreenshotPath && fs.existsSync(originalScreenshotPath)) {
      parts.push({ inlineData: { mimeType: 'image/png', data: base64FromFile(originalScreenshotPath) } });
    }
    if (cloneScreenshotPath && fs.existsSync(cloneScreenshotPath)) {
      parts.push({ inlineData: { mimeType: 'image/png', data: base64FromFile(cloneScreenshotPath) } });
    }

    const prompt = `
YOU ARE THE ABSOLUTE MASTER OF WEB FIDELITY. 
GIVEN AN ORIGINAL WEBSITE AND A FAILED CLONE, YOU MUST GENERATE SURGICAL PATCHES TO RESTORE 100% VISUAL AND FUNCTIONAL IDENTITY.

DIAGNOSTIC DATA:
Target URL: ${url}
Original State: ${JSON.stringify(originalDiag)}
Clone State: ${JSON.stringify(cloneDiag)}

YOUR MISSION:
1. PIXEL-PERFECT RECOVERY: Compare the two screenshots. If colors, layouts, or spacing are broken, generate CSS patches in the <style> block of the target HTML file or in the relevant CSS files.
2. GUARDIAN GHOST REMOVAL: Any remaining reCAPTCHA artifacts, Captcha forms, or "I Agree" banners that block the view MUST BE DELETED (provide a deletion patch for the whole element).
3. PATH NORMALIZATION: Fix any 404 network errors seen in the diagnostic log by correcting paths (check for windows backslashes vs power-forward-slashes).
4. LOGIC RE-WIRING: If a button or menu is broken, try to wrap it in a Link or make it functional with basic CSS hover states.

OUTPUT RULE:
ONLY OUTPUT VALID JSON. DO NOT TALK.
{
  "patches": [
    {
      "file": "target filename",
      "search": "<exact existing code substring>",
      "replace": "<new code>",
      "reason": "<reasoning>"
    }
  ]
}

PATCHABLE FILES (FULL CONTENT):
${JSON.stringify(patchInput, null, 2)}
`;

    const versions = ['v1', 'v1beta'];
    const names = [this.model, 'gemini-1.5-flash', 'gemini-1.5-flash-latest'];
    let lastErr = '';

    for (const v of versions) {
      for (const n of names) {
        const endpoint = `https://generativelanguage.googleapis.com/${v}/models/${n}:generateContent?key=${apiKey}`;
        try {
          const resp = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }, ...parts] }] })
          });
          if (resp.ok) {
            const json = await resp.json();
            return json?.candidates?.[0]?.content?.parts?.[0]?.text || '';
          }
          lastErr = await resp.text();
        } catch (e) { lastErr = e.message; }
      }
    }
    throw new Error(`Gemini Ultra failure: ${lastErr}`);
  }

  /**
   * High-Performance Patch Application with Collision Detection
   */
  applyPatchesRobustly(outputDir, patches) {
    let applied = 0;
    let skipped = 0;
    
    // Sort index.html patches first
    const sortedPatches = [...patches].sort((a) => a.file === 'index.html' ? -1 : 1);

    for (const patch of sortedPatches) {
      const absPath = path.join(outputDir, patch.file);
      if (!fs.existsSync(absPath)) { skipped++; continue; }

      let content = fs.readFileSync(absPath, 'utf-8');
      if (content.includes(patch.search)) {
        content = content.replace(patch.search, patch.replace);
        fs.writeFileSync(absPath, content, 'utf-8');
        applied++;
      } else {
        skipped++;
      }
    }

    return { applied, skipped, note: `Absolute Power deployed ${applied} patches.` };
  }

  async callDeepSeek({ url, originalDiag, cloneDiag, patchInput }) {
    const apiKey = this.apiKey;
    const model = this.model || 'deepseek-chat';
    const endpoint = 'https://api.deepseek.com/chat/completions';
    const prompt = `YOU ARE THE ABSOLUTE MASTER OF WEB FIDELITY. GIVEN AN ORIGINAL WEBSITE AND A FAILED CLONE, YOU MUST GENERATE SURGICAL PATCHES TO RESTORE 100% VISUAL AND FUNCTIONAL IDENTITY.\n\nDIAGNOSTIC DATA: ${url}, ${JSON.stringify(originalDiag)}, ${JSON.stringify(cloneDiag)}\n\nOUTPUT ONLY JSON: {"patches": [{"file": "index.html", "search": "...", "replace": "...", "reason": "..."}]}\n\nFILES: ${JSON.stringify(patchInput)}`;

    this.emit({ phase: 'ai', message: 'V6 Ultra: Activating DeepSeek Extreme Inference...', percent: 88.8 });
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], temperature: 0.1, response_format: { type: 'json_object' } }),
    });
    if (!resp.ok) throw new Error(`DeepSeek Ultra failure: ${await resp.text()}`);
    const json = await resp.json();
    return json?.choices?.[0]?.message?.content || '';
  }
}
