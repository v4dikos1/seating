/**
 * Единицы схемы в одном месте.
 *
 * Контракт геометрии хранит целые числа — тысячные доли единицы сцены. Единица сцены
 * равна метру: калибровка подложки ставит первую отмеченную точку в (0, 0), а вторую —
 * в (distanceMeters * 1000, 0) (`Backend/docs/guides/seating-configurator.md`). Значит
 * целое число в геометрии — это миллиметр помещения, и интерфейс обязан называть его так,
 * а не «условной единицей»: иначе нарисованная схема и калиброванный план расходятся
 * в масштабе, и подложка перестаёт что-либо значить.
 */

import { MILLIMETRES_PER_UNIT } from './theme';

export { MILLIMETRES_PER_UNIT };

/** Миллиметры → единицы сцены (метры). */
export function millimetresToUnits(millimetres: number): number {
  return millimetres / MILLIMETRES_PER_UNIT;
}

/** Единицы сцены (метры) → миллиметры контракта. */
export function unitsToMillimetres(units: number): number {
  return Math.round(units * MILLIMETRES_PER_UNIT);
}

function decimal(value: number, fractionDigits: number): string {
  return value.toFixed(fractionDigits).replace(/\.?0+$/, '').replace('.', ',');
}

/**
 * Длина человеческим языком: до полуметра — сантиметры, дальше — метры.
 * Нужна везде, где раньше печаталось «ед.»: шаг сетки, шаг ряда, размеры зоны,
 * координаты места, расстояние до подложки.
 */
export function formatLength(millimetres: number): string {
  if (!Number.isFinite(millimetres)) return '—';
  const absolute = Math.abs(millimetres);
  if (absolute < 10) return `${Math.round(millimetres)} мм`;
  if (absolute < 1_000) return `${decimal(millimetres / 10, 1)} см`;
  if (absolute < 100_000) return `${decimal(millimetres / 1_000, 2)} м`;
  return `${decimal(millimetres / 1_000, 0)} м`;
}

/** Та же длина, но всегда в метрах: для размеров зала и расстояний на холсте. */
export function formatMetres(millimetres: number, fractionDigits = 1): string {
  if (!Number.isFinite(millimetres)) return '—';
  return `${decimal(millimetres / MILLIMETRES_PER_UNIT, fractionDigits)} м`;
}

/**
 * Разбор длины, введённой человеком, — действие, обратное `formatLength`.
 * Понимает миллиметры («450», «450 мм»), сантиметры («45 см») и метры («0,45 м»,
 * «18,7 м»); дробная часть — через запятую или точку. Единица по умолчанию —
 * миллиметр, как и у самого мелкого деления `formatLength`. Если строку не разобрать
 * или получившаяся длина не положительна — `null`: подставлять ноль или обрезать
 * молча нельзя, ошибку ввода должен увидеть тот, кто её допустил.
 */
export function parseLength(input: string): number | null {
  const normalized = input.trim().toLowerCase().replace(',', '.');
  if (!normalized) return null;
  const match = /^(-?\d+(?:\.\d+)?)\s*(мм|см|м)?$/.exec(normalized);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  const unit = match[2] ?? 'мм';
  const millimetres = unit === 'м' ? value * 1_000 : unit === 'см' ? value * 10 : value;
  if (!Number.isFinite(millimetres) || millimetres <= 0) return null;
  return Math.round(millimetres);
}

/** Площадь в квадратных метрах по размерам в миллиметрах. */
export function formatArea(widthMm: number, heightMm: number): string {
  const squareMetres = (widthMm / MILLIMETRES_PER_UNIT) * (heightMm / MILLIMETRES_PER_UNIT);
  if (!Number.isFinite(squareMetres) || squareMetres <= 0) return '—';
  return `${decimal(squareMetres, squareMetres < 100 ? 1 : 0)} м²`;
}
