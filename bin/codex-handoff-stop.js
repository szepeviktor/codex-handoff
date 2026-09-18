#!/usr/bin/env node
'use strict';

const fs = require('node:fs');

const MAX_BYTES = 50 * 1024 * 1024;
const LIMITS = {
  latestTokens: 100000,
  sessionTokens: 2000000,
  turns: 40,
  toolCalls: 75,
  toolOutputTokens: 100000,
};

main().catch(() => finish());

async function main() {
  const hook = parseJson(await readStdin()) || {};
  const file = transcriptPath(hook);
  const summary = file && summarize(file);
  const warning = summary && checkpointWarning(summary);

  finish(warning);
}

function summarize(file) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return null;
  }
  if (!stat.isFile() || stat.size > MAX_BYTES) return null;

  const summary = {
    latestTokens: 0,
    sessionTokens: 0,
    turns: 0,
    toolCalls: 0,
    toolOutputTokens: 0,
  };

  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const record = parseJson(line);
    if (!record || typeof record !== 'object') continue;
    const payload = objectValue(record.payload);

    if (record.type === 'response_item') {
      if (payload.type === 'function_call') summary.toolCalls++;
      if (payload.type === 'function_call_output') {
        summary.toolOutputTokens = Math.max(summary.toolOutputTokens, originalTokenCount(payload.output));
      }
      continue;
    }

    if (record.type !== 'event_msg' || payload.type !== 'token_count') continue;
    const info = objectValue(payload.info);
    summary.latestTokens = numeric(objectValue(info.last_token_usage).total_tokens);
    summary.sessionTokens = numeric(objectValue(info.total_token_usage).total_tokens);
    summary.turns++;
  }

  return summary.turns || summary.toolCalls ? summary : null;
}

function checkpointWarning(summary) {
  const hits = [
    metric('latest turn', summary.latestTokens, LIMITS.latestTokens),
    metric('session total', summary.sessionTokens, LIMITS.sessionTokens),
    metric('turns', summary.turns, LIMITS.turns),
    metric('tool calls', summary.toolCalls, LIMITS.toolCalls),
    metric('largest tool output', summary.toolOutputTokens, LIMITS.toolOutputTokens),
  ].filter(Boolean);

  if (!hits.length) return null;

  return [
    `Handoff checkpoint suggested: ${hits.slice(0, 3).join('; ')}.`,
    'Before starting fresh, ask Codex to use the handoff skill so the next session can resume with compact context.',
  ].join(' ');
}

function metric(label, value, limit) {
  if (!limit || value < limit) return null;
  return `${label} ${formatNumber(value)} >= ${formatNumber(limit)}`;
}

function originalTokenCount(output) {
  const text = typeof output === 'string' ? output : JSON.stringify(output || '');
  let max = 0;
  for (const match of text.matchAll(/Original token count: (\d+)/g)) {
    max = Math.max(max, numeric(match[1]));
  }
  return max;
}

function transcriptPath(hook) {
  return stringValue(hook.transcript_path)
    || stringValue(hook.transcriptPath)
    || stringValue(hook.payload && hook.payload.transcript_path)
    || stringValue(hook.payload && hook.payload.transcriptPath);
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

function finish(systemMessage = null) {
  const output = { continue: true };
  if (systemMessage) output.systemMessage = systemMessage;
  process.stdout.write(JSON.stringify(output));
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

function numeric(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function formatNumber(value) {
  return Math.round(value).toLocaleString('en-US');
}
