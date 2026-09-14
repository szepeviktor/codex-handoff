#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');

const MAX_FILES = positiveInt(process.env.CODEX_HANDOFF_MAX_FILES, 200);
const MAX_BYTES = positiveInt(process.env.CODEX_HANDOFF_MAX_BYTES, 50 * 1024 * 1024);
const MAX_CONTEXT_CHARS = positiveInt(process.env.CODEX_HANDOFF_MAX_CONTEXT_CHARS, 12000);
const FENCE_RE = /```codex-handoff\s*\n([\s\S]*?)\n```/g;

main().catch((error) => {
  finish({ systemMessage: `codex-handoff could not load handoff: ${error.message}` });
});

async function main() {
  if (handoffDisabled()) {
    finish();
    return;
  }

  const hook = parseJson(await readStdin()) || {};
  const cwd = currentCwd(hook);
  const sessionRoot = path.resolve(cwd);
  const currentSession = transcriptPath(hook);
  const handoff = await findLatestHandoff({ sessionRoot, currentSession });

  if (!handoff) {
    finish();
    return;
  }

  finish({
    systemMessage: `codex-handoff started with handoff context for ${sessionRoot}`,
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: formatAdditionalContext(handoff, sessionRoot),
    },
  });
}

async function findLatestHandoff(context) {
  const files = sessionFiles(defaultCodexHome())
    .filter((file) => file.file !== context.currentSession)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, MAX_FILES);

  for (const entry of files) {
    const session = await scanSession(entry.file);
    if (!session || !sameSessionRoot(session, context)) continue;
    const handoff = latestValidHandoff(session.messages, context.sessionRoot);
    if (handoff) return { ...handoff, session };
  }

  return null;
}

async function scanSession(file) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return null;
  }
  if (!stat.isFile() || stat.size > MAX_BYTES) return null;

  const session = {
    file,
    mtimeMs: stat.mtimeMs,
    cwd: null,
    messages: [],
  };

  await new Promise((resolve) => {
    const stream = fs.createReadStream(file, { encoding: 'utf8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    rl.on('line', (line) => consumeLine(line, session));
    rl.on('close', resolve);
    rl.on('error', resolve);
    stream.on('error', resolve);
  });

  return session.cwd ? session : null;
}

function consumeLine(line, session) {
  const record = parseJson(line);
  if (!record || typeof record !== 'object') return;

  const payload = objectValue(record.payload);
  if (record.type === 'session_meta') {
    session.cwd = stringValue(payload.cwd) || session.cwd;
    return;
  }

  if (record.type === 'turn_context') {
    session.cwd = stringValue(payload.cwd) || session.cwd;
    return;
  }

  if (record.type !== 'response_item') return;
  if (payload.type !== 'message' || payload.role !== 'assistant') return;
  if (payload.phase && payload.phase !== 'final_answer') return;

  const text = messageText(payload);
  if (text) session.messages.push(text);
}

function latestValidHandoff(messages, sessionRoot) {
  for (let i = messages.length - 1; i >= 0; i--) {
    for (const block of handoffBlocks(messages[i]).reverse()) {
      const data = parseJson(block);
      if (!data || data.version !== 1) continue;
      const handoffRoot = stringValue(data.root) || stringValue(data.repo);
      if (handoffRoot && path.resolve(handoffRoot) !== sessionRoot) continue;
      if (expired(data)) continue;
      return { data };
    }
  }
  return null;
}

function handoffBlocks(text) {
  const blocks = [];
  for (const match of text.matchAll(FENCE_RE)) blocks.push(match[1].trim());
  return blocks;
}

function sameSessionRoot(session, context) {
  return path.resolve(session.cwd) === context.sessionRoot;
}

function expired(data) {
  const ttlHours = positiveInt(data.ttl_hours, 0);
  if (!ttlHours) return false;

  const createdAt = Date.parse(data.created_at || '');
  if (!Number.isFinite(createdAt)) return false;

  return Date.now() - createdAt > ttlHours * 60 * 60 * 1000;
}

function formatAdditionalContext(handoff, sessionRoot) {
  const data = handoff.data;
  const payload = JSON.stringify(data, null, 2);
  return [
    `Session-root-scoped Codex handoff loaded for ${sessionRoot}.`,
    'Use it as optional background only. Current user instructions take priority.',
    '',
    '```json',
    payload.slice(0, MAX_CONTEXT_CHARS),
    '```',
  ].join('\n');
}

function currentCwd(hook) {
  return stringValue(hook.cwd)
    || stringValue(hook.workspace && hook.workspace.cwd)
    || stringValue(hook.payload && hook.payload.cwd)
    || process.cwd();
}

function transcriptPath(hook) {
  return stringValue(hook.transcript_path)
    || stringValue(hook.transcriptPath)
    || stringValue(hook.payload && hook.payload.transcript_path)
    || stringValue(hook.payload && hook.payload.transcriptPath);
}

function sessionFiles(codexHome) {
  const roots = ['sessions', 'archived_sessions']
    .map((name) => path.join(codexHome, name))
    .filter((root) => {
      try { return fs.statSync(root).isDirectory(); } catch { return false; }
    });

  const files = [];
  for (const root of roots) walk(root, files);
  return files;
}

function walk(root, files) {
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, files);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
    try {
      const stat = fs.statSync(fullPath);
      files.push({ file: fullPath, mtimeMs: stat.mtimeMs });
    } catch {
      // Ignore disappearing session files.
    }
  }
}

function messageText(payload) {
  const content = Array.isArray(payload.content) ? payload.content : [];
  return content
    .map((part) => stringValue(part.text) || '')
    .filter(Boolean)
    .join('\n')
    .trim();
}

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    const timer = setTimeout(() => resolve(data), 1000).unref();
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => {
      clearTimeout(timer);
      resolve(data);
    });
    process.stdin.on('error', () => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

function finish(extra = {}) {
  process.stdout.write(JSON.stringify({ continue: true, ...extra }));
}

function defaultCodexHome() {
  return process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
}

function handoffDisabled() {
  const value = process.env.CODEX_HANDOFF;
  if (value === undefined) return false;

  return ['0', 'false', 'off', 'no', 'disabled'].includes(value.trim().toLowerCase());
}

function parseJson(value) {
  try {
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function objectValue(value) {
  return value && typeof value === 'object' ? value : {};
}

function stringValue(value) {
  return typeof value === 'string' && value ? value : null;
}

function positiveInt(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}
