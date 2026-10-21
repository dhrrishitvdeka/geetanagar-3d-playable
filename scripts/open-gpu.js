// Opens the game in its own browser window on the laptop's dedicated GPU. run.bat points Vite's BROWSER at this file, and Vite
// runs it with the page URL as the last argument.
//
// Why: on a laptop with two GPUs, Chromium browsers (Edge, Chrome, Brave) give WebGL the integrated one and ignore the page's
// powerPreference: 'high-performance'. --force_high_performance_gpu makes them use the dedicated one. A browser that is already
// open would take the URL into its running process and drop the flag, so the game gets its own profile (and so its own process).
// Saves and settings live in that profile.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const url = process.argv[process.argv.length - 1];
const { LOCALAPPDATA = '', PROGRAMFILES = '', 'PROGRAMFILES(X86)': PF86 = '' } = process.env;
const CANDIDATES = [
  join(PF86, 'Microsoft/Edge/Application/msedge.exe'), join(PROGRAMFILES, 'Microsoft/Edge/Application/msedge.exe'),
  join(LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'), join(PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'),
  join(LOCALAPPDATA, 'BraveSoftware/Brave-Browser/Application/brave.exe'), join(PROGRAMFILES, 'BraveSoftware/Brave-Browser/Application/brave.exe'),
];
const browser = CANDIDATES.find(p => p && existsSync(p));

if (browser) {
  const profile = join(LOCALAPPDATA, 'GuwaMap', 'browser');
  mkdirSync(profile, { recursive: true });
  spawn(browser, ['--force_high_performance_gpu', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', `--app=${url}`], { detached: true, stdio: 'ignore' }).unref();
  console.log(`  Opened the game in ${browser.split(/[\\/]/).pop()} on the dedicated GPU (add ?fps to the URL to check)`);
} else {
  spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref(); // no Chromium browser: the default one
  console.log('  No Edge, Chrome or Brave found: opened the default browser (it chooses the GPU itself)');
}
