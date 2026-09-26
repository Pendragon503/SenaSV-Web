// Espejo en JS plano de src/catalog.ts. Debe mantenerse sincronizado manualmente:
// aquí solo se usa para (a) construir la ruta de aprendizaje global en el backend
// y (b) validar los lessonId que llegan desde el cliente. No define reglas de UI.

const pilotAlphabet = ['A', 'B', 'D', 'F', 'G', 'H', 'I', 'L', 'U', 'V', 'W', 'Y'];
const pilotNumbers = ['0', '1', '2', '3', '4'];

const pilotClasses = [
  ...pilotAlphabet.map((label) => ({
    id: `alfabeto-${label.toLowerCase()}`,
    label,
    category: 'Abecedario',
  })),
  ...pilotNumbers.map((label) => ({
    id: `numero-${label}`,
    label,
    category: 'Números',
  })),
];

const plannedEntries = [
  ['hola', 'Saludos y cortesía'],
  ['gracias', 'Saludos y cortesía'],
  ['por favor', 'Saludos y cortesía'],
  ['adiós', 'Saludos y cortesía'],
  ['qué', 'Preguntas'],
  ['quién', 'Preguntas'],
  ['dónde', 'Preguntas'],
  ['ayuda', 'Necesidades y acciones'],
  ['agua', 'Necesidades y acciones'],
  ['comer', 'Necesidades y acciones'],
  ['universidad', 'Universidad'],
  ['estudiante', 'Universidad'],
  ['docente', 'Universidad'],
];

const plannedClasses = plannedEntries.map(([label, category]) => ({
  id: `${category.toLowerCase().replaceAll(' ', '-')}-${label}`,
  label,
  category,
}));

// Orden global: exactamente el mismo orden que src/catalog.ts#signCatalog.
// Este orden ES la ruta de aprendizaje: una lección se desbloquea cuando la anterior
// queda en estado "completed" para el usuario autenticado.
export const learningPath = [...pilotClasses, ...plannedClasses].map((entry, index) => ({
  ...entry,
  order: index,
}));

export const lessonsById = new Map(learningPath.map((lesson) => [lesson.id, lesson]));

// Agrupación por módulo (categoría) preservando el orden de aparición.
export const modules = (() => {
  const byCategory = new Map();
  for (const lesson of learningPath) {
    if (!byCategory.has(lesson.category)) {
      byCategory.set(lesson.category, { id: slugifyModule(lesson.category), title: lesson.category, lessons: [] });
    }
    byCategory.get(lesson.category).lessons.push(lesson);
  }
  return [...byCategory.values()];
})();

export function isValidLessonId(lessonId) {
  return lessonsById.has(lessonId);
}

export function firstLessonId() {
  return learningPath[0]?.id ?? null;
}

export function nextLessonId(lessonId) {
  const current = lessonsById.get(lessonId);
  if (!current) return null;
  const next = learningPath[current.order + 1];
  return next ? next.id : null;
}

function slugifyModule(category) {
  return category
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replaceAll(' ', '-');
}
