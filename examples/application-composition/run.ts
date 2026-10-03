import { composePublicationBrief } from './publication-brief.js';

const sourceText = process.argv[2];
const locale = process.argv[3];
if (!sourceText || !locale) {
  throw new TypeError('Usage: tsx run.ts <source-text> <locale>');
}

console.log(JSON.stringify(await composePublicationBrief({ sourceText, locale }), null, 2));
