import { useSplit } from '../store';
import { sampleEyeBadge } from '../fixtures/build3mf';

let input: HTMLInputElement | null = null;

/** Open the file picker for a 3MF file. */
export function openSplitPicker() {
  if (!input) {
    input = document.createElement('input');
    input.type = 'file';
    input.accept = '.3mf,model/3mf,application/vnd.ms-package.3dmanufacturing-3dmodel+xml';
    input.setAttribute('data-testid', 'split-file-input');
    input.style.display = 'none';
    input.addEventListener('change', () => {
      const file = input?.files?.[0];
      if (file) void useSplit.getState().importFile(file);
      if (input) input.value = '';
    });
    document.body.appendChild(input);
  }
  input.click();
}

/** Load the built-in multi-colour sample (generated in the browser, not downloaded). */
export function openSample() {
  const bytes = sampleEyeBadge();
  void useSplit.getState().importFile(new File([bytes as BlobPart], 'eye-badge-sample.3mf', { type: 'model/3mf' }));
}
