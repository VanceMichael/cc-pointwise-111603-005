import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('命令帮助列出导入、查询和目录管理入口且正常退出', () => {
  const result = spawnSync(process.execPath, ['src/cli.js', '--help'], {encoding: 'utf8'});
  assert.equal(result.status, 0);
  const help = JSON.parse(result.stdout);
  assert.ok(help.usage.includes('ingest'));
  assert.deepEqual(help.commands, ['ingest', 'query', 'collect', 'decide', 'catalog', 'trace']);
});

test('未知动作明确失败而不执行默认查询', () => {
  const result = spawnSync(process.execPath, ['src/cli.js', 'invalid-action'], {encoding: 'utf8'});
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /ingest, query/);
});

test('collect、decide、catalog、trace 构成完整的确认与反查流程', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cli-catalog-'));
  try {
    const env = { ...process.env, STATE_DIR: directory };
    const run = (args) => spawnSync(process.execPath, ['src/cli.js', ...args], { encoding: 'utf8', env });

    let result = run(['collect', 'fixtures/records.json']);
    assert.equal(result.status, 0, result.stderr);
    let output = JSON.parse(result.stdout);
    assert.equal(output.pending, 1, '没有人工决定时条目保持待确认');

    result = run(['decide']);
    assert.equal(result.status, 0, result.stderr);
    output = JSON.parse(result.stdout);
    assert.equal(output.applied, 3);
    assert.equal(output.decisionRevision, 4);

    result = run(['catalog']);
    assert.equal(result.status, 0, result.stderr);
    output = JSON.parse(result.stdout);
    assert.equal(output.pending.length, 0, '决定生效后待确认条目被解析');
    const redMedium = output.variants.find((variant) => variant.variantId === 'red-medium');
    assert.ok(redMedium.sources.some((source) => source.channel === 'a' && source.mappingVersion === 1));

    result = run(['trace', 'red-medium']);
    assert.equal(result.status, 0, result.stderr);
    output = JSON.parse(result.stdout);
    assert.equal(output.sources[0].basis.confirmedBy, 'operator-local');
    assert.equal(output.sources[0].sourceFields.color, '红');

    result = run(['trace', 'unknown-variant']);
    assert.notEqual(result.status, 0, '未知变体明确失败');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
