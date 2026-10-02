/**
 * Чистая геометрия и компоновка надписей на схеме зала (0 зависимостей от Pixi.js).
 */

export interface PlacedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Проверяет пересечение двух прямоугольников (AABB).
 * Соприкосновение границами не считается пересечением.
 */
export function rectsOverlap(a: PlacedRect, b: PlacedRect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

export interface HeaderCandidate {
  /** X координата в мировом пространстве (условные единицы / 1000) */
  cx: number;
  /** Y координата в мировом пространстве (условные единицы / 1000) */
  cy: number;
}

/**
 * Вычисляет список стандартных позиций-кандидатов для подписи зоны в мировых координатах:
 * 1. Внутри в левом верхнем углу
 * 2. Сверху над зоной
 * 3. Внутри в правом верхнем углу
 * 4. Внутри в левом нижнем углу
 */
export function computeHeaderCandidates(
  zx: number,
  zy: number,
  zw: number,
  zh: number,
  worldW: number,
  invScale: number,
): HeaderCandidate[] {
  return [
    { cx: zx + 10 * invScale, cy: zy + 8 * invScale },
    { cx: zx + 10 * invScale, cy: zy - 26 * invScale },
    { cx: zx + zw - worldW - 10 * invScale, cy: zy + 8 * invScale },
    { cx: zx + 10 * invScale, cy: zy + zh - 26 * invScale },
  ];
}

/**
 * Проверяет, видна ли зона хотя бы частично на экране.
 */
export function isZoneVisibleInViewport(
  screenX: number,
  screenY: number,
  screenWidth: number,
  screenHeight: number,
  viewportWidth: number,
  viewportHeight: number,
): boolean {
  return !(
    screenX + screenWidth < 0 ||
    screenX > viewportWidth ||
    screenY + screenHeight < 0 ||
    screenY > viewportHeight
  );
}

/**
 * Проверяет, достаточно ли велика зона на экране для отображения подписи (LOD).
 */
export function isZoneBigEnoughForHeader(
  screenWidth: number,
  screenHeight: number,
  minWidth = 32,
  minHeight = 22,
): boolean {
  return screenWidth >= minWidth && screenHeight >= minHeight;
}

/**
 * Определяет, стоит ли предпочесть полное название зоны коду.
 */
export function shouldPreferFullHeader(screenWidth: number, threshold = 110): boolean {
  return screenWidth >= threshold;
}

export interface ResolveHeaderPlacementOptions {
  zoneX: number;
  zoneY: number;
  zoneWidth: number;
  zoneHeight: number;
  worldX: number;
  worldY: number;
  scale: number;
  fullWidth: number;
  codeWidth: number;
  labelHeight?: number;
  viewportWidth: number;
  viewportHeight: number;
  placedObstacles: readonly PlacedRect[];
  checkSeatCollision?: (worldCand: HeaderCandidate, worldW: number, worldH: number, screenRect: PlacedRect) => boolean;
}

export interface ResolvedHeaderPlacement {
  placed: boolean;
  candidate: HeaderCandidate;
  screenRect: PlacedRect;
  useFull: boolean;
}

/**
 * Чистый алгоритм подбора размещения подписи зоны с разрешением коллизий.
 */
export function resolveHeaderPlacement(
  options: ResolveHeaderPlacementOptions,
): ResolvedHeaderPlacement | null {
  const {
    zoneX,
    zoneY,
    zoneWidth,
    zoneHeight,
    worldX,
    worldY,
    scale,
    fullWidth,
    codeWidth,
    labelHeight = 22,
    viewportWidth,
    viewportHeight,
    placedObstacles,
    checkSeatCollision,
  } = options;

  const sx = worldX + zoneX * scale;
  const sy = worldY + zoneY * scale;
  const sw = zoneWidth * scale;
  const sh = zoneHeight * scale;

  if (!isZoneVisibleInViewport(sx, sy, sw, sh, viewportWidth, viewportHeight)) {
    return null;
  }

  if (!isZoneBigEnoughForHeader(sw, sh)) {
    return null;
  }

  const invScale = 1 / scale;
  const preferFull = shouldPreferFullHeader(sw);
  const modes: boolean[] = preferFull ? [true, false] : [false];

  for (const useFull of modes) {
    const textWidth = useFull ? fullWidth : codeWidth;
    const labelW = textWidth + 16;
    const labelH = labelHeight;
    const worldW = labelW * invScale;
    const worldH = labelH * invScale;

    const candidates = computeHeaderCandidates(
      zoneX,
      zoneY,
      zoneWidth,
      zoneHeight,
      worldW,
      invScale,
    );

    for (const cand of candidates) {
      const candSx = worldX + cand.cx * scale;
      const candSy = worldY + cand.cy * scale;
      const rect: PlacedRect = {
        x: candSx,
        y: candSy,
        width: labelW,
        height: labelH,
      };

      // Проверка границ экрана (с отступом 4px)
      if (
        rect.x < 4 ||
        rect.x + rect.width > viewportWidth - 4 ||
        rect.y < 4 ||
        rect.y + rect.height > viewportHeight - 4
      ) {
        continue;
      }

      // Проверка препятствий (другие подписи зон, торцы рядов)
      let overlaps = false;
      for (const obstacle of placedObstacles) {
        if (rectsOverlap(rect, obstacle)) {
          overlaps = true;
          break;
        }
      }
      if (overlaps) {
        continue;
      }

      // Проверка мест
      if (checkSeatCollision && checkSeatCollision(cand, worldW, worldH, rect)) {
        continue;
      }

      return {
        placed: true,
        candidate: cand,
        screenRect: rect,
        useFull,
      };
    }
  }

  return null;
}
