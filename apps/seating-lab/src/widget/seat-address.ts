import { readText, type RenderGeometry } from '@tickets/seating';

/** Человекочитаемый адрес места из уже загруженной схемы: идентификаторы покупателю не показываются. */
export interface SeatAddress {
  zoneName: string;
  row: string;
  label: string;
  isTable: boolean;
}

/** Позиция → адрес. Строится один раз на схему: по 54 000 мест это единицы миллисекунд. */
export function buildPositionIndex(rendered: RenderGeometry | undefined): Map<string, SeatAddress> {
  const index = new Map<string, SeatAddress>();
  if (!rendered) return index;
  for (const zone of rendered.zones) {
    for (let slot = zone.start; slot < zone.start + zone.count; slot++) {
      const positionId = readText(rendered.positionIds, slot);
      if (!positionId) continue;
      index.set(positionId, {
        zoneName: zone.name,
        row: readText(rendered.rows, slot),
        label: readText(rendered.labels, slot),
        isTable: zone.kind === 'Tables',
      });
    }
  }
  return index;
}

/** «Зона A · ряд 1 · место 1»; без адреса в схеме — нейтральное «Место», но не идентификатор. */
export function formatSeatAddress(address: SeatAddress | undefined): string {
  if (!address) return 'Место';
  return [
    address.zoneName,
    (address.isTable ? 'стол ' : 'ряд ') + address.row,
    'место ' + address.label,
  ].join(' · ');
}
