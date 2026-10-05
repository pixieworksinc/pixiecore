/**
 * @file
 * Marks unsaved inputs and instructions without interpreting pricing rules.
 */

(function attachSpecificationEditor(Drupal, once) {
  Drupal.behaviors.pixiecoreSpecification = {
    /**
     * Attaches one dirty-state listener to each Drupal form.
     *
     * @param {Document|HTMLElement} context
     *   The Drupal behavior context.
     */
    attach(context) {
      once('pixiecore-specification', '[data-specification-editor]', context).forEach((form) => {
        const instruction = form.querySelector('[data-specification-instruction]');
        const inputs = form.querySelector('[data-specification-inputs]');
        const execute = form.querySelector('[data-specification-execute]');
        const status = form.querySelector('[data-specification-dirty]');
        if (!(instruction instanceof HTMLTextAreaElement)
          || !(inputs instanceof HTMLTextAreaElement)
          || !(execute instanceof HTMLInputElement)
          || !(status instanceof HTMLElement)) return;
        const savedText = instruction.value;
        const savedInputs = inputs.value;
        const initiallyDisabled = execute.disabled;
        /** @param {HTMLTextAreaElement} textarea */
        const valueOf = (textarea) => {
          const editorElement = /** @type {HTMLElement & { CodeMirror?: CodeMirrorInstance }} */ (textarea.nextElementSibling);
          return editorElement?.CodeMirror?.getValue() ?? textarea.value;
        };
        const markDirty = () => {
          const dirty = valueOf(instruction) !== savedText || valueOf(inputs) !== savedInputs;
          execute.disabled = initiallyDisabled || dirty;
          status.textContent = dirty ? Drupal.t('Unsaved changes. Save before Execute.') : Drupal.t('Saved');
        };
        /** @param {HTMLTextAreaElement} textarea */
        const bindEditor = (textarea) => {
          const editorElement = /** @type {HTMLElement & { CodeMirror?: CodeMirrorInstance }} */ (textarea.nextElementSibling);
          if (editorElement?.CodeMirror) {
            editorElement.CodeMirror.on('change', markDirty);
            return;
          }
          textarea.addEventListener('input', markDirty);
        };
        window.setTimeout(() => {
          bindEditor(instruction);
          bindEditor(inputs);
        }, 0);
        form.addEventListener('submit', () => {
          // Preserve the clicked button's name for Form API operation selection.
          window.setTimeout(() => { execute.disabled = true; }, 0);
        });
      });
    },
  };
})(Drupal, once);
