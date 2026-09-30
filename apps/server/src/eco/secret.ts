import { spawnSync } from 'node:child_process';

/**
 * Keys for GMES are kept sealed (plan 40-SPACE-PLANNER §0, the same DPAPI pattern as the other apps): on Windows the secret is
 * encrypted for the signed-in user with the operating system (ProtectedData, CurrentUser), so the database file alone does not
 * reveal it. The secret goes to PowerShell through an environment variable, never through the command line. On other systems
 * (development and CI only; the owner's planner runs on Windows) it is stored with a `plain:` prefix and the file's own
 * permissions are the protection: the value says so, so nobody mistakes it for sealed.
 */

const run = (script: string, secret: string): string => {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    env: { ...process.env, ECO_SECRET: secret }, encoding: 'utf8', windowsHide: true, timeout: 20_000,
  });
  if (result.status !== 0) throw new Error('the operating system could not seal or open the key');
  return result.stdout.trim();
};

const PROTECT = 'Add-Type -AssemblyName System.Security; [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($env:ECO_SECRET), $null, [Security.Cryptography.DataProtectionScope]::CurrentUser))';
const UNPROTECT = 'Add-Type -AssemblyName System.Security; [Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($env:ECO_SECRET), $null, [Security.Cryptography.DataProtectionScope]::CurrentUser))';

/** Several secrets in one PowerShell start (each start takes over a second): base64 in, sealed base64 out, comma-separated. */
const PROTECT_MANY = 'Add-Type -AssemblyName System.Security; ($env:ECO_SECRET.Split(",") | ForEach-Object { [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect([Convert]::FromBase64String($_), $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)) }) -join ","';

/** Seals each non-empty text (an empty one stays empty), in order. */
export function sealSecrets(plains: readonly string[]): string[] {
  const filled = plains.filter((p) => p !== '');
  if (filled.length === 0) return plains.map(() => '');
  const sealed =
    process.platform === 'win32'
      ? run(PROTECT_MANY, filled.map((p) => Buffer.from(p, 'utf8').toString('base64')).join(',')).split(',').map((s) => `dpapi:${s}`)
      : filled.map((p) => `plain:${Buffer.from(p, 'utf8').toString('base64')}`);
  if (sealed.length !== filled.length) throw new Error('the operating system could not seal the keys');
  let next = 0;
  return plains.map((p) => (p === '' ? '' : sealed[next++]!));
}

export const sealSecret = (plain: string): string => sealSecrets([plain])[0]!;

/** Opening starts PowerShell (about a second), so an opened key is remembered for the life of the server process, which needs it anyway. */
const opened = new Map<string, string>();

export function openSecret(stored: string): string {
  if (stored === '') return '';
  if (stored.startsWith('dpapi:')) {
    const known = opened.get(stored);
    if (known !== undefined) return known;
    const plain = run(UNPROTECT, stored.slice(6));
    opened.set(stored, plain);
    return plain;
  }
  if (stored.startsWith('plain:')) return Buffer.from(stored.slice(6), 'base64').toString('utf8');
  throw new Error('the stored key has an unknown form');
}

export const isSealed = (stored: string): boolean => stored.startsWith('dpapi:');
