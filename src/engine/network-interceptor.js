/**
 * NetworkInterceptor — Captures every network response from the page
 * and categorizes/saves assets by MIME type.
 */

import fs from 'fs';
import path from 'path';
import mime from 'mime-types';
import { URL } from 'url';

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
          // Some responses may not have a body
          return;
        }

        if (!buffer || buffer.length === 0) return;

        // Ensure unique local paths
        let uniquePath = localPath;
        let counter = 1;
        const existingPaths = new Set([...self.assets.values()].map(a => a.localPath));
        while (existingPaths.has(uniquePath)) {
          const ext = path.extname(localPath);
          const base = localPath.slice(0, -ext.length || undefined);
          uniquePath = `${base}_${counter}${ext}`;
          counter++;
        }
        localPath = uniquePath;

        // Save to disk
        const fullPath = path.join(self.outputDir, localPath);
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, buffer);

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
      
      // Ensure unique local paths
      let uniquePath = localPath;
      let counter = 1;
      const existingPaths = new Set([...this.assets.values()].map(a => a.localPath));
      while (existingPaths.has(uniquePath)) {
        const ext = path.extname(localPath);
        const base = localPath.slice(0, -ext.length || undefined);
        uniquePath = `${base}_${counter}${ext}`;
        counter++;
      }
      localPath = uniquePath;

      // Save to disk
      const fullPath = path.join(this.outputDir, localPath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, buffer);

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
