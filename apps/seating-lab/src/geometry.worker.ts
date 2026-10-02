/// <reference lib="webworker" />
import {
  createRenderGeometry, decodeScene, encodeScene, generateScene, renderTransferables, splitScene,
  type GeometryEncoding, type SeatingScene,
} from '@tickets/seating/core';

interface WorkerRequest {
  encoding: GeometryEncoding;
  scene?: SeatingScene;
  synthetic?: { count: number; perZone: number; freeCapacity?: number };
}

const worker = globalThis as unknown as DedicatedWorkerGlobalScope;

worker.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  try {
    const request = event.data;
    const scene = request.scene
      ?? generateScene(request.synthetic?.count ?? 8_000, request.synthetic?.perZone ?? 1_800,
        { freeZoneCapacity: request.synthetic?.freeCapacity });
    const metrics = [];
    for (const encoding of ['json', 'protobuf'] as const) {
      const started = performance.now();
      const bytes = encodeScene(scene, encoding);
      const encoded = performance.now();
      decodeScene(bytes, encoding);
      const decoded = performance.now();
      const compressed = await new Response(new Blob([new Uint8Array(bytes)]).stream()
        .pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
      metrics.push({
        encoding, bytes: bytes.length, gzip: compressed.byteLength,
        encodeMs: encoded - started, decodeMs: decoded - encoded,
      });
    }
    // Сцена проходит полный путь кодека выбранного формата: так измеряется то, что увидит клиент.
    const rendered = createRenderGeometry(decodeScene(encodeScene(scene, request.encoding), request.encoding));
    const exported = encodeScene(scene, 'json');
    worker.postMessage({ scene: rendered, metrics, chunks: splitScene(scene).length, exported },
      [...renderTransferables(rendered), exported.buffer as ArrayBuffer]);
  } catch (error) {
    worker.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
