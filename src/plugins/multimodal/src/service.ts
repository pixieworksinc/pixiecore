/**
 * Implements service behavior for the multimodal plugin.
 */

import type { MultimodalServicePort } from '../../../core/contracts/multimodal/index.js';
import { attachmentBytes, resolveAttachment } from './attachments.js';
import {
  contentParts,
  contentText,
  enhanceMessagesWithMultimodal,
  normalizeAttachmentInput,
} from './content.js';
import { makeDataUrl, mimeFromName, parseDataUrl } from './encoding.js';
import { extractPdfText } from './pdf.js';

/** Creates one immutable capability set without reading attachments or loading PDF code. */
export function createMultimodalService(): MultimodalServicePort {
  return Object.freeze({
    resolveAttachment,
    attachmentBytes,
    enhanceMessagesWithMultimodal,
    contentParts,
    contentText,
    normalizeAttachmentInput,
    makeDataUrl,
    mimeFromName,
    parseDataUrl,
    extractPdfText,
  });
}
