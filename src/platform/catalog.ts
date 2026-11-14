import type { StudioId } from '@/app/studio';

/**
 * What MODELLIO offers, in one place: the landing page, the dashboard and the menus all read
 * this, so a maker or tool is listed the same way everywhere. Only live entries link anywhere.
 */
export interface MakerEntry {
  id: string;
  name: string;
  /** One line: what you put in and what you get out. */
  line: string;
  description: string;
  studio: StudioId;
  /** Product render on a transparent background (`scripts/render-landing-images.mjs`); used by the dashboard. */
  image: string;
  /** Landing-page product art (transparent WebP, `scripts/prepare-landing-art.py`); falls back to `image`. */
  art?: string;
  facts: string[];
}

export const MAKER_ENTRIES: MakerEntry[] = [
  {
    id: 'keyring',
    name: 'Keyring Maker',
    line: 'Your name, a shape or a logo, as a two-colour keyring.',
    description:
      'Type a name, drop in shapes or your logo and arrange them on a canvas. Raised, engraved or flush lettering, a reinforced ring, and a back side too.',
    studio: 'keyring',
    image: '/landing/maker-keyring.webp',
    art: '/landing/art/maker-keyring.webp',
    facts: ['28 templates', 'Raised, engraved or flush', 'Two colours'],
  },
  {
    id: 'keytag',
    name: 'Key Tag Maker',
    line: 'Numbered ID tags for lockers, rooms, pets and kit — in batches.',
    description:
      'Pick an ID layout, set the label, and number a whole run of tags at once: prefix, start, step and padding. Every tag prints as its own object.',
    studio: 'keytag',
    image: '/landing/maker-keytag.webp',
    art: '/landing/art/maker-keytag.webp',
    facts: ['Sequential numbering', 'Batch 3MF', 'ID layouts'],
  },
  {
    id: 'sign',
    name: 'Sign Maker',
    line: 'House numbers, door and desk signs with mounting built in.',
    description:
      'Several lines of text with their own sizes and fonts, raised or recessed, a border, and screw holes, keyhole slots or a desk stand that slots on.',
    studio: 'sign',
    image: '/landing/maker-sign.webp',
    art: '/landing/art/maker-sign.webp',
    facts: ['Multi-line text', 'Screw holes or keyhole slots', 'Desk stand'],
  },
  {
    id: 'vase',
    name: 'Vase & Planter Maker',
    line: 'Vases, planters, bowls and lampshades from a profile you can drag.',
    description:
      'Shape the side profile, choose a cross-section, twist it and add ribs, waves or texture. Planters get drainage holes and a saucer.',
    studio: 'vase',
    image: '/landing/maker-vase.webp',
    art: '/landing/art/maker-vase-planter.webp',
    facts: ['32 templates', 'Twist and 7 patterns', 'Capacity shown'],
  },
  {
    id: 'split',
    name: 'Split Studio',
    line: 'A multi-colour 3MF in; one printable part per colour out.',
    description:
      'Separates every colour, including painted areas, into closed parts, adds pegs and sockets so they line up, and lays them out on plates.',
    studio: 'split',
    image: '/landing/maker-split.webp',
    art: '/landing/art/maker-split-studio.webp',
    facts: ['Reads slicer colours', 'Pegs and sockets', 'Plates per colour'],
  },
  {
    id: 'cookie',
    name: 'Cookie Cutter & Stamp',
    line: 'A shape, a name or a drawing in; a cutter, stamp and handle out.',
    description: 'Lay out the cookie on a canvas: what makes the outline and what the stamp presses in. Prints without supports.',
    studio: 'cookie',
    image: '/landing/maker-cookie.webp',
    facts: ['25 templates', 'Stamp fits the cutter', 'No supports'],
  },
];

export interface ToolEntry {
  id: string;
  name: string;
  line: string;
  /** Where it lives. Tools without one are listed as coming soon. */
  studio?: StudioId;
  /** Shown on the button. */
  where?: string;
}

export const TOOL_ENTRIES: ToolEntry[] = [
  {
    id: 'text',
    name: 'Text 3D',
    line: 'Any bundled font, raised or cut, with spacing and alignment.',
    studio: 'design',
    where: 'Design Studio → Text',
  },
  {
    id: 'svg',
    name: 'SVG & Picture Extruder',
    line: 'Logos and drawings traced into solids you can resize and combine.',
    studio: 'design',
    where: 'Design Studio → Assets',
  },
  {
    id: 'gear',
    name: 'Gear Generator',
    line: 'Involute spur gears by tooth count and module, with a bore.',
    studio: 'design',
    where: 'Design Studio → Shapes',
  },
  {
    id: 'box',
    name: 'Box & Lid Generator',
    line: 'A box and a lid that fits, to the millimetre, with your clearance.',
    studio: 'design',
    where: 'Design Studio → Shapes',
  },
  {
    id: 'underside',
    name: 'Double-sided Engraver',
    line: 'Send text or a logo to the underside: engraved or a flush second colour.',
    studio: 'design',
    where: 'Design Studio → Inspector',
  },
  {
    id: 'print',
    name: 'Print Check',
    line: 'Overhangs, thin walls and closed solids before you slice.',
    studio: 'design',
    where: 'Design Studio → Print',
  },
  {
    id: 'fillet',
    name: 'Fillet & Chamfer',
    line: 'Round or bevel the exact edges you pick, with a live preview.',
    studio: 'design',
    where: 'Design Studio → Features',
  },
  {
    id: 'loft',
    name: 'Loft & Sweep',
    line: 'Blend between sketched sections, or move a profile along a path.',
    studio: 'design',
    where: 'Design Studio → Features',
  },
  {
    id: 'step',
    name: 'STEP Import & Export',
    line: 'Exact CAD geometry in and out, for Fusion, SolidWorks, FreeCAD and Onshape.',
    studio: 'design',
    where: 'Design Studio → Import / Export',
  },
  { id: 'lithophane', name: 'Lithophane', line: 'A photo into a panel that shows the picture when lit from behind.' },
  { id: 'thread', name: 'Thread Generator', line: 'Screw threads and nuts that print and fit.' },
];

export const WORKSPACE_LABEL: Record<string, string> = {
  design: 'Design Studio',
  keyring: 'Keyring Maker',
  keytag: 'Key Tag Maker',
  sign: 'Sign Maker',
  vase: 'Vase & Planter',
  cookie: 'Cookie Maker',
  split: 'Split Studio',
};
