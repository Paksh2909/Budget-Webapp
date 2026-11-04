#!/usr/bin/env node
// Generates PASSPHRASE_HASH, SESSION_SECRET and TOKEN_ENCRYPTION_KEY.
//
//   node scripts/generate-secrets.mjs            -> print values (paste into .dev.vars)
//   node scripts/generate-secrets.mjs --deploy   -> upload them with `wrangler secret put`
//
// Note: rotating TOKEN_ENCRYPTION_KEY makes stored Plaid tokens unreadable (you'd need to relink banks).
// Use --only-passphrase to change just the passphrase.

import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import readline from 'node:readline';

const ITERATIONS = 20000; // Cloudflare Workers cap PBKDF2 at 100k; lower keeps login within free-plan CPU limits.
const MIN_LENGTH = 12;
const args = new Set(process.argv.slice(2));

// One shared interface so piped input works too; typed characters are not echoed.
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY });
rl._writeToOutput = () => { }; // suppress echo of typed characters
const lines = rl[Symbol.asyncIterator]();

async function promptHidden(question) {
  rl.output.write(question);
  const { value } = await lines.next();
  process.stdout.write('\n');
  return value ?? '';
}

const pass1 = await promptHidden(`Choose a passphrase (min ${MIN_LENGTH} chars): `);
if (pass1.length < MIN_LENGTH) {
  console.error(`Passphrase must be at least ${MIN_LENGTH} characters.`);
  process.exit(1);
}
const pass2 = await promptHidden('Repeat passphrase: ');
rl.close();
if (pass1 !== pass2) {
  console.error('Passphrases do not match.');
  process.exit(1);
}

const salt = randomBytes(16);
const hash = pbkdf2Sync(pass1, salt, ITERATIONS, 32, 'sha256');
const secrets = {
  PASSPHRASE_HASH: `pbkdf2-sha256$${ITERATIONS}$${salt.toString('base64')}$${hash.toString('base64')}`,
};
if (!args.has('--only-passphrase')) {
  secrets.SESSION_SECRET = randomBytes(32).toString('base64');
  secrets.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('base64');
}

if (args.has('--deploy')) {
  for (const [name, value] of Object.entries(secrets)) {
    const r = spawnSync('npx', ['wrangler', 'secret', 'put', name], { input: value, stdio: ['pipe', 'inherit', 'inherit'] });
    if (r.status !== 0) {
      console.error(`Failed to set ${name}`);
      process.exit(r.status ?? 1);
    }
  }
  console.log('Secrets uploaded to Cloudflare.');
} else {
  console.log('\nAdd these to worker/.dev.vars (keep them private):\n');
  for (const [name, value] of Object.entries(secrets)) console.log(`${name}=${value}`);
}
