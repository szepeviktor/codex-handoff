const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const bin = path.resolve(__dirname, '../bin/codex-handoff-stop.js');

test('Stop hook suggests a handoff checkpoint when thresholds are crossed', (t) => {
  const file = makeTranscript(t, [
    JSON.stringify({
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          last_token_usage: { total_tokens: 100001 },
          total_token_usage: { total_tokens: 30 },
        },
      },
    }),
    JSON.stringify({
      type: 'response_item',
      payload: {
        type: 'function_call_output',
        output: 'Original token count: 100001',
      },
    }),
    '',
  ].join('\n'));

  const result = spawnSync(process.execPath, [bin], {
    input: JSON.stringify({ transcript_path: file }),
    encoding: 'utf8',
  });

  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');

  const output = JSON.parse(result.stdout);
  assert.equal(output.continue, true);
  assert.match(output.systemMessage, /Handoff checkpoint suggested/);
  assert.match(output.systemMessage, /handoff skill/);
});

test('Stop hook stays quiet below thresholds', (t) => {
  const file = makeTranscript(t, [
    JSON.stringify({
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          last_token_usage: { total_tokens: 12 },
          total_token_usage: { total_tokens: 30 },
        },
      },
    }),
    '',
  ].join('\n'));

  const result = spawnSync(process.execPath, [bin], {
    input: JSON.stringify({ transcript_path: file }),
    encoding: 'utf8',
  });

  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.deepEqual(JSON.parse(result.stdout), { continue: true });
});

function makeTranscript(t, contents) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-handoff-stop-test-'));
  const file = path.join(temp, 'session.jsonl');
  fs.writeFileSync(file, contents);
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  return file;
}
