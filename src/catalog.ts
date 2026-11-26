import { compareLabels, referenceLabels } from './reference-dataset';

export type ClassStatus = 'piloto' | 'planificada';
export type ValidationStatus = 'presencia-verificada' | 'pendiente-validacion-signo';

export interface SignClass {
  id: string;
  label: string;
  category: 'Abecedario' | 'Números' | 'Saludos y cortesía' | 'Preguntas' | 'Necesidades y acciones' | 'Familia y personas' | 'Educación' | 'Emergencias';
  status: ClassStatus;
  validation: ValidationStatus;
  sourceId: 'dees-lessa' | 'hablemos-lessa' | 'lessa-modulo1' | 'lessa-virtual';
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
  {
    id: 'lessa-virtual',
    title: 'Aprende LESSA con Becky Soundy',
    institution: 'LESSA Virtual',
    url: 'https://www.youtube.com/@lessavirtual',
    usage: 'Referencia pedagógica para contrastar vocabulario común, frases de cortesía, movimiento y expresión no manual.',
    rights: 'Consultar mediante YouTube. No descargar, recortar ni convertir videos en dataset sin autorización expresa de la titular.',
  },
];

const ruleLetters = ['A', 'B', 'D', 'F', 'G', 'H', 'I', 'L', 'U', 'V', 'W', 'Y'];
const ruleNumbers = ['0', '1', '2', '3', '4'];
const imageLetters = new Set(referenceLabels('alphabet'));
const imageNumbers = new Set(referenceLabels('numbers'));
const imageModelNote = 'Cobertura experimental con fotografías aportadas por KevinGuzman1. Requiere validación con personas signantes en LESSA.';

// Piloto: reglas geométricas más las clases presentes en las fotografías de referencia.
export const pilotClasses: SignClass[] = [
  ...[...new Set([...ruleLetters, ...imageLetters])].sort(compareLabels).map((label) => ({
    id: `alfabeto-${label.toLowerCase()}`,
    label,
    category: 'Abecedario' as const,
    status: 'piloto' as const,
    validation: ruleLetters.includes(label) ? 'presencia-verificada' as const : 'pendiente-validacion-signo' as const,
    sourceId: 'lessa-modulo1' as const,
    notes: imageLetters.has(label)
      ? imageModelNote
      : 'Regla geométrica provisional. Contrastar configuración y orientación con el Módulo I y validarla con una persona competente.',
  })),
  ...[...new Set([...ruleNumbers, ...imageNumbers])].sort(compareLabels).map((label) => ({
    id: `numero-${label}`,
    label,
    category: 'Números' as const,
    status: 'piloto' as const,
    validation: ruleNumbers.includes(label) ? 'presencia-verificada' as const : 'pendiente-validacion-signo' as const,
    sourceId: 'dees-lessa' as const,
    notes: imageNumbers.has(label)
      ? imageModelNote
      : 'Confirmar orientación, mano dominante y variantes antes de capturar.',
  })),
];

const wordEntries: Array<[string, SignClass['category']]> = [
  ['hola', 'Saludos y cortesía'], ['buenos días', 'Saludos y cortesía'], ['buenas tardes', 'Saludos y cortesía'],
  ['buenas noches', 'Saludos y cortesía'], ['adiós', 'Saludos y cortesía'], ['gracias', 'Saludos y cortesía'],
  ['por favor', 'Saludos y cortesía'], ['perdón', 'Saludos y cortesía'], ['bienvenido', 'Saludos y cortesía'],
  ['mucho gusto', 'Saludos y cortesía'],
  ['qué', 'Preguntas'], ['quién', 'Preguntas'], ['dónde', 'Preguntas'], ['cuándo', 'Preguntas'],
  ['cómo', 'Preguntas'], ['por qué', 'Preguntas'], ['cuánto', 'Preguntas'], ['cuál', 'Preguntas'],
  ['ayuda', 'Necesidades y acciones'], ['agua', 'Necesidades y acciones'], ['comer', 'Necesidades y acciones'],
  ['beber', 'Necesidades y acciones'], ['baño', 'Necesidades y acciones'], ['dolor', 'Necesidades y acciones'],
  ['médico', 'Necesidades y acciones'], ['esperar', 'Necesidades y acciones'], ['ir', 'Necesidades y acciones'],
  ['venir', 'Necesidades y acciones'], ['querer', 'Necesidades y acciones'], ['necesitar', 'Necesidades y acciones'],
  ['mamá', 'Familia y personas'], ['papá', 'Familia y personas'], ['hermano', 'Familia y personas'],
  ['hermana', 'Familia y personas'], ['familia', 'Familia y personas'], ['amigo', 'Familia y personas'],
  ['niño', 'Familia y personas'], ['persona', 'Familia y personas'],
  ['universidad', 'Educación'], ['estudiante', 'Educación'], ['docente', 'Educación'], ['clase', 'Educación'],
  ['libro', 'Educación'], ['aprender', 'Educación'], ['estudiar', 'Educación'], ['computadora', 'Educación'],
  ['emergencia', 'Emergencias'], ['peligro', 'Emergencias'], ['policía', 'Emergencias'], ['hospital', 'Emergencias'],
];

export const wordLabels = wordEntries.map(([label]) => label);

export const plannedClasses: SignClass[] = wordEntries.map(([label, category]) => ({
  id: `${category.toLowerCase().replaceAll(' ', '-')}-${label}`,
  label,
  category,
  status: 'planificada',
  validation: 'pendiente-validacion-signo',
  sourceId: 'lessa-virtual',
  notes: 'Clase candidata. Requiere revisión del video de referencia y validación por una persona competente.',
}));

export const signCatalog = [...pilotClasses, ...plannedClasses];
