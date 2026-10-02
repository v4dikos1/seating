import { GlobalWorkerOptions, getDocument, type PageViewport } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { FloorCalibration, FloorCalibrationPoint, FloorPlacement } from '@tickets/seating';
import type { FloorBackgroundTransform } from '@tickets/seating';

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface RenderedPdfPage {
  canvas: HTMLCanvasElement;
  viewport: PageViewport;
  numPages: number;
}

export async function renderPdfPage(url: string, pageNumber: number): Promise<RenderedPdfPage> {
  const loadingTask = getDocument({ url });
  const document = await loadingTask.promise;
  const numPages = document.numPages;
  if (pageNumber < 1 || pageNumber > document.numPages) {
    await loadingTask.destroy();
    throw new Error(`В PDF нет страницы ${pageNumber}.`);
  }
  const page = await document.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1 });
  const canvas = window.document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Браузер не создал canvas для страницы PDF.');
  await page.render({ canvas, canvasContext: context, viewport }).promise;
  page.cleanup();
  await loadingTask.destroy();
  return { canvas, viewport, numPages };
}

export function pdfCalibrationTransform(
  viewport: PageViewport,
  calibration: FloorCalibration,
  placement: FloorPlacement = { originX: 0, originY: 0, rotationDegrees: 0 },
): FloorBackgroundTransform | null {
  const { point1, point2, distanceMeters } = calibration;
  if (
    !Number.isFinite(point1.x) || !Number.isFinite(point1.y)
    || !Number.isFinite(point2.x) || !Number.isFinite(point2.y)
    || !Number.isFinite(distanceMeters) || distanceMeters <= 0
  ) return null;
  const first = viewport.convertToViewportPoint(point1.x, point1.y);
  const second = viewport.convertToViewportPoint(point2.x, point2.y);
  const dx = second[0] - first[0];
  const dy = second[1] - first[1];
  const pixels = Math.hypot(dx, dy);
  if (!Number.isFinite(pixels) || pixels <= 0) return null;

  const scale = distanceMeters * 1_000 / pixels;
  const rotation = placement.rotationDegrees * Math.PI / 180;
  return {
    x: placement.originX,
    y: placement.originY,
    scale,
    rotation,
  };
}

export function pointAtCanvasPosition(
  viewport: PageViewport,
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
): FloorCalibrationPoint {
  const bounds = canvas.getBoundingClientRect();
  const x = (clientX - bounds.left) * canvas.width / bounds.width;
  const y = (clientY - bounds.top) * canvas.height / bounds.height;
  const [pdfX, pdfY] = viewport.convertToPdfPoint(x, y);
  return { x: Math.round(pdfX * 10_000) / 10_000, y: Math.round(pdfY * 10_000) / 10_000 };
}
