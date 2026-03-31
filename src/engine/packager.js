/**
 * Packager — Organizes extracted files and creates ZIP archives.
 */

import fs from 'fs';
import path from 'path';
import archiver from 'archiver';

export class Packager {
  constructor(outputDir) {
    this.outputDir = outputDir;
  }

  /**
   * Write an HTML file to the output directory.
   */
  writeHTML(html, filename = 'index.html') {
    const htmlPath = path.join(this.outputDir, filename);
    fs.mkdirSync(path.dirname(htmlPath), { recursive: true });
    
    let finalHtml = html;
    const alreadyHasDoc = /<!DOCTYPE\s+html/i.test(html) || /<html\b/i.test(html);

    if (!alreadyHasDoc) {
      finalHtml = `<!DOCTYPE html>\n<html>${html}</html>`;
    }

    fs.writeFileSync(htmlPath, finalHtml, 'utf-8');
    return htmlPath;
  }

  /**
   * Write the extracted animations CSS file.
   */
  writeAnimationsCSS(cssContent) {
    if (!cssContent || cssContent.trim().length < 50) return null;
    const cssPath = path.join(this.outputDir, 'css', 'extracted-animations.css');
    fs.mkdirSync(path.dirname(cssPath), { recursive: true });
    fs.writeFileSync(cssPath, cssContent, 'utf-8');
    return cssPath;
  }

  /**
   * Rewrite CSS files in the output directory.
   */
  rewriteCSSFiles(urlRewriter) {
    const cssDir = path.join(this.outputDir, 'css');
    if (!fs.existsSync(cssDir)) return;

    const walkDir = (dir) => {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          walkDir(fullPath);
        } else if (file.endsWith('.css')) {
          let content = fs.readFileSync(fullPath, 'utf-8');

          // Find the original URL for this CSS file
          let originalUrl = null;
          for (const [url, asset] of urlRewriter.assetMap) {
            const expectedPath = path.join(this.outputDir, asset.localPath);
            if (path.resolve(expectedPath) === path.resolve(fullPath)) {
              originalUrl = url;
              break;
            }
          }

          content = urlRewriter.rewriteCSS(content, originalUrl);
          content = urlRewriter.rewriteCSSImports(content, originalUrl);

          // Rewrite url() paths relative to CSS file location
          const relDir = path.relative(path.dirname(fullPath), this.outputDir);
          content = content.replace(/url\(\s*'([^']+)'\s*\)/gi, (match, localPath) => {
            if (localPath.startsWith('data:') || localPath.startsWith('http')) return match;
            const adjustedPath = path.posix.join(
              relDir.replace(/\\/g, '/'),
              localPath.replace(/\\/g, '/')
            );
            return `url('${adjustedPath}')`;
          });

          fs.writeFileSync(fullPath, content, 'utf-8');
        }
      }
    };

    walkDir(cssDir);
  }

  /**
   * Generate a manifest of all extracted files.
   */
  generateManifest(stats) {
    const manifest = {
      generatedAt: new Date().toISOString(),
      tool: 'SiteCloner v1.0.0',
      stats,
      files: [],
    };

    const walkDir = (dir, relativeTo) => {
      if (!fs.existsSync(dir)) return;
      const files = fs.readdirSync(dir);
      for (const file of files) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          walkDir(fullPath, relativeTo);
        } else {
          manifest.files.push({
            path: path.relative(relativeTo, fullPath).replace(/\\/g, '/'),
            size: stat.size,
          });
        }
      }
    };

    walkDir(this.outputDir, this.outputDir);

    const manifestPath = path.join(this.outputDir, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
    return manifest;
  }

  /**
   * Inject "Holographic" computed styles directly into the HTML to ensure visual fidelity (V7 Extreme).
   */
  injectHolographicStyles(html, computedStyles, customProperties) {
    let holographicCSS = '\n/* ===== V7 EXTREME FIDELITY: HOLOGRAPHIC STYLE INJECTION ===== */\n';
    
    // 1. Inject Live CSS Variables
    if (customProperties && Object.keys(customProperties).length > 0) {
      holographicCSS += ':root {\n';
      for (const [prop, value] of Object.entries(customProperties)) {
        holographicCSS += `  ${prop}: ${value} !important;\n`;
      }
      holographicCSS += '}\n\n';
    }

    // 2. Inject Element-Level Computed Snapshots
    if (computedStyles && Object.keys(computedStyles).length > 0) {
      for (const [selector, styles] of Object.entries(computedStyles)) {
        holographicCSS += `${selector} {\n`;
        for (const [prop, value] of Object.entries(styles)) {
          holographicCSS += `  ${prop}: ${value} !important;\n`;
        }
        holographicCSS += '}\n\n';
      }
    }

    const styleBlock = `\n<style id="v7-holographic-style">\n${holographicCSS}</style>\n`;
    return html.replace('</head>', `${styleBlock}</head>`);
  }

  /**
   * Create a ZIP archive of the output directory.
   */
  async createZip(zipPath) {
    return new Promise((resolve, reject) => {
      const output = fs.createWriteStream(zipPath);
      const archive = archiver('zip', { zlib: { level: 9 } });

      output.on('close', () => {
        resolve({
          path: zipPath,
          size: archive.pointer(),
        });
      });

      archive.on('error', reject);
      archive.pipe(output);
      archive.directory(this.outputDir, false);
      archive.finalize();
    });
  }

  /**
   * Write a launch batch file for easy previewing.
   */
  writeLaunchBat() {
    const batPath = path.join(this.outputDir, 'run.bat');
    const content = `@echo off\ncls\necho.\necho   -------------------------------------------------\necho      S I T E C L O N E R   P R E V I E W\necho   -------------------------------------------------\necho.\necho Launching cloned website in your default browser...\necho.\nstart "" "index.html"\necho.\necho Done. You can close this window now.\ntimeout /t 3 > nul\n`;
    fs.writeFileSync(batPath, content, 'utf-8');
    return batPath;
  }
}
