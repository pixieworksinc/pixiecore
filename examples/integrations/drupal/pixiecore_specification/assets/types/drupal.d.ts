/** Describes only the Drupal/once browser ports used by the demo behavior. */
declare const Drupal: {
  behaviors: Record<string, { attach(context: Document | HTMLElement): void }>;
  /** Translates one UI status string using Drupal's browser translation port. */
  t(text: string): string;
};

/** Returns unprocessed elements from Drupal's once library. */
declare function once(id: string, selector: string, context: Document | HTMLElement): HTMLElement[];

/** Describes the CodeMirror 5 instance attached to a Drupal textarea. */
interface CodeMirrorInstance {
  /** Returns the current editor contents. */
  getValue(): string;
  /** Subscribes to editor changes. */
  on(event: 'change', callback: () => void): void;
}
