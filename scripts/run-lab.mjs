#!/usr/bin/env node
// Runs the lab page (lab.html, see docs/lab.md) in a headless Chrome/Chromium and prints its results.
// No dependency: Node's fetch and WebSocket, and a Chrome already installed. The dev server must be
// running (`make dev`, or `npx vite --port 5173`).
//
//   node scripts/run-lab.mjs [--query "scenarios=lab.selftest"] [--angle gl|vulkan|swiftshader|default]
//                            [--chrome /path/to/chrome] [--url http://localhost:5173/particle-simulator/lab.html]
//                            [--out results.json] [--timeout 1200]
//
// Exit code: 0 when no scenario failed, 1 when one did, 2 when the lab could not run.

import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({
    options: {
        url: { type: 'string', default: 'http://localhost:5173/particle-simulator/lab.html' },
        query: { type: 'string', default: '' },
        chrome: { type: 'string', default: process.env.LAB_CHROME ?? '' },
        angle: { type: 'string', default: 'gl' },
        out: { type: 'string', default: '' },
        timeout: { type: 'string', default: '1200' },
    },
});

const CHROME_CANDIDATES = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'chrome'];
const POLL_MS = 1000;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function launch(userDataDir) {
    const flags = [
        '--headless=new', `--user-data-dir=${userDataDir}`, '--remote-debugging-port=0', '--no-first-run',
        '--window-size=1280,900', '--ignore-gpu-blocklist', '--enable-webgl',
        // The page is hidden to the window manager: keep its timers and animation frames running.
        '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    ];
    if (args.angle !== 'default') flags.push(`--use-angle=${args.angle}`);
    if (args.angle === 'swiftshader') flags.push('--enable-unsafe-swiftshader');
    if (process.env.LAB_NO_SANDBOX) flags.push('--no-sandbox');
    flags.push('about:blank');
    const candidates = args.chrome ? [args.chrome] : CHROME_CANDIDATES;
    for (const command of candidates) {
        const child = spawn(command, flags, { stdio: ['ignore', 'ignore', 'pipe'] });
        const endpoint = await new Promise(resolve => {
            let text = '';
            child.once('error', () => resolve(null));
            child.once('exit', () => resolve(null));
            child.stderr.on('data', chunk => {
                text += chunk;
                const found = /DevTools listening on (ws:\/\/[^\s]+)/.exec(text);
                if (found) resolve(found[1]);
            });
        });
        if (endpoint) return { child, endpoint };
    }
    throw new Error(`no Chrome could be started (tried ${candidates.join(', ')}); set --chrome or LAB_CHROME`);
}

/** A minimal DevTools protocol client over one WebSocket. */
class Cdp {
    constructor(url) {
        this.next = 1;
        this.pending = new Map();
        this.listeners = [];
        this.socket = new WebSocket(url);
        this.opened = new Promise((resolve, reject) => {
            this.socket.addEventListener('open', resolve);
            this.socket.addEventListener('error', () => reject(new Error(`cannot connect to ${url}`)));
        });
        this.socket.addEventListener('message', event => {
            const message = JSON.parse(String(event.data));
            if (message.id !== undefined) {
                const entry = this.pending.get(message.id);
                this.pending.delete(message.id);
                if (message.error) entry?.reject(new Error(message.error.message));
                else entry?.resolve(message.result);
            } else {
                for (const listener of this.listeners) listener(message);
            }
        });
    }

    send(method, params = {}, sessionId) {
        const id = this.next++;
        this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
        return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    }

    on(listener) { this.listeners.push(listener); }
    close() { this.socket.close(); }
}

async function main() {
    const timeoutMs = Number(args.timeout) * 1000;
    const userDataDir = await mkdtemp(join(tmpdir(), 'lab-chrome-'));
    let chrome = null;
    let cdp = null;
    try {
        const launched = await launch(userDataDir);
        chrome = launched.child;
        cdp = new Cdp(launched.endpoint);
        await cdp.opened;
        const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
        const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
        const page = (method, params) => cdp.send(method, params, sessionId);
        cdp.on(message => {
            if (message.sessionId !== sessionId) return;
            if (message.method === 'Runtime.exceptionThrown') {
                console.error('[page exception]', message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
            } else if (message.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(message.params.type)) {
                console.error(`[page ${message.params.type}]`, message.params.args.map(a => a.value ?? a.description).join(' '));
            } else if (message.method === 'Runtime.consoleAPICalled' && message.params.args[0]?.value?.startsWith?.('[lab]')) {
                console.error(message.params.args[0].value);
            }
        });
        await page('Runtime.enable');
        await page('Page.enable');
        const target = `${args.url}${args.query ? `?${args.query}` : ''}`;
        console.error(`opening ${target} (angle: ${args.angle})`);
        await page('Page.navigate', { url: target });

        const evaluate = async expression => {
            const { result, exceptionDetails } = await page('Runtime.evaluate', { expression, returnByValue: true });
            if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
            return result.value;
        };
        const deadline = Date.now() + timeoutMs;
        while (!(await evaluate('window.__labDone === true').catch(() => false))) {
            if (Date.now() > deadline) throw new Error(`the lab did not finish within ${args.timeout} s`);
            await sleep(POLL_MS);
        }
        const json = await evaluate('JSON.stringify(window.__labResults ?? null)');
        const status = await evaluate("document.getElementById('lab-status')?.textContent ?? ''");
        const results = JSON.parse(json);
        if (!results) throw new Error(`the lab produced no results (${status})`);
        if (args.out) await writeFile(args.out, JSON.stringify(results, null, 2));
        else console.log(JSON.stringify(results, null, 2));
        console.error(`\nrenderer: ${results.renderer}${results.software ? '  [SOFTWARE: timings invalid]' : ''}`);
        for (const s of results.scenarios) console.error(`${s.status.toUpperCase().padEnd(5)} ${s.id.padEnd(40)} ${String(s.durationMs).padStart(8)} ms  ${s.details.split('\n')[0]}`);
        return results.scenarios.some(s => s.status === 'fail') ? 1 : 0;
    } finally {
        cdp?.close();
        if (chrome && chrome.exitCode === null && chrome.signalCode === null) {
            const exited = new Promise(resolve => chrome.once('exit', resolve));
            chrome.kill('SIGKILL');
            await exited;
        }
        await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
    }
}

main().then(code => process.exit(code), error => {
    console.error(`run-lab: ${error.message}`);
    process.exit(2);
});
