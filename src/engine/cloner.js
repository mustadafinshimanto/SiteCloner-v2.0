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
    const isFullClone = this.options.fullClone === true;
    const maxPages = this.options.maxPages || (isFullClone ? 20 : 1);
    
    this.emit('progress', { phase: 'init', message: `Initializing V8 Absolute Power Engine (Mode: ${isFullClone ? 'Full Site' : 'Single Page'})...`, percent: 0 });

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
      const queue = [url];
      const visited = new Set();
      const results = [];
      const interceptor = new NetworkInterceptor(outputDir);
      const packager = new Packager(outputDir);
      
      let pagesCloned = 0;

      while (queue.length > 0 && pagesCloned < maxPages) {
        const currentUrl = queue.shift();
        if (visited.has(currentUrl)) continue;
        visited.add(currentUrl);
        pagesCloned++;

        this.emit('progress', { 
          phase: 'navigate', 
          message: `[${pagesCloned}/${maxPages}] Deep-scanning: ${currentUrl}`, 
          percent: Math.min(90, (pagesCloned / maxPages) * 100) 
        });

        const pageResult = await this.capturePage(currentUrl, browser, interceptor, packager, pagesCloned === 1);
        results.push(pageResult);

        if (isFullClone && pagesCloned < maxPages) {
          const internalLinks = this.discoverInternalLinks(pageResult.html, url);
          for (const link of internalLinks) {
            if (!visited.has(link) && !queue.includes(link)) {
              queue.push(link);
            }
          }
        }
      }

      this.emit('progress', { phase: 'package', message: 'Finalizing V8 absolute pack...', percent: 95 });

      // Create ZIP
      const zipPath = outputDir + '.zip';
      const zipInfo = await packager.createZip(zipPath);

      this.emit('progress', { phase: 'done', message: `V8 Clone Complete! Captured ${pagesCloned} pages.`, percent: 100 });

      const assetStats = interceptor.getStats();
      const result = {
        success: true,
        url,
        pagesCloned,
        outputDir,
        zipPath,
        zipSize: zipInfo.size,
        duration: Date.now() - startTime,
        stats: {
          assets: assetStats,
          pages: results.length,
        },
      };

      return result;

    } finally {
      await browser.close();
    }
  }

  /**
   * Capture a single page and its assets.
   */
  async capturePage(url, browser, interceptor, packager, isInitial = false) {
    const page = await browser.newPage();
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

      // Wait for stability
      await this.waitForStability(page);
      await this.waitForFonts(page);

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

      return { url, filename, html: rewrittenHTML, metaInfo };
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
          const cleanUrl = absoluteUrl.href.replace(/\/$/, '');
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

