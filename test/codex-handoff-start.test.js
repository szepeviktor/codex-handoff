const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const bin = path.resolve(__dirname, '../bin/codex-handoff-start.js');

test('CODEX_HANDOFF=0 disables handoff loading', (t) => {
  const fixture = makeSessionFixture(t);
  const result = spawnSync(process.execPath, [bin], {
    cwd: fixture.root,
    env: {
      ...process.env,
      CODEX_HOME: fixture.codexHome,
      CODEX_HANDOFF: '0',
    },
    input: JSON.stringify({
      cwd: fixture.root,
      transcript_path: fixture.currentSession,
    }),
    encoding: 'utf8',
  });

  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.deepEqual(JSON.parse(result.stdout), { continue: true });
});

test('loads matching handoff when enabled', (t) => {
  const fixture = makeSessionFixture(t);
  const result = spawnSync(process.execPath, [bin], {
    cwd: fixture.root,
    env: {
      ...process.env,
      CODEX_HOME: fixture.codexHome,
      CODEX_HANDOFF: '',
    },
    input: JSON.stringify({
      cwd: fixture.root,
      transcript_path: fixture.currentSession,
    }),
    encoding: 'utf8',
  });

  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');

  const output = JSON.parse(result.stdout);
  assert.equal(output.continue, true);
  assert.match(output.systemMessage, /codex-handoff started/);
  assert.match(output.hookSpecificOutput.additionalContext, /Loaded from fixture/);
});

function makeSessionFixture(t) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-handoff-test-'));
  const root = path.join(temp, 'project');
  const codexHome = path.join(temp, 'codex-home');
  const sessionDir = path.join(codexHome, 'sessions', '2026', '09', '14');
  const previousSession = path.join(sessionDir, 'previous.jsonl');
  const currentSession = path.join(sessionDir, 'current.jsonl');

  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.writeFileSync(previousSession, previousSessionJsonl(root));
  fs.writeFileSync(currentSession, '');
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));

  return { root, codexHome, currentSession };
}

function previousSessionJsonl(root) {
  const handoff = {
    version: 1,
    root,
    created_at: '2026-09-14T00:00:00Z',
    ttl_hours: 72,
    summary: ['Loaded from fixture'],
    open_items: [],
    verification: [],
  };

  return [
    JSON.stringify({
      type: 'session_meta',
      payload: { cwd: root },
    }),
    JSON.stringify({
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'assistant',
        phase: 'final_answer',
        content: [
          {
            type: 'output_text',
            text: ['```codex-handoff', JSON.stringify(handoff), '```'].join('\n'),
          },
        ],
      },
    }),
    '',
  ].join('\n');
}
