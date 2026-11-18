import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const run = (args, cwd = process.cwd()) => spawnSync(process.execPath, ['src/cli.js', ...args], {
  encoding: 'utf8',
  cwd,
});

test('命令帮助列出全部采集与目录管理入口且正常退出', () => {
  const result = run(['--help']);
  assert.equal(result.status, 0);
  const help = JSON.parse(result.stdout);
  assert.ok(help.usage.includes('npm start'));
  for (const command of ['ingest', 'query', 'decide', 'catalog', 'pending', 'trace']) {
    assert.ok(help.commands.includes(command), `help 缺少 ${command}`);
    assert.ok(help.details[command], `help 缺少 ${command} 的说明`);
  }
});

test('未知动作明确失败而不执行默认查询', () => {
  const result = run(['invalid-action']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /ingest, query, decide, catalog, pending or trace/);
});

test('CLI 端到端：采集、待确认、决策、反查与重放不撤销人工决定', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'catalog-cli-'));
  try {
    const stateDir = join(directory, 'state');
    const inputPath = join(directory, 'records.json');
    const decisionPath = join(directory, 'decisions.json');
    await writeFile(inputPath, JSON.stringify([
      {
        sourceId: 'a:a-red-m', source: '商品目录采集器', observedAt: '2026-11-16T08:00:00Z',
        label: '衬衫',
        attributes: {
          variantId: 'a-red-m', productId: 'P1', channel: 'a', name: '衬衫',
          color: '红', size: 'M', mappingVersion: 1, observedAt: '2026-11-16T08:00:00Z',
        },
      },
      {
        sourceId: 'b:b-17', source: '商品目录采集器', observedAt: '2026-11-16T08:00:00Z',
        label: '衬衫',
        attributes: {
          variantId: 'b-17', productId: 'shirt', channel: 'b', name: '衬衫',
          tone: 'red', dimension: 'M', mappingVersion: 1, observedAt: '2026-11-16T08:00:00Z',
        },
      },
    ]));

    const ingested = JSON.parse(run(['ingest', inputPath, '--state-dir', stateDir]).stdout);
    assert.equal(ingested.accepted, 2);
    assert.equal(ingested.pending, 2, '无决策时两条都待确认');

    const pending = JSON.parse(run(['pending', '--state-dir', stateDir]).stdout);
    assert.deepEqual(pending.map((item) => item.sourceId).sort(), ['a:a-red-m', 'b:b-17']);

    await writeFile(decisionPath, JSON.stringify([{
      source: 'b', variantId: 'b-17', canonicalProduct: 'shirt', canonicalVariant: 'red-medium',
      decisionRevision: 1, confirmedBy: 'operator-local', confirmedAt: '2026-11-16T10:00:00Z',
    }]));
    const decided = JSON.parse(run(['decide', decisionPath, '--state-dir', stateDir]).stdout);
    assert.equal(decided.applied, 1);
    assert.equal(decided.catalog.pending, 1);

    const catalog = JSON.parse(run(['catalog', '--state-dir', stateDir]).stdout);
    assert.equal(catalog.variants[0].canonicalVariant, 'red-medium');
    assert.equal(catalog.mappings[0].basis.confirmedBy, 'operator-local');

    const trace = JSON.parse(run(['trace', 'red-medium', '--state-dir', stateDir]).stdout);
    assert.deepEqual(trace.variant.sources, ['b:b-17']);
    assert.equal(trace.decisionHistory[0].decisionRevision, 1);

    // 同 revision 再次追加必须失败且台账不被改动。
    const rejected = run(['decide', decisionPath, '--state-dir', stateDir]);
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /must be greater than 1/);
    const storedDecisions = JSON.parse(await readFile(join(stateDir, 'decisions.json'), 'utf8'));
    assert.equal(storedDecisions.decisions.length, 1);

    assert.throws(() => JSON.parse(run(['trace', 'unknown', '--state-dir', stateDir]).stdout), SyntaxError);
    assert.notEqual(run(['trace', 'unknown', '--state-dir', stateDir]).status, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
