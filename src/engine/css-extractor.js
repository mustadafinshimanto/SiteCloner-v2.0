/**
 * CSSExtractor — Parses document.styleSheets to extract @keyframes,
 * @font-face, CSS custom properties, animations, and transitions.
 */

export class CSSExtractor {
  constructor() {
    this.keyframes = [];
    this.fontFaces = [];
    this.customProperties = [];
    this.animationRules = [];
    this.transitionRules = [];
    this.mediaQueries = [];
    this.allRules = [];
  }

  /**
   * Extract all CSS rules from the page's stylesheets.
   */
  async extract(page) {
    const extracted = await page.evaluate(() => {
      const keyframes = [];
      const fontFaces = [];
      const customProperties = new Map();
      const animationRules = [];
      const transitionRules = [];
      const mediaQueries = [];
      const allCSSText = [];

      function processRules(rules, sheetHref) {
        if (!rules) return;
        for (const rule of rules) {
          try {
            // @keyframes
            if (rule.type === CSSRule.KEYFRAMES_RULE) {
              keyframes.push({
                name: rule.name,
                cssText: rule.cssText,
                source: sheetHref,
              });
            }
            // @font-face
            else if (rule.type === CSSRule.FONT_FACE_RULE) {
              fontFaces.push({
                cssText: rule.cssText,
                source: sheetHref,
              });
            }
            // @media
            else if (rule.type === CSSRule.MEDIA_RULE) {
              mediaQueries.push({
                conditionText: rule.conditionText || rule.media?.mediaText || '',
                cssText: rule.cssText,
                source: sheetHref,
              });
              // Recurse into media rules
              processRules(rule.cssRules, sheetHref);
            }
            // @supports, @layer, or nested rules
            else if (rule.type === CSSRule.SUPPORTS_RULE || 
                     rule.type === 7 /* CSSRule.LAYER_BLOCK_RULE */ ||
                     rule.type === 12 /* CSSRule.LAYER_STATEMENT_RULE */) {
              if (rule.cssText) allCSSText.push(rule.cssText);
              if (rule.cssRules) processRules(rule.cssRules, sheetHref);
            }
            // Standard style rules
            else if (rule.type === CSSRule.STYLE_RULE) {
              const style = rule.style;

              // Check for custom properties
              for (let i = 0; i < style.length; i++) {
                const prop = style[i];
                if (prop.startsWith('--')) {
                  customProperties.set(prop, style.getPropertyValue(prop));
                }
              }

              // Check for animation properties
              const animation = style.getPropertyValue('animation') || style.getPropertyValue('animation-name');
              if (animation && animation !== 'none') {
                animationRules.push({
                  selector: rule.selectorText,
                  animation: style.getPropertyValue('animation'),
                  animationName: style.getPropertyValue('animation-name'),
                  animationDuration: style.getPropertyValue('animation-duration'),
                  animationTimingFunction: style.getPropertyValue('animation-timing-function'),
                  animationDelay: style.getPropertyValue('animation-delay'),
                  animationIterationCount: style.getPropertyValue('animation-iteration-count'),
                  animationDirection: style.getPropertyValue('animation-direction'),
                  animationFillMode: style.getPropertyValue('animation-fill-mode'),
                  cssText: rule.cssText,
                  source: sheetHref,
                });
              }

              // Check for transition properties
              const transition = style.getPropertyValue('transition');
              if (transition && transition !== 'none' && transition !== 'all 0s ease 0s') {
                transitionRules.push({
                  selector: rule.selectorText,
                  transition: style.getPropertyValue('transition'),
                  transitionProperty: style.getPropertyValue('transition-property'),
                  transitionDuration: style.getPropertyValue('transition-duration'),
                  transitionTimingFunction: style.getPropertyValue('transition-timing-function'),
                  transitionDelay: style.getPropertyValue('transition-delay'),
                  cssText: rule.cssText,
                  source: sheetHref,
                });
              }
            }
          } catch (e) {
            // Skip individual rule errors
          }
        }
      }

      // Iterate over all stylesheets
      for (const sheet of document.styleSheets) {
        try {
          const href = sheet.href || 'inline';
          processRules(sheet.cssRules, href);
        } catch (e) {
          // Cross-origin stylesheet, can't read rules directly
          // We rely on the network interceptor to capture these
        }
      }

      // Also extract root-level custom properties
      const rootEl = document.documentElement;
      const rootComputed = window.getComputedStyle(rootEl);
      // Note: getComputedStyle doesn't enumerate custom properties in all browsers,
      // so we also check inline style and :root rules above

      return {
        keyframes,
        fontFaces,
        customProperties: Object.fromEntries(customProperties),
        animationRules,
        transitionRules,
        mediaQueries,
      };
    });

    this.keyframes = extracted.keyframes;
    this.fontFaces = extracted.fontFaces;
    this.customProperties = extracted.customProperties;
    this.animationRules = extracted.animationRules;
    this.transitionRules = extracted.transitionRules;
    this.mediaQueries = extracted.mediaQueries;

    return extracted;
  }

  /**
   * Generate a standalone CSS file with all extracted animations.
   */
  generateAnimationsCSS() {
    let css = '/* ===== EXTRACTED ANIMATIONS & KEYFRAMES ===== */\n\n';

    // Custom properties
    if (Object.keys(this.customProperties).length > 0) {
      css += ':root {\n';
      for (const [prop, value] of Object.entries(this.customProperties)) {
        css += `  ${prop}: ${value};\n`;
      }
      css += '}\n\n';
    }

    // @font-face rules
    for (const ff of this.fontFaces) {
      css += ff.cssText + '\n\n';
    }

    // @keyframes rules
    for (const kf of this.keyframes) {
      css += kf.cssText + '\n\n';
    }

    return css;
  }

  /**
   * Manually parse CSS text for keyframes and font-faces.
   * Useful for cross-origin stylesheets where rules are inaccessible via DOM.
   */
  manualParse(assetMap) {
    const keyframesRegex = /@(?:-webkit-)?keyframes\s+([^{]+)\{((?:[^{}]|\{[^{}]*\})*)\}/gi;
    const fontFaceRegex = /@font-face\s*\{((?:[^{}]|\{[^{}]*\})*)\}/gi;

    for (const [url, asset] of assetMap) {
      if (asset.category === 'css' && asset.content) {
        // Find keyframes
        let match;
        // Reset regex state for each file
        keyframesRegex.lastIndex = 0;
        while ((match = keyframesRegex.exec(asset.content)) !== null) {
          const name = match[1].trim();
          const cssText = match[0];
          
          // Avoid duplicates
          if (!this.keyframes.some(k => k.name === name)) {
            this.keyframes.push({ name, cssText, source: url });
          }
        }

        // Find font-faces
        let ffMatch;
        fontFaceRegex.lastIndex = 0;
        while ((ffMatch = fontFaceRegex.exec(asset.content)) !== null) {
          const cssText = ffMatch[0];
          if (!this.fontFaces.some(f => f.cssText === cssText)) {
            this.fontFaces.push({ cssText, source: url });
          }
        }
      }
    }
  }

  /**
   * Get extraction summary stats.
   */
  getStats() {
    return {
      keyframes: this.keyframes.length,
      fontFaces: this.fontFaces.length,
      customProperties: Object.keys(this.customProperties).length,
      animationRules: this.animationRules.length,
      transitionRules: this.transitionRules.length,
      mediaQueries: this.mediaQueries.length,
    };
  }
}

