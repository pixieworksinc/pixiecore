/** Canonical Gemini API URL construction owned by the providers plugin. */
/**
 * Handles gemini url for the owning PixieCore boundary.
 */
export function geminiUrl(path: string, apiKey: string): string {
  return joinUrl('https://generativelanguage.googleapis.com/v1beta', path, { key: apiKey });
}

/**
 * Handles gemini upload url for the owning PixieCore boundary.
 */
export function geminiUploadUrl(apiKey: string): string {
  return joinUrl('https://generativelanguage.googleapis.com/upload/v1beta', 'files', {
    key: apiKey,
  });
}

function joinUrl(baseUrl: string, path: string, query: Record<string, string>): string {
  const url = new URL(baseUrl);
  if (path) {
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
  }
  for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
  return url.toString();
}
