import fs from 'node:fs';
import path from 'node:path';
const dir = path.resolve(process.argv[2] || 'assets');
let bad = 0;
for (const f of fs.readdirSync(dir).filter(n => /^vestiaire-.*\.js$/.test(n))) {
  const s = fs.readFileSync(path.join(dir, f), 'utf8');
  if (s.includes('/onze-site/*')) { console.error('corrupted GLSL comment in', f); bad++; }
  if (s.includes('static env diffuse removed') && !s.includes("'/* static env diffuse removed: GI is baked */'")) { console.error('shader replacement altered in', f); bad++; }
}
if (bad) process.exit(1);
console.log('vestiaire shader check ok');
