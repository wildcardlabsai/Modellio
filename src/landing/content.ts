import {
  Box,
  Scissors,
  KeyRound,
  Signpost,
  Grid3x3,
  Package,
  Image,
  Ruler,
  Combine,
  Type,
  Printer,
  Download,
  History,
  Share2,
  LayoutTemplate,
  Palette,
  Layers,
  Puzzle,
  type LucideIcon,
} from 'lucide-react';
import type { StudioId } from '@/app/studio';

export interface StudioCard {
  id: string;
  name: string;
  tagline: string;
  description: string;
  Icon: LucideIcon;
  /** Live studios open in the app; the rest are on the roadmap. */
  studio?: Exclude<StudioId, 'home'>;
  image?: string;
  badge?: string;
  points: string[];
}

export const LIVE_STUDIOS: StudioCard[] = [
  {
    id: 'design',
    name: 'Design Studio',
    tagline: 'Model anything from simple shapes',
    description:
      'Drag shapes onto the workplane, size them to the millimetre, and combine them into solid parts. Cut holes, add 3D text, round edges and check the result is ready to print.',
    Icon: Box,
    studio: 'design',
    image: '/landing/design-studio.jpg',
    points: ['Exact sizes in mm or inches', 'Combine, subtract and intersect', 'Export STL, OBJ and 3MF'],
  },
  {
    id: 'split',
    name: 'Split Studio',
    tagline: 'Turn a multi-colour 3MF into parts you can print',
    description:
      'Open a multi-colour 3MF from Bambu Studio, OrcaSlicer, PrusaSlicer or a CAD tool. Split Studio finds every colour, object and painted region, so you can print each colour as its own part on a single-colour printer.',
    Icon: Scissors,
    studio: 'split',
    image: '/landing/split-studio.jpg',
    badge: 'New',
    points: [
      'Reads slicer filaments and painted areas',
      'Splits each colour into a closed, printable part',
      'Adds pegs and sockets, then exports plates',
    ],
  },
];

export const COMING_SOON: StudioCard[] = [
  {
    id: 'keyring',
    name: 'Keyring Maker',
    tagline: 'Name tags and keyrings in seconds',
    description: 'Type a name, pick a font and shape, and get a print-ready keyring with a strong loop.',
    Icon: KeyRound,
    points: [],
  },
  {
    id: 'sign',
    name: 'Sign Generator',
    tagline: 'Door signs, labels and plaques',
    description: 'Raised or engraved text on a backing plate, with fixing holes and colour layers.',
    Icon: Signpost,
    points: [],
  },
  {
    id: 'organiser',
    name: 'Organiser Generator',
    tagline: 'Drawer and desk organisers that fit',
    description: 'Enter your drawer size and get a grid of trays and dividers that fit it exactly.',
    Icon: Grid3x3,
    points: [],
  },
  {
    id: 'box',
    name: 'Box & Lid Maker',
    tagline: 'Boxes with lids that actually close',
    description: 'Parametric boxes with snap or sliding lids and the right tolerance for your printer.',
    Icon: Package,
    points: [],
  },
  {
    id: 'lithophane',
    name: 'Lithophane Studio',
    tagline: 'Photos that glow when lit',
    description: 'Turn a photo into a lithophane panel, lamp shade or night-light insert.',
    Icon: Image,
    points: [],
  },
];

export const DESIGN_FEATURES: { Icon: LucideIcon; title: string; body: string }[] = [
  {
    Icon: Ruler,
    title: 'Precise to the millimetre',
    body: 'Type exact sizes and positions, snap to a grid and measure between any two points.',
  },
  {
    Icon: Combine,
    title: 'Real solid modelling',
    body: 'Combine, subtract and intersect shapes on watertight geometry, and edit the parts later.',
  },
  { Icon: Type, title: '3D text', body: 'Add raised or engraved lettering in several fonts for names, labels and signs.' },
  {
    Icon: Printer,
    title: 'Ready to print',
    body: 'Lay flat on any face, hollow out, and check for overhangs and thin walls before you slice.',
  },
  { Icon: Download, title: 'Open formats', body: 'Import STL and OBJ. Export STL, OBJ or 3MF with colours for your slicer.' },
  { Icon: History, title: 'Saved as you go', body: 'Projects autosave in your browser, with version history and full undo.' },
  { Icon: Share2, title: 'Share a link', body: 'Send a view-only link to your design. The recipient can save their own copy.' },
  { Icon: LayoutTemplate, title: 'Start from a template', body: 'Begin with a phone stand, plant pot or organiser and make it your own.' },
];

export const SPLIT_FEATURES: { Icon: LucideIcon; title: string; body: string; soon?: boolean }[] = [
  { Icon: Palette, title: 'Finds every colour', body: 'Reads 3MF materials, colour groups, slicer filaments and painted triangles.' },
  {
    Icon: Layers,
    title: 'Keeps your assembly',
    body: 'Objects, parts and repeated copies stay separate, with their exact positions in mm.',
  },
  { Icon: Scissors, title: 'Split by colour', body: 'Each colour becomes its own closed solid; thin painted areas become inlays.' },
  { Icon: Puzzle, title: 'Pegs and sockets', body: 'Alignment pegs and blind sockets so the printed parts fit back together.' },
];

export const STEPS = [
  { title: 'Design or import', body: 'Start from a blank workplane or a template, or open an STL, OBJ or 3MF.' },
  { title: 'Shape and check', body: 'Size, combine and refine, then run the print check to catch problems early.' },
  { title: 'Export and print', body: 'Download STL, OBJ or 3MF and open it in your slicer.' },
];

export const AUDIENCES = [
  { title: 'Beginners', body: 'If you can drag a box, you can model. Everything is labelled and every action can be undone.' },
  { title: 'Makers', body: 'Brackets, spacers, clips and replacement parts, sized to fit what you already have.' },
  { title: 'Teachers', body: 'Runs on school laptops and iPads in the browser, with no installs or licences.' },
  { title: 'Multi-colour printers', body: 'Plan colour prints and split them into parts for a single-colour printer.' },
];

export const FAQ = [
  {
    q: 'Is MODELLIO free?',
    a: 'Yes. The Design Studio and Split Studio are free to use. There is no install and you don’t need an account.',
  },
  {
    q: 'Where are my designs stored?',
    a: 'Projects are saved in your browser on this device and autosave as you work. You can also download a project file at any time to back it up or move it to another computer. Files you open in Split Studio are processed on your device and are not uploaded.',
  },
  {
    q: 'Which printers and slicers does it work with?',
    a: 'Any. MODELLIO exports standard STL, OBJ and 3MF files, which Bambu Studio, OrcaSlicer, PrusaSlicer, Cura and other slicers open.',
  },
  {
    q: 'Is this an AI model generator?',
    a: 'No. MODELLIO is a real CAD tool: every shape is genuine, watertight geometry measured in millimetres, and you stay in control of every dimension.',
  },
  {
    q: 'Does it work on a tablet?',
    a: 'Yes. MODELLIO runs in modern browsers on desktop and on tablets such as the iPad, with touch-friendly controls. Phones are better for viewing than modelling.',
  },
  {
    q: 'When will the new studios arrive?',
    a: 'Keyring Maker, Sign Generator, Organiser Generator, Box & Lid Maker and Lithophane Studio are in development. They will appear on this page as they launch.',
  },
];
