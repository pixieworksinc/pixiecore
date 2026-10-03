import { fileURLToPath } from 'node:url';
import { PromptRuntime } from '@pixieworks/pixiecore';

await using runtime = new PromptRuntime();
console.log(await runtime.execute(fileURLToPath(new URL('./hello.yaml', import.meta.url)), { name: 'World' }));
