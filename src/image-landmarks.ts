import type { HandLandmarker } from '@mediapipe/tasks-vision';
import { createStillImageHandLandmarker } from './hand-tracker';
import { normalizePoints, selectPrimaryHand } from './landmark-features';
import type { ReferenceImage } from './reference-dataset';

export interface ExtractedReference {
  image: ReferenceImage;
  /** 63 valores normalizados (`metric-single-hand-v1`). */
  features: number[];
  /** Variante con la que se detectó la mano. */
  variant: string;
}

export interface ExtractionResult {
  samples: ExtractedReference[];
  failed: ReferenceImage[];
}

/** Márgenes probados cuando la mano toca el borde o llena el encuadre. */
const PADDING_VARIANTS = [0, 0.25, 0.6];

export async function extractReferenceLandmarks(
  images: ReferenceImage[],
  onProgress?: (done: number, total: number, image: ReferenceImage) => void,
): Promise<ExtractionResult> {
  const landmarker = await createStillImageHandLandmarker();
  const samples: ExtractedReference[] = [];
  const failed: ReferenceImage[] = [];
  try {
    for (const [index, image] of images.entries()) {
      try {
        const element = await loadImage(image.url);
        const detected = detectWithFallback(landmarker, element);
        if (detected) samples.push({ image, ...detected });
        else failed.push(image);
      } catch (error) {
        console.warn(`No se pudo procesar ${image.path}.`, error);
        failed.push(image);
      }
      onProgress?.(index + 1, images.length, image);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  } finally {
    landmarker.close();
  }
  return { samples, failed };
}

function detectWithFallback(landmarker: HandLandmarker, image: HTMLImageElement): { features: number[]; variant: string } | null {
  for (const padding of PADDING_VARIANTS) {
    const source = padding === 0 ? image : padImage(image, padding);
    const width = padding === 0 ? image.naturalWidth : (source as HTMLCanvasElement).width;
    const height = padding === 0 ? image.naturalHeight : (source as HTMLCanvasElement).height;
    const result = landmarker.detect(source);
    const points = selectPrimaryHand(result.landmarks, width, height);
    if (points) {
      return {
        features: normalizePoints(points),
        variant: padding === 0 ? 'original' : `margen ${Math.round(padding * 100)} %`,
      };
    }
  }
  return null;
}

/** Coloca la fotografía sobre un lienzo más grande para que el detector de palma vea la mano completa. */
function padImage(image: HTMLImageElement, padding: number): HTMLCanvasElement {
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  const marginX = Math.round(width * padding);
  const marginY = Math.round(height * padding);
  const canvas = document.createElement('canvas');
  canvas.width = width + marginX * 2;
  canvas.height = height + marginY * 2;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('El navegador no permite crear un lienzo 2D.');
  context.fillStyle = averageColor(image);
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, marginX, marginY, width, height);
  return canvas;
}

function averageColor(image: HTMLImageElement): string {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return '#c8c8c8';
  context.drawImage(image, 0, 0, 1, 1);
  const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
  return `rgb(${r}, ${g}, ${b})`;
}

async function loadImage(url: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.decoding = 'async';
  image.src = url;
  await image.decode();
  return image;
}
