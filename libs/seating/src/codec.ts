import { parse } from 'protobufjs';
import schema from './geometry.proto?raw';
import {
  declaresNothing, geometryFormatVersion, seatingAccessibilities, seatingViewObstructions,
  validateScene, validateZoneGeometry, zoneKindOf,
  type SeatingAccessibility, type SeatingPositionGeometry, type SeatingProperties, type SeatingRowGeometry,
  type SeatingScene, type SeatingSceneZone, type SeatingTableGeometry, type SeatingViewObstruction, type SeatingZoneGeometry,
} from './model';

export type GeometryEncoding = 'json' | 'protobuf';
const messageType = parse(schema).root.lookupType('tomcell.seating.v4.Scene');
const maxPayloadBytes = 32 * 1024 * 1024;

/** Пустое объявление равно наследованию, поэтому в каноническом виде его нет вовсе. */
function canonicalProperties(properties: SeatingProperties | null | undefined): SeatingProperties | null {
  if (declaresNothing(properties)) return null;
  const declared = properties as SeatingProperties;
  const result: SeatingProperties = {};
  if (declared.accessibility !== null && declared.accessibility !== undefined)
    result.accessibility = declared.accessibility;
  if (declared.viewObstruction !== null && declared.viewObstruction !== undefined)
    result.viewObstruction = declared.viewObstruction;
  if (declared.sellable !== null && declared.sellable !== undefined) result.sellable = declared.sellable;
  return result;
}

function canonicalPosition(position: SeatingPositionGeometry): SeatingPositionGeometry {
  return {
    id: position.id ? position.id : null, label: position.label,
    x: position.x, y: position.y, rotation: position.rotation,
    properties: canonicalProperties(position.properties),
  };
}

function canonicalRow(row: SeatingRowGeometry): SeatingRowGeometry {
  return {
    id: row.id ? row.id : null, label: row.label, positions: row.positions.map(canonicalPosition),
    properties: canonicalProperties(row.properties),
  };
}
function canonicalTable(table: SeatingTableGeometry): SeatingTableGeometry {
  return { ...table, id: table.id || null, minimumQuantity: table.minimumQuantity ?? null,
    positions: table.positions.map(canonicalPosition), properties: canonicalProperties(table.properties) };
}

/** Явные null вместо отсутствующих полей: ровно та форма, которую принимает API. */
export function canonicalZoneGeometry(geometry: SeatingZoneGeometry): SeatingZoneGeometry {
  const kind = zoneKindOf(geometry);
  return {
    code: geometry.code, name: geometry.name, color: geometry.color,
    x: geometry.x, y: geometry.y, width: geometry.width, height: geometry.height,
    rows: geometry.rows.map(canonicalRow), kind,
    capacity: kind === 'Free' ? geometry.capacity ?? null : null,
    properties: canonicalProperties(geometry.properties),
    tables: (geometry.tables ?? []).map(canonicalTable),
  };
}

export function canonicalScene(scene: SeatingScene): SeatingScene {
  return {
    formatVersion: geometryFormatVersion,
    configurationId: scene.configurationId,
    revision: scene.revision ?? null,
    zones: scene.zones.map((zone) => ({
      zoneId: zone.zoneId, zoneVersion: zone.zoneVersion,
      compositionVersion: zone.compositionVersion ?? 0,
      geometry: canonicalZoneGeometry(zone.geometry),
    })),
    properties: canonicalProperties(scene.properties),
  };
}

export function encodeScene(scene: SeatingScene, encoding: GeometryEncoding): Uint8Array {
  const canonical = canonicalScene(scene);
  validateScene(canonical);
  if (encoding === 'json') return new TextEncoder().encode(JSON.stringify(canonical));
  return messageType.encode(messageType.fromObject(canonical)).finish();
}

function propertiesFromWire(value: unknown): SeatingProperties | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  const accessibility = source['accessibility'];
  const viewObstruction = source['viewObstruction'];
  const sellable = source['sellable'];
  const result: SeatingProperties = {};
  if (typeof accessibility === 'string' && seatingAccessibilities.includes(accessibility as SeatingAccessibility))
    result.accessibility = accessibility as SeatingAccessibility;
  if (typeof viewObstruction === 'string' && seatingViewObstructions.includes(viewObstruction as SeatingViewObstruction))
    result.viewObstruction = viewObstruction as SeatingViewObstruction;
  if (typeof sellable === 'boolean') result.sellable = sellable;
  return declaresNothing(result) ? null : result;
}

function fromWire(value: Record<string, unknown>): SeatingScene {
  const zones = (value['zones'] as Record<string, unknown>[] | undefined) ?? [];
  return {
    formatVersion: Number(value['formatVersion']),
    configurationId: String(value['configurationId'] ?? ''),
    revision: Number(value['revision']) || null,
    properties: propertiesFromWire(value['properties']),
    zones: zones.map((zone) => {
      const geometry = (zone['geometry'] ?? {}) as Record<string, unknown>;
      const rows = (geometry['rows'] as Record<string, unknown>[] | undefined) ?? [];
      const kind = geometry['kind'] === 'Free' ? 'Free' : geometry['kind'] === 'Tables' ? 'Tables' : 'Numbered';
      return {
        zoneId: String(zone['zoneId'] ?? ''),
        zoneVersion: Number(zone['zoneVersion'] ?? 0),
        compositionVersion: Number(zone['compositionVersion'] ?? 0),
        geometry: {
          code: String(geometry['code'] ?? ''), name: String(geometry['name'] ?? ''),
          color: String(geometry['color'] ?? ''), x: Number(geometry['x'] ?? 0), y: Number(geometry['y'] ?? 0),
          width: Number(geometry['width'] ?? 0), height: Number(geometry['height'] ?? 0), kind,
          capacity: kind === 'Free' ? Number(geometry['capacity']) || null : null,
          properties: propertiesFromWire(geometry['properties']),
          rows: rows.map((row) => ({
            id: row['id'] ? String(row['id']) : null,
            label: String(row['label'] ?? ''),
            properties: propertiesFromWire(row['properties']),
            positions: ((row['positions'] as Record<string, unknown>[] | undefined) ?? []).map((position) => ({
              id: position['id'] ? String(position['id']) : null,
              label: String(position['label'] ?? ''),
              x: Number(position['x'] ?? 0), y: Number(position['y'] ?? 0),
              rotation: Number(position['rotation'] ?? 0),
              properties: propertiesFromWire(position['properties']),
            })),
          })),
          tables: ((geometry['tables'] as Record<string, unknown>[] | undefined) ?? []).map((table) => ({
            id: table['id'] ? String(table['id']) : null, label: String(table['label'] ?? ''),
            x: Number(table['x'] ?? 0), y: Number(table['y'] ?? 0), rotation: Number(table['rotation'] ?? 0),
            capacity: Number(table['capacity'] ?? 0), saleMode: String(table['saleMode'] ?? 'Whole') as SeatingTableGeometry['saleMode'],
            minimumQuantity: Number(table['minimumQuantity']) || null, properties: propertiesFromWire(table['properties']),
            positions: ((table['positions'] as Record<string, unknown>[] | undefined) ?? []).map((position) => ({
              id: position['id'] ? String(position['id']) : null,
              label: String(position['label'] ?? ''),
              x: Number(position['x'] ?? 0), y: Number(position['y'] ?? 0),
              rotation: Number(position['rotation'] ?? 0),
              properties: propertiesFromWire(position['properties']),
            })),
          })),
        },
      } satisfies SeatingSceneZone;
    }),
  };
}

export function decodeScene(bytes: Uint8Array, encoding: GeometryEncoding): SeatingScene {
  if (bytes.byteLength > maxPayloadBytes) throw new Error('Полезная нагрузка превышает 32 МиБ.');
  const value: unknown = encoding === 'json'
    ? JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    : messageType.toObject(messageType.decode(bytes), { defaults: true, arrays: true, longs: Number });
  if (!value || typeof value !== 'object') throw new Error('Состав редакции должен быть объектом.');
  const scene = fromWire(value as Record<string, unknown>);
  validateScene(scene);
  return scene;
}

/** Проверка одной зоны в форме тела запроса API. */
export function decodeZoneGeometry(text: string): SeatingZoneGeometry {
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== 'object') throw new Error('Геометрия зоны должна быть объектом.');
  const geometry = canonicalZoneGeometry(value as SeatingZoneGeometry);
  validateZoneGeometry(geometry);
  return geometry;
}
