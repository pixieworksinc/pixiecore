import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractPdfTextFromLoadingTask,
  type PdfLoadingTask,
} from '../../../../plugins/multimodal/src/pdf.js';

test('PDF parser task is destroyed after exact text extraction', async () => {
  let destroyCount = 0;
  const loadingTask: PdfLoadingTask = {
    promise: Promise.resolve({
      numPages: 1,
      async getPage() {
        return {
          async getTextContent() {
            return { items: [{ str: 'first' }, { str: '' }, {}, { str: 'last' }] };
          },
        };
      },
    }),
    async destroy() { destroyCount += 1; },
  };

  assert.equal(await extractPdfTextFromLoadingTask(loadingTask), 'first last');
  assert.equal(destroyCount, 1);
});

test('PDF parser task is destroyed when document loading rejects', async () => {
  const failure = new Error('invalid PDF fixture');
  let destroyCount = 0;
  const loadingTask: PdfLoadingTask = {
    promise: Promise.reject(failure),
    async destroy() { destroyCount += 1; },
  };

  await assert.rejects(extractPdfTextFromLoadingTask(loadingTask), failure);
  assert.equal(destroyCount, 1);
});
