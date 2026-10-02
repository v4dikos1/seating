import { Application, BitmapText, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import {
  defaultSeatStep,
  documentBounds,
  fitCamera,
  flattenZone,
  snapPointToGrid,
  snapRowPlan,
  snapToGrid,
  resizeZoneFrame,
  type ZoneResizeHandle,
  type Rect,
} from './editor-model';
import {
  rectsOverlap,
  resolveHeaderPlacement,
  type PlacedRect,
} from './geometry-layout';
import { resolveProperties, zoneCapacity, zoneKindOf, type SeatingZoneGeometry } from './model';
import { ObjectPool } from './object-pool';
import {
  ROW_LABEL_LOD_SCALE,
  SEAT_DIAMETER_UNITS,
  SEAT_LABEL_LOD_SCALE,
  SEAT_SPRITE_LOD_SCALE,
  seatScreenPixels,
} from './render-model';
import { createSeatTextureSet } from './seat-textures';
import { buildSpatialIndex, querySpatial, type SpatialIndex } from './spatial-index';
import { SEATING_THEME } from './theme';
import { formatLength } from './units';

export type EditorTool = 'select' | 'zone' | 'row' | 'seat' | 'table';

export interface EditorZone {
  zoneId: string;
  geometry: SeatingZoneGeometry;
}

export interface EditorCallbacks {
  /** Итоговый выбор после щелчка или рамки; пустой массив снимает выделение. */
  onSelect: (slots: number[], additive: boolean) => void;
  onMove: (dx: number, dy: number) => void;
  onMoveZone?: (zoneId: string, dx: number, dy: number) => void;
  onResizeZone?: (zoneId: string, handle: ZoneResizeHandle, x: number, y: number) => void;
  onCreateZone: (rect: Rect) => void;
  onAddRow: (from: { x: number; y: number }, to: { x: number; y: number }, count?: number) => void;
  onAddSeat: (x: number, y: number) => void;
  onAddTable?: (x: number, y: number) => void;
  onPickZone: (zoneId: string) => void;
  /**
   * Состояние камеры и указателя для строки состояния: масштаб в пикселях на метр
   * и координаты курсора в миллиметрах. Вызывается только при изменении.
   */
  onView?: (view: { scale: number; x: number | null; y: number | null }) => void;
}

export interface EditorController {
  setDocument: (zones: EditorZone[], activeZoneId: string | null) => void;
  setSelection: (slots: readonly number[]) => void;
  setTool: (tool: EditorTool) => void;
  fit: () => void;
  focusZone: (zoneId: string) => void;
  setBackground: (canvas: HTMLCanvasElement | null, transform: FloorBackgroundTransform | null) => void;
  /** Видимость и прозрачность подложки — настройка сеанса, на сервер она не уходит. */
  setBackgroundView: (visible: boolean, opacity: number) => void;
  /** Подогнать камеру по подложке: иначе её невозможно найти, если схема нарисована в стороне. */
  fitBackground: () => void;
  /** Прямоугольник подложки в координатах контракта либо null, если её нет. */
  backgroundBounds: () => Rect | null;
  /** Прямоугольник всей геометрии в координатах контракта либо null, если рамок нет. */
  contentBounds: () => Rect | null;
  /**
   * Центр видимой сейчас области холста в координатах контракта (мм). Нужен, чтобы
   * ставить новую рамку зоне «на глаз» туда, куда сейчас смотрит пользователь,
   * а не в мировой ноль, который может быть далеко за пределами экрана.
   */
  viewportCenter: () => { x: number; y: number };
  zoomBy: (factor: number) => void;
  setSnap: (enabled: boolean, step: number) => void;
  focus: () => void;
  destroy: () => void;
}

export interface FloorBackgroundTransform {
  x: number;
  y: number;
  scale: number;
  rotation: number;
}

interface RowBadgeItem {
  container: Container;
  bg: Graphics;
  label: BitmapText;
}

interface EditorZoneHeaderItem {
  zone: EditorZone;
  container: Container;
  bg: Graphics;
  text: Text;
  codeOnly: Text;
  lastUseFull?: boolean;
}

interface EditorSeat {
  zoneIndex: number;
  zoneId: string;
  slot: number;
  isActiveZone: boolean;
  x: number; // world x (mm / unit)
  y: number; // world y (mm / unit)
  rawX: number; // mm
  rawY: number; // mm
  rotation: number; // radians
  label: string;
  texture: Texture;
  tint: string;
  alpha: number;
  scale: number;
  sellable: boolean;
}

interface EditorRowHeader {
  zoneIndex: number;
  label: string;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  count: number;
  isActiveZone: boolean;
}

const unit = 1_000;

/**
 * Единица сцены — метр (см. `units.ts`), поэтому всё, что рисуется, имеет настоящий
 * размер: кресло 45 см, стол полтора метра. Текстура места нарисована в квадрате 16×16
 * логических единиц, отсюда и множитель спрайта.
 */
const seatTextureSize = 16;
const seatSpriteScale = SEAT_DIAMETER_UNITS / seatTextureSize;
const tableWidthUnits = SEATING_THEME.geometry.tableWidthMm / unit;
const tableDepthUnits = SEATING_THEME.geometry.tableDepthMm / unit;
/** Запас отсечения по видимой области: место целиком укладывается в метр. */
const cullMargin = 1;

/** Редактор схемы: рисование зон, ровные ряды с привязкой, выравнивание и выбор мест. */
export async function createEditorScene(host: HTMLElement, callbacks: EditorCallbacks): Promise<EditorController> {
  const app = new Application();
  await app.init({
    preference: 'webgl',
    // resizeTo намеренно не используется: Pixi слушает только resize окна и не замечает,
    // что изменился сам контейнер. Из-за этого холст расходился с местом, которое ему
    // отведено, и под ним оставалась пустая светлая полоса во весь экран.
    width: Math.max(1, host.clientWidth),
    height: Math.max(1, host.clientHeight),
    background: '#f7f9fc',
    antialias: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    autoDensity: true,
    autoStart: false,
  });
  host.appendChild(app.canvas);
  app.canvas.style.touchAction = 'none';
  // Единственная Tab-остановка холста: у обёртки-хоста (configurator.tsx) tabIndex
  // намеренно не выставлен, чтобы Tab не останавливался на одной и той же области дважды.
  app.canvas.tabIndex = 0;
  app.canvas.setAttribute(
    'aria-label',
    'Холст схемы зала. Стрелки перемещают камеру, + и − меняют масштаб, [ и ] переключают зоны.',
  );

  const world = new Container();
  const gridLayer = new Graphics();
  const backgroundLayer = new Container();
  const framesLayer = new Container();
  const seatsLayer = new Container();
  const labelsLayer = new Container();
  const rowLabelsLayer = new Container();
  const headersLayer = new Container();
  const overlay = new Graphics();
  const hudContainer = new Container();

  world.addChild(gridLayer, backgroundLayer, framesLayer, seatsLayer, labelsLayer, rowLabelsLayer, headersLayer, overlay, hudContainer);
  app.stage.addChild(world);

  const seatTextures = createSeatTextureSet(app.renderer);

  let zones: EditorZone[] = [];
  let activeZoneId: string | null = null;
  let tool: EditorTool = 'select';
  let selection = new Set<number>();

  let allSeats: EditorSeat[] = [];
  let seatSpatialIndex: SpatialIndex | null = null;
  let editorRowHeaders: EditorRowHeader[] = [];

  const spritePool = new ObjectPool<Sprite>(
    () => new Sprite(seatTextures.regular),
    (s) => { s.visible = false; },
  );
  const activeSprites = new Map<number, Sprite>();

  const seatLabelPool = new ObjectPool<BitmapText>(
    () => {
      const label = new BitmapText({
        text: '',
        style: {
          fontFamily: SEATING_THEME.seatLabel.fontFamily,
          fontSize: SEATING_THEME.seatLabel.fontSize,
          fill: SEATING_THEME.seatLabel.fill,
          stroke: { color: SEATING_THEME.seatLabel.strokeColor, width: SEATING_THEME.seatLabel.strokeWidth },
        },
      });
      label.anchor.set(0.5);
      label.eventMode = 'none';
      labelsLayer.addChild(label);
      return label;
    },
    (l) => { l.visible = false; },
  );
  const activeSeatLabels = new Map<number, BitmapText>();

  const rowBadgePool = new ObjectPool<RowBadgeItem>(
    () => {
      const container = new Container();
      const bg = new Graphics();
      const label = new BitmapText({
        text: '',
        style: {
          fontFamily: SEATING_THEME.seatLabel.fontFamily,
          fontSize: SEATING_THEME.rowBadge.fontSize,
          fill: SEATING_THEME.rowBadge.fill,
        },
      });
      label.anchor.set(0.5);
      container.addChild(bg, label);
      container.eventMode = 'none';
      rowLabelsLayer.addChild(container);
      return { container, bg, label };
    },
    (b) => { b.container.visible = false; },
  );
  const activeRowBadges: RowBadgeItem[] = [];

  let zoneHeaders: EditorZoneHeaderItem[] = [];
  let zoneFrames: { zone: EditorZone; shape: Graphics }[] = [];
  let framesScale = 0;
  let backgroundTexture: Texture | null = null;
  let backgroundSprite: Sprite | null = null;
  let backgroundRect: Rect | null = null;
  let backgroundVisible = true;
  let backgroundOpacity = 0.35;
  let destroyed = false;
  let frame = 0;

  let shiftHeld = false;
  let altHeld = false;
  let spaceHeld = false;
  let snapEnabled = true;
  let snapStep = defaultSeatStep;

  let panning: { x: number; y: number } | null = null;
  let drag: { startX: number; startY: number; x: number; y: number; mode: 'band' | 'move' | 'moveZone' | 'resizeZone' | 'zone' | 'row'; zoneId?: string; handle?: ZoneResizeHandle } | null = null;
  let hoveredSlot: number | null = null;

  // Floating HUD elements for row drafting
  const hudBg = new Graphics();
  const hudText = new BitmapText({
    text: '',
    style: {
      fontFamily: 'Inter, Arial, sans-serif',
      fontSize: 10,
      fill: '#ffffff',
      fontWeight: 'bold',
    },
  });
  hudContainer.addChild(hudBg, hudText);
  hudContainer.visible = false;
  hudContainer.eventMode = 'none';

  function active(): EditorZone | undefined {
    return zones.find((zone) => zone.zoneId === activeZoneId);
  }

  function zoneHandles(geometry: SeatingZoneGeometry): Array<{ handle: ZoneResizeHandle; x: number; y: number }> {
    const { x, y, width, height } = geometry;
    return [
      { handle: 'nw', x, y }, { handle: 'n', x: x + width / 2, y }, { handle: 'ne', x: x + width, y },
      { handle: 'e', x: x + width, y: y + height / 2 }, { handle: 'se', x: x + width, y: y + height },
      { handle: 's', x: x + width / 2, y: y + height }, { handle: 'sw', x, y: y + height },
      { handle: 'w', x, y: y + height / 2 },
    ];
  }

  function hitZoneHandle(x: number, y: number): ZoneResizeHandle | null {
    const zone = active();
    if (!zone || zone.geometry.width <= 0 || zone.geometry.height <= 0) return null;
    const radius = 11 * unit / world.scale.x;
    return zoneHandles(zone.geometry).find((item) => Math.hypot(item.x - x, item.y - y) <= radius)?.handle ?? null;
  }

  function resizeCursor(handle: ZoneResizeHandle): string {
    if (handle === 'n' || handle === 's') return 'ns-resize';
    if (handle === 'e' || handle === 'w') return 'ew-resize';
    return handle === 'nw' || handle === 'se' ? 'nwse-resize' : 'nesw-resize';
  }

  function resizeTarget(x: number, y: number): { x: number; y: number } {
    return snapEnabled && !altHeld ? snapPointToGrid({ x, y }, snapStep) : { x, y };
  }

  function request() {
    if (!frame && !destroyed) frame = requestAnimationFrame(render);
  }

  let pointerWorld: { x: number; y: number } | null = null;
  let lastViewScale = 0;
  let lastViewX: number | null = null;
  let lastViewY: number | null = null;

  /** Строка состояния обновляется только при изменении: это не поток событий мыши. */
  function publishView() {
    if (!callbacks.onView) return;
    const scale = world.scale.x;
    const x = pointerWorld ? Math.round(pointerWorld.x) : null;
    const y = pointerWorld ? Math.round(pointerWorld.y) : null;
    if (scale === lastViewScale && x === lastViewX && y === lastViewY) return;
    lastViewScale = scale;
    lastViewX = x;
    lastViewY = y;
    callbacks.onView({ scale, x, y });
  }

  function toWorld(event: PointerEvent | WheelEvent) {
    const bounds = app.canvas.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    return {
      screenX: x,
      screenY: y,
      x: ((x - world.x) / world.scale.x) * unit,
      y: ((y - world.y) / world.scale.x) * unit,
    };
  }

  function updateSeatData() {
    allSeats = [];
    editorRowHeaders = [];
    const xList: number[] = [];
    const yList: number[] = [];

    for (let zIdx = 0; zIdx < zones.length; zIdx++) {
      const zone = zones[zIdx];
      const geometry = zone.geometry;
      const isActive = zone.zoneId === activeZoneId;

      for (const seat of flattenZone(geometry)) {
        const rowProps = seat.parent === 'row' ? geometry.rows[seat.parentIndex]?.properties : null;
        const tableProps = seat.parent === 'table' ? geometry.tables?.[seat.parentIndex]?.properties : null;
        const resolved = resolveProperties(seat.properties, rowProps ?? tableProps, geometry.properties);

        const tex = seatTextures.get(resolved.accessibility, resolved.viewObstruction, resolved.sellable);
        const wx = seat.x / unit;
        const wy = seat.y / unit;

        let tint = geometry.color;
        let alpha = isActive ? 1 : 0.45;
        if (!resolved.sellable) {
          tint = '#94a3b8';
          alpha = isActive ? 0.55 : 0.35;
        }

        allSeats.push({
          zoneIndex: zIdx,
          zoneId: zone.zoneId,
          slot: seat.slot,
          isActiveZone: isActive,
          x: wx,
          y: wy,
          rawX: seat.x,
          rawY: seat.y,
          rotation: (seat.rotation / 1_000) * (Math.PI / 180),
          label: seat.label,
          texture: tex,
          tint,
          alpha,
          scale: isActive ? 1 : 0.85,
          sellable: resolved.sellable,
        });

        xList.push(wx);
        yList.push(wy);
      }

      for (const row of geometry.rows) {
        if (!row.positions.length) continue;
        const first = row.positions[0];
        const last = row.positions[row.positions.length - 1];
        editorRowHeaders.push({
          zoneIndex: zIdx,
          label: row.label,
          startX: first.x / unit,
          startY: first.y / unit,
          endX: last.x / unit,
          endY: last.y / unit,
          count: row.positions.length,
          isActiveZone: isActive,
        });
      }
    }

    const xArr = new Float32Array(xList);
    const yArr = new Float32Array(yList);
    seatSpatialIndex = xList.length > 0 ? buildSpatialIndex(xArr, yArr) : null;
  }

  /** Обводка и скругление рамок зон — в экранных пикселях, поэтому зависят от масштаба. */
  function drawZoneFrames(scale: number) {
    framesScale = scale;
    for (const { zone, shape } of zoneFrames) {
      const geometry = zone.geometry;
      const isActive = zone.zoneId === activeZoneId;
      const width = geometry.width / unit;
      const height = geometry.height / unit;
      const radius = Math.min(10 / scale, width / 4, height / 4);
      shape.clear()
        .roundRect(geometry.x / unit, geometry.y / unit, width, height, radius)
        .fill({ color: geometry.color, alpha: isActive ? 0.12 : 0.05 })
        .stroke({
          color: geometry.color,
          alpha: isActive ? 0.9 : 0.35,
          width: (isActive ? 2.5 : 1.5) / scale,
        });
    }
  }

  function updateFrames() {
    framesLayer.removeChildren().forEach((child) => child.destroy());
    headersLayer.removeChildren().forEach((child) => child.destroy());
    zoneHeaders = [];
    zoneFrames = [];
    framesScale = 0;

    for (const zone of zones) {
      const geometry = zone.geometry;
      const isActive = zone.zoneId === activeZoneId;

      if (geometry.width > 0 && geometry.height > 0) {
        const shape = new Graphics();
        framesLayer.addChild(shape);
        // Толщина обводки и скругление задаются в экранных пикселях и перерисовываются
        // при смене масштаба: в мировых единицах обводка зоны была бы толщиной в метры
        // и при приближении закрашивала бы зону целиком.
        zoneFrames.push({ zone, shape });

        const headerContainer = new Container();
        const bg = new Graphics();
        const caption =
          zoneKindOf(geometry) === 'Free'
            ? geometry.code + ' · ' + geometry.name + ' · лимит ' + zoneCapacity(geometry)
            : geometry.code + ' · ' + geometry.name;

        const text = new Text({
          text: caption,
          style: {
            fontFamily: 'Inter, Arial, sans-serif',
            fontSize: 13,
            fill: isActive ? '#1e293b' : '#64748b',
            fontWeight: '600',
          },
        });
        const codeOnly = new Text({
          text: geometry.code,
          style: {
            fontFamily: 'Inter, Arial, sans-serif',
            fontSize: 12,
            fill: isActive ? '#1e293b' : '#64748b',
            fontWeight: '700',
          },
        });
        headerContainer.addChild(bg, text, codeOnly);
        headerContainer.eventMode = 'none';
        headersLayer.addChild(headerContainer);

        zoneHeaders.push({
          zone,
          container: headerContainer,
          bg,
          text,
          codeOnly,
        });
      }

      // Столы рисуются в настоящих размерах: полтора метра в ширину, 1,1 в глубину.
      for (const table of geometry.tables ?? []) {
        const shape = new Graphics()
          .roundRect(-tableWidthUnits / 2, -tableDepthUnits / 2, tableWidthUnits, tableDepthUnits,
            tableDepthUnits / 3)
          .fill({ color: geometry.color, alpha: isActive ? 0.9 : 0.45 })
          .stroke({ color: '#ffffff', width: tableDepthUnits / 20 });
        shape.position.set(table.x / unit, table.y / unit);
        shape.rotation = (table.rotation / 1_000) * (Math.PI / 180);
        framesLayer.addChild(shape);

        const label = new Text({
          text: table.label,
          resolution: 4,
          style: { fontFamily: 'Inter, Arial, sans-serif', fontSize: 10, fill: '#ffffff', fontWeight: 'bold' },
        });
        label.anchor.set(0.5);
        label.scale.set((tableDepthUnits * 0.45) / 10);
        label.position.set(table.x / unit, table.y / unit);
        framesLayer.addChild(label);
      }
    }
  }

  function computeDragDelta(startX: number, startY: number, curX: number, curY: number): { dx: number; dy: number } {
    let dx = curX - startX;
    let dy = curY - startY;

    if (shiftHeld) {
      if (Math.abs(dx) >= Math.abs(dy)) dy = 0;
      else dx = 0;
    }

    const snap = snapEnabled && !altHeld;
    if (snap) {
      dx = snapToGrid(dx, snapStep);
      dy = snapToGrid(dy, snapStep);
    }

    return { dx, dy };
  }

  function render() {
    frame = 0;
    if (destroyed) return;
    const scale = world.scale.x;
    if (scale !== framesScale) drawZoneFrames(scale);

    const left = -world.x / scale;
    const top = -world.y / scale;
    const right = left + host.clientWidth / scale;
    const bottom = top + host.clientHeight / scale;

    // 0. Координатная сетка привязки: шаг удваивается, пока точки не разойдутся
    // хотя бы на двенадцать экранных пикселей — иначе получается серая заливка.
    gridLayer.clear();
    if (snapEnabled) {
      let gridUnit = snapStep / unit;
      for (let doubling = 0; doubling < 12 && gridUnit * scale < 12; doubling++) gridUnit *= 2;
      if (gridUnit * scale >= 12) {
        const startX = Math.floor(left / gridUnit) * gridUnit;
        const endX = Math.ceil(right / gridUnit) * gridUnit;
        const startY = Math.floor(top / gridUnit) * gridUnit;
        const endY = Math.ceil(bottom / gridUnit) * gridUnit;

        const dotRadius = 1.2 / scale;
        for (let gx = startX; gx <= endX; gx += gridUnit) {
          for (let gy = startY; gy <= endY; gy += gridUnit) {
            gridLayer.circle(gx, gy, dotRadius);
          }
        }
        gridLayer.fill({ color: '#94a3b8', alpha: 0.5 });
      }
    }

    let currentDragDx = 0;
    let currentDragDy = 0;
    if (drag && drag.mode === 'move') {
      const delta = computeDragDelta(drag.startX, drag.startY, drag.x, drag.y);
      currentDragDx = delta.dx;
      currentDragDy = delta.dy;
    }

    // 1. Отрисовка мест через spatial index и пул спрайтов
    const visibleSeatIndices = new Set<number>();

    if (seatSpatialIndex && scale >= SEAT_SPRITE_LOD_SCALE) {
      const queried = querySpatial(seatSpatialIndex,
        left - cullMargin, top - cullMargin, right + cullMargin, bottom + cullMargin);
      for (const index of queried) {
        const seat = allSeats[index];
        if (!seat) continue;
        const isSelected = seat.isActiveZone && selection.has(seat.slot);
        const isHovered = !drag && seat.isActiveZone && hoveredSlot === seat.slot;
        const isDragged = isSelected && drag && drag.mode === 'move';
        const posX = isDragged ? seat.x + currentDragDx / unit : seat.x;
        const posY = isDragged ? seat.y + currentDragDy / unit : seat.y;

        if (posX < left - cullMargin || posX > right + cullMargin
          || posY < top - cullMargin || posY > bottom + cullMargin) continue;
        visibleSeatIndices.add(index);

        let sprite = activeSprites.get(index);
        if (!sprite) {
          sprite = spritePool.acquire();
          if (!sprite.parent) {
            sprite.anchor.set(0.5);
            sprite.eventMode = 'none';
            seatsLayer.addChild(sprite);
          }
          activeSprites.set(index, sprite);
        }

        sprite.position.set(posX, posY);
        sprite.rotation = seat.rotation;
        sprite.texture = seat.texture;
        sprite.tint = isSelected
          ? SEATING_THEME.canvas.selectionTint
          : (isHovered ? 0x0284c7 : seat.tint);
        sprite.alpha = isSelected ? 1 : (isHovered ? 1 : seat.alpha);
        sprite.scale.set(seatSpriteScale * (isSelected ? 1.25 : (isHovered ? 1.18 : seat.scale)));
        sprite.visible = true;
      }
    }

    // Recycle non-visible sprites
    for (const [index, sprite] of activeSprites) {
      if (visibleSeatIndices.has(index)) continue;
      activeSprites.delete(index);
      spritePool.release(sprite);
    }

    // 2. Номера мест: пул BitmapText и отсечение по LOD и видимости
    if (scale >= SEAT_LABEL_LOD_SCALE) {
      for (const index of visibleSeatIndices) {
        const seat = allSeats[index];
        if (!seat) continue;
        const isSelected = seat.isActiveZone && selection.has(seat.slot);
        const isDragged = isSelected && drag && drag.mode === 'move';
        const posX = isDragged ? seat.x + currentDragDx / unit : seat.x;
        const posY = isDragged ? seat.y + currentDragDy / unit : seat.y;

        let label = activeSeatLabels.get(index);
        if (!label) {
          label = seatLabelPool.acquire();
          activeSeatLabels.set(index, label);
        }

        if (label.text !== seat.label) label.text = seat.label;
        label.position.set(posX, posY);
        // Номер места читается в экранных пикселях: в мире он был бы высотой в метры.
        label.scale.set(1 / scale);
        label.alpha = isSelected ? 1 : (seat.isActiveZone ? 1 : 0.6);
        label.visible = true;
      }
    }

    // Recycle non-visible labels
    for (const [index, label] of activeSeatLabels) {
      if (scale < SEAT_LABEL_LOD_SCALE || !visibleSeatIndices.has(index)) {
        activeSeatLabels.delete(index);
        seatLabelPool.release(label);
      }
    }

    // 3. Подписи рядов у торцов: пул RowBadgeItem и отсечение по LOD
    for (const badge of activeRowBadges) {
      rowBadgePool.release(badge);
    }
    activeRowBadges.length = 0;
    const placedRowBadgeRects: PlacedRect[] = [];

    if (scale >= ROW_LABEL_LOD_SCALE) {
      for (const rh of editorRowHeaders) {
        const minX = Math.min(rh.startX, rh.endX);
        const maxX = Math.max(rh.startX, rh.endX);
        const minY = Math.min(rh.startY, rh.endY);
        const maxY = Math.max(rh.startY, rh.endY);
        if (maxX < left - 5 || minX > right + 5 || maxY < top - 5 || minY > bottom + 5) continue;

        const dx = rh.endX - rh.startX;
        const dy = rh.endY - rh.startY;
        const dist = Math.hypot(dx, dy);
        const ux = dist > 0 ? dx / dist : 1;
        const uy = dist > 0 ? dy / dist : 0;

        const acquireBadge = (): RowBadgeItem => {
          const item = rowBadgePool.acquire();
          item.container.visible = true;
          activeRowBadges.push(item);
          return item;
        };

        // Подпись ряда живёт в экранных пикселях: её размер не зависит от того,
        // в каком масштабе нарисована схема.
        const renderBadge = (bx: number, by: number) => {
          const badge = acquireBadge();
          badge.label.text = rh.label;
          const textW = badge.label.width;
          const badgeW = Math.max(SEATING_THEME.rowBadge.minWidth, textW + 8);
          const badgeH = SEATING_THEME.rowBadge.height;
          badge.bg.clear()
            .roundRect(-badgeW / 2, -badgeH / 2, badgeW, badgeH, 4)
            .fill({ color: '#1e293b', alpha: rh.isActiveZone ? 0.9 : 0.5 });
          badge.container.scale.set(1 / scale);
          badge.container.position.set(bx, by);

          const screenX = world.x + bx * scale;
          const screenY = world.y + by * scale;
          placedRowBadgeRects.push({
            x: screenX - badgeW / 2,
            y: screenY - badgeH / 2,
            width: badgeW,
            height: badgeH,
          });
        };

        // Плашка отступает на половину места плюс зазор, иначе садится на первое кресло.
        const offset = SEAT_DIAMETER_UNITS / 2 + 12 / scale;
        renderBadge(rh.startX - ux * offset, rh.startY - uy * offset);
        if (rh.count >= 4) {
          renderBadge(rh.endX + ux * offset, rh.endY + uy * offset);
        }
      }
    }

    // 4. Отрисовка интерактивного слоя (Overlay / HUD)
    overlay.clear();
    hudContainer.visible = false;

    if (drag && drag.mode !== 'move') {
      const activeZone = active();

      if (drag.mode === 'row') {
        const plan = snapRowPlan(
          { x: drag.startX, y: drag.startY },
          { x: drag.x, y: drag.y },
          {
            lockAxis: shiftHeld,
            snapAngle: !altHeld,
            snapGrid: snapEnabled && !altHeld,
            step: snapStep,
            neighborRows: activeZone?.geometry.rows,
          },
        );

        // Направляющая линия
        overlay
          .moveTo(plan.from.x / unit, plan.from.y / unit)
          .lineTo(plan.to.x / unit, plan.to.y / unit)
          .stroke({ color: '#2563eb', width: 2.5 / scale });

        // Превью будущих мест
        const steps = Math.max(1, plan.count - 1);
        for (let i = 0; i < plan.count; i++) {
          const ratio = plan.count === 1 ? 0 : i / steps;
          const sx = (plan.from.x + (plan.to.x - plan.from.x) * ratio) / unit;
          const sy = (plan.from.y + (plan.to.y - plan.from.y) * ratio) / unit;
          overlay
            .circle(sx, sy, SEAT_DIAMETER_UNITS / 2)
            .fill({ color: '#2563eb', alpha: 0.35 })
            .stroke({ color: '#ffffff', width: 1.5 / scale });
        }

        // Live HUD tooltip
        hudContainer.visible = true;
        const hudMsg = `${plan.count} мест · шаг ${formatLength(plan.step)} · ${plan.angleDeg}°${shiftHeld ? ' [Shift: ось]' : ''}${altHeld ? ' [Alt: без сетки]' : ''}`;
        hudText.text = hudMsg;
        const padX = 8;
        const padY = 4;
        const hudW = hudText.width + padX * 2;
        const hudH = 18;

        hudBg.clear()
          .roundRect(0, 0, hudW, hudH, 4)
          .fill({ color: '#0f172a', alpha: 0.9 })
          .stroke({ color: '#38bdf8', width: 1 });
        hudText.position.set(padX, padY);

        const hudWorldScale = 1 / scale;
        hudContainer.scale.set(hudWorldScale);
        hudContainer.position.set(
          plan.to.x / unit + 12 * hudWorldScale,
          plan.to.y / unit - 24 * hudWorldScale,
        );
      } else if (drag.mode === 'resizeZone' && activeZone && drag.handle) {
        const target = resizeTarget(drag.x, drag.y);
        const preview = resizeZoneFrame(activeZone.geometry, drag.handle, target.x, target.y);
        overlay
          .rect(preview.x / unit, preview.y / unit, preview.width / unit, preview.height / unit)
          .fill({ color: activeZone.geometry.color, alpha: 0.1 })
          .stroke({ color: '#2563eb', width: 2 / scale });
      } else if (drag.mode === 'moveZone') {
        const moving = drag;
        const delta = computeDragDelta(moving.startX, moving.startY, moving.x, moving.y);
        const movingZone = zones.find((z) => z.zoneId === moving.zoneId);
        if (movingZone) {
          const zx = (movingZone.geometry.x + delta.dx) / unit;
          const zy = (movingZone.geometry.y + delta.dy) / unit;
          const zw = movingZone.geometry.width / unit;
          const zh = movingZone.geometry.height / unit;
          overlay
            .roundRect(zx, zy, zw, zh, 10)
            .fill({ color: movingZone.geometry.color, alpha: 0.16 })
            .stroke({ color: movingZone.geometry.color, width: 2 / scale });

          hudContainer.visible = true;
          const hudMsg = `Сдвиг зоны: ${formatLength(delta.dx)} · ${formatLength(delta.dy)}${shiftHeld ? ' [Shift: ось]' : ''}${altHeld ? ' [Alt: без сетки]' : ''}`;
          hudText.text = hudMsg;
          const padX = 8;
          const padY = 4;
          const hudW = hudText.width + padX * 2;
          const hudH = 18;

          hudBg.clear()
            .roundRect(0, 0, hudW, hudH, 4)
            .fill({ color: '#0f172a', alpha: 0.9 })
            .stroke({ color: '#38bdf8', width: 1 });
          hudText.position.set(padX, padY);

          const hudWorldScale = 1 / scale;
          hudContainer.scale.set(hudWorldScale);
          hudContainer.position.set(
            zx + 12 * hudWorldScale,
            zy - 24 * hudWorldScale,
          );
        }
      } else {
        const x = Math.min(drag.startX, drag.x) / unit;
        const y = Math.min(drag.startY, drag.y) / unit;
        const width = Math.abs(drag.x - drag.startX) / unit;
        const height = Math.abs(drag.y - drag.startY) / unit;

        overlay
          .rect(x, y, width, height)
          .fill({ color: '#2563eb', alpha: drag.mode === 'zone' ? 0.12 : 0.08 })
          .stroke({ color: '#2563eb', width: 1.5 / scale });
      }
    }

    if (tool === 'select') {
      const zone = active();
      if (zone && zone.geometry.width > 0 && zone.geometry.height > 0) {
        const geometry = drag?.mode === 'resizeZone' && drag.handle
          ? resizeZoneFrame(zone.geometry, drag.handle, resizeTarget(drag.x, drag.y).x, resizeTarget(drag.x, drag.y).y)
          : zone.geometry;
        const radius = 5 / scale;
        for (const item of zoneHandles(geometry)) {
          overlay.rect(item.x / unit - radius, item.y / unit - radius, radius * 2, radius * 2)
            .fill({ color: '#ffffff' })
            .stroke({ color: '#2563eb', width: 1.5 / scale });
        }
      }
    }

    // 5. Подписи зон: экранный кегль, LOD и разрешение коллизий (с зонами, рядами и местами)
    const obstacles: PlacedRect[] = [...placedRowBadgeRects];
    const sortedHeaders = [...zoneHeaders].sort((a, b) => {
      if (a.zone.zoneId === activeZoneId) return -1;
      if (b.zone.zoneId === activeZoneId) return 1;
      const areaA = (a.zone.geometry.width / unit) * (a.zone.geometry.height / unit);
      const areaB = (b.zone.geometry.width / unit) * (b.zone.geometry.height / unit);
      return areaB - areaA;
    });

    const checkSeatCollision = (cand: { cx: number; cy: number }, worldW: number, worldH: number, screenRect: PlacedRect) => {
      if (!seatSpatialIndex) return false;
      const nearby = querySpatial(
        seatSpatialIndex,
        cand.cx - SEAT_DIAMETER_UNITS,
        cand.cy - SEAT_DIAMETER_UNITS,
        cand.cx + worldW + SEAT_DIAMETER_UNITS,
        cand.cy + worldH + SEAT_DIAMETER_UNITS,
      );
      for (const sIdx of nearby) {
        const s = allSeats[sIdx];
        if (!s) continue;
        const sScreenX = world.x + s.x * scale;
        const sScreenY = world.y + s.y * scale;
        const seatRadius = Math.max(3, seatScreenPixels(scale) / 2);
        const seatRect: PlacedRect = {
          x: sScreenX - seatRadius,
          y: sScreenY - seatRadius,
          width: seatRadius * 2,
          height: seatRadius * 2,
        };
        if (rectsOverlap(screenRect, seatRect)) return true;
      }
      return false;
    };

    for (const item of sortedHeaders) {
      const g = item.zone.geometry;
      const placement = resolveHeaderPlacement({
        zoneX: g.x / unit,
        zoneY: g.y / unit,
        zoneWidth: g.width / unit,
        zoneHeight: g.height / unit,
        worldX: world.x,
        worldY: world.y,
        scale,
        fullWidth: item.text.width,
        codeWidth: item.codeOnly.width,
        labelHeight: SEATING_THEME.zoneHeader.height,
        viewportWidth: host.clientWidth,
        viewportHeight: host.clientHeight,
        placedObstacles: obstacles,
        checkSeatCollision,
      });

      if (!placement) {
        if (item.zone.zoneId !== activeZoneId) {
          item.container.visible = false;
        }
        continue;
      }

      obstacles.push(placement.screenRect);
      item.container.scale.set(1 / scale);
      item.container.position.set(placement.candidate.cx, placement.candidate.cy);
      item.container.visible = true;
      item.text.visible = placement.useFull;
      item.codeOnly.visible = !placement.useFull;

      if (item.lastUseFull !== placement.useFull) {
        item.lastUseFull = placement.useFull;
        const activeText = placement.useFull ? item.text : item.codeOnly;
        activeText.position.set(8, 3);
        item.bg.clear()
          .roundRect(0, 0, activeText.width + 16, SEATING_THEME.zoneHeader.height, 6)
          .fill({ color: '#ffffff', alpha: 0.94 })
          .stroke({ color: g.color, alpha: item.zone.zoneId === activeZoneId ? 0.9 : 0.45, width: 1.5 });
      }
    }

    app.renderer.render(app.stage);
  }

  function bounds(): Rect | null {
    return documentBounds(zones.map((zone) => zone.geometry));
  }

  function fitTo(rect: Rect | null) {
    const view = fitCamera(rect, host.clientWidth, host.clientHeight);
    world.scale.set(view.scale);
    world.position.set(view.x, view.y);
    publishView();
    request();
  }

  function zoom(factor: number, screenX: number, screenY: number) {
    const previous = world.scale.x;
    const next = Math.max(SEATING_THEME.zoom.minScale,
      Math.min(SEATING_THEME.zoom.maxScale, previous * factor));
    if (next === previous) return;
    world.position.set(screenX - ((screenX - world.x) * next) / previous, screenY - ((screenY - world.y) * next) / previous);
    world.scale.set(next);
    publishView();
    request();
  }

  const wheel = (event: WheelEvent) => {
    event.preventDefault();
    const point = toWorld(event);
    zoom(Math.exp(-event.deltaY * 0.0012), point.screenX, point.screenY);
  };

  const down = (event: PointerEvent) => {
    shiftHeld = event.shiftKey;
    altHeld = event.altKey;
    const point = toWorld(event);
    try {
      app.canvas.setPointerCapture(event.pointerId);
    } catch {
      // Захват недоступен для этого указателя: жест продолжает работать без него.
    }

    // Средняя кнопка или пробел: панорама доступна при любом инструменте
    if (event.button === 1 || event.button === 2 || spaceHeld) {
      panning = { x: point.screenX, y: point.screenY };
      return;
    }
    if (event.button !== 0) return;

    if (tool === 'zone' || tool === 'row') {
      drag = { startX: point.x, startY: point.y, x: point.x, y: point.y, mode: tool };
      request();
      return;
    }
    if (tool === 'seat') {
      const snap = snapEnabled && !altHeld;
      const target = snap ? snapPointToGrid({ x: point.x, y: point.y }, snapStep) : { x: point.x, y: point.y };
      callbacks.onAddSeat(target.x, target.y);
      return;
    }
    if (tool === 'table') {
      const snap = snapEnabled && !altHeld;
      const target = snap ? snapPointToGrid({ x: point.x, y: point.y }, snapStep) : { x: point.x, y: point.y };
      if (callbacks.onAddTable) callbacks.onAddTable(target.x, target.y);
      else callbacks.onAddSeat(target.x, target.y);
      return;
    }

    const handle = hitZoneHandle(point.x, point.y);
    if (handle) {
      drag = { startX: point.x, startY: point.y, x: point.x, y: point.y,
        mode: 'resizeZone', zoneId: activeZoneId ?? undefined, handle };
      app.canvas.style.cursor = resizeCursor(handle);
      request();
      return;
    }

    const hitHeader = findZoneHeaderHit(point.x, point.y);
    if (hitHeader) {
      callbacks.onPickZone(hitHeader.zone.zoneId);
      drag = {
        startX: point.x,
        startY: point.y,
        x: point.x,
        y: point.y,
        mode: 'moveZone',
        zoneId: hitHeader.zone.zoneId,
      };
      return;
    }

    const zone = active();
    if (!zone) {
      const picked = zones.find((item) => inside(item.geometry, point.x, point.y));
      if (picked) callbacks.onPickZone(picked.zoneId);
      return;
    }

    const radius = (14 / world.scale.x) * unit;
    let hit = nearest(zone.geometry, point.x, point.y, radius);
    if (hit === null && (zone.geometry.tables?.length ?? 0) > 0) {
      hit = nearestTableSeat(zone.geometry, point.x, point.y, radius);
    }
    if (hit !== null) {
      if (!selection.has(hit)) {
        const allSlots = flattenZone(zone.geometry);
        const hitSeat = allSlots[hit];
        if (hitSeat && hitSeat.parent === 'table') {
          const tableSeats = allSlots
            .filter((s) => s.parent === 'table' && s.parentIndex === hitSeat.parentIndex)
            .map((s) => s.slot);
          callbacks.onSelect(tableSeats, event.shiftKey);
        } else {
          callbacks.onSelect([hit], event.shiftKey);
        }
      }
      drag = { startX: point.x, startY: point.y, x: point.x, y: point.y, mode: 'move' };
      return;
    }

    const other = zones.find((item) => item.zoneId !== zone.zoneId && inside(item.geometry, point.x, point.y));
    if (other) {
      callbacks.onPickZone(other.zoneId);
      return;
    }
    drag = { startX: point.x, startY: point.y, x: point.x, y: point.y, mode: 'band' };
    request();
  };

  const move = (event: PointerEvent) => {
    shiftHeld = event.shiftKey;
    altHeld = event.altKey;
    const point = toWorld(event);
    pointerWorld = { x: point.x, y: point.y };
    publishView();
    if (panning) {
      world.x += point.screenX - panning.x;
      world.y += point.screenY - panning.y;
      panning = { x: point.screenX, y: point.screenY };
      request();
      return;
    }
    if (!drag) {
      const handle = tool === 'select' ? hitZoneHandle(point.x, point.y) : null;
      app.canvas.style.cursor = handle ? resizeCursor(handle) : tool === 'select' ? 'default' : 'crosshair';
      const activeZone = active();
      let nextHover: number | null = null;
      if (activeZone) {
        // Радиус наведения задан в экранных пикселях: в мировых он был бы метрами
        // и захватывал бы полсотни соседних кресел.
        const radius = (12 / world.scale.x) * unit;
        nextHover = nearest(activeZone.geometry, point.x, point.y, radius);
      }
      if (nextHover !== hoveredSlot) {
        hoveredSlot = nextHover;
        request();
      }
      return;
    }
    drag.x = point.x;
    drag.y = point.y;
    request();
  };

  const up = (event: PointerEvent) => {
    shiftHeld = event.shiftKey;
    altHeld = event.altKey;
    if (panning) {
      panning = null;
      return;
    }
    if (!drag) return;
    hoveredSlot = null;
    const current = drag;
    drag = null;
    hudContainer.visible = false;

    if (current.mode === 'zone') {
      const dx = current.x - current.startX;
      const dy = current.y - current.startY;
      const rect: Rect = {
        x: Math.min(current.startX, current.x),
        y: Math.min(current.startY, current.y),
        width: Math.abs(dx),
        height: Math.abs(dy),
      };
      if (rect.width > unit && rect.height > unit) callbacks.onCreateZone(rect);
    } else if (current.mode === 'row') {
      const activeZone = active();
      const plan = snapRowPlan(
        { x: current.startX, y: current.startY },
        { x: current.x, y: current.y },
        {
          lockAxis: shiftHeld,
          snapAngle: !altHeld,
          snapGrid: snapEnabled && !altHeld,
          step: snapStep,
          neighborRows: activeZone?.geometry.rows,
        },
      );
      if (Math.hypot(plan.to.x - plan.from.x, plan.to.y - plan.from.y) > unit) {
        callbacks.onAddRow(plan.from, plan.to, plan.count);
      }
    } else if (current.mode === 'resizeZone') {
      const zone = active();
      if (zone && current.zoneId && current.handle
        && Math.hypot(current.x - current.startX, current.y - current.startY) > 1) {
        const target = resizeTarget(current.x, current.y);
        const resized = resizeZoneFrame(zone.geometry, current.handle, target.x, target.y);
        if (resized !== zone.geometry) callbacks.onResizeZone?.(current.zoneId, current.handle, target.x, target.y);
      }
      app.canvas.style.cursor = 'default';
    } else if (current.mode === 'move') {
      const { dx, dy } = computeDragDelta(current.startX, current.startY, current.x, current.y);
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
        callbacks.onMove(dx, dy);
      } else {
        request();
      }
    } else if (current.mode === 'moveZone') {
      const { dx, dy } = computeDragDelta(current.startX, current.startY, current.x, current.y);
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
        if (callbacks.onMoveZone && current.zoneId) {
          callbacks.onMoveZone(current.zoneId, dx, dy);
        }
      } else {
        request();
      }
    } else {
      const dx = current.x - current.startX;
      const dy = current.y - current.startY;
      const rect: Rect = {
        x: Math.min(current.startX, current.x),
        y: Math.min(current.startY, current.y),
        width: Math.abs(dx),
        height: Math.abs(dy),
      };
      const zone = active();
      if (zone) {
        if (rect.width < unit / 2 && rect.height < unit / 2) callbacks.onSelect([], false);
        else callbacks.onSelect(inRect(zone.geometry, rect), event.shiftKey);
      }
    }
    request();
  };

  /**
   * Холст реагирует на клавиатуру только когда он в фокусе — иначе стрелки двигали бы
   * камеру, даже когда пользователь работает со списком зон или инспектором.
   * Модификаторы слушаются всегда: они влияют на жест мышью.
   */
  function canvasHasFocus(): boolean {
    const active = document.activeElement;
    return active === app.canvas || active === host || (active !== null && host.contains(active)
      && active.tagName !== 'INPUT' && active.tagName !== 'TEXTAREA' && active.tagName !== 'SELECT'
      && active.tagName !== 'BUTTON');
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Shift') {
      shiftHeld = true;
      if (drag) request();
      return;
    } else if (e.key === 'Alt') {
      altHeld = true;
      if (drag) request();
      return;
    } else if (e.code === 'Space') {
      if (canvasHasFocus()) spaceHeld = true;
      return;
    }

    if (!canvasHasFocus()) return;
    if (e.ctrlKey || e.metaKey) return;

    const panStep = 50;
    const pan = (dx: number, dy: number) => {
      e.preventDefault();
      world.x += dx;
      world.y += dy;
      request();
    };
    // Панорамирование — только стрелками: буквы (в т.ч. W/A/S/D) заняты инструментами
    // конфигуратора (V/Z/R/S/T, configurator.tsx) и не должны значить второе на холсте.
    if (e.key === 'ArrowLeft') {
      pan(panStep, 0);
    } else if (e.key === 'ArrowRight') {
      pan(-panStep, 0);
    } else if (e.key === 'ArrowUp') {
      pan(0, panStep);
    } else if (e.key === 'ArrowDown') {
      pan(0, -panStep);
    } else if (e.key === '+' || e.key === '=') {
      zoom(1.15, host.clientWidth / 2, host.clientHeight / 2);
    } else if (e.key === '-' || e.key === '_') {
      zoom(1 / 1.15, host.clientWidth / 2, host.clientHeight / 2);
    } else if (e.key === '[') {
      if (zones.length > 1) {
        const curIdx = zones.findIndex((z) => z.zoneId === activeZoneId);
        const prevIdx = (curIdx - 1 + zones.length) % zones.length;
        callbacks.onPickZone(zones[prevIdx].zoneId);
      }
    } else if (e.key === ']') {
      if (zones.length > 1) {
        const curIdx = zones.findIndex((z) => z.zoneId === activeZoneId);
        const nextIdx = (curIdx + 1) % zones.length;
        callbacks.onPickZone(zones[nextIdx].zoneId);
      }
    }
    // Escape обрабатывает конфигуратор: два обработчика на одну клавишу — это ошибка.
  };

  const onKeyUp = (e: KeyboardEvent) => {
    if (e.key === 'Shift') {
      shiftHeld = false;
      if (drag) request();
    } else if (e.key === 'Alt') {
      altHeld = false;
      if (drag) request();
    } else if (e.code === 'Space') {
      spaceHeld = false;
    }
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  const context = (event: Event) => event.preventDefault();
  const leave = () => {
    pointerWorld = null;
    publishView();
    if (hoveredSlot !== null) {
      hoveredSlot = null;
      request();
    }
  };
  app.canvas.addEventListener('wheel', wheel, { passive: false });
  app.canvas.addEventListener('pointerdown', down);
  app.canvas.addEventListener('pointermove', move);
  app.canvas.addEventListener('pointerup', up);
  app.canvas.addEventListener('pointercancel', up);
  app.canvas.addEventListener('pointerleave', leave);
  app.canvas.addEventListener('contextmenu', context);

  /** Холст всегда точно равен своему контейнеру — и по ширине, и по высоте. */
  let sizedWidth = Math.max(1, host.clientWidth);
  let sizedHeight = Math.max(1, host.clientHeight);
  function syncSize() {
    if (destroyed) return;
    const width = Math.max(1, host.clientWidth);
    const height = Math.max(1, host.clientHeight);
    if (width === sizedWidth && height === sizedHeight) return;
    sizedWidth = width;
    sizedHeight = height;
    app.renderer.resize(width, height);
    request();
  }
  const observer = new ResizeObserver(syncSize);
  observer.observe(host);

  function nearest(geometry: SeatingZoneGeometry, x: number, y: number, radius: number): number | null {
    if (!seatSpatialIndex) return null;
    const wx = x / unit;
    const wy = y / unit;
    const wr = radius / unit;
    const queried = querySpatial(seatSpatialIndex, wx - wr, wy - wr, wx + wr, wy + wr);
    let bestSlot: number | null = null;
    let bestDist = radius;
    for (const idx of queried) {
      const seat = allSeats[idx];
      if (!seat || !seat.isActiveZone) continue;
      const d = Math.hypot(seat.rawX - x, seat.rawY - y);
      if (d <= bestDist) {
        bestDist = d;
        bestSlot = seat.slot;
      }
    }
    return bestSlot;
  }

  function nearestTableSeat(geometry: SeatingZoneGeometry, x: number, y: number, radius: number): number | null {
    const slots = flattenZone(geometry);
    const tables = geometry.tables ?? [];
    for (let tIndex = 0; tIndex < tables.length; tIndex++) {
      const table = tables[tIndex];
      const hitRadius = Math.max(SEATING_THEME.geometry.tableWidthMm / 2, radius);
      if (Math.hypot(table.x - x, table.y - y) <= hitRadius) {
        const first = slots.find((s) => s.parent === 'table' && s.parentIndex === tIndex);
        if (first) return first.slot;
      }
    }
    return null;
  }

  function findZoneHeaderHit(x: number, y: number): EditorZoneHeaderItem | null {
    const wx = x / unit;
    const wy = y / unit;
    const scale = world.scale.x;
    for (const item of zoneHeaders) {
      if (!item.container.visible) continue;
      const hx = item.container.position.x;
      const hy = item.container.position.y;
      const activeText = item.text.visible ? item.text : item.codeOnly;
      const hw = (activeText.width + 16) / scale;
      const hh = SEATING_THEME.zoneHeader.height / scale;
      if (wx >= hx && wx <= hx + hw && wy >= hy && wy <= hy + hh) {
        return item;
      }
    }
    return null;
  }

  function inRect(geometry: SeatingZoneGeometry, rect: Rect): number[] {
    if (!seatSpatialIndex) return [];
    const rx1 = rect.x / unit;
    const ry1 = rect.y / unit;
    const rx2 = (rect.x + rect.width) / unit;
    const ry2 = (rect.y + rect.height) / unit;
    const queried = querySpatial(seatSpatialIndex, rx1, ry1, rx2, ry2);
    const right = rect.x + rect.width;
    const bottom = rect.y + rect.height;
    const result: number[] = [];
    for (const idx of queried) {
      const seat = allSeats[idx];
      if (!seat || !seat.isActiveZone) continue;
      if (seat.rawX >= rect.x && seat.rawX <= right && seat.rawY >= rect.y && seat.rawY <= bottom) {
        result.push(seat.slot);
      }
    }
    return result;
  }

  return {
    setDocument(next, zoneId) {
      const first = zones.length === 0 && next.length > 0;
      zones = next;
      activeZoneId = zoneId;

      updateSeatData();
      updateFrames();

      if (first) fitTo(bounds());
      request();
    },
    setSelection(slots) {
      selection = new Set(slots);
      request();
    },
    setTool(next) {
      tool = next;
      app.canvas.style.cursor = next === 'select' ? 'default' : 'crosshair';
    },
    fit: () => fitTo(bounds()),
    focusZone(zoneId) {
      const zone = zones.find((item) => item.zoneId === zoneId);
      if (zone && zone.geometry.width > 0) fitTo(zone.geometry);
    },
    setBackground(canvas, transform) {
      backgroundLayer.removeChildren().forEach((child) => child.destroy());
      backgroundTexture?.destroy(true);
      backgroundTexture = null;
      backgroundSprite = null;
      backgroundRect = null;
      if (canvas && transform) {
        backgroundTexture = Texture.from(canvas);
        const image = new Sprite(backgroundTexture);
        image.position.set(transform.x / unit, transform.y / unit);
        image.scale.set(transform.scale / unit);
        image.rotation = transform.rotation;
        image.alpha = backgroundVisible ? backgroundOpacity : 0;
        image.visible = backgroundVisible;
        image.eventMode = 'none';
        backgroundLayer.addChild(image);
        backgroundSprite = image;
        // Границы подложки в координатах контракта: нужны и для подгонки камеры,
        // и для того, чтобы честно сказать, как далеко схема лежит от плана.
        const corners = [[0, 0], [canvas.width, 0], [0, canvas.height], [canvas.width, canvas.height]]
          .map(([px, py]) => {
            const sx = px * transform.scale;
            const sy = py * transform.scale;
            const cos = Math.cos(transform.rotation);
            const sin = Math.sin(transform.rotation);
            return { x: transform.x + sx * cos - sy * sin, y: transform.y + sx * sin + sy * cos };
          });
        const xs = corners.map((point) => point.x);
        const ys = corners.map((point) => point.y);
        backgroundRect = {
          x: Math.min(...xs), y: Math.min(...ys),
          width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys),
        };
      }
      request();
    },
    setBackgroundView(visible, opacity) {
      backgroundVisible = visible;
      backgroundOpacity = Math.min(1, Math.max(0.05, opacity));
      if (backgroundSprite) {
        backgroundSprite.visible = visible;
        backgroundSprite.alpha = backgroundOpacity;
      }
      request();
    },
    fitBackground: () => fitTo(backgroundRect),
    backgroundBounds: () => backgroundRect,
    contentBounds: () => bounds(),
    viewportCenter: () => ({
      x: ((host.clientWidth / 2 - world.x) / world.scale.x) * unit,
      y: ((host.clientHeight / 2 - world.y) / world.scale.x) * unit,
    }),
    zoomBy: (factor) => zoom(factor, host.clientWidth / 2, host.clientHeight / 2),
    setSnap(enabled, step) {
      snapEnabled = enabled;
      snapStep = step > 0 ? step : defaultSeatStep;
      request();
    },
    focus: () => app.canvas.focus(),
    destroy() {
      destroyed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      app.canvas.removeEventListener('wheel', wheel);
      app.canvas.removeEventListener('pointerdown', down);
      app.canvas.removeEventListener('pointermove', move);
      app.canvas.removeEventListener('pointerup', up);
      app.canvas.removeEventListener('pointercancel', up);
      app.canvas.removeEventListener('pointerleave', leave);
      app.canvas.removeEventListener('contextmenu', context);
      backgroundTexture?.destroy(true);
      seatTextures.destroy();

      for (const sprite of activeSprites.values()) sprite.destroy();
      spritePool.clear((s) => s.destroy());
      for (const label of activeSeatLabels.values()) label.destroy();
      seatLabelPool.clear((l) => l.destroy());
      for (const b of activeRowBadges) {
        b.container.destroy({ children: true });
      }
      rowBadgePool.clear((b) => b.container.destroy({ children: true }));

      app.destroy(true, { children: true });
    },
  };
}

function inside(geometry: SeatingZoneGeometry, x: number, y: number): boolean {
  return (
    geometry.width > 0 &&
    geometry.height > 0 &&
    x >= geometry.x &&
    x <= geometry.x + geometry.width &&
    y >= geometry.y &&
    y <= geometry.y + geometry.height
  );
}
