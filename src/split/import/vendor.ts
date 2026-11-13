import { strFromU8 } from 'fflate';
import { getPart } from './opc';
import { localName, walkXml } from './xml';

/**
 * Slicer (vendor) colour metadata. Bambu Studio / OrcaSlicer and PrusaSlicer store
 * multi-colour assignments outside the 3MF Materials extension:
 *
 * - Bambu/Orca: `Metadata/model_settings.config` gives each object and part an
 *   `extruder` (1-based filament slot); `Metadata/project_settings.config` (JSON)
 *   lists `filament_colour` per slot.
 * - PrusaSlicer: `Metadata/Slic3r_PE_model.config` splits each object's single mesh
 *   into volumes (inclusive triangle ranges) with an `extruder`; `Metadata/Slic3r_PE.config`
 *   holds `extruder_colour` / `filament_colour`.
 *
 * Only the colour-relevant subset is read. Parts that are not printed geometry
 * (modifiers, negative volumes, support blockers/enforcers) are identified so they
 * are never mistaken for coloured regions.
 */
export type PartRole = 'part' | 'modifier' | 'negative' | 'support_blocker' | 'support_enforcer';

export interface Filament {
  /** 1-based slot. */
  slot: number;
  colour: string;
  type?: string;
}

export interface VendorPart {
  /** Bambu: mesh object id inside the referenced model part. */
  id: number;
  name?: string;
  extruder?: number;
  role: PartRole;
}

export interface VendorVolume {
  firstTriangle: number;
  lastTriangle: number;
  name?: string;
  extruder?: number;
  role: PartRole;
}

export interface VendorObject {
  /** Object id in the root model part. */
  id: number;
  name?: string;
  extruder?: number;
  parts: VendorPart[];
  volumes: VendorVolume[];
}

export interface VendorData {
  vendor: 'bambu' | 'prusa';
  objects: Map<number, VendorObject>;
  filaments: Filament[];
}

const BAMBU_ROLES: Record<string, PartRole> = {
  normal_part: 'part',
  modifier_part: 'modifier',
  negative_part: 'negative',
  support_blocker: 'support_blocker',
  support_enforcer: 'support_enforcer',
};
const PRUSA_ROLES: Record<string, PartRole> = {
  ModelPart: 'part',
  ParameterModifier: 'modifier',
  NegativeVolume: 'negative',
  SupportBlocker: 'support_blocker',
  SupportEnforcer: 'support_enforcer',
};

const toInt = (v: string | undefined) => {
  const n = v === undefined ? NaN : parseInt(v, 10);
  return Number.isFinite(n) ? n : undefined;
};

/** Normalise "#RRGGBB" / "#RRGGBBAA" / "RRGGBB" → "#RRGGBB" (upper case), or null. */
export function normaliseHex(v: string | undefined): string | null {
  if (!v) return null;
  const m = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(v.trim());
  return m ? '#' + m[1].toUpperCase() : null;
}

export function readVendorData(parts: Map<string, Uint8Array>): { data: VendorData | null; notes: string[] } {
  const notes: string[] = [];
  const bambu = getPart(parts, 'Metadata/model_settings.config');
  if (bambu) return { data: readBambu(parts, strFromU8(bambu), notes), notes };
  const prusa = getPart(parts, 'Metadata/Slic3r_PE_model.config');
  if (prusa) return { data: readPrusa(parts, strFromU8(prusa), notes), notes };
  return { data: null, notes };
}

function readBambu(parts: Map<string, Uint8Array>, xml: string, notes: string[]): VendorData {
  const objects = new Map<number, VendorObject>();
  let obj: VendorObject | null = null;
  let part: VendorPart | null = null;
  let depth = 0;
  let inPlate = false;
  walkXml(
    xml,
    {
      open: (tag, a) => {
        depth++;
        const n = localName(tag);
        if (n === 'plate') inPlate = true;
        if (inPlate) return;
        if (n === 'object' && depth === 2) {
          const id = toInt(a.id);
          if (id !== undefined) {
            obj = { id, parts: [], volumes: [] };
            objects.set(id, obj);
          }
        } else if (n === 'part' && obj) {
          const id = toInt(a.id);
          if (id !== undefined) {
            part = { id, role: BAMBU_ROLES[a.subtype ?? 'normal_part'] ?? 'part' };
            obj.parts.push(part);
          }
        } else if (n === 'metadata' && obj) {
          const target: { name?: string; extruder?: number } = part ?? obj;
          if (a.key === 'name') target.name = a.value;
          if (a.key === 'extruder') target.extruder = toInt(a.value);
        }
      },
      close: (tag) => {
        depth--;
        const n = localName(tag);
        if (n === 'plate') inPlate = false;
        if (n === 'part') part = null;
        if (n === 'object' && depth === 1) obj = null;
      },
    },
    'Metadata/model_settings.config',
  );

  const filaments: Filament[] = [];
  const settings = getPart(parts, 'Metadata/project_settings.config');
  if (settings) {
    try {
      const json = JSON.parse(strFromU8(settings)) as Record<string, unknown>;
      const colours = Array.isArray(json.filament_colour) ? (json.filament_colour as string[]) : [];
      const types = Array.isArray(json.filament_type) ? (json.filament_type as string[]) : [];
      colours.forEach((c, i) => {
        const hex = normaliseHex(c);
        if (hex) filaments.push({ slot: i + 1, colour: hex, type: types[i] });
        else notes.push(`Filament ${i + 1} has an unreadable colour "${c}".`);
      });
    } catch {
      notes.push('Metadata/project_settings.config could not be read, so filament colours are unknown.');
    }
  } else notes.push('The file has Bambu/Orca part assignments but no project settings, so filament colours are unknown.');
  return { vendor: 'bambu', objects, filaments };
}

function readPrusa(parts: Map<string, Uint8Array>, xml: string, notes: string[]): VendorData {
  const objects = new Map<number, VendorObject>();
  let obj: VendorObject | null = null;
  let vol: VendorVolume | null = null;
  walkXml(
    xml,
    {
      open: (tag, a) => {
        const n = localName(tag);
        if (n === 'object') {
          const id = toInt(a.id);
          if (id !== undefined) {
            obj = { id, parts: [], volumes: [] };
            objects.set(id, obj);
          }
        } else if (n === 'volume' && obj) {
          const first = toInt(a.firstid);
          const last = toInt(a.lastid);
          if (first !== undefined && last !== undefined) {
            vol = { firstTriangle: first, lastTriangle: last, role: 'part' };
            obj.volumes.push(vol);
          }
        } else if (n === 'metadata' && obj) {
          if (vol && a.type === 'volume') {
            if (a.key === 'name') vol.name = a.value;
            if (a.key === 'extruder') vol.extruder = toInt(a.value);
            if (a.key === 'volume_type') vol.role = PRUSA_ROLES[a.value ?? ''] ?? 'part';
            if (a.key === 'modifier' && a.value === '1' && vol.role === 'part') vol.role = 'modifier';
          } else if (a.type === 'object') {
            if (a.key === 'name') obj.name = a.value;
            if (a.key === 'extruder') obj.extruder = toInt(a.value);
          }
        }
      },
      close: (tag) => {
        const n = localName(tag);
        if (n === 'volume') vol = null;
        if (n === 'object') obj = null;
      },
    },
    'Metadata/Slic3r_PE_model.config',
  );

  const filaments: Filament[] = [];
  const cfg = getPart(parts, 'Metadata/Slic3r_PE.config');
  if (cfg) {
    const text = strFromU8(cfg);
    const read = (key: string) => {
      const m = new RegExp(`^;\\s*${key}\\s*=\\s*(.*)$`, 'm').exec(text);
      return m ? m[1].replace(/"/g, '').split(';') : [];
    };
    const extruder = read('extruder_colour');
    const filament = read('filament_colour');
    const types = read('filament_type');
    const count = Math.max(extruder.length, filament.length);
    for (let i = 0; i < count; i++) {
      const hex = normaliseHex(extruder[i]) ?? normaliseHex(filament[i]);
      if (hex) filaments.push({ slot: i + 1, colour: hex, type: types[i] });
    }
  } else notes.push('The file has PrusaSlicer volume assignments but no print settings, so extruder colours are unknown.');
  return { vendor: 'prusa', objects, filaments };
}
