const html = '<script type="module" src="js/assets/index-CVoItpy2.js"></script>';
const replaced = html.replace(/<script\s+[^>]*type\s*=\s*["']module["'][^>]*>[\s\S]*?<\/script>/gi, '<!-- stripped -->');
console.log(replaced);
