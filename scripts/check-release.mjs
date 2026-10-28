import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
const root = resolve(import.meta.dirname, '..');
const failures = []; let jsCount = 0, imports = 0;
function walk(dir) { for (const item of readdirSync(dir, { withFileTypes: true })) {
  if (item.name === '.git' || item.name === 'node_modules') continue;
  const full = join(dir, item.name);
  if (item.isDirectory()) walk(full);
  else if (item.name.endsWith('.js') && item.name !== 'sw.js') {
    jsCount++;
    const checked = spawnSync(process.execPath, ['--check', full], { encoding: 'utf8' });
    if (checked.status !== 0) failures.push(`Syntax: ${full}\n${checked.stderr}`);
    const src = readFileSync(full, 'utf8');
    const re = /(?:\bfrom\s*|\bimport\s*\()\s*['"](\.[^'"]+)['"]/g;
    for (const m of src.matchAll(re)) {
      imports++;
      const dest = resolve(dirname(full), m[1]);
      if (!existsSync(dest)) failures.push(`Missing import: ${full} -> ${m[1]}`);
    }
  }
} }
walk(root);
for (const file of ['index.html', 'manifest.webmanifest', 'sw.js', 'js/main.js', 'js/pwa/register.js', 'js/portal/data.js', 'assets/icons/icon-192.png', 'assets/icons/icon-512.png']) {
  if (!existsSync(join(root, file))) failures.push(`Missing release file: ${file}`);
}
const test = readFileSync(join(root, 'supabase/tests/technician_rls_test.sql'), 'utf8');
if (/create or replace function pg_temp\.as_owner\(\)[\s\S]*?begin\s+perform pg_temp\.as_owner\(\)/i.test(test)) failures.push('Recursive SQL test helper');
console.log(`Checked ${jsCount} JS files and ${imports} relative imports`);
if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
console.log('PASS: static checks only. Supabase and browser tests are still required.');
