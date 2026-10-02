import { Graphics, type Renderer, type Texture } from 'pixi.js';
import type { SeatingAccessibility, SeatingViewObstruction } from './model';
import type { SeatSalesStatus } from './render-model';

export type SeatTextureKind =
  | 'regular'
  | 'wheelchair'
  | 'companion'
  | 'reducedMobility'
  | 'obstructedPartial'
  | 'obstructedSevere'
  | 'unsellable'
  | 'held'
  | 'sold';

export interface SeatTextureSet {
  regular: Texture;
  wheelchair: Texture;
  companion: Texture;
  reducedMobility: Texture;
  obstructedPartial: Texture;
  obstructedSevere: Texture;
  unsellable: Texture;
  held: Texture;
  sold: Texture;
  /** Белая точка для окраски (tint) при общем виде, когда полный узор места не читается. */
  dot: Texture;
  /** Кольцо-выделение выбранного места. */
  halo: Texture;
  get(
    accessibility?: SeatingAccessibility | null,
    viewObstruction?: SeatingViewObstruction | null,
    sellable?: boolean | null,
    salesStatus?: SeatSalesStatus | null,
  ): Texture;
  destroy(): void;
}

/**
 * Продажный статус места (артефакт 20 §6: не только цветом) старше геометрических свойств —
 * покупателю важнее купить это место или нет, а не почему оно вообще недоступно. `Available`
 * не переопределяет ничего: свободное место показывает обычные значки доступности/обзора.
 */
export function getSeatTextureKind(
  accessibility?: SeatingAccessibility | null,
  viewObstruction?: SeatingViewObstruction | null,
  sellable?: boolean | null,
  salesStatus?: SeatSalesStatus | null,
): SeatTextureKind {
  if (salesStatus === 'Sold') return 'sold';
  if (salesStatus === 'Held') return 'held';
  if (salesStatus === 'NotForSale') return 'unsellable';
  if (sellable === false) return 'unsellable';
  if (accessibility === 'Wheelchair') return 'wheelchair';
  if (accessibility === 'Companion') return 'companion';
  if (accessibility === 'ReducedMobility') return 'reducedMobility';
  if (viewObstruction === 'Severe') return 'obstructedSevere';
  if (viewObstruction === 'Partial') return 'obstructedPartial';
  return 'regular';
}

/**
 * Создаёт набор векторно-чётких текстур мест для различных свойств (ADR-052).
 * resolution: 16 даёт текстуру 256×256 при логическом размере 16×16.
 * Место рисуется реальным диаметром `SEAT_DIAMETER_MM` (0,45 м сцены); на предельном
 * зуме камеры (`SEATING_THEME.zoom.maxScale`, сейчас 400 пкс/м) с запасом на Retina
 * (DPR = 2) это заметно меньше 256 физических пикселей текстуры, так что кресло
 * растеризуется даже на самом крупном плане, не «размывается» с укрупнением текстуры.
 * Расход памяти: 7 текстур × 256 × 256 × 4 байта = 1.75 МБ в видеопамяти — абсолютно незначительно.
 */
export function createSeatTextureSet(renderer: Renderer): SeatTextureSet {
  const resolution = 16;


  function build(draw: (g: Graphics) => void): Texture {
    const g = new Graphics();
    g.rect(0, 0, 16, 16).fill({ color: 0x000000, alpha: 0 });
    draw(g);
    const texture = renderer.generateTexture({
      target: g,
      resolution,
      antialias: true,
      // Без мипмапов текстура 256 пкс, ужатая до 3-10 пкс, даёт «лесенку» и мерцание.
      textureSourceOptions: {
        scaleMode: 'linear',
        autoGenerateMipmaps: true,
        mipLevelCount: 5,
        mipmapFilter: 'linear',
      },
    });
    g.destroy();
    return texture;
  }

  // Обычное место
  const regular = build((g) => {
    g.circle(8, 8, 6.75).fill('#ffffff');
    g.circle(8, 8, 6.75).stroke({ color: 'rgba(0, 0, 0, 0.16)', width: 0.5 });
  });

  // Место для людей на колясках
  const wheelchair = build((g) => {
    g.circle(8, 8, 6.75).fill('#ffffff');
    g.circle(8, 8, 6.75).stroke({ color: 'rgba(0, 0, 0, 0.2)', width: 0.5 });
    g.circle(8.2, 5, 0.9).fill('rgba(0, 0, 0, 0.65)');
    g.moveTo(7.7, 6.1).lineTo(7.7, 8.4).lineTo(9.7, 8.4)
      .stroke({ color: 'rgba(0, 0, 0, 0.65)', width: 1.1 });
    g.arc(7.4, 8.6, 2.2, Math.PI * 0.2, Math.PI * 1.5)
      .stroke({ color: 'rgba(0, 0, 0, 0.65)', width: 1 });
  });

  // Место для сопровождающего
  const companion = build((g) => {
    g.circle(8, 8, 6.75).fill('#ffffff');
    g.circle(8, 8, 6.75).stroke({ color: 'rgba(0, 0, 0, 0.2)', width: 0.5 });
    g.moveTo(8, 4.8).lineTo(8, 11.2)
      .moveTo(4.8, 8).lineTo(11.2, 8)
      .stroke({ color: 'rgba(0, 0, 0, 0.65)', width: 1.5 });
  });

  // Место для маломобильных
  const reducedMobility = build((g) => {
    g.circle(8, 8, 6.75).fill('#ffffff');
    g.circle(8, 8, 6.75).stroke({ color: 'rgba(0, 0, 0, 0.2)', width: 0.5 });
    g.arc(8, 5.8, 1.3, Math.PI, 0)
      .stroke({ color: 'rgba(0, 0, 0, 0.65)', width: 1.1 });
    g.moveTo(9.3, 5.8).lineTo(7.6, 11.2)
      .stroke({ color: 'rgba(0, 0, 0, 0.65)', width: 1.1 });
  });

  // Частично ограниченный обзор
  const obstructedPartial = build((g) => {
    g.circle(8, 8, 6.75).fill('#ffffff');
    g.circle(8, 8, 6.75).stroke({ color: 'rgba(0, 0, 0, 0.2)', width: 0.5 });
    g.moveTo(3.8, 11.5).lineTo(12.2, 4.5)
      .stroke({ color: 'rgba(0, 0, 0, 0.55)', width: 1.6 });
  });

  // Сильно ограниченный обзор
  const obstructedSevere = build((g) => {
    g.circle(8, 8, 6.75).fill('#ffffff');
    g.circle(8, 8, 6.75).stroke({ color: 'rgba(0, 0, 0, 0.25)', width: 0.5 });
    g.moveTo(4, 12).lineTo(12, 4)
      .moveTo(4, 4).lineTo(12, 12)
      .stroke({ color: 'rgba(0, 0, 0, 0.6)', width: 1.5 });
  });

  // Не для продажи (служебное, а в продажном контексте — зона/место вне продажи этого показа)
  const unsellable = build((g) => {
    g.circle(8, 8, 6.75).fill('rgba(255, 255, 255, 0.35)');
    g.circle(8, 8, 6.75).stroke({ color: 'rgba(0, 0, 0, 0.35)', width: 0.8 });
    g.moveTo(3.5, 12.5).lineTo(12.5, 3.5)
      .stroke({ color: 'rgba(0, 0, 0, 0.55)', width: 1.6 });
  });

  // Удержано действующей бронью: пунктирная обводка (узор) плюс знак часов — временно,
  // а не окончательно недоступно. Цвет тона места сохраняется через tint в scene.ts.
  const held = build((g) => {
    g.circle(8, 8, 6.75).fill('#ffffff');
    const dashes = 10;
    for (let i = 0; i < dashes; i++) {
      const a0 = (i / dashes) * Math.PI * 2;
      const a1 = a0 + ((Math.PI * 2) / dashes) * 0.55;
      g.arc(8, 8, 6.75, a0, a1).stroke({ color: 'rgba(0, 0, 0, 0.7)', width: 1.2 });
    }
    // Знак часов: центр и две стрелки.
    g.circle(8, 8, 0.9).fill('rgba(0, 0, 0, 0.75)');
    g.moveTo(8, 8).lineTo(8, 5.4).stroke({ color: 'rgba(0, 0, 0, 0.75)', width: 1 });
    g.moveTo(8, 8).lineTo(10, 8.8).stroke({ color: 'rgba(0, 0, 0, 0.75)', width: 1 });
  });

  // Продано: сплошная тёмная заливка (узор/знак, не только цвет) с белым крестом-галочкой.
  const sold = build((g) => {
    g.circle(8, 8, 6.75).fill('rgba(15, 23, 42, 0.9)');
    g.moveTo(5, 5).lineTo(11, 11).stroke({ color: 'rgba(255, 255, 255, 0.9)', width: 1.4 });
    g.moveTo(11, 5).lineTo(5, 11).stroke({ color: 'rgba(255, 255, 255, 0.9)', width: 1.4 });
  });

  const dot = build((g) => {
    g.circle(8, 8, 7).fill('#ffffff');
  });

  const halo = build((g) => {
    g.circle(8, 8, 6.4).stroke({ color: '#ffffff', width: 2.4 });
  });

  const map: Record<SeatTextureKind, Texture> = {
    regular,
    wheelchair,
    companion,
    reducedMobility,
    obstructedPartial,
    obstructedSevere,
    unsellable,
    held,
    sold,
  };

  return {
    regular,
    wheelchair,
    companion,
    reducedMobility,
    obstructedPartial,
    obstructedSevere,
    unsellable,
    held,
    sold,
    dot,
    halo,
    get(accessibility, viewObstruction, sellable, salesStatus) {
      return map[getSeatTextureKind(accessibility, viewObstruction, sellable, salesStatus)];
    },
    destroy() {
      regular.destroy(true);
      wheelchair.destroy(true);
      companion.destroy(true);
      reducedMobility.destroy(true);
      obstructedPartial.destroy(true);
      obstructedSevere.destroy(true);
      unsellable.destroy(true);
      held.destroy(true);
      sold.destroy(true);
      dot.destroy(true);
      halo.destroy(true);
    },
  };
}
