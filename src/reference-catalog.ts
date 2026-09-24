export interface SignReference {
  label: string;
  page: number | null;
  image: string | null;
  source: string;
  note: string;
}

const baseUrl = import.meta.env.BASE_URL;

const alphabetPages: Record<string, number> = {
  A: 13, B: 13, C: 13, CH: 13,
  D: 14, E: 14, F: 14, G: 14,
  H: 15, I: 15, J: 15, K: 15,
  L: 16, LL: 16, M: 16, N: 16,
  Ñ: 17, O: 17, P: 17, Q: 17,
  R: 18, RR: 18, S: 18, T: 18,
  U: 19, V: 19, W: 19, X: 19,
  Y: 20, Z: 20,
};

const numberPages: Record<string, number> = {
  '0': 33, '1': 33, '2': 33, '3': 33,
  '4': 34, '5': 34, '6': 34, '7': 34,
  '8': 35, '9': 35, '10': 35, '11': 35,
  '12': 36, '13': 36, '14': 36, '15': 36,
  '16': 37, '17': 37, '18': 37, '19': 37,
  '20': 38, '21': 38, '22': 38, '23': 38,
  '24': 39, '25': 39, '26': 39, '30': 39,
  '40': 40, '50': 40, '60': 40, '70': 40,
  '80': 41, '90': 41, '100': 41,
};

export function getReference(label: string): SignReference {
  const alphabetPage = alphabetPages[label];
  if (alphabetPage) {
    return {
      label,
      page: alphabetPage,
      image: `${baseUrl}references/modulo1/alphabet-${String(alphabetPage).padStart(3, '0')}.png`,
      source: 'Módulo I LESSA, MINEDUCYT y Asociación Salvadoreña de Sordos, 2020',
      note: 'Referencia oficial precargada. Observa configuración, orientación y movimiento antes de capturar.',
    };
  }

  const numberPage = numberPages[label];
  if (numberPage) {
    return {
      label,
      page: numberPage,
      image: `${baseUrl}references/modulo1/numbers-${String(numberPage).padStart(3, '0')}.png`,
      source: 'Módulo I LESSA, MINEDUCYT y Asociación Salvadoreña de Sordos, 2020',
      note: 'Referencia oficial precargada. Reproduce la configuración mostrada y captura varias rondas.',
    };
  }

  return {
    label,
    page: null,
    image: null,
    source: 'Módulo I LESSA, MINEDUCYT y Asociación Salvadoreña de Sordos, 2020',
    note: 'El módulo no presenta esta cantidad como entrada individual. Debe validarse su composición con una persona competente en LESSA antes de entrenar.',
  };
}
