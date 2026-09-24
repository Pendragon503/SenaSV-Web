export type ClassStatus = 'piloto' | 'planificada';
export type ValidationStatus = 'presencia-verificada' | 'pendiente-validacion-signo';

export interface SignClass {
  id: string;
  label: string;
  category: 'Abecedario' | 'Números' | 'Saludos y cortesía' | 'Preguntas' | 'Necesidades y acciones' | 'Universidad';
  status: ClassStatus;
  validation: ValidationStatus;
  sourceId: 'dees-lessa' | 'hablemos-lessa' | 'lessa-modulo1';
  notes: string;
}

export interface CatalogSource {
  id: SignClass['sourceId'];
  title: string;
  institution: string;
  url: string;
  usage: string;
  rights: string;
}

export const sources: CatalogSource[] = [
  {
    id: 'dees-lessa',
    title: 'Diccionario Especializado en Educación Superior de Lengua de Señas Salvadoreña',
    institution: 'Unidad de Educación Superior Inclusiva y Editorial Universitaria UES',
    url: 'https://editorial.ues.edu.sv/dees-lessa/',
    usage: 'Referencia principal para verificar vocabulario, campos léxicos y realización de las señas.',
    rights: 'Todos los derechos reservados. No usar imágenes o videos como dataset sin autorización escrita.',
  },
  {
    id: 'hablemos-lessa',
    title: 'Hablemos LESSA',
    institution: 'MINEDUCYT, Ministerio de Cultura y Canal 10',
    url: 'https://www.mined.gob.sv/2020/12/21/clases-de-lengua-de-senas-por-television-una-nueva-forma-de-comunicarnos/',
    usage: 'Material institucional complementario para aprendizaje y contraste con personas competentes en LESSA.',
    rights: 'No se localizó licencia abierta para reutilización como datos de entrenamiento. Solicitar permiso.',
  },
  {
    id: 'lessa-modulo1',
    title: 'Recursos Módulo 1: configuraciones manuales LESSA',
    institution: 'Portal educativo LESSA de clases.edu.sv',
    url: 'https://sites.google.com/clases.edu.sv/lessa/recursos-m%C3%B3dulo-1',
    usage: 'Guía visual de 11 configuraciones para contrastar extensión, curvatura, pinza y orientación durante la captura.',
    rights: 'Material disponible para descarga educativa; conservar atribución y no reutilizar como dataset sin autorización expresa.',
  },
];

// Piloto deliberadamente estático para validar primero cámara, landmarks y clasificador.
export const pilotClasses: SignClass[] = [
  ...['A', 'B', 'D', 'F', 'G', 'H', 'I', 'L', 'U', 'V', 'W', 'Y'].map((label) => ({
    id: `alfabeto-${label.toLowerCase()}`,
    label,
    category: 'Abecedario' as const,
    status: 'piloto' as const,
    validation: 'presencia-verificada' as const,
    sourceId: 'lessa-modulo1' as const,
    notes: 'Regla geométrica provisional. Contrastar configuración y orientación con el Módulo I y validarla con una persona competente.',
  })),
  ...['0', '1', '2', '3', '4'].map((label) => ({
    id: `numero-${label}`,
    label,
    category: 'Números' as const,
    status: 'piloto' as const,
    validation: 'presencia-verificada' as const,
    sourceId: 'dees-lessa' as const,
    notes: 'Confirmar orientación, mano dominante y variantes antes de capturar.',
  })),
];

export const plannedClasses: SignClass[] = [
  ['hola', 'Saludos y cortesía'], ['gracias', 'Saludos y cortesía'], ['por favor', 'Saludos y cortesía'],
  ['adiós', 'Saludos y cortesía'], ['qué', 'Preguntas'], ['quién', 'Preguntas'], ['dónde', 'Preguntas'],
  ['ayuda', 'Necesidades y acciones'], ['agua', 'Necesidades y acciones'], ['comer', 'Necesidades y acciones'],
  ['universidad', 'Universidad'], ['estudiante', 'Universidad'], ['docente', 'Universidad'],
].map(([label, category]) => ({
  id: `${category.toLowerCase().replaceAll(' ', '-')}-${label}`,
  label,
  category: category as SignClass['category'],
  status: 'planificada',
  validation: 'pendiente-validacion-signo',
  sourceId: 'dees-lessa',
  notes: 'Clase candidata. Requiere revisión del video de referencia y validación por una persona competente.',
}));

export const signCatalog = [...pilotClasses, ...plannedClasses];
