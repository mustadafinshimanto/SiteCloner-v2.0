/**
 * URLRewriter — Rewrites all asset URLs in HTML and CSS to point
 * to local relative paths based on the asset map.
 */

import path from 'path';
import { URL } from 'url';

export class URLRewriter {
  constructor(assetMap, baseUrl) {
    this.assetMap = assetMap; // Map<url, { localPath, category, ... }>
    this.baseUrl = baseUrl;
    this.rewriteCount = 0;
    this.unresolvedUrls = new Set();
  }

  /**
   * Resolve a potentially relative URL against the base URL.
   */
  resolveUrl(url) {
    if (!url) return null;
    url = url.trim();
    if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('#') || url.startsWith('javascript:') || url.startsWith('mailto:')) {
      return null;
    }
    try {
      // Handle protocol-relative URLs
      if (url.startsWith('//')) {
        url = 'https:' + url;
      }
      return new URL(url, this.baseUrl).href;
    } catch {
      return null;
    }
  }

  /**
   * Find the local path for a given absolute URL.
   */
  findLocalPath(absoluteUrl) {
    if (!absoluteUrl) return null;

    // Direct lookup
    if (this.assetMap.has(absoluteUrl)) {
      const localPath = this.assetMap.get(absoluteUrl).localPath;
      // Force forward slashes for Windows-compatibility
      return localPath ? localPath.replace(/\\/g, '/') : null;
    }

    // Try without query string
    try {
      const parsed = new URL(absoluteUrl);
      const withoutQuery = parsed.origin + parsed.pathname;
      if (this.assetMap.has(withoutQuery)) {
        return this.assetMap.get(withoutQuery).localPath;
      }

      // Try without hash
      const withoutHash = parsed.origin + parsed.pathname + parsed.search;
      if (this.assetMap.has(withoutHash)) {
        return this.assetMap.get(withoutHash).localPath;
      }
    } catch {}

    // Try matching by pathname suffix
    for (const [url, asset] of this.assetMap) {
      try {
        const assetParsed = new URL(url);
        const inputParsed = new URL(absoluteUrl);
        if (assetParsed.pathname === inputParsed.pathname) {
          const localPath = asset.localPath;
          return localPath ? localPath.replace(/\\/g, '/') : null;
        }
      } catch {}
    }

    this.unresolvedUrls.add(absoluteUrl);
    
    // V4: Smart Fallback for unmapped root-relative paths (Next.js, etc.)
    try {
      const parsed = new URL(absoluteUrl);
      if (parsed.origin === new URL(this.baseUrl).origin) {
        // It's on the same domain but we missed it. 
        // V5: Prepend correct category based on extension
        let relPath = parsed.pathname;
        if (relPath.startsWith('/')) relPath = relPath.slice(1);
        const category = this.getCategory(relPath);
        
        // Correct localized path: category/original/path
        return path.join(category, relPath).replace(/\\/g, '/');
      }
    } catch {}

    return null;
  }

  /**
   * Rewrite all URLs in an HTML string.
   */
  rewriteHTML(html) {
    let result = html;

    // Rewrite src attributes
    result = result.replace(/(src\s*=\s*["'])([^"']+)(["'])/gi, (match, prefix, url, suffix) => {
      const absoluteUrl = this.resolveUrl(url);
      if (!absoluteUrl) return match;
      const localPath = this.findLocalPath(absoluteUrl);
      if (!localPath) return match;
      this.rewriteCount++;
      return prefix + localPath + suffix;
    });

    // Rewrite href attributes (CSS, favicons, etc. — but preserve anchor links)
    result = result.replace(/(href\s*=\s*["'])([^"']+)(["'])/gi, (match, prefix, url, suffix) => {
      if (url.startsWith('#') || url.startsWith('mailto:') || url.startsWith('tel:') || url.startsWith('javascript:')) {
        return match;
      }
      
      const absoluteUrl = this.resolveUrl(url);
      if (!absoluteUrl) return match;

      // V8: Internal Page Link Translation
      try {
        const parsed = new URL(absoluteUrl);
        const baseParsed = new URL(this.baseUrl);
        
        if (parsed.origin === baseParsed.origin) {
          // If it's a page link (not an asset)
          const ext = path.extname(parsed.pathname).toLowerCase();
          if (!ext || ext === '.html' || ext === '.php' || ext === '.asp') {
            let localPagePath = parsed.pathname;
            if (localPagePath === '/' || !localPagePath) {
              localPagePath = 'index.html';
            } else {
              if (localPagePath.startsWith('/')) localPagePath = localPagePath.slice(1);
              if (!localPagePath.endsWith('.html')) {
                localPagePath = localPagePath.replace(/\/$/, '') + '.html';
              }
            }
            this.rewriteCount++;
            return prefix + localPagePath + suffix;
          }
        }
      } catch {}

      const localPath = this.findLocalPath(absoluteUrl);
      if (!localPath) return match;
      this.rewriteCount++;
      return prefix + localPath + suffix;
    });

    // Rewrite srcset attributes
    result = result.replace(/(srcset\s*=\s*["'])([^"']+)(["'])/gi, (match, prefix, srcset, suffix) => {
      const parts = srcset.split(',').map(part => {
        const trimmed = part.trim();
        if (!trimmed) return part;
        const pieces = trimmed.split(/\s+/);
        const url = pieces[0];
        const descriptor = pieces.slice(1).join(' ');
        const absoluteUrl = this.resolveUrl(url);
        if (!absoluteUrl) return part;
        const localPath = this.findLocalPath(absoluteUrl);
        if (!localPath) return part;
        this.rewriteCount++;
        return localPath + (descriptor ? ' ' + descriptor : '');
      });
      return prefix + parts.join(', ') + suffix;
    });

    // Rewrite common lazy-load and data attributes
    const lazyAttributes = ['data-src', 'data-srcset', 'data-original', 'lazy-src', 'data-lazy-src', 'data-href'];
    for (const attr of lazyAttributes) {
      const regex = new RegExp(`(${attr}\\s*=\\s*["'])([^"']+)(["'])`, 'gi');
      result = result.replace(regex, (match, prefix, url, suffix) => {
        // If it looks like a srcset (contains commas but isn't just one URL with params)
        if (attr.includes('srcset') || (url.includes(',') && !url.includes('?') && !url.includes('('))) {
          const parts = url.split(',').map(part => {
            const trimmed = part.trim();
            if (!trimmed) return part;
            const pieces = trimmed.split(/\s+/);
            const subUrl = pieces[0];
            const descriptor = pieces.slice(1).join(' ');
            const absoluteUrl = this.resolveUrl(subUrl);
            if (!absoluteUrl) return part;
            const localPath = this.findLocalPath(absoluteUrl);
            if (!localPath) return part;
            this.rewriteCount++;
            return localPath + (descriptor ? ' ' + descriptor : '');
          });
          return prefix + parts.join(', ') + suffix;
        }

        const absoluteUrl = this.resolveUrl(url);
        if (!absoluteUrl) return match;
        const localPath = this.findLocalPath(absoluteUrl);
        if (!localPath) return match;
        this.rewriteCount++;
        return prefix + localPath + suffix;
      });
    }

    // Rewrite inline style url() references
    result = result.replace(/(style\s*=\s*["'][^"']*)(url\s*\(\s*["']?)([^"')]+)(["']?\s*\))/gi, (match, before, urlPrefix, url, urlSuffix) => {
      const absoluteUrl = this.resolveUrl(url);
      if (!absoluteUrl) return match;
      const localPath = this.findLocalPath(absoluteUrl);
      if (!localPath) return match;
      this.rewriteCount++;
      return before + urlPrefix + localPath + urlSuffix;
    });

    // Rewrite poster attributes (for video elements)
    result = result.replace(/(poster\s*=\s*["'])([^"']+)(["'])/gi, (match, prefix, url, suffix) => {
      const absoluteUrl = this.resolveUrl(url);
      if (!absoluteUrl) return match;
      const localPath = this.findLocalPath(absoluteUrl);
      if (!localPath) return match;
      this.rewriteCount++;
      return prefix + localPath + suffix;
    });
    // Rewrite content attributes ONLY for known URL/Image meta tags (v3.4)
    result = result.replace(/(<meta\s[^>]*?(?:property|name)\s*=\s*["'](?:og:image|og:url|twitter:image|twitter:url|video:url)[^>]*?content\s*=\s*["'])([^"']+)(["'][^>]*>)/gi, (match, prefix, url, suffix) => {
      const absoluteUrl = this.resolveUrl(url);
      if (!absoluteUrl) return match;
      const localPath = this.findLocalPath(absoluteUrl);
      if (!localPath) return match;
      this.rewriteCount++;
      return prefix + localPath + suffix;
    });

    // V3: Scrub Framework Hydration Data (Next.js, React, etc.)
    result = this.rewriteFrameworkData(result);

    return result;
  }

  /**
   * Rewrite URLs hidden in framework hydration scripts (JSON/JS objects).
   * Commonly found in Next.js self.__next_f.push or __NEXT_DATA__
   */
  rewriteFrameworkData(html) {
    // Regex to find script contents
    return html.replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script>)/gi, (match, openTag, content, closeTag) => {
      if (!content.trim()) return match;

      let rewrittenContent = content;

      // V4: Improved Regex to find both quoted and escaped URLs (Next.js /_next/, static/, etc.)
      // Matches: "/_next/..." or \"/_next/...\" or \/_next\/...
      const urlRegex = /(?:\\"|")((?:\\\/|\/)[^\\"]*(?:\/_next\/|css\/|js\/|assets\/|static\/)[^\\"]*)(?:\\"|")/gi;

      rewrittenContent = rewrittenContent.replace(urlRegex, (match, url) => {
        // Clean the URL (handle \/ escapes)
        const cleanUrl = url.replace(/\\\//g, '/');
        
        const absoluteUrl = this.resolveUrl(cleanUrl);
        if (!absoluteUrl) return match;

        let localPath = this.findLocalPath(absoluteUrl);
        if (!localPath) return match;

        // Re-escape slashes if the original had them
        if (url.includes('\\/')) {
          localPath = localPath.replace(/\//g, '\\/');
        }

        // Wrap in the original quote style (escaped or not)
        const quote = match.startsWith('\\"') ? '\\"' : '"';
        this.rewriteCount++;
        return quote + localPath + quote;
      });

      return openTag + rewrittenContent + closeTag;
    });
  }

  /**
   * Rewrite all url() references in a CSS string.
   */
  rewriteCSS(css, cssFileUrl) {
    const cssBase = cssFileUrl || this.baseUrl;

    return css.replace(/url\(\s*["']?([^"')]+)["']?\s*\)/gi, (match, url) => {
      url = url.trim();
      if (url.startsWith('data:')) return match;

      let absoluteUrl;
      try {
        absoluteUrl = new URL(url, cssBase).href;
      } catch {
        absoluteUrl = this.resolveUrl(url);
      }

      if (!absoluteUrl) return match;
      const localPath = this.findLocalPath(absoluteUrl);
      if (!localPath) return match;

      this.rewriteCount++;
      return `url('${localPath}')`;
    });
  }

  /**
   * Rewrite @import URLs in CSS.
   */
  rewriteCSSImports(css, cssFileUrl) {
    const cssBase = cssFileUrl || this.baseUrl;

    return css.replace(/@import\s+(?:url\(\s*)?["']?([^"');\s]+)["']?\s*\)?\s*;/gi, (match, url) => {
      let absoluteUrl;
      try {
        absoluteUrl = new URL(url, cssBase).href;
      } catch {
        return match;
      }

      const localPath = this.findLocalPath(absoluteUrl);
      if (!localPath) return match;

      this.rewriteCount++;
      return `@import url('${localPath}');`;
    });
  }

  getCategory(url) {
    const ext = path.extname(url.split('?')[0]).toLowerCase();
    if (['.js', '.mjs', '.cjs'].includes(ext)) return 'js';
    if (['.css'].includes(ext)) return 'css';
    if (['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.avif', '.ico'].includes(ext)) return 'images';
    if (['.woff', '.woff2', '.ttf', '.otf', '.eot'].includes(ext)) return 'fonts';
    if (['.mp4', '.webm', '.ogg', '.mov'].includes(ext)) return 'videos';
    if (['.mp3', '.wav', '.flac', '.aac'].includes(ext)) return 'audio';
    return 'other';
  }

  /**
   * Get rewrite stats.
   */
  getStats() {
    return {
      rewriteCount: this.rewriteCount,
      unresolvedUrls: [...this.unresolvedUrls],
    };
  }
}
