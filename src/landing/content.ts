import type { StudioId } from '@/app/studio';

/** A tool on the landing page. Live tools open in the app; the rest are listed as coming soon. */
export interface Maker {
  id: string;
  name: string;
  /** One line: what you put in and what you get out. */
  line: string;
  description: string;
  studio?: Exclude<StudioId, 'home'>;
  image?: string;
  /** What you get, as short facts. */
  facts: string[];
  /** Call to action on the button. */
  action?: string;
}

export const DESIGN_STUDIO: Maker = {
  id: 'design',
  name: 'Design Studio',
  line: 'A blank workplane and a box of shapes.',
  description:
    'Drop shapes on the workplane, set their sizes in millimetres, then join them together or cut one out of another. Add raised or engraved text, round off edges, check that it will print, and export it for your slicer.',
  studio: 'design',
  image: '/landing/design-studio.jpg',
  action: 'Open the Design Studio',
  facts: [
    '15 shapes, including 3D text',
    'Sizes to 0.01 mm, or inches',
    'Join, cut out, intersect',
    'Holes, chamfers, hollowing',
    'Print check for overhangs and thin walls',
    'STL, OBJ and 3MF in and out',
    'Autosave and version history',
    'Share a link to a design',
  ],
};

export const MAKERS: Maker[] = [
  {
    id: 'cookie',
    name: 'Cookie Cutter & Stamp Maker',
    line: 'A shape, a name or a drawing in; a cutter, a stamp and a handle out.',
    description:
      'Pick one of the built-in shapes, type a name, or upload a logo or a scan of a child’s drawing. It makes a cutter, a stamp that fits inside it and presses the design into the dough, and a handle for the stamp. Everything prints without supports.',
    studio: 'cookie',
    image: '/landing/cookie-maker.jpg',
    action: 'Open Cookie Cutter & Stamp Maker',
    facts: [
      'Shapes, text, SVG or a picture',
      'Mirrored so text reads the right way',
      'Stamp fits inside the cutter',
      'One 3MF, or an STL per part',
    ],
  },
  {
    id: 'split',
    name: 'Split Studio',
    line: 'A multi-colour 3MF in; one closed part per colour out.',
    description:
      'For multi-colour models when you only have one nozzle. Open a 3MF from Bambu Studio, OrcaSlicer or PrusaSlicer and it separates every colour, including painted areas, into its own solid part, adds pegs so the parts line up, and lays them out on plates for your printer.',
    studio: 'split',
    image: '/landing/split-studio.jpg',
    action: 'Open Split Studio',
    facts: ['Reads slicer colours and paint', 'Thin colours become inlays', 'Pegs and blind sockets', 'One plate per colour'],
  },
];

export const COMING_SOON: Maker[] = [
  { id: 'keyring', name: 'Keyring Maker', line: 'A name and a font in; a keyring with a strong loop out.', description: '', facts: [] },
  { id: 'sign', name: 'Sign Maker', line: 'Desk, door and house-number signs with stands or screw holes.', description: '', facts: [] },
  {
    id: 'organiser',
    name: 'Organiser Generator',
    line: 'Your drawer size in; Gridfinity-compatible bins and a baseplate out.',
    description: '',
    facts: [],
  },
  { id: 'box', name: 'Box & Lid Maker', line: 'Boxes to the millimetre with lids that actually fit.', description: '', facts: [] },
  {
    id: 'lithophane',
    name: 'Lithophane Studio',
    line: 'A photo in; a panel that shows the picture when lit from behind.',
    description: '',
    facts: [],
  },
];

export const FAQ = [
  {
    q: 'Is it free?',
    a: 'Yes. Everything on this page is free to use, with no install and no account.',
  },
  {
    q: 'Design Studio or a maker — which should I use?',
    a: 'If a maker exists for the thing you want, start there: it asks a few questions and does the fiddly geometry for you. For anything else, or to change what a maker made, use the Design Studio. Makers have a "Customise in Design Studio" button for exactly that.',
  },
  {
    q: 'Where are my designs kept?',
    a: 'In your browser, on this device, saved as you work. You can download a project file at any time to back it up or move it to another computer. Files you open in Split Studio or the makers are processed on your device and are not uploaded.',
  },
  {
    q: 'Will it work with my printer?',
    a: 'It exports standard STL, OBJ and 3MF files, which Bambu Studio, OrcaSlicer, PrusaSlicer, Cura and other slicers open.',
  },
  {
    q: 'Is this an AI model generator?',
    a: 'No. You decide every shape and size; nothing is generated from a prompt. What you see is real, closed geometry measured in millimetres.',
  },
  {
    q: 'Are printed cookie cutters food safe?',
    a: 'Printed parts have fine layer lines that can hold dough. Use a filament rated for food contact, wash by hand in warm soapy water, and dust the cutter with flour before use.',
  },
  {
    q: 'Does it work on an iPad?',
    a: 'Yes. It runs in modern browsers on desktops, laptops and tablets, with touch controls. Phones are fine for looking, cramped for designing.',
  },
];
