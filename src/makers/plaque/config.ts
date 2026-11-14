import { createContext, useContext, type ComponentType, type ReactNode } from 'react';
import type { StoreApi, UseBoundStore } from 'zustand';
import type { StudioId } from '@/app/studio';
import type { MakerState, MakerTemplate } from '../canvas/store';
import type { PanelConfig } from '../canvas/DesignPanels';
import type { KeyringParams, KeyringResult } from '../keyring/geometry';

export type PlaqueStore = UseBoundStore<StoreApi<MakerState<KeyringParams, KeyringResult>>>;

/** What a plate-based maker (keyring, key tag, sign) supplies to the shared workspace. */
export interface PlaqueConfig {
  /** Test-id prefix and window hook suffix, e.g. 'keyring'. */
  id: string;
  studio: StudioId;
  title: string;
  /** Short name for "Back to …" and messages, e.g. 'Keyring Maker'. */
  label: string;
  /** The thing being made, for file names: 'keyring', 'tag', 'sign'. */
  noun: string;
  store: PlaqueStore;
  templates: MakerTemplate<KeyringParams>[];
  categories: string[];
  thumbDir: string;
  blankHint: string;
  openTemplate: (id: string) => Promise<void>;
  startBlank: () => void;
  placeHoleAtEdge?: () => void;
  panel: PanelConfig;
  artboard: { w: number; h: number; label?: string };
  /** Front/back editing. */
  doubleSided: boolean;
  /** Key ring hole controls. */
  ring: boolean;
  settingsTitle: string;
  help: ReactNode;
  windowKey: string;
  testHooks?: Record<string, unknown>;
  /** Extra controls in the settings panel (numbering, mounting…). */
  ExtraSettings?: ComponentType;
  /** Extra actions under the result (batch download…). */
  ExtraResult?: ComponentType;
}

export const PlaqueContext = createContext<PlaqueConfig | null>(null);

export function usePlaque(): PlaqueConfig {
  const c = useContext(PlaqueContext);
  if (!c) throw new Error('usePlaque outside a PlaqueStudio');
  return c;
}
