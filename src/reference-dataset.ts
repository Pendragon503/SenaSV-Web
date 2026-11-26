/**
 * Fotografías de referencia usadas para entrenar el modelo base de configuraciones manuales.
 *
 * Las imágenes viven en `dataset/imagenes/<carpeta>/<ETIQUETA>.jpg` y Vite las descubre
 * automáticamente: basta con añadir archivos para ampliar el dataset.
 *
 * - `letras/`  → abecedario (A.jpg, B.jpg, … ; `N-.jpg` corresponde a la Ñ)
 * - `numeros/` → configuraciones de una mano
 * - Para varias fotografías de la misma clase usa un sufijo con `@`: `A@2.jpg`, `A@persona3.jpg`.
 */

export type ReferenceGroup = 'alphabet' | 'numbers';

export interface ReferenceImage {
  label: string;
  group: ReferenceGroup;
  /** Ruta relativa al repositorio, útil para reportes. */
  path: string;
  /** URL servida por Vite. */
  url: string;
}

const GROUP_BY_FOLDER: Record<string, ReferenceGroup> = {
  letras: 'alphabet',
  numeros: 'numbers',
};

/** Nombres de archivo ASCII que representan etiquetas con caracteres especiales. */
const LABEL_ALIASES: Record<string, string> = {
  'N-': 'Ñ',
  NN: 'Ñ',
  ENIE: 'Ñ',
};

const GROUP_ORDER: ReferenceGroup[] = ['alphabet', 'numbers'];

const files = import.meta.glob<string>('/dataset/imagenes/*/*.{jpg,jpeg,png,webp,JPG,JPEG,PNG,WEBP}', {
  eager: true,
  query: '?url',
  import: 'default',
});

export const REFERENCE_IMAGES: ReferenceImage[] = Object.entries(files)
  .map(([path, url]) => parseReference(path, url))
  .filter((image): image is ReferenceImage => image !== null)
  .sort((a, b) =>
    GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group)
    || compareLabels(a.label, b.label)
    || a.path.localeCompare(b.path));

/**
 * Identificador estable del contenido del dataset (archivos y etiquetas).
 * En producción incluye la huella de contenido que Vite incorpora a cada URL.
 */
export const REFERENCE_DATASET_VERSION = `imagenes-${REFERENCE_IMAGES.length}-${fnv1a(
  REFERENCE_IMAGES.map((image) => `${image.group}:${image.label}:${image.path}:${image.url}`).join('\n'),
)}`;

export function referenceLabels(group?: ReferenceGroup): string[] {
  const labels = REFERENCE_IMAGES
    .filter((image) => !group || image.group === group)
    .map((image) => image.label);
  return [...new Set(labels)];
}

export function compareLabels(a: string, b: string): number {
  return a.localeCompare(b, 'es', { numeric: true });
}

function parseReference(path: string, url: string): ReferenceImage | null {
  const match = /\/dataset\/imagenes\/([^/]+)\/([^/]+)\.[a-z]+$/i.exec(path);
  if (!match) return null;
  const group = GROUP_BY_FOLDER[match[1].toLowerCase()];
  if (!group) return null;
  const stem = match[2].split('@')[0].trim().toUpperCase();
  const label = LABEL_ALIASES[stem] ?? stem;
  if (!label) return null;
  if (group === 'numbers' && !/^\d+$/.test(label)) return null;
  return { label, group, path: path.replace(/^\//, ''), url };
}

function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
