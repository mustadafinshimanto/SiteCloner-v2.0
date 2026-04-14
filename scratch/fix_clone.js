import fs from 'fs';
import path from 'path';

const cloneDir = 'c:/Storage/Workspace/Antigravity/www.applegadgetsbd.com_clone';

function neutralizeNextJs(filePath) {
    console.log(`Processing ${filePath}...`);
    let content = fs.readFileSync(filePath, 'utf8');

    // 1. Comment out Next.js scripts
    // We look for scripts that include _next/static
    content = content.replace(/(<script\b[^>]*?src=["'][^"']*?_next\/static\/[^"']*?["'][^>]*><\/script>)/gi, '<!-- $1 -->');
    
    // 2. Supplement the hydration shield to be more aggressive
    const aggressiveShield = `
    <script id="v8-absolute-fidelity-fix">
      (function() {
        // Suppress all React/Next.js runtime errors after sterilization
        window.addEventListener('error', function(e) {
          if (e.message && (e.message.includes('Next.js') || e.message.includes('React'))) {
            e.stopImmediatePropagation();
            e.preventDefault();
          }
        }, true);
        
        // Block Next.js from trying to hydrate
        window.__NEXT_DATA__ = undefined;
        window.next = { router: { push: () => {}, replace: () => {}, prefetch: () => Promise.resolve() } };
        
        console.log('[Surgical Fix] Next.js runtime neutralized for static local run.');
      })();
    </script>
    `;

    if (!content.includes('v8-absolute-fidelity-fix')) {
        content = content.replace('</head>', `${aggressiveShield}</head>`);
    }

    fs.writeFileSync(filePath, content);
}

const files = fs.readdirSync(cloneDir);
files.forEach(file => {
    if (file.endsWith('.html')) {
        neutralizeNextJs(path.join(cloneDir, file));
    }
});

console.log('All HTML files adjusted for local run.');
