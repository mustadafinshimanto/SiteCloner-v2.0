/**
 * AIFixer — “Finishing” step using Gemini.
 *
 * It:
 *  1) renders the original page + the cloned preview page,
 *  2) collects console/page/request diagnostics + screenshots,
 *  3) asks Gemini for a constrained JSON patch list, and
 *  4) applies patches safely to the generated clone output (only index.html + css/*.css).
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

function normalizeRelativePath(p) {
  // Prevent absolute paths and traversal outside outputDir.
  const cleaned = p.replace(/\\/g, '/').replace(/^\/+/, '');
  if (cleaned.includes('..')) return null;
  return cleaned;
}

function isAllowedPatchFile(fileRel) {
  if (fileRel === 'index.html') return true;
  if (fileRel.startsWith('css/') && fileRel.toLowerCase().endsWith('.css')) return true;
  return false;
}

function extractJsonFromText(text) {
  // First try fenced blocks.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced && fenced[1]) return fenced[1].trim();

  // Fallback: first {...} block.
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1).trim();
  }
  return null;
}

function base64FromFile(filePath) {
  const buf = fs.readFileSync(filePath);
  return buf.toString('base64');
}

async function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export class AIFixer {
  constructor({ apiKey, model = 'gemini-1.5-flash', provider = 'gemini', onProgress = () => {} } = {}) {
    this.apiKey = apiKey;
    this.model = model;
    this.provider = provider;
    this.onProgress = onProgress;

    this.maxCssFiles = 10;
    this.maxTotalCssChars = 160000;
    this.maxFileChars = 80000;

    // Patch safety limits
    this.maxSearchChars = 50000;
    this.maxReplaceChars = 200000;
  }

  emit(progress) {
    this.onProgress(progress);
  }

  async finish({ url, outputDir, jobId, viewport, userAgent, browser }) {
    const port = process.env.PORT || 3000;
    const baseUrl = `http://localhost:${port}`;
    const clonePreviewUrl = `${baseUrl}/api/preview/${jobId}/index.html`;

    ensureDirSync(path.join(outputDir, 'ai'));

    // Diagnostics collection
    this.emit({ phase: 'ai', message: 'AI finisher: capturing diagnostics (original + clone)...', percent: 87 });

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

      const [originalDiag, originalScreenshotPath] = await this.captureDiagnostics({
        browser: localBrowser,
        targetUrl: url,
        label: 'original',
        outputDir,
        viewport: viewportToUse,
        userAgent,
      });

      const [cloneDiag, cloneScreenshotPath] = await this.captureDiagnostics({
        browser: localBrowser,
        targetUrl: clonePreviewUrl,
        label: 'clone',
        outputDir,
        viewport: viewportToUse,
        userAgent,
      });

    // Read patchable files
    this.emit({ phase: 'ai', message: 'AI finisher: preparing patchable files for AI...', percent: 88.5 });
      const patchInput = this.buildPatchInput(outputDir);

      this.emit({ phase: 'ai', message: `AI finisher: asking ${this.provider === 'deepseek' ? 'DeepSeek' : 'Gemini'} for safe patches...`, percent: 88 });

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
          skippedPatches: null,
          note: 'Gemini response did not contain parsable JSON patches.',
          screenshots: { original: originalScreenshotPath, clone: cloneScreenshotPath },
          diagnostics: { original: originalDiag, clone: cloneDiag },
        };
      }

      const parsed = JSON.parse(jsonText);
      const patches = Array.isArray(parsed.patches) ? parsed.patches : [];

      this.emit({ phase: 'ai', message: 'AI finisher: applying safe patches to clone output...', percent: 89 });
      const patchResult = this.applyPatchesSafely(outputDir, patches);

      this.emit({ phase: 'ai', message: 'AI finisher: re-checking clone after patches...', percent: 89 });
      // Quick sanity check: just count console errors after patching.
      const afterDiag = await this.captureDiagnostics({
        browser: localBrowser,
        targetUrl: clonePreviewUrl,
        label: 'clone_after',
        outputDir,
        viewport: viewportToUse,
        userAgent,
        screenshot: false,
      }).then(([diag]) => diag);

      return {
        model: this.model,
        appliedPatches: patchResult.applied,
        skippedPatches: patchResult.skipped,
        screenshots: { original: originalScreenshotPath, clone: cloneScreenshotPath },
        diagnostics: { before: { original: originalDiag, clone: cloneDiag }, after: { clone: afterDiag } },
        note: patchResult.note,
      };
    } finally {
      if (ownBrowser && localBrowser) {
        await localBrowser.close();
      }
    }
  }

  async captureDiagnostics({
    browser,
    targetUrl,
    label,
    outputDir,
    viewport,
    userAgent,
    screenshot = true,
  }) {
    const page = await browser.newPage();
    try {
      this.emit({ phase: 'ai', message: `AI finisher: loading ${label} page for diagnostics...`, percent: label === 'original' ? 87.5 : 88 });
      await page.setViewport(viewport);
      if (userAgent) await page.setUserAgent(userAgent);
      await page.setBypassCSP(true).catch(() => {});

      const diagnostics = {
        consoleErrors: [],
        pageErrors: [],
        requestFailed: [],
      };

      page.on('console', (msg) => {
        // Capture console errors/warnings aggressively (most “breakage” is reported here).
        const text = msg.text();
        const type = msg.type();
        if (type === 'error' || type === 'warning' || /error|failed|exception/i.test(text)) {
          diagnostics.consoleErrors.push({ type, text });
        }
      });

      page.on('pageerror', (err) => {
        diagnostics.pageErrors.push({ message: err?.message || String(err) });
      });

      page.on('requestfailed', (req) => {
        diagnostics.requestFailed.push({
          url: req.url(),
          failure: req.failure()?.errorText || null,
        });
      });

      await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {});
      this.emit({ phase: 'ai', message: `AI finisher: ${label} page loaded, capturing screenshot...`, percent: label === 'original' ? 88 : 88.2 });
      // Let layout + late async errors settle.
      await new Promise(resolve => setTimeout(resolve, 1500));

      const screenshotPath = screenshot
        ? path.join(outputDir, 'ai', `${label}.png`)
        : null;

      if (screenshotPath) {
        await page.screenshot({ path: screenshotPath, fullPage: false }).catch(() => {});
      }

      return [diagnostics, screenshotPath];
    } finally {
      await page.close().catch(() => {});
    }
  }

  buildPatchInput(outputDir) {
    const indexPath = path.join(outputDir, 'index.html');
    const indexHtml = readTextSafe(indexPath) || '';

    const cssDir = path.join(outputDir, 'css');
    const cssFiles = [];

    const walk = (dir) => {
      if (!fs.existsSync(dir)) return;
      const entries = fs.readdirSync(dir);
      for (const entry of entries) {
        const full = path.join(dir, entry);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
          walk(full);
        } else if (entry.toLowerCase().endsWith('.css')) {
          const relToRoot = path.relative(outputDir, full).replace(/\\/g, '/');
          cssFiles.push({ rel: relToRoot, abs: full, size: stat.size });
        }
      }
    };

    walk(cssDir);
    cssFiles.sort((a, b) => b.size - a.size);

    const chosen = [];
    let totalChars = 0;
    for (const f of cssFiles.slice(0, this.maxCssFiles)) {
      if (totalChars >= this.maxTotalCssChars) break;
      const content = readTextSafe(f.abs) || '';
      const capped = content.length > this.maxFileChars ? content.slice(0, this.maxFileChars) : content;
      totalChars += capped.length;
      chosen.push({ file: f.rel, content: capped, truncated: capped.length < content.length });
    }

    return {
      patchableFiles: {
        'index.html': { content: indexHtml.length > this.maxFileChars ? indexHtml.slice(0, this.maxFileChars) : indexHtml, truncated: indexHtml.length > this.maxFileChars },
        css: chosen,
      },
    };
  }

  /**
   * Orchestrate the AI call based on the selected provider.
   */
  async callAI(params) {
    if (this.provider === 'deepseek') {
      return this.callDeepSeek(params);
    }
    return this.callGemini(params);
  }

  async callGemini({ url, originalDiag, cloneDiag, originalScreenshotPath, cloneScreenshotPath, patchInput }) {
    const apiKey = this.apiKey;
    const model = this.model;
    const parts = [];

    if (originalScreenshotPath && fs.existsSync(originalScreenshotPath)) {
      const originalB64 = base64FromFile(originalScreenshotPath);
      parts.push({ inlineData: { mimeType: 'image/png', data: originalB64 } });
    }
    if (cloneScreenshotPath && fs.existsSync(cloneScreenshotPath)) {
      const cloneB64 = base64FromFile(cloneScreenshotPath);
      parts.push({ inlineData: { mimeType: 'image/png', data: cloneB64 } });
    }

    const prompt = this.getPrompt({ url, originalDiag, cloneDiag, patchInput, includeVision: true });

    const payload = {
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }, ...parts],
        },
      ],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 2000,
      },
    };

    const versions = ['v1', 'v1beta'];
    // Final verified 2026 model list
    const names = [
      'gemini-2.5-flash',
      'gemini-2.5-flash-latest',
      'gemini-2.0-flash',
      'gemini-2.0-flash-latest',
      'gemini-1.5-flash',
      'gemini-1.5-flash-latest',
    ];

    let lastError = null;
    let successResponse = null;

    this.emit({ phase: 'ai', message: 'AI finisher: connecting to Gemini (auto-detecting endpoint)...', percent: 88.8 });

    for (const v of versions) {
      for (const n of names) {
        const endpoint = `https://generativelanguage.googleapis.com/${v}/models/${encodeURIComponent(n)}:generateContent?key=${encodeURIComponent(apiKey)}`;
        
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 45000);

          const resp = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: controller.signal,
          });

          clearTimeout(timeout);
          const responseBody = await resp.text();

          if (resp.ok) {
            successResponse = responseBody;
            break;
          } else {
            lastError = `[${v}/${n}] ${resp.status} ${responseBody}`;
          }
        } catch (e) {
          lastError = e.message;
        }
      }
      if (successResponse) break;
    }

    if (!successResponse) {
      throw new Error(`Gemini failed after trying all endpoints: ${lastError}`);
    }

    let responseText = '';
    try {
      const json = JSON.parse(successResponse);
      responseText =
        json?.candidates?.[0]?.content?.parts?.map((p) => p?.text).filter(Boolean).join('') || '';
    } catch {
      responseText = successResponse;
    }

    this.emit({ phase: 'ai', message: 'AI finisher: Gemini response received; parsing patches...', percent: 89.2 });
    return responseText;
  }

  async callDeepSeek({ url, originalDiag, cloneDiag, patchInput }) {
    const apiKey = this.apiKey;
    const model = this.model || 'deepseek-chat';
    
    // DeepSeek is OpenAI-compatible
    const endpoint = 'https://api.deepseek.com/chat/completions';
    const prompt = this.getPrompt({ url, originalDiag, cloneDiag, patchInput, includeVision: false });

    const payload = {
      model,
      messages: [
        { role: 'user', content: prompt }
      ],
      temperature: 0.1,
      max_tokens: 2000,
      response_format: { type: 'json_object' } // DeepSeek supports mandatory JSON mode
    };

    this.emit({ phase: 'ai', message: 'AI finisher: sending prompt to DeepSeek...', percent: 88.8 });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);

    try {
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const text = await resp.text();
      if (!resp.ok) {
        throw new Error(`DeepSeek request failed: ${resp.status} ${text}`);
      }

      const json = JSON.parse(text);
      const content = json?.choices?.[0]?.message?.content || '';

      this.emit({ phase: 'ai', message: 'AI finisher: DeepSeek response received; parsing patches...', percent: 89.2 });
      return content;
    } finally {
      clearTimeout(timeout);
    }
  }

  getPrompt({ url, originalDiag, cloneDiag, patchInput, includeVision }) {
    return [
      'You are a code patching assistant expert in fixing front-end website clones.',
      'Your task is to improve a locally-cloned website so it is more stable and functionally identical to the original.',
      includeVision ? 'You are given screenshots of the original page and the clone to compare visual fidelity.' : '',
      '',
      'You MUST output ONLY valid JSON matching the schema below.',
      'Do not output markdown text, explanations, or extra keys outside the JSON.',
      '',
      'Schema:',
      '{',
      '  "patches": [',
      '    {',
      '      "file": "index.html" | "css/<path>.css",',
      '      "search": "<exact substring that already exists>",',
      '      "replace": "<replacement text>",',
      '      "reason": "<short reason>"',
      '    }',
      '  ]',
      '}',
      '',
      'Hard rules:',
      '- Only patch files from patchableFiles.',
      '- The "search" value must be an exact substring in the current content.',
      '- Pay special attention to: broken asset paths (e.g. windows backslashes), missing base URLs, and framework hydration errors.',
      '',
      'Diagnostics (JSON):',
      JSON.stringify({ url, originalDiag, cloneDiag }, null, 2),
      '',
      'Patchable files:',
      JSON.stringify(patchInput, null, 2),
    ].join('\n');
  }

  applyPatchesSafely(outputDir, patches) {
    let applied = 0;
    let skipped = 0;
    let note = null;

    this.emit({ phase: 'ai', message: 'AI finisher: applying JSON patches (safe mode)...', percent: 89.5 });

    const byFile = new Map();
    for (const patch of patches) {
      if (!patch || typeof patch !== 'object') continue;
      const fileRel = patch.file;
      if (!isAllowedPatchFile(fileRel)) {
        skipped++;
        continue;
      }
      const search = typeof patch.search === 'string' ? patch.search : null;
      const replace = typeof patch.replace === 'string' ? patch.replace : null;
      if (!search || !replace) {
        skipped++;
        continue;
      }
      if (search.length > this.maxSearchChars || replace.length > this.maxReplaceChars) {
        skipped++;
        continue;
      }
      const normalized = normalizeRelativePath(fileRel);
      if (!normalized || !isAllowedPatchFile(normalized)) {
        skipped++;
        continue;
      }
      if (!byFile.has(normalized)) byFile.set(normalized, []);
      byFile.get(normalized).push({ search, replace, reason: patch.reason || '' });
    }

    for (const [fileRel, patchesForFile] of byFile.entries()) {
      const abs = path.resolve(path.join(outputDir, fileRel));
      const targetDir = path.resolve(outputDir);
      if (!abs.startsWith(targetDir + path.sep)) continue;

      let content = readTextSafe(abs);
      if (content == null) continue;

      let didApplyAny = false;
      for (const { search, replace } of patchesForFile) {
        if (!content.includes(search)) {
          skipped++;
          continue;
        }

        content = content.replace(search, replace);
        applied++;
        didApplyAny = true;
      }

      if (didApplyAny) {
        fs.writeFileSync(abs, content, 'utf-8');
      }
    }

    if (applied === 0) note = 'Gemini produced patches, but none matched the required search substrings.';
    return { applied, skipped, note };
  }
}

