/**
 * Implements pdf behavior for the multimodal plugin.
 */

import { attachmentBytes } from './attachments.js';
import type { ResolvedAttachment } from '../../../core/contracts/multimodal/index.js';

interface PdfTextContent {
  readonly items: readonly object[];
}

interface PdfPage {
  /**
   * Returns text content without exposing mutable internal state.
   */
  getTextContent(): Promise<PdfTextContent>;
}

interface PdfDocument {
  readonly numPages: number;
  /**
   * Returns page without exposing mutable internal state.
   */
  getPage(pageNumber: number): Promise<PdfPage>;
}

/**
 * Describes the pdf loading task contract.
 */
export interface PdfLoadingTask {
  readonly promise: Promise<PdfDocument>;
  /**
   * Releases resources owned by the implementation.
   */
  destroy(): Promise<void>;
}

/**
 * Extracts ordered text content from a PDF attachment.
 */
export async function extractPdfText(
  attachment: ResolvedAttachment,
  fetcher: typeof globalThis.fetch = globalThis.fetch,
): Promise<string> {
  const data = await attachmentBytes(attachment, fetcher);
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // pdfjs rejects Node.js Buffer instances even though Buffer extends
  // Uint8Array. Copy into a plain Uint8Array at this library boundary.
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(data) });
  return extractPdfTextFromLoadingTask(loadingTask);
}

/** Internal lifecycle seam used to verify that parser resources always close. */
export async function extractPdfTextFromLoadingTask(
  loadingTask: PdfLoadingTask,
): Promise<string> {
  const pages: string[] = [];
  try {
    const document = await loadingTask.promise;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber);
      const text = await page.getTextContent();
      pages.push(text.items
        .map(item => ('str' in item && typeof item.str === 'string' ? item.str : ''))
        .filter(Boolean)
        .join(' '));
    }
  } finally {
    await loadingTask.destroy();
  }
  return pages.join('\n\n');
}
