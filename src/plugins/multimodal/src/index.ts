/**
 * Implements src behavior for the multimodal plugin.
 */

export { attachmentBytes, resolveAttachment } from './attachments.js';
export {
  contentParts,
  contentText,
  enhanceMessagesWithMultimodal,
  normalizeAttachmentInput,
} from './content.js';
export { makeDataUrl, mimeFromName, parseDataUrl } from './encoding.js';
export { extractPdfText } from './pdf.js';
export { createMultimodalService } from './service.js';
