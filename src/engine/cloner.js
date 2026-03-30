/**
 * SiteCloner — Core orchestrator that coordinates all extraction layers
 * to produce a high-fidelity clone of any website's front-end.
 */

import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import { NetworkInterceptor } from './network-interceptor.js';
import { DOMSerializer } from './dom-serializer.js';
import { CSSExtractor } from './css-extractor.js';
import { URLRewriter } from './url-rewriter.js';
import { Packager } from './packager.js';
import { AIFixer } from './ai-fixer.js';

export class SiteCloner extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = {
      waitTimeout: options.waitTimeout || 30000,
      scrollToBottom: options.scrollToBottom !== false,
      captureJS: options.captureJS !== false,
      viewport: options.viewport || { width: 1920, height: 1080 },
      userAgent: options.userAgent || null,
      ...options,
      // Default to enabled; allow disabling per job.
      aiFinish: options.aiFinish !== false,
    };
  }

  /**
   * Clone a website and produce output files.
   */
  async clone(url, outputDir) {
    const startTime = Date.now();
    this.emit('progress', { phase: 'init', message: 'Initializing browser engine...', percent: 0 });

    // Ensure output dir exists
    fs.mkdirSync(outputDir, { recursive: true });

    // Launch Puppeteer
    const browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process',
        '--allow-running-insecure-content',
      ],
    });

    try {
      const page = await browser.newPage();

      // Set viewport
      await page.setViewport(this.options.viewport);

      // Set user agent if provided
      if (this.options.userAgent) {
        await page.setUserAgent(this.options.userAgent);
      }

      // Bypass CSP to access all styles
      await page.setBypassCSP(true);

      this.emit('progress', { phase: 'init', message: 'Browser ready. Setting up interceptors...', percent: 5 });

      // ===== LAYER 1: Network Interception =====
      const interceptor = new NetworkInterceptor(outputDir);
      await interceptor.attach(page, (assetInfo) => {
        this.emit('progress', {
          phase: 'download',
          message: `Downloaded: ${assetInfo.category}/${path.basename(assetInfo.localPath)}`,
          percent: Math.min(40, 10 + assetInfo.total * 0.5),
          asset: assetInfo,
        });
      });

      this.emit('progress', { phase: 'navigate', message: `Navigating to ${url}...`, percent: 10 });

      // Navigate to the page
      try {
        await page.goto(url, {
          waitUntil: 'networkidle0',
          timeout: this.options.waitTimeout,
        });
      } catch (navError) {
        // Try with networkidle2 as fallback (more lenient)
        this.emit('progress', { phase: 'navigate', message: 'Retrying with relaxed wait...', percent: 12 });
        await page.goto(url, {
          waitUntil: 'networkidle2',
          timeout: this.options.waitTimeout,
        });
      }

      this.emit('progress', { phase: 'navigate', message: 'Page loaded successfully!', percent: 30 });

      // Wait extra for lazy-loaded content and late animations
      await this.delay(2000);

      // Scroll to bottom to trigger lazy loading
      if (this.options.scrollToBottom) {
        this.emit('progress', { phase: 'scroll', message: 'Scrolling page to load all content...', percent: 35 });
        await this.autoScroll(page);
        await this.delay(2000);
      }

      // Wait for any remaining network activity
      await this.waitForNetworkIdle(page, 1500);

      this.emit('progress', { phase: 'extract', message: 'Waiting for DOM stability...', percent: 40 });
      await this.waitForStability(page);

      this.emit('progress', { phase: 'extract', message: 'Waiting for web fonts to load...', percent: 44 });
      await this.waitForFonts(page);

      this.emit('progress', { phase: 'extract', message: 'Extracting DOM structure (including Shadow DOM)...', percent: 45 });

      // ===== LAYER 2: DOM Serialization =====
      const domSerializer = new DOMSerializer();
      // ===== LAYER 0: Lazy-Load Triggering =====
      this.emit('progress', { phase: 'pre-capture', message: 'Triggering lazy-load (auto-scrolling)...', percent: 62 });
      await this.autoScroll(page);

      // (Proceed with original HTML capture)
      const { html, inlineStyles, metaInfo } = await domSerializer.serialize(page);

      this.emit('progress', { phase: 'extract', message: 'Extracting CSS animations & keyframes (CORS-Ready)...', percent: 55 });

      // ===== LAYER 3: CSS Extraction =====
      const assetMap = interceptor.getAssetMap();
      const cssExtractor = new CSSExtractor();
      await cssExtractor.extract(page);
      
      // Manual parse for cross-origin styles
      cssExtractor.manualParse(assetMap);

      this.emit('progress', { phase: 'extract', message: 'Extracting computed styles...', percent: 60 });

      // Extract computed styles for key elements
      const computedStyles = await domSerializer.extractComputedStyles(page);

      this.emit('progress', { phase: 'rewrite', message: 'Rewriting asset URLs (V4 High-Fidelity enabled)...', percent: 65 });

      // ===== LAYER 4: URL Rewriting =====
      const urlRewriter = new URLRewriter(assetMap, url);
      
      // V4: Discovery Scan for missed assets in HTML
      const missedAssets = this.discoverAssets(html, url);
      if (missedAssets.length > 0) {
        this.emit('progress', { phase: 'rewrite', message: `Downloading ${missedAssets.length} additional assets...`, percent: 70 });
        for (const assetUrl of missedAssets) {
          try {
            await interceptor.downloadAsset(assetUrl);
          } catch (e) {
            // Silently ignore individual download failures
          }
        }
      }

      let rewrittenHTML = urlRewriter.rewriteHTML(html);


      this.emit('progress', { phase: 'package', message: 'Packaging files...', percent: 75 });

      // ===== LAYER 5: Packaging =====
      const packager = new Packager(outputDir);

      // Write the animations CSS
      const animCSS = cssExtractor.generateAnimationsCSS();
      packager.writeAnimationsCSS(animCSS);

      // Rewrite CSS files
      packager.rewriteCSSFiles(urlRewriter);

      // Inject the extracted-animations.css link if it exists
      if (animCSS && animCSS.trim().length > 50) {
        rewrittenHTML = rewrittenHTML.replace(
          '</head>',
          '  <link rel="stylesheet" href="css/extracted-animations.css">\n</head>'
        );
      }

      // Write the main HTML
      packager.writeHTML(rewrittenHTML);
      
      // Generate the quick launch (run.bat) file
      packager.writeLaunchBat();

      this.emit('progress', { phase: 'package', message: 'Generating manifest...', percent: 85 });

      // Generate manifest
      const assetStats = interceptor.getStats();
      const cssStats = cssExtractor.getStats();
      const rewriteStats = urlRewriter.getStats();
      const manifestInput = {
        url,
        clonedAt: new Date().toISOString(),
        duration: Date.now() - startTime,
        assets: assetStats,
        css: cssStats,
        urlRewrites: rewriteStats.rewriteCount,
        metaInfo,
      };

      packager.generateManifest(manifestInput);

      // ===== AI FINISHER (optional) =====
      let aiSummary = null;
      if (this.options.aiFinish) {
        const provider = process.env.AI_PROVIDER || 'gemini';
        const apiKey = provider === 'deepseek' ? process.env.DEEPSEEK_API_KEY : process.env.GEMINI_API_KEY;
        const model = provider === 'deepseek' ? (process.env.DEEPSEEK_MODEL || 'deepseek-chat') : (process.env.GEMINI_MODEL || 'gemini-1.5-flash');

        if (!apiKey) {
          const keyName = provider === 'deepseek' ? 'DEEPSEEK_API_KEY' : 'GEMINI_API_KEY';
          this.emit('progress', { phase: 'ai', message: `AI finishing skipped (${keyName} not set).`, percent: 86 });
        } else {
          const aiFixer = new AIFixer({
            apiKey,
            model,
            provider,
            onProgress: (evt) => this.emit('progress', evt),
          });

          this.emit('progress', { phase: 'ai', message: `AI finishing: analyzing clone stability with ${provider}...`, percent: 86 });
          aiSummary = await aiFixer.finish({
            url,
            outputDir,
            jobId: path.basename(outputDir),
            viewport: this.options.viewport,
            userAgent: this.options.userAgent,
            browser,
          });
        }
      }

      // If AI patched anything, regenerate manifest so sizes reflect final output.
      if (aiSummary && aiSummary.appliedPatches > 0) {
        packager.generateManifest({
          ...manifestInput,
          clonedAt: new Date().toISOString(),
        });
      }

      this.emit('progress', { phase: 'zip', message: 'Creating ZIP archive...', percent: 90 });

      // Create ZIP
      const zipPath = outputDir + '.zip';
      const zipInfo = await packager.createZip(zipPath);

      this.emit('progress', { phase: 'done', message: 'Clone complete!', percent: 100 });

      const result = {
        success: true,
        url,
        outputDir,
        zipPath,
        zipSize: zipInfo.size,
        duration: Date.now() - startTime,
        stats: {
          assets: assetStats,
          css: cssStats,
          urlRewrites: rewriteStats.rewriteCount,
          unresolvedUrls: rewriteStats.unresolvedUrls.length,
          computedStyleElements: Object.keys(computedStyles).length,
          ai: aiSummary,
        },
        metaInfo,
      };

      return result;

    } finally {
      await browser.close();
    }
  }

  /**
   * Wait for the DOM to stabilize (no changes for 1s).
   */
  async waitForStability(page, timeout = 10000) {
    try {
      await page.evaluate((timeout) => {
        return new Promise((resolve) => {
          let lastNodeCount = document.querySelectorAll('*').length;
          let lastCheckTime = Date.now();
          const start = Date.now();

          const timer = setInterval(() => {
            const currentNodeCount = document.querySelectorAll('*').length;
            const now = Date.now();

            if (currentNodeCount !== lastNodeCount) {
              lastNodeCount = currentNodeCount;
              lastCheckTime = now;
            } else if (now - lastCheckTime >= 1000) {
              // Stable for 1 second
              clearInterval(timer);
              resolve(true);
            }

            if (now - start > timeout) {
              // Timed out, just proceed
              clearInterval(timer);
              resolve(false);
            }
          }, 250);
        });
      }, timeout);
    } catch {
      // If evaluate fails, just continue
    }
  }

  /**
   * Wait for web fonts to load (best-effort). Helps ensure serialized pages use the correct
   * typography when fonts are loaded after initial DOM rendering.
   */
  async waitForFonts(page, timeout = 5000) {
    try {
      await page.evaluate(
        async (timeoutMs) => {
          if (!document.fonts || !document.fonts.ready) return;
          const ready = document.fonts.ready;
          // Some pages never resolve `ready` (or take a long time) — cap with timeout.
          await Promise.race([
            ready,
            new Promise((resolve) => setTimeout(resolve, timeoutMs)),
          ]);
        },
        timeout
      );
    } catch {
      // Ignore pages without Font Loading API support.
    }
  }

  /**
   * Auto-scroll the page to trigger lazy loading.
   */
  async autoScroll(page) {
    await page.evaluate(async () => {
      await new Promise((resolve) => {
        let totalHeight = 0;
        const distance = 400;
        const timer = setInterval(() => {
          const scrollHeight = document.body.scrollHeight;
          window.scrollBy(0, distance);
          totalHeight += distance;

          if (totalHeight >= scrollHeight) {
            // Scroll back to top
            window.scrollTo(0, 0);
            clearInterval(timer);
            resolve();
          }
        }, 100);

        // Safety timeout
        setTimeout(() => {
          clearInterval(timer);
          window.scrollTo(0, 0);
          resolve();
        }, 15000);
      });
    });
  }

  /**
   * Wait for network activity to settle.
   */
  async waitForNetworkIdle(page, idleTime = 1500) {
    try {
      await page.waitForNetworkIdle({ idleTime, timeout: 10000 });
    } catch {
      // Not all pages will become fully idle, that's ok
    }
  }

  /**
   * Scroll down the page to trigger all lazy-loaded images, animations, and transitions.
   */
  async autoScroll(page) {
    this.emit('progress', { phase: 'pre-capture', message: 'Triggering lazy-load (auto-scrolling)...', percent: 62 });
    await page.evaluate(async () => {
      await new Promise((resolve) => {
        let totalHeight = 0;
        const distance = 100;
        const timer = setInterval(() => {
          const scrollHeight = document.body.scrollHeight;
          window.scrollBy(0, distance);
          totalHeight += distance;

          if (totalHeight >= scrollHeight) {
            clearInterval(timer);
            resolve();
          }
        }, 100);
      });
    });
    // Scroll back to the top for serialization
    await page.evaluate(() => window.scrollTo(0, 0));
    // Final wait for network requests and late animations
    await new Promise(resolve => setTimeout(resolve, 3000));
  }

  /**
   * Scan HTML for any asset URLs that were missed by the network interceptor.
   */
  discoverAssets(html, baseUrl) {
    // V5: Expanded regex to catch data-attributes and common framework patterns
    const assetRegex = /(?:src|href|poster|data-src|data-srcset|data-video-src|data-lazy-src)\s*=\s*["']([^"']+)["']/gi;
    const discovered = new Set();
    let match;

    while ((match = assetRegex.exec(html)) !== null) {
      const url = match[1];
      if (url.startsWith('data:') || url.startsWith('javascript:') || url.startsWith('#') || url.startsWith('blob:')) continue;
      
      try {
        const absoluteUrl = new URL(url, baseUrl).href;
        discovered.add(absoluteUrl);
      } catch {
        // Skip invalid URLs
      }
    }

    // V5: Look for potential escaped URLs in framework data strings
    const escapedRegex = /(?:\\"|")((?:\\\/|\/)[^\\"]*(?:\/_next\/|css\/|js\/|assets\/|static\/)[^\\"]*)(?:\\"|")/gi;
    while ((match = escapedRegex.exec(html)) !== null) {
      const escapedUrl = match[1];
      const cleanUrl = escapedUrl.replace(/\\\//g, '/');
      try {
        const absoluteUrl = new URL(cleanUrl, baseUrl).href;
        discovered.add(absoluteUrl);
      } catch {}
    }

    return [...discovered];
  }

  /**
   * Simple delay helper.
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

