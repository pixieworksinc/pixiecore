import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { withTempDirectory } from '../helpers/temp.js';
import { testData } from '../helpers/test-data.js';

const execFileAsync = promisify(execFile);
const checker = join(process.cwd(), 'scripts', 'check-docs.mjs');

test('documentation drift checker accepts local links, explicit sync, and packed files offline', async () => {
  await withTempDirectory(async root => {
    const data = testData('docs-drift-success');
    const content = `${data.text('canonical', 'source')}\n`;
    await createFixture(root, content, `
[source](source.txt#section)
[external](https://example.invalid/offline)
<!-- pixiecore-sync source="source.txt" -->
\`\`\`text
${content.trimEnd()}
\`\`\`
<!-- pixiecore-packed path="packed.txt" -->
`);

    const result = await runChecker(root);
    assert.equal(result.stderr, '');
    assert.match(result.stdout, /Documentation drift check passed/);
  }, 'pixiecore-docs-');
});

test('documentation drift checker reports missing links and escaping paths', async () => {
  await withTempDirectory(async root => {
    await createFixture(root, 'source\n', '[missing](missing.md)\n[escape](../../outside.md)\n');
    const result = await runChecker(root, true);
    assert.match(result.stderr, /missing relative link target: missing\.md/);
    assert.match(result.stderr, /link escapes repository/);
  }, 'pixiecore-docs-');
});

test('documentation drift checker reports marked snippet drift', async () => {
  await withTempDirectory(async root => {
    await createFixture(root, 'canonical\n', `
<!-- pixiecore-sync source="source.txt" -->
\`\`\`text
drifted
\`\`\`
`);
    const result = await runChecker(root, true);
    assert.match(result.stderr, /synced snippet drifted from source\.txt/);
  }, 'pixiecore-docs-');
});

test('documentation drift checker reports references excluded from the package', async () => {
  await withTempDirectory(async root => {
    await createFixture(root, 'source\n', '<!-- pixiecore-packed path="ignored.txt" -->\n');
    await writeFile(join(root, 'ignored.txt'), 'not packed\n');
    const result = await runChecker(root, true);
    assert.match(result.stderr, /referenced file is not packed: ignored\.txt/);
  }, 'pixiecore-docs-');
});

async function createFixture(root: string, source: string, readme: string): Promise<void> {
  await mkdir(root, { recursive: true });
  await Promise.all([
    writeFile(join(root, 'source.txt'), source),
    writeFile(join(root, 'packed.txt'), 'packed\n'),
    writeFile(join(root, 'README.md'), readme.trimStart()),
    writeFile(join(root, 'package.json'), JSON.stringify({
      name: 'pixiecore-docs-fixture',
      version: '1.0.0',
      files: ['README.md', 'source.txt', 'packed.txt'],
    })),
  ]);
}

async function runChecker(root: string, expectFailure = false) {
  try {
    return await execFileAsync(process.execPath, [checker, '--root', root]);
  } catch (error) {
    if (!expectFailure) throw error;
    const failure = error as Error & { stdout?: string; stderr?: string };
    return { stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' };
  }
}
