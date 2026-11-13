import { SaxesParser } from 'saxes';

/** Thrown for anything wrong with the uploaded file (as opposed to a bug). Shown to the user verbatim. */
export class ThreeMFImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ThreeMFImportError';
  }
}

export interface XmlHandlers {
  /** Element start: qualified name as written (e.g. "m:colorgroup") and raw attributes. */
  open?: (name: string, attrs: Record<string, string>) => void;
  close?: (name: string) => void;
  text?: (text: string) => void;
}

/**
 * Streaming XML walk (no DOM: `DOMParser` isn't available in workers and large model parts
 * would double memory). Namespaces are not resolved; callers compare local names via `localName`.
 */
export function walkXml(xml: string, handlers: XmlHandlers, part = 'XML'): void {
  const parser = new SaxesParser();
  parser.on('error', (e) => {
    throw new ThreeMFImportError(`${part} is not valid XML (${e.message.split('\n')[0]}).`);
  });
  if (handlers.open) {
    const open = handlers.open;
    parser.on('opentag', (tag) => open(tag.name, tag.attributes as Record<string, string>));
  }
  if (handlers.close) {
    const close = handlers.close;
    parser.on('closetag', (tag) => close(tag.name));
  }
  if (handlers.text) parser.on('text', handlers.text);
  parser.write(xml).close();
}

export const localName = (qname: string) => qname.slice(qname.indexOf(':') + 1);
