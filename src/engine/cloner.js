/**
 * SiteCloner — Core orchestrator that coordinates all extraction layers
 * to produce a high-fidelity clone of any website's front-end.
 */

import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { EventEmitter } from 'events';
import { NetworkInterceptor } from './network-interceptor.js';
import { DOMSerializer } from './dom-serializer.js';
import { CSSExtractor } from './css-extractor.js';
import { URLRewriter } from './url-rewriter.js';
import { Packager } from './packager.js';
import { AIFixer } from './ai-fixer.js';

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function safeNewPage(browser, retries = 2) {
  for (let i = 0; i < retries; i++) {
    try {
      return await browser.newPage();
    } catch (err) {
      if (err.message.includes('Session with given id not found') && i < retries - 1) {
        console.warn(`[system] Neural Session Lost. Attempting reconnection (${i + 1}/${retries})...`);
        await delay(2000);
        continue;
      }
      throw err;
    }
  }
}

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
  async clone(url, outputDir, jobId) {
    const startTime = Date.now();
    const isFullClone = this.options.fullClone === true;
    const maxPages = this.options.maxPages || (isFullClone ? 20 : 1);
    
    this.emit('progress', { phase: 'init', message: `Initializing V8 Absolute Power Engine (Mode: ${isFullClone ? 'Full Site' : 'Single Page'})...`, percent: 0 });
    this.outputDir = outputDir;
    this.jobId = jobId;

    // Ensure output dir exists
    fs.mkdirSync(this.outputDir, { recursive: true });

    // Launch Puppeteer with Absolute Phase Resilience (v2.17)
    // Moving userDataDir to System Temp to prevent EBUSY locks and node --watch interference
    const userDataDir = path.join(os.tmpdir(), `sitecloner_user_data_${this.jobId}`);
    fs.mkdirSync(userDataDir, { recursive: true });

    const browser = await puppeteer.launch({
      headless: true,
      userDataDir,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process',
        '--allow-running-insecure-content',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--proxy-server="direct://"',
        '--proxy-bypass-list=*',
      ],
      timeout: 60000, // Explicit launch timeout
    });

    try {
      const queue = [url];
      const visited = new Set();
      const results = [];
      const interceptor = new NetworkInterceptor(this.outputDir);
      const packager = new Packager(this.outputDir);
      const aiFixer = new AIFixer({
        apiKey: process.env.GEMINI_API_KEY,
        model: process.env.GEMINI_MODEL || 'gemini-1.5-flash',
        onProgress: (p) => this.emit('progress', p)
      });
      
      let pagesCloned = 0;
      const concurrencyLimit = 3;

      // Process initial page sequentially to discover links
      const firstUrl = queue.shift();
      if (firstUrl) {
        visited.add(firstUrl);
        pagesCloned++;
        this.emit('progress', { 
          phase: 'navigate', 
          message: `[1/${maxPages}] Primary Neural Link: ${firstUrl}`, 
          percent: 5 
        });
        const firstResult = await this.capturePage(firstUrl, browser, interceptor, packager, true, aiFixer);
        results.push(firstResult);
        
        // Aggregate AI statistics for first page
        if (firstResult && firstResult.aiResult && firstResult.aiResult.appliedPatches) {
          this.totalAiPatches = (this.totalAiPatches || 0) + firstResult.aiResult.appliedPatches;
        }

        if (isFullClone) {
          const links = this.discoverInternalLinks(firstResult.html, url);
          for (const l of links) {
            if (!visited.has(l) && !queue.includes(l)) queue.push(l);
          }
        }
      }

      // Process remaining queue in parallel batches
      while (queue.length > 0 && pagesCloned < maxPages) {
        const remaining = maxPages - pagesCloned;
        const currentBatchSize = Math.min(queue.length, concurrencyLimit, remaining);
        const batch = queue.splice(0, currentBatchSize);
        
        const batchPromises = batch.map(async (currentUrl) => {
          if (visited.has(currentUrl)) return null;
          visited.add(currentUrl);
          const pIndex = ++pagesCloned;
          
          this.emit('progress', { 
            phase: 'navigate', 
            message: `[${pIndex}/${maxPages}] Quantum Weaving: ${currentUrl}`, 
            percent: Math.min(90, (pIndex / maxPages) * 100) 
          });

          const pageResult = await this.capturePage(currentUrl, browser, interceptor, packager, false, aiFixer);
          
          if (isFullClone && pagesCloned < maxPages) {
            const internalLinks = this.discoverInternalLinks(pageResult.html, url);
            for (const link of internalLinks) {
              if (!visited.has(link) && !queue.includes(link)) {
                queue.push(link);
              }
            }
          }
          return pageResult;
        });

        const batchResults = await Promise.all(batchPromises);
        const validResults = batchResults.filter(r => r !== null);
        results.push(...validResults);

        // Aggregate AI statistics (v2.18)
        validResults.forEach(r => {
          if (r.aiResult && r.aiResult.appliedPatches) {
            this.totalAiPatches = (this.totalAiPatches || 0) + r.aiResult.appliedPatches;
          }
        });

        // Neural Breathing Space (v2.1)
        if (queue.length > 0 && pagesCloned < maxPages) {
          this.emit('progress', { phase: 'navigate', message: 'Neural Breathing Space: Recovering system descriptors...', percent: -1 });
          await delay(2000);
        }
      }

      this.emit('progress', { phase: 'package', message: 'Finalizing V8 absolute pack...', percent: 95 });

      // Create ZIP
      const zipPath = this.outputDir + '.zip';
      const zipInfo = await packager.createZip(zipPath);

      const assetStats = interceptor.getStats();
      const result = {
        success: true,
        url,
        pagesCloned,
        outputDir: this.outputDir,
        zipPath,
        zipSize: zipInfo.size,
        duration: Date.now() - startTime,
        stats: {
          assets: assetStats,
          pages: results.length,
          ai: {
            appliedPatches: this.totalAiPatches || 0
          }
        },
      };

      this.emit('progress', { 
        phase: 'done', 
        message: `V8 Clone Complete! Captured ${pagesCloned} pages.`, 
        percent: 100,
        result // Pass result back proactively (v2.9)
      });

      return result;

    } finally {
      if (browser) {
        // Absolute Teardown Lock (v2.17): Ensure sequential cleanup for system stability
        try {
          await browser.close();
          // Safety Buffer: Allow OS handles to release before deletion (v2.17)
          await delay(1000);
          if (fs.existsSync(userDataDir)) {
            fs.rmSync(userDataDir, { recursive: true, force: true });
          }
        } catch (e) {
          console.error(`[SYSTEM] Neural Teardown Fault: ${e.message}`);
        }
      }
    }
  }

  /**
   * Capture a single page and its assets.
   */
  async capturePage(url, browser, interceptor, packager, isInitial = false, aiFixer = null) {
    const page = await safeNewPage(browser);
    try {
      // Set viewport
      await page.setViewport(this.options.viewport);

      // Set user agent if provided
      if (this.options.userAgent) {
        await page.setUserAgent(this.options.userAgent);
      }

      // Bypass CSP
      await page.setBypassCSP(true);

      // Attach interceptor
      await interceptor.attach(page, (assetInfo) => {
        if (isInitial) {
          this.emit('progress', {
            phase: 'download',
            message: `Extracting: ${assetInfo.category}/${path.basename(assetInfo.localPath)}`,
            percent: Math.min(40, 10 + assetInfo.total * 0.2),
          });
        }
      });

      // Navigate
      try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: this.options.waitTimeout });
      } catch (e) {
        // Retry navigation once if it fails
        await page.goto(url, { waitUntil: 'networkidle0', timeout: this.options.waitTimeout });
      }

      // Scroll to trigger lazy loading
      if (this.options.scrollToBottom) {
        await this.autoScroll(page);
      }

      // V3.0 [Cinematic Overdrive]: Neural Media Heartbeat
      // Force all background videos to "wake up" and trigger network requests
      await page.evaluate(async () => {
        const videos = Array.from(document.querySelectorAll('video'));
        for (const video of videos) {
          try {
            video.muted = true;
            video.setAttribute('playsinline', '');
            video.setAttribute('autoplay', 'autoplay');
            // Force a small play/pause cycle to trigger metadata and initial buffer
            await video.play().catch(() => {});
            setTimeout(() => video.pause(), 500);
          } catch (e) {}
        }
      });

      // Wait for stability and SPA readiness (v2.19 — Absolute Hydration Protocol)
      await this.waitForStability(page);
      await this.waitForFonts(page);
      
      // V2.19 Deep SPA Hydration Wait — Handles React, Vue, Vite, Next.js SPAs
      // The key insight: we wait not just for root to have children, but for the page
      // to have meaningful visual content (elements with actual text nodes or images)
      await page.evaluate(async () => {
        const hasContent = () => {
          const body = document.body;
          if (!body) return false;
          // Count elements that likely have visible content
          const headings = body.querySelectorAll('h1,h2,h3,h4,h5,h6,p,span,a,button,img,section,article,main,nav');
          return headings.length > 3; // At least 4 meaningful elements rendered
        };
        
        if (hasContent()) return; // Already rendered — no need to wait
        
        // Wait up to 8s for content to appear
        await new Promise(resolve => {
          let checks = 0;
          const interval = setInterval(() => {
            checks++;
            if (hasContent() || checks > 32) { // 32 * 250ms = 8s max
              clearInterval(interval);
              resolve();
            }
          }, 250);
        });
      });
      
      // Final buffer to allow animations/transitions to complete
      await new Promise(resolve => setTimeout(resolve, 1500));

      // V10: Guardian Bypass — Surgical Removal of CAPTCHA/Verification Blocks
      await page.evaluate(() => {
        const guardianSelectors = [
          '.g-recaptcha', 'iframe[src*="recaptcha"]', 'script[src*="recaptcha"]',
          '.h-captcha', 'iframe[src*="hcaptcha"]',
          '.cf-turnstile', 'iframe[src*="turnstile"]',
          '.captcha-container'
        ];
        
        guardianSelectors.forEach(selector => {
          const elements = document.querySelectorAll(selector);
          elements.forEach(el => el.remove());
        });
      });

      // Serializing
      const domSerializer = new DOMSerializer();
      const { html, metaInfo } = await domSerializer.serialize(page);

      // CSS Extraction
      const assetMap = interceptor.getAssetMap();
      const cssExtractor = new CSSExtractor();
      await cssExtractor.extract(page);
      cssExtractor.manualParse(assetMap);

      // Computed Styles (V7 Holographic)
      const computedStyles = await domSerializer.extractComputedStyles(page);

      // URL Rewriting (V8 Navigation Ready)
      const urlRewriter = new URLRewriter(assetMap, url);
      let rewrittenHTML = urlRewriter.rewriteHTML(html);

      // V2.19: Strip crossorigin attributes — they cause CORS failures when served locally.
      // Vite/React apps add crossorigin="" to all module scripts which breaks preview loading.
      rewrittenHTML = rewrittenHTML.replace(/\s+crossorigin(?:=["'][^"']*["']|)?/gi, '');
      // Also strip integrity attributes which prevent tampered/local files from loading
      rewrittenHTML = rewrittenHTML.replace(/\s+integrity=["'][^"']*["']/gi, '');

      // V2.20: SPA Static Preservation — Remove framework module scripts that destroy pre-rendered DOM.
      // When we clone a React/Vue/Vite SPA, the DOM serializer captures the fully-rendered HTML.
      // The bundled JS modules (type="module") would re-mount the framework, see the wrong URL path
      // (e.g. /api/preview/jobId/...), and render a blank page / 404 — destroying our perfect HTML.
      // Solution: Strip these module scripts since the static DOM is already complete.
      // We also strip modulepreload links since those are only useful for module scripts.
      rewrittenHTML = rewrittenHTML.replace(/<script\s+[^>]*type\s*=\s*["']module["'][^>]*>[\s\S]*?<\/script>/gi, '<!-- SiteCloner: Module script removed for static fidelity -->');
      rewrittenHTML = rewrittenHTML.replace(/<link\s+[^>]*rel\s*=\s*["']modulepreload["'][^>]*>/gi, '<!-- SiteCloner: Modulepreload removed -->');


      // V7: Inject Holographic Styles
      rewrittenHTML = packager.injectHolographicStyles(rewrittenHTML, computedStyles, cssExtractor.customProperties);

      // Determine local filename
      const urlObj = new URL(url);
      let filename = urlObj.pathname === '/' || !urlObj.pathname ? 'index.html' : urlObj.pathname;
      if (filename.startsWith('/')) filename = filename.slice(1);
      if (!filename.endsWith('.html')) {
        filename = filename.replace(/\/$/, '') + '.html';
      }

      // Write page
      const hydrationShield = `
      <script id="v8-hydration-shield">
        // V8: Next.js Hydration Recovery & Error Suppression
        (function() {
          const originalError = console.error;
          console.error = function(...args) {
            if (args[0] && typeof args[0] === 'string' && (
              args[0].includes('Hydration failed') || 
              args[0].includes('Text content did not match') ||
              args[0].includes('Application error')
            )) {
              originalError.apply(console, ['[V8 Shield] Suppressed Hydration Error:', ...args]);
              return;
            }
            originalError.apply(console, args);
          };
          window.addEventListener('error', function(e) {
            if (e.message && e.message.includes('Next.js')) {
              e.stopImmediatePropagation();
              e.preventDefault();
              console.warn('[V8 Shield] Blocked Next.js Runtime Crash');
            }
          }, true);
        })();
      </script>
      `;
      rewrittenHTML = rewrittenHTML.replace('</head>', `${hydrationShield}</head>`);
      packager.writeHTML(rewrittenHTML, filename);
      
      // If it's the initial page, write the animations and run.bat
      if (isInitial) {
        const animCSS = cssExtractor.generateAnimationsCSS();
        packager.writeAnimationsCSS(animCSS);
        packager.writeLaunchBat();
        // V9: Setup the Preview Shield Service Worker
        packager.setupPreviewShield();
        // Rewrite CSS files for global assets
        packager.rewriteCSSFiles(urlRewriter);
      }

      // V11: Neural Overdrive — High-Fidelity AI Healing Pass
      let aiResult = null;
      if (this.options.aiFinish && aiFixer && this.jobId) {
        try {
          aiResult = await aiFixer.finish({
            url,
            outputDir: this.outputDir,
            jobId: this.jobId,
            viewport: this.options.viewport,
            userAgent: this.options.userAgent,
            browser,
            targetFile: filename
          });
          
          if (aiResult && aiResult.appliedPatches) {
              this.emit('progress', { phase: 'ai', patches: aiResult.appliedPatches });
          }
        } catch (err) {
          console.error(`[AI Engine Failure] Neural bypass triggered for ${filename}:`, err);
          this.emit('progress', { 
            phase: 'ai', 
            message: `Neural Bypass Activated: Critical fault in ${filename}. Continuing with fallback fidelity...`, 
            percent: -1 
          });
        }
      }

      return { url, filename, html: rewrittenHTML, metaInfo, aiResult };
    } finally {
      await page.close();
    }
  }

  /**
   * Discover internal links on a given page.
   */
  discoverInternalLinks(html, baseUrl) {
    const linkRegex = /<a\s+(?:[^>]*?\s+)?href=["']([^"']+)["']/gi;
    const internalLinks = new Set();
    const baseOrigin = new URL(baseUrl).origin;
    let match;

    while ((match = linkRegex.exec(html)) !== null) {
      let link = match[1];
      if (link.startsWith('#') || link.startsWith('javascript:') || link.startsWith('mailto:') || link.startsWith('tel:')) continue;
      
      try {
        const absoluteUrl = new URL(link, baseUrl);
        if (absoluteUrl.origin === baseOrigin) {
          // Remove hash and trailing slash for normalization
          absoluteUrl.hash = '';
          let cleanUrl = absoluteUrl.href;
          // V2.21: Prevent redundant crawling of index files which map to the identical local file
          // and overwrite the hydrated root page with an empty route.
          cleanUrl = cleanUrl.replace(/\/(?:index\.html|index\.htm|index\.php)$/i, '/');
          cleanUrl = cleanUrl.replace(/\/$/, '');
          internalLinks.add(cleanUrl);
        }
      } catch (e) {}
    }

    return [...internalLinks];
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
        const maxScrollAttempts = 100; // Cap scrolling to prevent infinite loops (v2.13)
        let attempts = 0;

        const timer = setInterval(() => {
          const scrollHeight = document.body.scrollHeight;
          window.scrollBy(0, distance);
          totalHeight += distance;
          attempts++;

          if (totalHeight >= scrollHeight || attempts >= maxScrollAttempts) {
            clearInterval(timer);
            resolve();
          }
        }, 100);
      });
    });
    // Scroll back to the top for serialization
    await page.evaluate(() => window.scrollTo(0, 0));
    // Final wait for network requests and late animations
    await new Promise(resolve => setTimeout(resolve, 2000));
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

