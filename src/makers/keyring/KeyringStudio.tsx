import type { PanelConfig } from '../canvas/DesignPanels';
import type { KeyringRole } from './geometry';
import { useKeyring, openKeyringTemplate, startBlankKeyring, placeHoleAtEdge } from './store';
import { KEYRING_TEMPLATES, KEYRING_CATEGORIES } from './templates';
import { PlaqueContext, type PlaqueConfig, type PlaqueStore } from '../plaque/config';
import { PlaqueStudio } from '../plaque/PlaqueStudio';

export const KEYRING_PANEL: PanelConfig = {
  roles: [
    { value: 'raised', label: 'Raised', colour: '#2463EB' },
    { value: 'engraved', label: 'Engraved', colour: '#475467' },
    { value: 'inlay', label: 'Flush', colour: '#7FA6F5' },
    { value: 'plate', label: 'Plate', colour: '#D0D5DD' },
    { value: 'cut', label: 'Hole', colour: '#E0262B' },
  ] satisfies { value: KeyringRole; label: string; colour: string }[],
  defaults: { shape: 'raised', text: 'raised', upload: 'raised', draw: 'raised' },
  // On the back, new items are engraved (nothing can stand proud of the bottom face).
  pickRole: () => (useKeyring.getState().side === 'back' ? 'engraved' : 'raised'),
  backRoles: ['engraved', 'inlay', 'cut'],
  newShapeSize: 14,
  newTextHeight: 9,
  defaultText: 'NAME',
};

const CONFIG: PlaqueConfig = {
  id: 'keyring',
  studio: 'keyring',
  title: 'Keyring & Name Tag Maker',
  label: 'Keyring Maker',
  noun: 'keyring',
  store: useKeyring as PlaqueStore,
  templates: KEYRING_TEMPLATES,
  categories: KEYRING_CATEGORIES,
  thumbDir: 'keyring',
  blankHint: 'An empty canvas: add text, shapes or your own artwork',
  openTemplate: openKeyringTemplate,
  startBlank: startBlankKeyring,
  placeHoleAtEdge,
  panel: KEYRING_PANEL,
  artboard: { w: 80, h: 50, label: 'Tag area 80 × 50 mm' },
  doubleSided: true,
  ring: true,
  settingsTitle: 'Tag',
  windowKey: 'modellioKeyring',
  testHooks: { openKeyringTemplate, startBlankKeyring },
  help: (
    <>
      <p className="font-semibold text-ink">Make a keyring in a minute</p>
      <ol className="mt-1.5 list-decimal space-y-1 pl-4">
        <li>Pick a template, or Start blank and press Text.</li>
        <li>Type your text in the panel on the left; drag it on the canvas.</li>
        <li>Choose Raised, Engraved or Flush for each item, and the colours on the right.</li>
        <li>Drag the blue ring to place the hole, then Download (3MF).</li>
      </ol>
      <p className="mt-2 text-muted">Use Back to put text on the other side. Save project keeps the design in your dashboard.</p>
    </>
  ),
};

/**
 * Keyring & Name Tag Maker: lay out text, shapes, uploads and drawings on a canvas; choose
 * whether each is raised, engraved, flush or a hole; the tag is built live in 3D.
 */
export default function KeyringStudio() {
  return (
    <PlaqueContext.Provider value={CONFIG}>
      <PlaqueStudio />
    </PlaqueContext.Provider>
  );
}
