/**
 * NetworkInterceptor — Captures every network response from the page
 * and categorizes/saves assets by MIME type.
 */

import fs from 'fs';
import path from 'path';
import mime from 'mime-types';
import { URL } from 'url';
import axios from 'axios';

export class NetworkInterceptor {
  constructor(outputDir) {
    this.outputDir = outputDir;
    this.assets = new Map(); // url -> { localPath, category, mimeType, size }
    this.categories = {
      css: ['text/css'],
      js: ['application/javascript', 'text/javascript', 'application/x-javascript'],
      images: ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/svg+xml', 'image/webp', 'image/avif', 'image/bmp', 'image/ico', 'image/x-icon', 'image/vnd.microsoft.icon'],
      fonts: ['font/woff', 'font/woff2', 'font/ttf', 'font/otf', 'application/font-woff', 'application/font-woff2', 'application/x-font-woff', 'application/x-font-ttf', 'application/x-font-opentype', 'application/vnd.ms-fontobject'],
      videos: ['video/mp4', 'video/webm', 'video/ogg'],
      audio: ['audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/webm'],
    };
    this.knownPaths = new Set();
    this.savingPaths = new Set(); // Multi-page concurrency lock (v2.1)
  }

  /**
   * Get the category folder for a given content type.
   */
  getCategory(contentType) {
    if (!contentType) return 'other';
    const ct = contentType.split(';')[0].trim().toLowerCase();
    for (const [category, types] of Object.entries(this.categories)) {
      if (types.includes(ct)) return category;
    }
    // Fallback: guess from content type
    if (ct.startsWith('image/')) return 'images';
    if (ct.startsWith('font/')) return 'fonts';
    if (ct.startsWith('video/')) return 'videos';
    if (ct.startsWith('audio/')) return 'audio';
    return 'other';
  }

  /**
   * Generate a clean local filename from a URL.
   */
  generateLocalPath(urlString, contentType) {
    try {
      const parsed = new URL(urlString);
      let pathname = decodeURIComponent(parsed.pathname);

      // Remove leading slash
      if (pathname.startsWith('/')) pathname = pathname.slice(1);

      // If pathname is empty or just '/', use 'index'
      if (!pathname || pathname === '') pathname = 'index';

      // Get file extension
      let ext = path.extname(pathname);
      if (!ext && contentType) {
        const guessedExt = mime.extension(contentType.split(';')[0].trim());
        if (guessedExt) ext = '.' + guessedExt;
      }

      // Clean up the filename
      let baseName = pathname.replace(/[^a-zA-Z0-9._\-\/]/g, '_');
      if (!path.extname(baseName) && ext) {
        baseName += ext;
      }

      // Get category
      const category = this.getCategory(contentType);

      // Construct local path
      const localPath = path.join(category, baseName);
      return localPath;
    } catch {
      // Fallback for malformed URLs
      const category = this.getCategory(contentType);
      const hash = Buffer.from(urlString).toString('base64url').slice(0, 16);
      const ext = contentType ? mime.extension(contentType.split(';')[0].trim()) : 'bin';
      return path.join(category, `asset_${hash}.${ext || 'bin'}`);
    }
  }

  /**
   * Attach to a Puppeteer page and start intercepting responses.
   */
  async attach(page, onProgress) {
    const self = this;

    page.on('response', async (response) => {
      try {
        const url = response.url();
        const status = response.status();

        // Skip data URIs, blob URIs, and failed requests
        if (url.startsWith('data:') || url.startsWith('blob:')) return;
        if (status < 200 || status >= 400) return;

        // Skip the main HTML document page itself (we handle that in DOM serializer)
        const contentType = response.headers()['content-type'] || '';
        if (contentType.includes('text/html')) return;

        // Generate local path
        let localPath = self.generateLocalPath(url, contentType);

        // Handle duplicates
        if (self.assets.has(url)) return;

        // Try to download the response body
        let buffer;
        try {
          buffer = await response.buffer();
        } catch {
          // V3.0 [Cinematic Overdrive]: Resilient Media Fallback
          // If Puppeteer buffer fails (common for large videos), use standalone fetch
          const category = self.getCategory(contentType);
          if (category === 'videos' || category === 'audio') {
            console.log(`[system] Neural Media Fallback: Downloading large asset: ${path.basename(localPath)}`);
            try {
              const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 60000 });
              buffer = Buffer.from(res.data);
            } catch (err) {
              console.warn(`[system] Media Fallback Failed for ${url}: ${err.message}`);
              return;
            }
          } else {
            return;
          }
        }

        if (!buffer || buffer.length === 0) return;

        // Ensure unique local paths (Neural Write-Lock v2.1)
        let uniquePath = localPath;
        let counter = 1;
        while (self.knownPaths.has(uniquePath) || self.savingPaths.has(uniquePath)) {
          const ext = path.extname(localPath);
          const base = localPath.slice(0, -ext.length || undefined);
          uniquePath = `${base}_${counter}${ext}`;
          counter++;
        }
        localPath = uniquePath;
        self.savingPaths.add(localPath);

        // Save to disk
        const fullPath = path.join(self.outputDir, localPath);
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, buffer);
        
        self.knownPaths.add(localPath);
        self.savingPaths.delete(localPath);

        const category = self.getCategory(contentType);

        self.assets.set(url, {
          localPath,
          category,
          mimeType: contentType.split(';')[0].trim(),
          size: buffer.length,
          content: category === 'css' ? buffer.toString('utf8') : null,
        });


        if (onProgress) {
          onProgress({
            type: 'asset',
            url,
            localPath,
            category,
            size: buffer.length,
            total: self.assets.size,
          });
        }
      } catch (err) {
        // Silently continue — some responses can't be buffered
      }
    });
  }

  /**
   * Manually download an asset that wasn't captured during normal browsing.
   */
  async downloadAsset(urlStr) {
    if (this.assets.has(urlStr)) return;

    try {
      const response = await fetch(urlStr);
      if (!response.ok) return;

      const contentType = response.headers.get('content-type') || '';
      const buffer = Buffer.from(await response.arrayBuffer());

      if (!buffer || buffer.length === 0) return;

      let localPath = this.generateLocalPath(urlStr, contentType);
      
      // Ensure unique local paths (Neural Write-Lock v2.1)
      let uniquePath = localPath;
      let counter = 1;
      while (this.knownPaths.has(uniquePath) || this.savingPaths.has(uniquePath)) {
        const ext = path.extname(localPath);
        const base = localPath.slice(0, -ext.length || undefined);
        uniquePath = `${base}_${counter}${ext}`;
        counter++;
      }
      localPath = uniquePath;
      this.savingPaths.add(localPath);

      // Save to disk
      const fullPath = path.join(this.outputDir, localPath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, buffer);

      this.knownPaths.add(localPath);
      this.savingPaths.delete(localPath);

      const category = this.getCategory(contentType);

      this.assets.set(urlStr, {
        localPath,
        category,
        mimeType: contentType.split(';')[0].trim(),
        size: buffer.length,
        content: category === 'css' ? buffer.toString('utf8') : null,
      });

      return localPath;
    } catch (err) {
      // Failed to download — that's okay, we'll fallback to relative path rewriting
    }
  }

  /**
   * Get the URL -> local path mapping.
   */
  getAssetMap() {
    return new Map(this.assets);
  }

  /**
   * Get summary stats.
   */
  getStats() {
    const stats = { total: 0, totalSize: 0, byCategory: {} };
    for (const [, asset] of this.assets) {
      stats.total++;
      stats.totalSize += asset.size;
      if (!stats.byCategory[asset.category]) {
        stats.byCategory[asset.category] = { count: 0, size: 0 };
      }
      stats.byCategory[asset.category].count++;
      stats.byCategory[asset.category].size += asset.size;
    }
    return stats;
  }
}
