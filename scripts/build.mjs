// כותב את public/config.js ממשתני הסביבה ש-Vercel מקבל מהחיבור ל-Supabase.
// נכנסים רק ערכים ציבוריים: כתובת הפרויקט והמפתח הציבורי. המפתח הסודי לעולם לא נכתב לכאן.
import { writeFileSync } from 'node:fs';

const env = process.env;
const pick = (...names) => names.map((n) => env[n]).find((v) => v && v.trim()) || '';

const supabaseUrl = pick('NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL');
const supabaseKey = pick(
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_ANON_KEY'
);

if (supabaseKey.startsWith('sb_secret_')) {
  throw new Error('Refusing to publish a secret key to the browser.');
}

writeFileSync(
  new URL('../public/config.js', import.meta.url),
  `window.APP_CONFIG = ${JSON.stringify({ supabaseUrl, supabaseKey })};\n`
);

console.log(`config.js written (url: ${supabaseUrl ? 'found' : 'MISSING'}, key: ${supabaseKey ? 'found' : 'MISSING'})`);
