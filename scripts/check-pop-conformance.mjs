import { runPopConformanceSuite } from '../dist/core/kernel/conformance/index.js';

const report = await runPopConformanceSuite();
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.conformant) process.exitCode = 1;
