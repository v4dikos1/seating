import { useEffect, useRef, useState, type RefObject } from 'react';
import {
  createScene, geometryFormatVersion, readSeatProperties, readText,
  type GeometryEncoding, type RenderGeometry, type ResolvedSeatingProperties, type SceneController,
  type SeatSelection, type SeatingApi, type SeatingScene, type SeatingSceneZone,
} from '@tickets/seating';

export interface RowSeat {
  slot: number;
  label: string;
  properties: ResolvedSeatingProperties;
}

/**
 * Адреса зоны для доступного выбора без карты. Список строится по запросу одной зоны,
 * а не для всех 54 000 мест сразу, и остаётся единственной клавиатурной альтернативой.
 * Непродаваемые позиции в список не попадают: служебное место покупателю не предлагается.
 */
export function buildAddresses(rendered: RenderGeometry | undefined, zoneId: string,
  includeUnsellable = false): Map<string, RowSeat[]> {
  const result = new Map<string, RowSeat[]>();
  const zone = rendered?.zones.find((item) => item.zoneId === zoneId);
  if (!rendered || !zone) return result;
  for (let i = zone.start; i < zone.start + zone.count; i++) {
    const properties = readSeatProperties(rendered, i);
    if (!properties.sellable && !includeUnsellable) continue;
    const label = readText(rendered.rows, i);
    const seats = result.get(label) ?? [];
    seats.push({ slot: i, label: readText(rendered.labels, i), properties });
    result.set(label, seats);
  }
  return result;
}

export interface CodecMetric {
  encoding: string;
  bytes: number;
  gzip: number;
  encodeMs: number;
  decodeMs: number;
}

export interface SceneRequest {
  scene?: SeatingScene;
  synthetic?: { count: number; free: boolean };
}

export interface LoadedRevision {
  scene: SeatingScene;
  total: number;
  loaded: number;
}

/**
 * Состав редакции собирается списком зон и чтением каждой зоны по отдельности:
 * манифеста и неизменяемых частей сервер не отдаёт (этап S2).
 */
export async function loadRevisionScene(api: SeatingApi, configurationId: string,
  revision: number | null | undefined, maxZones = 200): Promise<LoadedRevision> {
  // Умолчания конфигурации — последний уровень наследования свойств, и без них разрешение неполно.
  const card = await api.getConfiguration(configurationId);
  const list = await api.listZones(configurationId, { limit: maxZones, revision: revision ?? undefined });
  const zones: SeatingSceneZone[] = [];
  for (const item of list.items) {
    const zone = await api.getZone(configurationId, item.zoneId, item.versions.configurationRevision);
    zones.push({
      zoneId: zone.zoneId, zoneVersion: zone.versions.zoneVersion,
      compositionVersion: zone.versions.compositionVersion, geometry: zone.geometry,
    });
  }
  return {
    scene: {
      formatVersion: geometryFormatVersion,
      configurationId,
      revision: list.items[0]?.versions.configurationRevision ?? revision ?? null,
      zones,
      properties: card.properties ?? null,
    },
    total: list.totalItems,
    loaded: zones.length,
  };
}

/** Декодирование, проверка, пространственный индекс и замеры выполняются в Worker. */
export function useSceneGeometry(request: SceneRequest, encoding: GeometryEncoding) {
  const [rendered, setRendered] = useState<RenderGeometry>();
  const [metrics, setMetrics] = useState<CodecMetric[]>([]);
  const [chunks, setChunks] = useState(0);
  const [exported, setExported] = useState<Uint8Array>();
  const [error, setError] = useState('');

  useEffect(() => {
    setError('');
    setRendered(undefined);
    setExported(undefined);
    // Пустой запрос не означает «нарисуй что-нибудь»: без данных схема не показывается.
    if (!request.scene && !request.synthetic) return;
    const worker = new Worker(new URL('../geometry.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event) => {
      if (event.data.error) {
        setError(event.data.error);
        return;
      }
      setRendered(event.data.scene);
      setMetrics(event.data.metrics);
      setChunks(event.data.chunks);
      setExported(event.data.exported);
    };
    worker.onerror = (event) => setError(event.message || 'Не удалось загрузить обработчик геометрии.');
    worker.postMessage({
      encoding,
      scene: request.scene,
      synthetic: request.scene ? undefined : {
        count: request.synthetic?.count ?? 8_000,
        perZone: 1_800,
        freeCapacity: request.synthetic?.free ? 500 : undefined,
      },
    });
    return () => worker.terminate();
  }, [request, encoding]);

  return { rendered, metrics, chunks, exported, error };
}

export function useSceneController(host: RefObject<HTMLDivElement | null>,
  rendered: RenderGeometry | undefined, onSelect: (seat: SeatSelection) => void) {
  const [controller, setController] = useState<SceneController | null>(null);
  const [error, setError] = useState('');
  const handler = useRef(onSelect);
  handler.current = onSelect;

  useEffect(() => {
    const element = host.current;
    if (!rendered || !element) return;
    let disposed = false;
    let active: SceneController | undefined;
    createScene(element, rendered, (seat) => handler.current(seat))
      .then((value) => {
        if (disposed) {
          value.destroy();
          return;
        }
        active = value;
        setController(value);
      })
      .catch((reason) => {
        if (!disposed) setError('WebGL недоступен: ' + String(reason) + '. Выбор мест доступен списком.');
      });
    return () => {
      disposed = true;
      active?.destroy();
      setController(null);
    };
  }, [rendered, host]);

  return { controller, error };
}
