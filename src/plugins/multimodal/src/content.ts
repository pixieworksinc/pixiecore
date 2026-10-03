/**
 * Implements content behavior for the multimodal plugin.
 */

import { InputTypeError, MultimodalNotSupportedError } from '../../../core/contracts/errors/index.js';
import type {
  Message,
  MessageContent,
  MessageContentPart,
  Provider,
  UserMessage,
} from '../../../core/contracts/types/index.js';

/**
 * Enhances messages with multimodal for the owning PixieCore boundary.
 */
export function enhanceMessagesWithMultimodal(
  messages: readonly Message[],
  inputs: Readonly<Record<string, unknown>>,
  provider: Provider,
): Message[] {
  const imagePaths = normalizeAttachmentInput(inputs.image_path, 'image_path');
  const filePaths = normalizeAttachmentInput(inputs.file_path, 'file_path');
  if (!imagePaths.length && !filePaths.length) return [...messages];

  if (imagePaths.length && !provider.supportsVision()) {
    throw new MultimodalNotSupportedError(
      `Model ${provider.model} does not support vision. Try a vision-capable model such as gpt-4o, claude-3, or gemini-1.5.`,
    );
  }
  if (filePaths.length && !provider.supportsFileInput()) {
    throw new MultimodalNotSupportedError(`${provider.name} does not support file inputs.`);
  }

  const attachments: MessageContentPart[] = [
    ...imagePaths.map(source => ({ type: 'image' as const, source })),
    ...filePaths.map(source => ({ type: 'file' as const, source })),
  ];
  return messages.map(message => {
    if (message.role !== 'user') return message;
    return {
      ...message,
      content: [...contentParts(message.content), ...attachments],
    } satisfies UserMessage;
  });
}

/**
 * Normalizes attachment input while preserving caller-owned input.
 */
export function normalizeAttachmentInput(
  value: unknown,
  name: 'image_path' | 'file_path',
): string[] {
  if (value === undefined || value === null) return [];
  if (typeof value === 'string') return [value];
  if (Array.isArray(value) && value.every(item => typeof item === 'string')) return [...value];
  throw new InputTypeError(`${name} must be str or list[str]`);
}

/**
 * Returns normalized multimodal content parts.
 */
export function contentParts(content: MessageContent): MessageContentPart[] {
  if (typeof content !== 'string') return [...content];
  return content ? [{ type: 'text', text: content }] : [];
}

/**
 * Returns the text represented by normalized content parts.
 */
export function contentText(content: MessageContent): string {
  if (typeof content === 'string') return content;
  return content
    .filter(part => part.type === 'text')
    .map(part => part.text)
    .join('');
}
