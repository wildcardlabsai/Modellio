/**
 * Loader and minimal typings for the official 3MF Consortium library (lib3mf, compiled to
 * WebAssembly). Only the calls the importer uses are typed. Known binding gaps (vector
 * getters and ReadFromBuffer are unbound in 2.5.0) are avoided: the package is written to
 * the Emscripten in-memory file system and data is read element by element.
 */
import lib3mfFactory from '@3mfconsortium/lib3mf';

/* eslint-disable @typescript-eslint/no-explicit-any -- the WASM binding is untyped; this module is the typed boundary. */
export type L3Enum = { value: number };
export interface L3Module {
  CWrapper: new () => L3Wrapper;
  FS: { writeFile(path: string, data: Uint8Array): void; unlink(path: string): void };
  eModelUnit: Record<'MicroMeter' | 'MilliMeter' | 'CentiMeter' | 'Inch' | 'Foot' | 'Meter', L3Enum>;
  ePropertyType: Record<'NoPropertyType' | 'BaseMaterial' | 'TexCoord' | 'Colors' | 'Composite' | 'Multi', L3Enum>;
  eObjectType: Record<'Other' | 'Model' | 'Support' | 'SolidSupport' | 'Surface', L3Enum>;
}
export interface L3Wrapper {
  CreateModel(): L3Model;
  GetLibraryVersion?(): any;
}
export type L3Model = any;
/* eslint-enable @typescript-eslint/no-explicit-any */

let loading: Promise<L3Module> | null = null;

/** Load (once per worker) the lib3mf WebAssembly module. `wasmUrl` overrides where the .wasm file is fetched from. */
export function loadLib3mf(wasmUrl?: string): Promise<L3Module> {
  if (!loading) {
    const options = wasmUrl ? { locateFile: (p: string) => (p.endsWith('.wasm') ? wasmUrl : p) } : {};
    loading = (lib3mfFactory(options) as Promise<L3Module>).catch((e: unknown) => {
      loading = null;
      throw new Error(`The 3MF reader (lib3mf) could not be loaded: ${(e as Error)?.message ?? e}`);
    });
  }
  return loading;
}
