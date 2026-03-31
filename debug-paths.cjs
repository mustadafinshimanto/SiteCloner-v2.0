const path = require('path');
const fs = require('fs');

const __dirname_test = process.cwd();
const CLONES_DIR = path.join(__dirname_test, 'clones');

console.log('--- SITECLONER PATH DEBUG ---');
console.log('CWD:', __dirname_test);
console.log('CLONES_DIR (Joined):', CLONES_DIR);
console.log('CLONES_DIR (Resolved):', path.resolve(CLONES_DIR));
console.log('Directory Exists:', fs.existsSync(CLONES_DIR));

if (fs.existsSync(CLONES_DIR)) {
    const entries = fs.readdirSync(CLONES_DIR);
    console.log('Raw Entries:', entries);
    entries.forEach(e => {
        const fullPath = path.join(CLONES_DIR, e);
        const stats = fs.statSync(fullPath);
        console.log(` - ${e} | isDir: ${stats.isDirectory()} | size: ${stats.size}`);
    });
}
console.log('----------------------------');
