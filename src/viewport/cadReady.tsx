import { useEffect } from 'react';
import { create } from 'zustand';
import { initKernel, onKernelReady } from '@/cad/kernel/kernel';
import { loadFont, onFontLoaded } from '@/cad/text/fonts';
import { useEditor } from '@/store/editorStore';
import type { FontId } from '@/types/document';

/**
 * Geometry that depends on asynchronously loaded resources (the WASM kernel,
 * fonts) is rebuilt when they arrive: components include `version` in their
 * memo keys.
 */
export const useCadReady = create<{ version: number; kernel: boolean }>(() => ({ version: 0, kernel: false }));

onKernelReady(() => useCadReady.setState((s) => ({ version: s.version + 1, kernel: true })));
onFontLoaded(() => useCadReady.setState((s) => ({ version: s.version + 1 })));

/**
 * Start the kernel and load every font the document uses. Mounted as its own
 * tiny component so document changes don't re-render the application shell.
 */
export function CadResources() {
  useCadResources();
  return null;
}

function useCadResources() {
  const doc = useEditor((s) => s.doc);
  useEffect(() => {
    initKernel().catch((e) => useEditor.getState().notify(`Solid-modelling engine failed to load: ${e}`));
  }, []);
  useEffect(() => {
    const fonts = new Set<FontId>();
    for (const o of Object.values(doc.objects)) if (o.kind === 'shape' && o.text) fonts.add(o.text.font);
    fonts.forEach((f) => loadFont(f).catch((e) => useEditor.getState().notify(`Font failed to load: ${e}`)));
  }, [doc]);
}
