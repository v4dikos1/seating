import { Application, BitmapFontManager, BitmapText, Container, Graphics, Sprite, Text } from 'pixi.js';
import {
  rectsOverlap,
  resolveHeaderPlacement,
  type PlacedRect,
} from './geometry-layout';
import { ObjectPool } from './object-pool';
import {
  ROW_LABEL_LOD_SCALE,
  SEAT_DIAMETER_UNITS,
  SEAT_LABEL_LOD_SCALE,
  SEAT_SPRITE_LOD_SCALE,
  readSalesStatus,
  readSeatProperties,
  readText,
  resolveRenderResolution,
  seatDotPixels,
  seatMagnification,
  seatScreenPixels,
  selectedHaloPixels,
  zoneLabelText,
  type RenderGeometry,
  type RenderZone,
} from './render-model';
import { createSeatTextureSet } from './seat-textures';
import { querySpatial } from './spatial-index';
import { SEATING_THEME } from './theme';

/**
 * Единица сцены — метр, поэтому кресло, стол и подписи имеют настоящие размеры
 * помещения: те же значения, что и в редакторе, берутся из общей темы.
 */
const seatTextureSize = 16;
const seatSpriteScale = SEAT_DIAMETER_UNITS / seatTextureSize;
const tableWidthUnits = SEATING_THEME.geometry.tableWidthMm / 1_000;
const tableDepthUnits = SEATING_THEME.geometry.tableDepthMm / 1_000;
const cullMargin = 1;
/** Радиус попадания указателя — в экранных пикселях, а не в метрах сцены: наведение
 *  и клик (see `up`) должны совпадать и не зависеть от масштаба камеры. */
const hitRadiusPx = 14;

export interface SeatSelection {
  slot: number;
  positionId: string | null;
  zoneId: string;
  zoneName: string;
  row: string;
  label: string;
}

export interface SceneController {
  fit(): void;
  focusZone(id: string): void;
  setSelection(slots: ReadonlySet<number>): void;
  describe(slot: number): SeatSelection;
  /**
   * Перерисовать кадр без смены геометрии: продажный статус (`applySalesStatus`) мутирует
   * буфер `RenderGeometry` на месте, и сцена о нём не узнает сама, пока её не попросят.
   */
  refresh(): void;
  destroy(): void;
}

interface RowBadgeItem {
  container: Container;
  bg: Graphics;
  label: BitmapText;
}

interface ZoneHeaderItem {
  zone: RenderZone;
  container: Container;
  bg: Graphics;
  text: Text;
  codeOnly: Text;
  lastUseFull?: boolean;
  lastLabel?: string;
}

interface TableItem {
  zone: RenderZone;
  shape: Graphics;
  label: Text;
}

let sceneCounter = 0;


/** Адаптер отрисовки: в хранилище не попадают ни классы Pixi, ни сериализованная сцена. */
export async function createScene(
  host: HTMLElement,
  geometry: RenderGeometry,
  onSelect: (seat: SeatSelection) => void,
): Promise<SceneController> {
  const app = new Application();
  let resolution = resolveRenderResolution(window.devicePixelRatio);
  await app.init({
    preference: 'webgl',
    // Размер задаётся явно и поддерживается ResizeObserver: resizeTo слушает только
    // окно и не замечает, что изменился сам контейнер.
    width: Math.max(1, host.clientWidth),
    height: Math.max(1, host.clientHeight),
    background: SEATING_THEME.canvas.background,
    resolution,
    autoDensity: true,
    antialias: true,
    autoStart: false,
  });
  host.appendChild(app.canvas);
  app.canvas.style.touchAction = 'none';

  const world = new Container();
  app.stage.addChild(world);

  // Растровые шрифты строятся один раз с запасом плотности (до 3x): при масштабе страницы
  // браузера подписи не превращаются в размытые растянутые пиксели.
  const fontPrefix = 'seating-scene-' + sceneCounter++;
  const seatFontName = fontPrefix + '-seat';
  const rowFontName = fontPrefix + '-row';
  BitmapFontManager.install({
    name: seatFontName,
    resolution: 3,
    style: {
      fontFamily: SEATING_THEME.seatLabel.fontFamily,
      fontSize: SEATING_THEME.seatLabel.fontSize,
      fill: SEATING_THEME.seatLabel.fill,
      stroke: { color: SEATING_THEME.seatLabel.strokeColor, width: SEATING_THEME.seatLabel.strokeWidth },
    },
  });
  BitmapFontManager.install({
    name: rowFontName,
    resolution: 3,
    style: {
      fontFamily: SEATING_THEME.seatLabel.fontFamily,
      fontSize: SEATING_THEME.rowBadge.fontSize,
      fill: SEATING_THEME.rowBadge.fill,
    },
  });

  const framesLayer = new Container();
  const seatsLayer = new Container();
  const haloLayer = new Container();
  const labelsLayer = new Container();
  const rowsLayer = new Container();
  const headersLayer = new Container();
  world.addChild(framesLayer, seatsLayer, haloLayer, labelsLayer, rowsLayer, headersLayer);

  const seatTextures = createSeatTextureSet(app.renderer);
  const sprites = new Map<number, Sprite>();
  const spritePool = new ObjectPool<Sprite>(
    () => new Sprite(seatTextures.regular),
    (s) => { s.visible = false; },
  );

  const seatLabels = new Map<number, BitmapText>();
  const seatLabelPool = new ObjectPool<BitmapText>(
    () => {
      const label = new BitmapText({
        text: '',
        style: {
          fontFamily: seatFontName,
          fontSize: SEATING_THEME.seatLabel.fontSize,
        },
      });
      label.anchor.set(0.5);
      label.eventMode = 'none';
      labelsLayer.addChild(label);
      return label;
    },
    (l) => { l.visible = false; },
  );

  const rowBadgePool = new ObjectPool<RowBadgeItem>(
    () => {
      const container = new Container();
      const bg = new Graphics();
      const label = new BitmapText({
        text: '',
        style: {
          fontFamily: rowFontName,
          fontSize: SEATING_THEME.rowBadge.fontSize,
        },
      });
      label.anchor.set(0.5);
      container.addChild(bg, label);
      container.eventMode = 'none';
      rowsLayer.addChild(container);
      return { container, bg, label };
    },
    (b) => { b.container.visible = false; },
  );
  const activeRowBadges: RowBadgeItem[] = [];

  const zoneHeaders: ZoneHeaderItem[] = [];
  const tableItems: TableItem[] = [];
  const halos: Sprite[] = [];
  const labelCache = new Array<string | undefined>(geometry.x.length);
  /** Кресло редкой, не откалиброванной рассадки рисуется крупнее: см. `seatMagnification`. */
  const seatMag = seatMagnification(geometry);
  const seatUnits = SEAT_DIAMETER_UNITS * seatMag;

  let selected: ReadonlySet<number> = new Set();

  let hoveredSlot: number | null = null;
  let destroyed = false;
  let frame = 0;
  const pointers = new Map<number, { x: number; y: number }>();
  let dragDistance = 0;

  const zoneFrames: { zone: RenderZone; shape: Graphics }[] = [];
  let framesScale = 0;

  function drawZoneFrames(scale: number) {
    framesScale = scale;
    for (const { zone, shape } of zoneFrames) {
      const width = zone.width / 1_000;
      const height = zone.height / 1_000;
      const x = zone.x / 1_000;
      const y = zone.y / 1_000;
      const radius = Math.min(12 / scale, width / 4, height / 4);
      if (zone.saleable === false) {
        // Зона не продаётся онлайн: серая заливка и штриховка отличают её от продаваемой не цветом.
        const muted = SEATING_THEME.canvas.mutedZone;
        shape.clear()
          .roundRect(x, y, width, height, radius)
          .fill({ color: muted, alpha: 0.12 })
          .stroke({ color: muted, alpha: 0.7, width: 1.5 / scale });
        const spacing = 9 / scale;
        if ((width + height) / spacing <= 400) {
          for (let c = -height; c < width; c += spacing) {
            const startX = Math.max(c, 0);
            const endX = Math.min(width, c + height);
            if (endX <= startX) continue;
            shape.moveTo(x + startX, y + startX - c).lineTo(x + endX, y + endX - c);
          }
          shape.stroke({ color: muted, alpha: 0.4, width: 1 / scale });
        }
        continue;
      }
      shape.clear()
        .roundRect(x, y, width, height, radius)
        .fill({ color: zone.color, alpha: zone.kind === 'Free' ? 0.16 : 0.08 })
        .stroke({ color: zone.color, alpha: 0.5, width: 2 / scale });
    }
    for (const { zone, shape, label } of tableItems) {
      const muted = zone.saleable === false;
      shape.tint = muted ? SEATING_THEME.canvas.mutedZone : '#ffffff';
      shape.alpha = muted ? 0.45 : 1;
      label.alpha = muted ? 0.7 : 1;
    }
  }

  function describe(slot: number): SeatSelection {
    const zone = geometry.zones[geometry.zoneSlots[slot]];
    const id = readText(geometry.positionIds, slot);
    return {
      slot,
      positionId: id ? id : null,
      zoneId: zone.zoneId,
      zoneName: zone.name,
      row: readText(geometry.rows, slot),
      label: readText(geometry.labels, slot),
    };
  }

  // Создание рамок зон и заголовков
  for (const zone of geometry.zones) {
    if (zone.width <= 0 || zone.height <= 0) continue;

    // Рамка зоны: обводка и скругление перерисовываются в экранных пикселях,
    // иначе при приближении линия толщиной в метры закрашивает зону целиком.
    const frame = new Graphics();
    framesLayer.addChild(frame);
    zoneFrames.push({ zone, shape: frame });

    // Контейнер заголовка зоны
    const headerContainer = new Container();
    const bg = new Graphics();
    const text = new Text({
      text: zoneLabelText(zone),
      resolution,
      style: {
        fontFamily: 'Inter, Arial, sans-serif',
        fontSize: 13,
        fill: '#1e293b',
        fontWeight: '600',
      },
    });
    const codeOnly = new Text({
      text: zone.code,
      resolution,
      style: {
        fontFamily: 'Inter, Arial, sans-serif',
        fontSize: 12,
        fill: '#1e293b',
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
      lastLabel: text.text,
    });

    // Столы зоны
    for (const table of zone.tables ?? []) {
      const shape = new Graphics()
        .roundRect(-tableWidthUnits / 2, -tableDepthUnits / 2, tableWidthUnits, tableDepthUnits,
          tableDepthUnits / 3)
        .fill({ color: zone.color, alpha: 0.85 })
        .stroke({ color: '#ffffff', width: tableDepthUnits / 20 });
      shape.position.set(table.x, table.y);
      shape.rotation = table.rotation;
      // Стол растёт вместе с креслами редкой рассадки, иначе он теряется между ними.
      shape.scale.set(seatMag);
      framesLayer.addChild(shape);

      const tableLabel = new Text({
        text: table.label,
        resolution: 8,
        style: {
          fontFamily: 'Inter, Arial, sans-serif',
          fontSize: 10,
          fill: '#ffffff',
          fontWeight: 'bold',
        },
      });
      tableLabel.anchor.set(0.5);
      tableLabel.scale.set((tableDepthUnits * seatMag * 0.45) / 10);
      tableLabel.position.set(table.x, table.y);
      framesLayer.addChild(tableLabel);
      tableItems.push({ zone, shape, label: tableLabel });
    }
  }


  /**
   * Место занято другой бронью, продано или не участвует в продаже этого показа: выбор
   * запрещён (артефакт 20 §6). Вне продажного контекста (нет `salesStatus`) ограничений нет.
   */
  function isSeatSelectable(index: number): boolean {
    const status = readSalesStatus(geometry, index);
    return status === null || status === 'Available';
  }

  function acquireSprite(index: number, zone: RenderZone, dotDiameter: number | null): Sprite {
    let sprite = sprites.get(index);
    if (!sprite) {
      sprite = spritePool.acquire();
      if (!sprite.parent) {
        sprite.anchor.set(0.5);
        sprite.eventMode = 'none';
        seatsLayer.addChild(sprite);
      }
      sprites.set(index, sprite);
    }
    const props = readSeatProperties(geometry, index);
    const status = readSalesStatus(geometry, index);
    sprite.position.set(geometry.x[index], geometry.y[index]);

    const selectable = isSeatSelectable(index);
    const isSelected = selectable && selected.has(index);
    const isHovered = selectable && hoveredSlot === index;

    if (dotDiameter !== null) {
      // Общий вид: упрощённая точка, статус читается цветом (узор на трёх пикселях не виден).
      sprite.texture = seatTextures.dot;
      if (isSelected) {
        sprite.tint = SEATING_THEME.canvas.selectionTint;
        sprite.alpha = 1;
      } else if (status === 'Sold') {
        sprite.tint = SEATING_THEME.canvas.soldDot;
        sprite.alpha = 1;
      } else if (status === 'Held') {
        sprite.tint = SEATING_THEME.canvas.heldDot;
        sprite.alpha = 1;
      } else if (status === 'NotForSale' || !props.sellable) {
        sprite.tint = SEATING_THEME.canvas.mutedZone;
        sprite.alpha = 0.35;
      } else {
        // Со статусами продаж свободное место окрашено статусом, без них (предпросмотр
        // конфигурации) — цветом зоны.
        sprite.tint = status === 'Available' ? SEATING_THEME.canvas.availableDot : zone.color;
        sprite.alpha = 1;
      }
      sprite.scale.set((dotDiameter * (isSelected ? 1.35 : 1)) / seatTextureSize);
      sprite.visible = true;
      return sprite;
    }

    sprite.texture = seatTextures.get(props.accessibility, props.viewObstruction, props.sellable, status);
    if (status === 'Sold') {
      // Заливка узора уже тёмная: цвет зоны здесь не добавляет опознаваемости продажи.
      sprite.tint = '#ffffff';
      sprite.alpha = 1;
    } else if (status === 'Held') {
      sprite.tint = SEATING_THEME.canvas.heldDot;
      sprite.alpha = 1;
    } else if (status === 'NotForSale' || !props.sellable) {
      sprite.tint = '#94a3b8';
      sprite.alpha = 0.5;
    } else if (isSelected) {
      sprite.tint = SEATING_THEME.canvas.selectionTint;
      sprite.alpha = 1;
    } else {
      sprite.tint = status === 'Available' ? SEATING_THEME.canvas.availableDot : zone.color;
      sprite.alpha = 1;
    }

    sprite.scale.set(seatSpriteScale * seatMag * (isSelected ? 1.25 : isHovered ? 1.15 : 1));
    sprite.visible = true;
    return sprite;
  }

  /** Кольцо вокруг каждого выбранного места: видно на любом масштабе, даже когда места — точки. */
  function drawHalos(scale: number) {
    let used = 0;
    for (const index of selected) {
      if (index < 0 || index >= geometry.x.length || !isSeatSelectable(index)) continue;
      let halo = halos[used];
      if (!halo) {
        halo = new Sprite(seatTextures.halo);
        halo.anchor.set(0.5);
        halo.eventMode = 'none';
        haloLayer.addChild(halo);
        halos.push(halo);
      }
      halo.tint = SEATING_THEME.canvas.selectionHalo;
      halo.position.set(geometry.x[index], geometry.y[index]);
      halo.scale.set(selectedHaloPixels(scale * seatMag) / scale / seatTextureSize);
      halo.visible = true;
      used++;
    }
    for (let i = used; i < halos.length; i++) halos[i].visible = false;
  }

  function acquireRowBadge(): RowBadgeItem {
    const item = rowBadgePool.acquire();
    item.container.visible = true;
    activeRowBadges.push(item);
    return item;
  }

  function render() {
    if (destroyed) return;
    frame = 0;
    const scale = world.scale.x;
    if (scale !== framesScale) drawZoneFrames(scale);
    const left = -world.x / scale;
    const top = -world.y / scale;
    const right = left + host.clientWidth / scale;
    const bottom = top + host.clientHeight / scale;
    const visible = new Set<number>();

    // 1. Отрисовка мест: ниже порога LOD — точки не мельче минимального экранного размера,
    // чтобы места и их статус были видны и на общем виде. Спрайты берутся из пула.
    const dotDiameter = scale * seatMag >= SEAT_SPRITE_LOD_SCALE ? null : seatDotPixels(scale * seatMag) / scale;
    const margin = dotDiameter === null ? cullMargin : Math.max(cullMargin, dotDiameter);
    for (const index of querySpatial(geometry.spatial,
      left - margin, top - margin, right + margin, bottom + margin)) {
      if (
        geometry.x[index] < left - margin ||
        geometry.x[index] > right + margin ||
        geometry.y[index] < top - margin ||
        geometry.y[index] > bottom + margin
      )
        continue;
      visible.add(index);
      acquireSprite(index, geometry.zones[geometry.zoneSlots[index]], dotDiameter);
    }
    drawHalos(scale);

    for (const [index, sprite] of sprites) {
      if (visible.has(index)) continue;
      sprites.delete(index);
      spritePool.release(sprite);
    }

    // 2. Номера мест при достаточном приближении (LOD)
    if (scale * seatMag >= SEAT_LABEL_LOD_SCALE) {
      for (const index of visible) {
        let label = seatLabels.get(index);
        if (!label) {
          label = seatLabelPool.acquire();
          seatLabels.set(index, label);
        }
        let text = labelCache[index];
        if (text === undefined) {
          text = readText(geometry.labels, index);
          labelCache[index] = text;
        }
        if (label.text !== text) label.text = text;
        label.position.set(geometry.x[index], geometry.y[index]);
        label.scale.set(1 / scale);
        label.visible = true;
      }
    }

    for (const [index, label] of seatLabels) {
      if (scale * seatMag < SEAT_LABEL_LOD_SCALE || !visible.has(index)) {
        seatLabels.delete(index);
        seatLabelPool.release(label);
      }
    }

    // 3. Подписи рядов у торцов (LOD scale >= ROW_LABEL_LOD_SCALE)
    for (const badge of activeRowBadges) {
      rowBadgePool.release(badge);
    }
    activeRowBadges.length = 0;
    const placedRowBadgeRects: PlacedRect[] = [];

    if (scale * seatMag >= ROW_LABEL_LOD_SCALE) {
      for (const zone of geometry.zones) {
        if (!zone.rowHeaders) continue;
        for (const rh of zone.rowHeaders) {
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

          // Торцевой бейдж начала ряда
          const startBadge = acquireRowBadge();
          startBadge.label.text = rh.label;
          const textW = startBadge.label.width;
          const badgeW = Math.max(SEATING_THEME.rowBadge.minWidth, textW + 8);
          const badgeH = SEATING_THEME.rowBadge.height;
          // Плашка отступает на половину места плюс зазор, иначе садится на первое кресло.
          const badgeOffset = seatUnits / 2 + 12 / scale;
          startBadge.bg.clear()
            .roundRect(-badgeW / 2, -badgeH / 2, badgeW, badgeH, 4)
            .fill({ color: '#1e293b', alpha: 0.88 });
          const startPosX = rh.startX - ux * badgeOffset;
          const startPosY = rh.startY - uy * badgeOffset;
          startBadge.container.scale.set(1 / scale);
          startBadge.container.position.set(startPosX, startPosY);

          const startScreenX = world.x + startPosX * scale;
          const startScreenY = world.y + startPosY * scale;
          placedRowBadgeRects.push({
            x: startScreenX - badgeW / 2,
            y: startScreenY - badgeH / 2,
            width: badgeW,
            height: badgeH,
          });

          // Торцевой бейдж конца ряда для длинных рядов
          if (rh.count >= 4) {
            const endBadge = acquireRowBadge();
            endBadge.label.text = rh.label;
            endBadge.bg.clear()
              .roundRect(-badgeW / 2, -badgeH / 2, badgeW, badgeH, 4)
              .fill({ color: '#1e293b', alpha: 0.88 });
            const endPosX = rh.endX + ux * badgeOffset;
            const endPosY = rh.endY + uy * badgeOffset;
            endBadge.container.scale.set(1 / scale);
            endBadge.container.position.set(endPosX, endPosY);

            const endScreenX = world.x + endPosX * scale;
            const endScreenY = world.y + endPosY * scale;
            placedRowBadgeRects.push({
              x: endScreenX - badgeW / 2,
              y: endScreenY - badgeH / 2,
              width: badgeW,
              height: badgeH,
            });
          }
        }
      }
    }

    // 4. Подписи зон: постоянный экранный кегль, LOD и разрешение коллизий (с зонами, рядами и местами)
    const obstacles: PlacedRect[] = [...placedRowBadgeRects];
    const sortedHeaders = [...zoneHeaders].sort((a, b) => {
      const areaA = (a.zone.width / 1_000) * (a.zone.height / 1_000);
      const areaB = (b.zone.width / 1_000) * (b.zone.height / 1_000);
      return areaB - areaA;
    });

    for (const item of sortedHeaders) {
      const z = item.zone;
      const label = zoneLabelText(z);
      if (label !== item.lastLabel) {
        item.lastLabel = label;
        item.text.text = label;
        item.lastUseFull = undefined;
      }
      const placement = resolveHeaderPlacement({
        zoneX: z.x / 1_000,
        zoneY: z.y / 1_000,
        zoneWidth: z.width / 1_000,
        zoneHeight: z.height / 1_000,
        worldX: world.x,
        worldY: world.y,
        scale,
        fullWidth: item.text.width,
        codeWidth: item.codeOnly.width,
        labelHeight: SEATING_THEME.zoneHeader.height,
        viewportWidth: host.clientWidth,
        viewportHeight: host.clientHeight,
        placedObstacles: obstacles,
        checkSeatCollision: (cand, worldW, worldH, screenRect) => {
          const nearbySeats = querySpatial(
            geometry.spatial,
            cand.cx - seatUnits,
            cand.cy - seatUnits,
            cand.cx + worldW + seatUnits,
            cand.cy + worldH + seatUnits,
          );
          for (const sIdx of nearbySeats) {
            const seatScreenX = world.x + geometry.x[sIdx] * scale;
            const seatScreenY = world.y + geometry.y[sIdx] * scale;
            const seatRadius = Math.max(3, seatScreenPixels(scale * seatMag) / 2);
            const seatRect: PlacedRect = {
              x: seatScreenX - seatRadius,
              y: seatScreenY - seatRadius,
              width: seatRadius * 2,
              height: seatRadius * 2,
            };
            if (rectsOverlap(screenRect, seatRect)) return true;
          }
          return false;
        },
      });

      if (!placement) {
        item.container.visible = false;
        continue;
      }

      obstacles.push(placement.screenRect);
      item.container.scale.set(1 / scale);
      // Привязка к физическим пикселям: подпись на дробной позиции размывается.
      const snappedX = Math.round((world.x + placement.candidate.cx * scale) * resolution) / resolution;
      const snappedY = Math.round((world.y + placement.candidate.cy * scale) * resolution) / resolution;
      item.container.position.set((snappedX - world.x) / scale, (snappedY - world.y) / scale);
      item.container.visible = true;
      item.text.visible = placement.useFull;
      item.codeOnly.visible = !placement.useFull;

      if (item.lastUseFull !== placement.useFull) {
        item.lastUseFull = placement.useFull;
        const activeText = placement.useFull ? item.text : item.codeOnly;
        activeText.position.set(8, 3);
        item.bg.clear()
          .roundRect(0, 0, activeText.width + 16, SEATING_THEME.zoneHeader.height, 6)
          .fill({ color: '#ffffff', alpha: 0.92 })
          .stroke({
            color: z.saleable === false ? SEATING_THEME.canvas.mutedZone : z.color,
            alpha: 0.6,
            width: 1.5,
          });
      }
    }

    app.renderer.render(app.stage);
  }

  function requestRender() {
    if (!frame && !destroyed) frame = requestAnimationFrame(render);
  }

  function fitBounds(x: number, y: number, width: number, height: number) {
    const scale = Math.max(
      SEATING_THEME.zoom.minScale,
      Math.min((host.clientWidth - 48) / width, (host.clientHeight - 48) / height,
        SEATING_THEME.zoom.fitMaxScale),
    );
    world.scale.set(scale);
    world.position.set(
      (host.clientWidth - width * scale) / 2 - x * scale,
      (host.clientHeight - height * scale) / 2 - y * scale,
    );
    requestRender();
  }

  function framed(): RenderZone[] {
    return geometry.zones.filter((zone) => zone.width > 0 && zone.height > 0);
  }

  function fit() {
    const zones = framed();
    if (!zones.length) return;
    const left = Math.min(...zones.map((zone) => zone.x)) / 1_000;
    const top = Math.min(...zones.map((zone) => zone.y)) / 1_000;
    const right = Math.max(...zones.map((zone) => zone.x + zone.width)) / 1_000;
    const bottom = Math.max(...zones.map((zone) => zone.y + zone.height)) / 1_000;
    fitBounds(left, top, right - left, bottom - top);
  }

  function focus(zone: RenderZone) {
    fitBounds(zone.x / 1_000, zone.y / 1_000, zone.width / 1_000, zone.height / 1_000);
  }

  function point(event: PointerEvent | WheelEvent) {
    const bounds = app.canvas.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }

  function zoom(factor: number, x: number, y: number) {
    const previous = world.scale.x;
    const next = Math.max(SEATING_THEME.zoom.minScale, Math.min(SEATING_THEME.zoom.maxScale, previous * factor));
    world.position.set(x - ((x - world.x) * next) / previous, y - ((y - world.y) * next) / previous);
    world.scale.set(next);
    requestRender();
  }

  const wheel = (event: WheelEvent) => {
    event.preventDefault();
    const p = point(event);
    zoom(Math.exp(-event.deltaY * 0.001), p.x, p.y);
  };

  const down = (event: PointerEvent) => {
    if (event.button !== 0) return;
    pointers.set(event.pointerId, point(event));
    dragDistance = 0;
    app.canvas.setPointerCapture(event.pointerId);
  };

  const move = (event: PointerEvent) => {
    const previous = pointers.get(event.pointerId);
    if (!previous) {
      // Hover проверка, когда кнопка не зажата
      const p = point(event);
      const wx = (p.x - world.x) / world.scale.x;
      const wy = (p.y - world.y) / world.scale.x;
      let nextHover: number | null = null;
      // Наведение работает и по точкам общего вида: клик ниже, в `up`, выбирает их так же.
      {
        const radius = hitRadiusPx / world.scale.x;
        for (const i of querySpatial(geometry.spatial, wx - radius, wy - radius, wx + radius, wy + radius)) {
          if (!isSeatSelectable(i)) continue;
          if (Math.hypot(wx - geometry.x[i], wy - geometry.y[i]) <= radius) {
            nextHover = i;
            break;
          }
        }
      }
      if (nextHover !== hoveredSlot) {
        hoveredSlot = nextHover;
        app.canvas.style.cursor = nextHover !== null ? 'pointer' : 'default';
        requestRender();
      }
      return;
    }

    const next = point(event);
    const other = [...pointers.entries()].find(([id]) => id !== event.pointerId)?.[1];
    if (other) {
      const before = Math.hypot(previous.x - other.x, previous.y - other.y);
      const after = Math.hypot(next.x - other.x, next.y - other.y);
      if (before > 0) zoom(after / before, (next.x + other.x) / 2, (next.y + other.y) / 2);
      dragDistance = 100;
    } else {
      world.x += next.x - previous.x;
      world.y += next.y - previous.y;
      dragDistance += Math.hypot(next.x - previous.x, next.y - previous.y);
    }
    pointers.set(event.pointerId, next);
    requestRender();
  };

  const up = (event: PointerEvent) => {
    if (!pointers.has(event.pointerId)) return;
    pointers.delete(event.pointerId);
    if (event.type === 'pointercancel' || dragDistance > 6) return;
    const p = point(event);
    const x = (p.x - world.x) / world.scale.x;
    const y = (p.y - world.y) / world.scale.x;
    const zone = framed().find(
      (item) =>
        x >= item.x / 1_000 &&
        x <= (item.x + item.width) / 1_000 &&
        y >= item.y / 1_000 &&
        y <= (item.y + item.height) / 1_000,
    );
    if (!zone) return;
    if (zone.kind === 'Free') {
      focus(zone);
      return;
    }
    let best = -1;
    // Радиус попадания — экранные пиксели, а не фиксированные метры сцены (тот же
    // hitRadiusPx, что и у наведения выше).
    let distance = hitRadiusPx / world.scale.x;
    for (const i of querySpatial(geometry.spatial, x - distance, y - distance, x + distance, y + distance)) {
      if (geometry.zones[geometry.zoneSlots[i]].zoneId !== zone.zoneId) continue;
      if (!isSeatSelectable(i)) continue;
      const candidate = Math.hypot(x - geometry.x[i], y - geometry.y[i]);
      if (candidate < distance) {
        best = i;
        distance = candidate;
      }
    }
    // Место выбирается и тогда, когда оно нарисовано точкой: при редкой рассадке точки не
    // вырастают до спрайта ни при каком приближении, и клик «только приближает» превращался
    // бы в бесконечное прокручивание. Приближение зоны — лишь при промахе мимо мест.
    if (best >= 0) onSelect(describe(best));
    else if (world.scale.x * seatMag < SEAT_SPRITE_LOD_SCALE) focus(zone);
  };

  app.canvas.addEventListener('wheel', wheel, { passive: false });
  app.canvas.addEventListener('pointerdown', down);
  app.canvas.addEventListener('pointermove', move);
  app.canvas.addEventListener('pointerup', up);
  app.canvas.addEventListener('pointercancel', up);

  let sizedWidth = Math.max(1, host.clientWidth);
  let sizedHeight = Math.max(1, host.clientHeight);
  /**
   * Масштаб страницы браузера (110%, 125%) меняет devicePixelRatio уже после создания сцены:
   * без обновления плотности холст растягивается и размывается.
   */
  function syncResolution(): boolean {
    const next = resolveRenderResolution(window.devicePixelRatio);
    if (next === resolution) return false;
    resolution = next;
    for (const header of zoneHeaders) {
      header.text.resolution = next;
      header.codeOnly.resolution = next;
    }
    return true;
  }

  const onResize = () => {
    if (destroyed) return;
    const width = Math.max(1, host.clientWidth);
    const height = Math.max(1, host.clientHeight);
    const densityChanged = syncResolution();
    if (densityChanged || width !== sizedWidth || height !== sizedHeight) {
      sizedWidth = width;
      sizedHeight = height;
      app.renderer.resize(width, height, resolution);
    }
    requestRender();
  };
  const observer = new ResizeObserver(onResize);
  observer.observe(host);
  window.addEventListener('resize', onResize);
  fit();

  return {
    fit,
    focusZone(id) {
      const zone = geometry.zones.find((item) => item.zoneId === id);
      if (zone && zone.width > 0 && zone.height > 0) focus(zone);
    },
    setSelection(slots) {
      selected = slots;
      requestRender();
    },
    describe,
    refresh() {
      // Продажный статус мог поменять рамки зон и подписи: рамки перерисуются на этом кадре.
      framesScale = -1;
      requestRender();
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', onResize);
      BitmapFontManager.uninstall(seatFontName);
      BitmapFontManager.uninstall(rowFontName);
      app.canvas.removeEventListener('wheel', wheel);
      app.canvas.removeEventListener('pointerdown', down);
      app.canvas.removeEventListener('pointermove', move);
      app.canvas.removeEventListener('pointerup', up);
      app.canvas.removeEventListener('pointercancel', up);
      seatTextures.destroy();
      seatLabelPool.clear((l) => l.destroy());
      seatLabels.forEach((l) => l.destroy());
      halos.forEach((h) => h.destroy());
      spritePool.clear((s) => s.destroy());
      sprites.forEach((s) => s.destroy());
      rowBadgePool.clear((r) => r.container.destroy({ children: true }));
      activeRowBadges.forEach((r) => r.container.destroy({ children: true }));
      app.destroy(true, { children: true });
    },
  };
}
