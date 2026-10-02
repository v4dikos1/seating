import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';

import {
  type EditorController, type EditorTool, type Rect,
  SeatingApiError, type SeatingConfigurationResult,
  type SeatingFloorResult, type SeatingZoneGeometry, type SeatingZoneListResult,
  addRow, addSeat, addSeatToRow, addTable, alignSeats, createEditorScene, createZone,
  declaresNothing, defaultSeatStep, distributeSeats, flattenZone, formatLength, formatMetres,
  measureSeatPitch, moveSeats, moveZone,
  resizeZoneFrame,
  newIdempotencyKey, nextRowLabel, plural, removeRow, removeSeats, renumberRowWithRule,
  resolveProperties, rotateSeats, rotateSeatsBy, selectedRotation, setRowLabel,
  setRowProperties,
  setRowStep, setSeatPosition, setSeatProperties, setZoneFrame, snapSelectionToGrid, straightenRow,
  validateZoneGeometry,
  zoneKindOf, zoneSummary,
  hasCritical, inspectZones, warningSignature,
  type SeatingFinding, type SeatingValidationResult,
} from '@tickets/seating';
import type { FloorBackgroundTransform } from '@tickets/seating';
import {
  AlertTriangle, Armchair, ArrowLeft, CircleDot, Coffee, Crosshair, Eye, Grid,
  HelpCircle, Layers, Maximize2, MoreHorizontal, MousePointer2, Plus, Redo2, RotateCw, Rows3,
  Save, Search, Settings2, ShieldCheck, SquareDashed, Trash2, Undo2, X,
} from 'lucide-react';

import {
  type WorkZone, documentReducer,
  initialDocumentState,
} from './configurator-document';
import { type PendingSave, pendingSaveFor, preserveConcurrentGeometry } from './configurator-state';
import {
  HallDefaultsInspector, PropertiesEditor, RowNumbering, ZoneInspector,
  inheritedTitles, rowOfSelection,
} from './inspectors';
import { SeatLegend } from './seat-legend';
import { useLab, useRequest } from './state';
import { Badge, Button, Modal, Note, Numeric, Problem, Spinner, Text } from './ui';
import { FloorPanel } from './floor-panel';
import '../styles/configurator.css';

const toolDefs: {
  id: EditorTool;
  title: string;
  hint: string;
  key: string;
  icon: typeof MousePointer2;
}[] = [
  {
    id: 'select',
    title: 'Выбор',
    hint: 'Щелчок — выбор места, рамка — несколько, перетаскивание — сдвиг',
    key: 'V',
    icon: MousePointer2,
  },
  {
    id: 'zone',
    title: 'Зона',
    hint: 'Растяните прямоугольник будущей посадочной зоны',
    key: 'Z',
    icon: SquareDashed,
  },
  {
    id: 'row',
    title: 'Ряд',
    hint: 'Проведите линию — места равномерно распределятся по ней',
    key: 'R',
    icon: Rows3,
  },
  {
    id: 'seat',
    title: 'Место',
    hint: 'Щелчок добавляет место в выбранный ряд зоны',
    key: 'S',
    icon: CircleDot,
  },
  {
    id: 'table',
    title: 'Стол',
    hint: 'Щелчок добавляет стол в выбранную зону со столами',
    key: 'T',
    icon: Coffee,
  },
];

/**
 * Шаги сетки мест в миллиметрах зала — подпись печатает ту же величину и в тех же
 * единицах, что и подсказка редактора (editor.ts, `snapEnabled`/`snapStep`): обе
 * стороны говорят про миллиметры, а не про «условные» доли метра.
 */
const gridSteps: { value: number; title: string }[] = [
  { value: 450, title: '450 мм · плотная посадка' },
  { value: 500, title: '500 мм · кресла (стандарт)' },
  { value: 550, title: '550 мм · широкие кресла' },
  { value: 600, title: '600 мм · просторная посадка' },
];

const backgroundViewKey = 'seating-lab.background-view';

interface BackgroundView {
  visible: boolean;
  opacity: number;
}

function readBackgroundView(): BackgroundView {
  try {
    const stored = localStorage.getItem(backgroundViewKey);
    if (!stored) return { visible: true, opacity: 0.35 };
    const parsed = JSON.parse(stored) as Partial<BackgroundView>;
    return {
      visible: parsed.visible !== false,
      opacity: Math.min(1, Math.max(0.05, Number(parsed.opacity) || 0.35)),
    };
  } catch {
    return { visible: true, opacity: 0.35 };
  }
}

/** Насколько геометрия отстоит от подложки; ноль означает, что они пересекаются. */
export function distanceBetweenRects(content: Rect | null, background: Rect | null): number | null {
  if (!content || !background) return null;
  const dx = Math.max(0, background.x - (content.x + content.width), content.x - (background.x + background.width));
  const dy = Math.max(0, background.y - (content.y + content.height), content.y - (background.y + background.height));
  return Math.round(Math.hypot(dx, dy));
}

export function Configurator(props: {
  hall: SeatingConfigurationResult;
  onBack: () => void;
  onPreview: (hall: SeatingConfigurationResult) => void;
  onHallChanged: (hall: SeatingConfigurationResult) => void;
}) {
  const { api } = useLab();
  const host = useRef<HTMLDivElement>(null);
  const controller = useRef<EditorController | null>(null);
  const floorBackground = useRef<{ canvas: HTMLCanvasElement | null; transform: FloorBackgroundTransform | null }>({ canvas: null, transform: null });

  // Состояние документа: зоны, активная зона, выделение и история изменений (ADR-029 / Part 2.2)
  const [doc, dispatchDoc] = useReducer(documentReducer, initialDocumentState);
  const { zones, activeZoneId, selection, history, future } = doc;

  const [activeFloorId, setActiveFloorId] = useState('');
  const zonesByFloor = useRef(new Map<string, WorkZone[]>());
  const activeFloorRef = useRef(activeFloorId);
  activeFloorRef.current = activeFloorId;
  const floorConfigurationId = useRef('');
  const loadGeneration = useRef(0);

  // Настройки редактора (эфемеренты сессии, не сохраняемые на сервере)
  const [tool, setTool] = useState<EditorTool>('select');
  const [seatsPerRow, setSeatsPerRow] = useState(12);
  const [snapGridEnabled, setSnapGridEnabled] = useState(true);
  const [gridStep, setGridStep] = useState(defaultSeatStep);
  const snapRef = useRef({ enabled: snapGridEnabled, step: gridStep });
  snapRef.current = { enabled: snapGridEnabled, step: gridStep };

  const pendingSaves = useRef(new Map<string, PendingSave>());
  const [version, setVersion] = useState(props.hall.versions.configurationVersion);
  const otherDirtyZoneCount = useMemo(() => {
    if (activeFloorId && zones) zonesByFloor.current.set(activeFloorId, zones);
    return [...zonesByFloor.current.entries()]
      .filter(([floorId]) => floorId !== activeFloorId)
      .flatMap(([, floorZones]) => floorZones.filter((zone) => zone.dirty)).length;
  }, [activeFloorId, zones]);
  const [backgroundRevision, setBackgroundRevision] = useState(0);
  const [localError, setLocalError] = useState('');
  const [dismissedError, setDismissedError] = useState<unknown>(null);
  const [confirmZone, setConfirmZone] = useState(false);
  const [zoneDeleteBusy, setZoneDeleteBusy] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showLegend, setShowLegend] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [zoneSearch, setZoneSearch] = useState('');
  const [floors, setFloors] = useState<SeatingFloorResult[]>([]);
  const [backgroundView, setBackgroundView] = useState<BackgroundView>(readBackgroundView);
  const [view, setView] = useState<{ scale: number; x: number | null; y: number | null }>(
    { scale: 0, x: null, y: null });
  const [backgroundGap, setBackgroundGap] = useState<number | null>(null);
  const [hasBackground, setHasBackground] = useState(false);
  const [calibrationRequest, setCalibrationRequest] = useState(0);
  const [review, setReview] = useState<SeatingFinding[] | null>(null);
  /** Ненавязчивое подтверждение после «Сохранить»: сколько зон записано, из них новых. */
  const [saveConfirmation, setSaveConfirmation] = useState<{ zoneCount: number; newCount: number } | null>(null);
  const saveConfirmationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (saveConfirmationTimer.current) clearTimeout(saveConfirmationTimer.current);
  }, []);
  /** Ответ ядра по сохранённой редакции: валидатор сервера — источник истины (§11). */
  const [serverReview, setServerReview] = useState<SeatingValidationResult | null>(null);
  const serverCheck = useRequest();
  /** Подпись подтверждённого набора предупреждений; пустая строка — подтверждать нечего. */
  const [confirmedWarnings, setConfirmedWarnings] = useState('');

  const { error, run } = useRequest();
  const saving = useRequest();

  const active = useMemo(
    () => zones?.find((zone) => zone.zoneId === activeZoneId) ?? null,
    [zones, activeZoneId],
  );
  const dirtyZones = useMemo(() => (zones ?? []).filter((zone) => zone.dirty), [zones]);
  const dirty = dirtyZones.length > 0 || otherDirtyZoneCount > 0;

  const setActiveZoneId = useCallback((zoneId: string | null) => {
    dispatchDoc({ type: 'SET_ACTIVE_ZONE', zoneId });
  }, []);

  const setSelection = useCallback((sel: number[] | ((curr: number[]) => number[])) => {
    if (typeof sel === 'function') {
      dispatchDoc({ type: 'SET_SELECTION', selection: sel(callbacks.current.selection) });
    } else {
      dispatchDoc({ type: 'SET_SELECTION', selection: sel });
    }
  }, []);

  const commit = useCallback((next: WorkZone[], nextActiveZoneId?: string) => {
    dispatchDoc({ type: 'COMMIT_ZONES', zones: next, nextActiveZoneId });
  }, []);

  const editActive = useCallback(
    (change: (geometry: SeatingZoneGeometry) => SeatingZoneGeometry) => {
      setLocalError('');
      dispatchDoc({ type: 'EDIT_ACTIVE', change });
    },
    [],
  );

  /**
   * «Задать рамку» для зоны без границ: ставит зону активной и заводит рамку разумного
   * размера в центре видимой сейчас области холста — как обычную правку, с отменой
   * через Ctrl+Z. Нужна и списку зон (зона может быть неактивна), и инспектору.
   */
  const frameZoneAtViewport = useCallback((zoneId: string) => {
    const center = controller.current?.viewportCenter() ?? { x: 0, y: 0 };
    setLocalError('');
    dispatchDoc({ type: 'SET_ACTIVE_ZONE', zoneId });
    dispatchDoc({ type: 'EDIT_ACTIVE', change: (geometry) => setZoneFrame(geometry, center) });
  }, []);

  const undo = useCallback(() => {
    dispatchDoc({ type: 'UNDO' });
  }, []);

  const redo = useCallback(() => {
    dispatchDoc({ type: 'REDO' });
  }, []);

  const handleSelectTable = useCallback((tableIndex: number) => {
    if (!active || tableIndex < 0) {
      setSelection([]);
      return;
    }
    const currentSeats = flattenZone(active.geometry);
    const slots = currentSeats.flatMap((s, idx) => s.parent === 'table' && s.parentIndex === tableIndex ? [idx] : []);
    setSelection(slots);
  }, [active, setSelection]);

  const onFloorBackgroundChange = useCallback((canvas: HTMLCanvasElement | null, transform: FloorBackgroundTransform | null) => {
    floorBackground.current = { canvas, transform };
    setHasBackground(Boolean(canvas && transform));
    setBackgroundRevision((current) => current + 1);
  }, []);

  // --- Загрузка ---------------------------------------------------------

  const onHallChangedRef = useRef(props.onHallChanged);
  onHallChangedRef.current = props.onHallChanged;

  const load = useCallback(async (floorId: string) => {
    const generation = ++loadGeneration.current;
    const configurationId = props.hall.id;
    activeFloorRef.current = floorId;
    floorConfigurationId.current = configurationId;
    const result = await run(async () => {
      const card = await api.getConfiguration(configurationId);
      const items: SeatingZoneListResult[] = [];
      let offset = 0;
      let totalItems = 0;
      do {
        const page = await api.listZones(configurationId, {
          offset, limit: 200, revision: card.versions.configurationRevision ?? undefined, floorId,
        });
        items.push(...page.items);
        totalItems = page.totalItems;
        offset += page.items.length;
      } while (offset < totalItems && offset > 0);
      const loaded: WorkZone[] = [];
      for (const item of items) {
        const zone = await api.getZone(configurationId, item.zoneId, item.versions.configurationRevision);
        loaded.push({
          zoneId: zone.zoneId,
          zoneVersion: zone.versions.zoneVersion,
          geometry: zone.geometry,
          dirty: false,
          structureDirty: false,
          isNew: false,
        });
      }
      return { card, loaded, floorId };
    });
    if (!result) return;
    if (generation !== loadGeneration.current || activeFloorRef.current !== floorId
      || floorConfigurationId.current !== configurationId) return;
    zonesByFloor.current.set(result.floorId, result.loaded);
    setVersion(result.card.versions.configurationVersion);
    dispatchDoc({ type: 'LOAD_ZONES', zones: result.loaded });
    onHallChangedRef.current(result.card);
  }, [api, props.hall.id, run]);

  useEffect(() => {
    if (floorConfigurationId.current === props.hall.id) return;
    floorConfigurationId.current = props.hall.id;
    loadGeneration.current++;
    zonesByFloor.current.clear();
    activeFloorRef.current = '';
    setActiveFloorId('');
    dispatchDoc({ type: 'RESET' });
    pendingSaves.current.clear();
  }, [props.hall.id]);

  useEffect(() => {
    if (!activeFloorId) return;
    if (floorConfigurationId.current !== props.hall.id) return;
    const cached = zonesByFloor.current.get(activeFloorId);
    if (cached) return;
    void load(activeFloorId);
  }, [props.hall.id, activeFloorId, load]);

  const selectFloor = useCallback((floorId: string) => {
    if (!floorId || floorId === activeFloorId) return;
    const currentZones = callbacks.current.zones;
    if (currentZones && activeFloorId) zonesByFloor.current.set(activeFloorId, currentZones);
    activeFloorRef.current = floorId;
    floorConfigurationId.current = props.hall.id;
    loadGeneration.current++;
    setActiveFloorId(floorId);
    const cached = zonesByFloor.current.get(floorId);
    if (cached) {
      dispatchDoc({ type: 'LOAD_ZONES', zones: cached, activeZoneId: null });
    } else {
      dispatchDoc({ type: 'RESET' });
    }
    setTool('select');
  }, [activeFloorId, props.hall.id]);

  // --- Сцена PixiJS -----------------------------------------------------

  const callbacks = useRef({ zones, activeZoneId, selection, seatsPerRow, activeFloorId });
  callbacks.current = { zones, activeZoneId, selection, seatsPerRow, activeFloorId };

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let disposed = false;
    let scene: EditorController | undefined;

    createEditorScene(element, {
      onSelect: (slots, additive) =>
        setSelection((current) =>
          additive ? [...new Set([...current, ...slots])] : slots,
        ),
      onMove: (dx, dy) => {
        const picked = callbacks.current.selection;
        if (picked.length) editActive((geometry) => moveSeats(geometry, picked, dx, dy));
      },
      onMoveZone: (zoneId, dx, dy) => {
        const currentZones = callbacks.current.zones ?? [];
        const zoneToMove = currentZones.find((z) => z.zoneId === zoneId);
        if (!zoneToMove) return;
        commit(
          currentZones.map((z) =>
            z.zoneId === zoneId
              ? { ...z, geometry: moveZone(z.geometry, dx, dy), dirty: true, structureDirty: true }
              : z,
          ),
          zoneId,
        );
      },
      onResizeZone: (zoneId, handle, x, y) => {
        const currentZones = callbacks.current.zones ?? [];
        const zone = currentZones.find((item) => item.zoneId === zoneId);
        if (!zone) return;
        const nextGeometry = resizeZoneFrame(zone.geometry, handle, x, y);
        if (nextGeometry === zone.geometry) return;
        commit(currentZones.map((item) => item.zoneId === zoneId
          ? { ...item, geometry: nextGeometry, dirty: true, structureDirty: true }
          : item), zoneId);
      },
      onCreateZone: (rect: Rect) => {
        const current = callbacks.current.zones ?? [];
        const created = createZone(rect, {
          codes: current.map((zone) => zone.geometry.code),
          colors: current.map((zone) => zone.geometry.color),
        });
        commit([
          ...current,
          {
            ...created,
            geometry: { ...created.geometry, floorId: callbacks.current.activeFloorId },
            zoneVersion: 0,
            dirty: true,
            structureDirty: true,
            isNew: true,
          },
        ], created.zoneId);
        setSelection([]);
        setTool('select');
      },
      onAddRow: (from, to, count) => {
        const zone = (callbacks.current.zones ?? []).find(
          (item) => item.zoneId === callbacks.current.activeZoneId,
        );
        if (!zone) return;
        const label = nextRowLabel(zone.geometry);
        try {
          const next = addRow(zone.geometry, {
            from,
            to,
            count: count ?? Math.max(1, callbacks.current.seatsPerRow),
            label,
            firstSeat: 1,
          });
          editActive(() => next);
        } catch (reason) {
          setLocalError(reason instanceof Error ? reason.message : String(reason));
        }
      },
      onAddSeat: (x, y) => {
        const zone = (callbacks.current.zones ?? []).find(
          (item) => item.zoneId === callbacks.current.activeZoneId,
        );
        if (zone && zoneKindOf(zone.geometry) === 'Tables') {
          editActive((geometry) => addTable(geometry, x, y));
          return;
        }
        if (!zone || !zone.geometry.rows.length) {
          setLocalError('Сначала добавьте хотя бы один ряд: каждое место принадлежит ряду.');
          return;
        }
        const rowIndex = rowOfSelection(zone.geometry, callbacks.current.selection);
        editActive((geometry) => addSeat(geometry, rowIndex, x, y));
      },
      onPickZone: (zoneId) => {
        setActiveZoneId(zoneId);
        setSelection([]);
      },
      onView: setView,
    }).then((created) => {
      if (disposed) {
        created.destroy();
        return;
      }
      scene = created;
      controller.current = created;
      created.setSnap(snapRef.current.enabled, snapRef.current.step);
      created.setDocument(
        (callbacks.current.zones ?? []).map((z) => ({
          zoneId: z.zoneId,
          geometry: z.geometry,
        })),
        callbacks.current.activeZoneId,
      );
      created.fit();
    }).catch((reason: unknown) => {
      if (!disposed) setLocalError(reason instanceof Error ? reason.message : String(reason));
    });

    return () => {
      disposed = true;
      scene?.destroy();
      controller.current = null;
    };
  }, [commit, editActive, setActiveZoneId, setSelection]);

  useEffect(() => {
    controller.current?.setTool(tool);
  }, [tool]);

  useEffect(() => {
    if (!zones) return;
    controller.current?.setDocument(
      zones.map((z) => ({ zoneId: z.zoneId, geometry: z.geometry })),
      activeZoneId,
    );
  }, [zones, activeZoneId]);

  useEffect(() => {
    controller.current?.setBackground(floorBackground.current.canvas, floorBackground.current.transform);
    controller.current?.setBackgroundView(backgroundView.visible, backgroundView.opacity);
    // Подложка и схема могут лежать в разных концах координат: об этом надо сказать вслух,
    // иначе холст просто выглядит пустым.
  }, [backgroundRevision]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setBackgroundGap(distanceBetweenRects(
      controller.current?.contentBounds() ?? null,
      controller.current?.backgroundBounds() ?? null,
    ));
  }, [zones, backgroundRevision]);

  useEffect(() => {
    controller.current?.setBackgroundView(backgroundView.visible, backgroundView.opacity);
    try {
      localStorage.setItem(backgroundViewKey, JSON.stringify(backgroundView));
    } catch {
      // Приватный режим браузера: настройка просто не переживёт перезагрузку.
    }
  }, [backgroundView]);

  useEffect(() => {
    controller.current?.setSelection(selection);
  }, [selection]);

  useEffect(() => {
    controller.current?.setSnap(snapGridEnabled, gridStep);
  }, [snapGridEnabled, gridStep]);

  // --- Горячие клавиши --------------------------------------------------

  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;

      if (event.key === 'Escape') {
        setSelection([]);
        setShowMore(false);
      }
      if (event.key === '?' || (event.shiftKey && event.key === '/')) {
        setShowShortcuts((prev) => !prev);
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selection.length) {
        event.preventDefault();
        editActive((geometry) => removeSeats(geometry, selection));
        setSelection([]);
      }
      if (event.ctrlKey && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      }
      // Инструменты выбираются одиночной буквой (V/Z/R/S/T) всегда, когда фокус не
      // в поле ввода — независимо от того, где именно фокус (в т.ч. на холсте).
      // Конфликта с панорамированием нет: холст (editor.ts, canvasHasFocus()) двигает
      // камеру только стрелками, буквы W/A/S/D у него не заняты.
      const match = toolDefs.find((item) => item.key.toLowerCase() === event.key.toLowerCase());
      if (match && !event.ctrlKey && !event.metaKey && !event.altKey) {
        setTool(match.id);
      }
    };
    window.addEventListener('keydown', keys);
    return () => window.removeEventListener('keydown', keys);
  }, [selection, editActive, redo, undo, setSelection]);

  // --- Сохранение -------------------------------------------------------

  /**
   * Проверка схемы перед сохранением (артефакт 14 §11): критические находки блокируют
   * запись, предупреждения требуют подтверждения именно этого набора — подтвердив один
   * набор, нельзя молча сохранить другой.
   */
  function inspectAllFloors(): SeatingFinding[] {
    if (zones && activeFloorId) zonesByFloor.current.set(activeFloorId, zones);
    // Зоны разных этажей между собой не сравниваются: их рамки лежат в разных плоскостях.
    return [...zonesByFloor.current.values()]
      .flatMap((floorZones) => inspectZones(floorZones.map((zone) => ({
        zoneId: zone.zoneId,
        geometry: zone.geometry,
      }))));
  }

  async function save() {
    const findings = inspectAllFloors();
    if (hasCritical(findings) || warningSignature(findings) !== confirmedWarnings) {
      setReview(findings);
      return;
    }
    await writeZones();
  }

  async function writeZones() {
    if (zones && activeFloorId) {
      zonesByFloor.current.set(activeFloorId, zones);
    }
    const allDirty: { floorId: string; zone: WorkZone }[] = [];
    for (const [floorId, floorZones] of zonesByFloor.current.entries()) {
      for (const zone of floorZones) {
        if (zone.dirty) {
          allDirty.push({ floorId, zone });
        }
      }
    }
    if (!allDirty.length) return;
    for (const { zone } of allDirty) {
      try {
        validateZoneGeometry(zone.geometry);
      } catch (reason) {
        setLocalError(
          'Зона «' +
            zone.geometry.name +
            '»: ' +
            (reason instanceof Error ? reason.message : String(reason)),
        );
        return;
      }
    }
    setLocalError('');
    let saveFailure: unknown;
    const result = await saving.run(async () => {
      try {
        let expected = version;
        for (const { floorId, zone } of allDirty) {
          const expectedZoneVersion = zone.zoneVersion;
          const expectedVersion = zone.isNew
            ? (pendingSaves.current.get(zone.zoneId)?.expectedVersion ?? expected)
            : undefined;
          const fingerprint = zone.isNew
            ? JSON.stringify({ expectedVersion, geometry: zone.geometry })
            : JSON.stringify({ expectedZoneVersion, geometry: zone.geometry });
          const pending = pendingSaveFor(
            pendingSaves.current,
            zone.zoneId,
            fingerprint,
            newIdempotencyKey,
            expectedVersion,
          );
          if (!zone.isNew && !zone.structureDirty) {
            const patched = await api.patchZone(
              props.hall.id,
              zone.zoneId,
              {
                expectedZoneVersion,
                code: zone.geometry.code,
                name: zone.geometry.name,
                color: zone.geometry.color,
                capacity:
                  zoneKindOf(zone.geometry) === 'Free'
                    ? (zone.geometry.capacity ?? undefined)
                    : undefined,
                properties: declaresNothing(zone.geometry.properties)
                  ? null
                  : zone.geometry.properties,
              },
              pending.key,
            );
            expected = patched.versions.configurationVersion;
            pendingSaves.current.delete(zone.zoneId);
            setVersion(expected);
            const floorList = zonesByFloor.current.get(floorId);
            if (floorList) {
              zonesByFloor.current.set(
                floorId,
                floorList.map((item) =>
                  item.zoneId === zone.zoneId
                    ? {
                        ...item,
                        zoneVersion: patched.versions.zoneVersion,
                        dirty: false,
                        structureDirty: false,
                      }
                    : item,
                ),
              );
            }
            continue;
          }
          const response = zone.isNew
            ? await api.createZone(
                props.hall.id,
                { expectedVersion: expectedVersion ?? expected, geometry: zone.geometry },
                pending.key,
              )
            : await api.saveZone(
                props.hall.id,
                zone.zoneId,
                { expectedZoneVersion, geometry: zone.geometry },
                pending.key,
              );
          expected = response.versions.configurationVersion;
          const stored = response;
          const confirmed: WorkZone = {
            zoneId: stored.zoneId,
            zoneVersion: stored.versions.zoneVersion,
            geometry: stored.geometry,
            dirty: false,
            structureDirty: false,
            isNew: false,
          };
          pendingSaves.current.delete(zone.zoneId);
          setVersion(expected);
          dispatchDoc({
            type: 'REBASE_ZONE',
            temporaryId: zone.zoneId,
            serverId: stored.zoneId,
            serverVersion: stored.versions.zoneVersion,
          });
          const updateZoneInList = (item: WorkZone) =>
            item.zoneId === zone.zoneId
              ? item.geometry === zone.geometry
                ? confirmed
                : {
                    ...item,
                    zoneId: stored.zoneId,
                    zoneVersion: stored.versions.zoneVersion,
                    geometry: preserveConcurrentGeometry(item.geometry),
                    isNew: false,
                    dirty: true,
                    structureDirty: true,
                  }
              : item;

          const targetFloorId = stored.geometry.floorId || floorId;
          const sourceFloorList = zonesByFloor.current.get(floorId) ?? [];
          if (targetFloorId !== floorId) {
            zonesByFloor.current.set(
              floorId,
              sourceFloorList.filter((item) => item.zoneId !== zone.zoneId),
            );
            const targetFloorList = zonesByFloor.current.get(targetFloorId) ?? [];
            const existingInTarget = targetFloorList.find((item) => item.zoneId === zone.zoneId);
            const updated = existingInTarget ? updateZoneInList(existingInTarget) : confirmed;
            zonesByFloor.current.set(targetFloorId, [
              ...targetFloorList.filter((item) => item.zoneId !== zone.zoneId),
              updated,
            ]);
          } else {
            zonesByFloor.current.set(
              floorId,
              sourceFloorList.map(updateZoneInList),
            );
          }
          if (activeZoneId === zone.zoneId && stored.zoneId !== zone.zoneId) {
            setActiveZoneId(stored.zoneId);
          }
        }
        const card = await api.getConfiguration(props.hall.id);
        return { card };
      } catch (reason) {
        saveFailure = reason;
        throw reason;
      }
    });
    if (!result) {
      if (
        saveFailure instanceof SeatingApiError &&
        saveFailure.status === 409
      ) {
        setLocalError(
          saveFailure.errorCode === 'SeatingZoneVersionConflict'
            ? 'Эту зону уже изменили в другом сеансе. Локальные правки сохранены; перечитайте зону и разрешите конфликт явно.'
            : 'Конфигурация была изменена в другом сеансе. Локальные правки сохранены; обновите данные и разрешите конфликт явно.',
        );
      }
      return;
    }
    const finalZones = zonesByFloor.current.get(activeFloorId) ?? [];
    dispatchDoc({ type: 'LOAD_ZONES', zones: finalZones, activeZoneId });
    setVersion(result.card.versions.configurationVersion);
    props.onHallChanged(result.card);

    // Подтверждение того, что именно ушло на сервер: сколько зон и сколько из них новых.
    // Автоскрытие — чтобы не превращаться в ещё один элемент, который надо закрывать руками.
    if (saveConfirmationTimer.current) clearTimeout(saveConfirmationTimer.current);
    setSaveConfirmation({
      zoneCount: allDirty.length,
      newCount: allDirty.filter(({ zone }) => zone.isNew).length,
    });
    saveConfirmationTimer.current = setTimeout(() => setSaveConfirmation(null), 5_000);
  }

  /**
   * Убрать зону из схемы: несохранённая зона исчезает локально, сохранённая — сразу
   * запросом к серверу. Сервер дописывает новую редакцию черновика без зоны, а история
   * и UUID мест прежних редакций остаются нетронутыми.
   */
  async function confirmDeleteZone() {
    if (!active) return;
    if (active.isNew) {
      dispatchDoc({ type: 'DELETE_ZONE', zoneId: active.zoneId });
      setConfirmZone(false);
      return;
    }
    const zoneId = active.zoneId;
    const expectedZoneVersion = active.zoneVersion;
    setLocalError('');
    setZoneDeleteBusy(true);
    try {
      const result = await api.deleteZone(
        props.hall.id,
        zoneId,
        expectedZoneVersion,
        newIdempotencyKey(),
      );
      dispatchDoc({ type: 'DELETE_ZONE', zoneId });
      setVersion(result.versions.configurationVersion);
      props.onHallChanged({
        ...props.hall,
        versions: { ...props.hall.versions,
          configurationVersion: result.versions.configurationVersion,
          configurationRevision: result.versions.configurationRevision },
      });
      setConfirmZone(false);
    } catch (reason) {
      setLocalError(
        reason instanceof SeatingApiError && reason.status === 409
          ? 'Эту зону уже изменили или удалили в другом сеансе. Обновите схему и повторите удаление.'
          : reason instanceof Error
            ? reason.message
            : String(reason),
      );
    } finally {
      setZoneDeleteBusy(false);
    }
  }

  // --- Разметка и свойства ----------------------------------------------

  const seats = active ? flattenZone(active.geometry) : [];
  const selectedRows = new Set<number>(selection.flatMap((slot) => {
    const seat = seats[slot];
    return seat?.parent === 'row' ? [seat.parentIndex] : [];
  }));
  const selectedTables = new Set<number>(selection.flatMap((slot) => {
    const seat = seats[slot];
    return seat?.parent === 'table' ? [seat.parentIndex] : [];
  }));
  const singleRow = selectedRows.size === 1 ? [...selectedRows][0] : null;
  const singleTable = selectedTables.size === 1 ? [...selectedTables][0] : null;

  const selectionProperties = useMemo(() => {
    if (!active || !selection.length) return null;
    const first = flattenZone(active.geometry).find((seat) => seat.slot === selection[0]);
    if (!first) return null;
    const parentProperties = first.parent === 'row'
      ? active.geometry.rows[first.parentIndex]?.properties
      : active.geometry.tables?.[first.parentIndex]?.properties;
    return resolveProperties(first.properties, parentProperties, active.geometry.properties, props.hall.properties);
  }, [active, selection, props.hall.properties]);

  const selectionRotation = useMemo(
    () => (active && selection.length ? selectedRotation(active.geometry, selection) : null),
    [active, selection],
  );


  const visibleZones = useMemo(() => {
    const needle = zoneSearch.trim().toLowerCase();
    if (!needle) return zones ?? [];
    return (zones ?? []).filter((zone) =>
      zone.geometry.code.toLowerCase().includes(needle)
      || zone.geometry.name.toLowerCase().includes(needle));
  }, [zones, zoneSearch]);

  const activeKind = active ? zoneKindOf(active.geometry) : null;
  const seatPitch = active ? measureSeatPitch(active.geometry) : null;
  const hasFrame = active ? active.geometry.width > 0 && active.geometry.height > 0 : false;
  const selectedTableLabel = singleTable !== null ? (active?.geometry.tables ?? [])[singleTable]?.label : undefined;
  const selectionContext = !active
    ? 'Зал целиком'
    : selection.length
      ? `${plural(selection.length, 'место', 'места', 'мест')}`
        + (singleRow !== null ? ` · ряд ${active.geometry.rows[singleRow].label}` : '')
        + (selectedTableLabel ? ` · стол ${selectedTableLabel}` : '')
      : `Зона ${active.geometry.code} · ${active.geometry.name}`;

  const newZoneCount = dirtyZones.filter((zone) => zone.isNew).length;

  // Находки текущего этажа считаются на каждый кадр разметки: организатор видит счётчик
  // сразу, а не узнаёт о наложении зон только при сохранении.
  const floorFindings = useMemo(
    () => inspectZones((zones ?? []).map((zone) => ({ zoneId: zone.zoneId, geometry: zone.geometry }))),
    [zones],
  );
  const criticalCount = floorFindings.filter((finding) => finding.level === 'critical').length;
  const warningCount = floorFindings.length - criticalCount;
  const alerts: { key: string; node: ReactNode }[] = [];
  if (error && error !== dismissedError) alerts.push({ key: 'api', node: <Problem error={error} /> });
  if (localError) alerts.push({ key: 'local', node: <Problem error={localError} /> });

  /** Быстрые пространственные действия над выделением: только то, что делается мышью. */
  const spatialActions: { key: string; label: string; title: string; icon?: ReactNode; run: () => void }[] =
    active && selection.length
      ? [
          {
            key: 'rotate',
            label: '+90°',
            icon: <RotateCw size={13} />,
            title: 'Повернуть выбранные места на +90°',
            run: () => editActive((geometry) => rotateSeatsBy(geometry, selection, 90_000)),
          },
          {
            key: 'align-h',
            label: '↔ По гориз.',
            title: 'Выровнять выбранные места по горизонтали (одинаковый Y)',
            run: () => editActive((geometry) => alignSeats(geometry, selection, 'horizontal')),
          },
          {
            key: 'align-v',
            label: '↕ По верт.',
            title: 'Выровнять выбранные места по вертикали (одинаковый X)',
            run: () => editActive((geometry) => alignSeats(geometry, selection, 'vertical')),
          },
          {
            key: 'distribute',
            label: 'Распределить',
            title: 'Распределить места равномерно между крайними',
            run: () => editActive((geometry) => distributeSeats(geometry, selection)),
          },
          {
            key: 'snap',
            label: `К сетке ${formatLength(gridStep)}`,
            title: `Привязать выбранные места к сетке ${formatLength(gridStep)}`,
            run: () => editActive((geometry) => snapSelectionToGrid(geometry, selection, gridStep)),
          },
          ...(singleRow !== null
            ? [
                {
                  key: 'straighten',
                  label: 'Выпрямить ряд',
                  title: 'Выпрямить ряд строго между крайними местами с равным шагом',
                  run: () => editActive((geometry) => straightenRow(geometry, singleRow)),
                },
                {
                  key: 'row-step',
                  label: `Шаг ${formatLength(gridStep)}`,
                  title: `Установить шаг ${formatLength(gridStep)} между местами ряда`,
                  run: () => editActive((geometry) => setRowStep(geometry, singleRow, gridStep)),
                },
              ]
            : []),
        ]
      : [];
  const inlineActions = spatialActions.slice(0, 4);
  const overflowActions = spatialActions.slice(4);

  return (
    <div className='editor-shell'>
      {/* Top Application Bar */}
      <header className='editor-bar'>
        <div className='editor-bar-left'>
          <button
            type='button'
            className='icon'
            onClick={props.onBack}
            title='Вернуться к списку залов'
            aria-label='Назад'
          >
            <ArrowLeft size={18} />
          </button>
          <div className='editor-title-wrap'>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <h2 style={{ fontSize: 15, fontWeight: 700 }}>{props.hall.name}</h2>
                <Badge tone='neutral'>Черновик</Badge>
                <span className='mono' style={{ fontSize: 11, color: 'var(--ink-muted)' }}>
                  v{version}
                </span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--ink-secondary)' }}>
                {active ? (
                  <>
                    Активная зона: <b>{active.geometry.name}</b> · {zoneSummary(active.geometry)}
                  </>
                ) : (
                  'Выберите зону в списке слева или растяните новую инструментом «Зона»'
                )}
              </div>
            </div>
          </div>
        </div>

        <div className='editor-bar-center'>
          <Button
            kind='ghost'
            icon={<Undo2 size={15} />}
            disabled={!history.length}
            title='Отменить (Ctrl+Z)'
            onClick={undo}
          />
          <Button
            kind='ghost'
            icon={<Redo2 size={15} />}
            disabled={!future.length}
            title='Вернуть (Ctrl+Shift+Z)'
            onClick={redo}
          />
          <div style={{ width: 1, height: 18, background: 'var(--line)', margin: '0 4px' }} />
          <Button
            kind='ghost'
            icon={<Maximize2 size={15} />}
            title='Вписать схему в окно'
            onClick={() => controller.current?.fit()}
          >
            По размеру
          </Button>
          <Button
            kind='ghost'
            icon={<HelpCircle size={15} />}
            title='Горячие клавиши (?)'
            onClick={() => setShowShortcuts(true)}
          />
        </div>

        <div className='editor-bar-right'>
          <Button
            kind='ghost'
            icon={<Settings2 size={15} />}
            title='Свойства и умолчания зала'
            onClick={() => {
              setActiveZoneId(null);
              setSelection([]);
            }}
          >
            Свойства зала
          </Button>
          <Button
            kind='secondary'
            icon={<Eye size={15} />}
            onClick={() => props.onPreview(props.hall)}
          >
            Витрина
          </Button>
          <Button
            kind='primary'
            icon={saving.busy ? <RotateCw size={15} /> : <Save size={15} />}
            disabled={!dirty || saving.busy}
            title={
              dirty
                ? `Отправить на сервер ${plural(dirtyZones.length + otherDirtyZoneCount, 'зону', 'зоны', 'зон')}`
                  + (newZoneCount ? `, из них новых: ${newZoneCount}` : '')
                : 'Несохранённых правок нет'
            }
            onClick={save}
          >
            {saving.busy ? 'Сохранение…' : 'Сохранить'}
            {dirtyZones.length > 0 ? (
              <span className='btn-badge'>{dirtyZones.length}</span>
            ) : otherDirtyZoneCount > 0 ? (
              <span className='btn-badge' title='Есть правки на других этажах'>+{otherDirtyZoneCount}</span>
            ) : null}
          </Button>
        </div>
      </header>

      <div className='editor-body'>
        {/* Left Toolbar & Zone Navigator */}
        <aside className='editor-left'>
          <div className='tool-palette' role='toolbar' aria-label='Инструменты редактора'>
            {toolDefs.map((def) => {
              const Icon = def.icon;
              const isActive = tool === def.id;
              return (
                <button
                  key={def.id}
                  type='button'
                  className={`tool-btn ${isActive ? 'active' : ''}`}
                  onClick={() => setTool(def.id)}
                  title={`${def.title} (${def.key}) — ${def.hint}`}
                  aria-pressed={isActive}
                >
                  <Icon size={18} />
                  <span className='tool-label'>{def.title}</span>
                  <span className='tool-hotkey'>{def.key}</span>
                </button>
              );
            })}
          </div>

          {tool === 'row' ? (
            <div className='tool-options-panel'>
              <Numeric
                label='Мест в новом ряду'
                value={seatsPerRow}
                min={1}
                max={200}
                onChange={setSeatsPerRow}
              />
              <p className='tool-options-hint'>
                Проведите линию на холсте. Количество мест и шаг рассчитываются автоматически.
              </p>
              {hasBackground ? <p className='configurator-calibration-tip'>
                Кресла меньше, чем на плане? Откалибруйте масштаб по креслам.
                <button type='button' onClick={() => setCalibrationRequest((value) => value + 1)}>По креслам</button>
              </p> : null}
            </div>
          ) : null}

          <FloorPanel
            configurationId={props.hall.id}
            configurationVersion={version}
            selectedFloorId={activeFloorId}
            onFloorSelect={selectFloor}
            otherDirtyZoneCount={otherDirtyZoneCount}
            onFloorsChange={setFloors}
            onConfigurationChange={(configuration) => {
              setVersion(configuration.versions.configurationVersion);
              props.onHallChanged(configuration);
            }}
            onBackgroundChange={onFloorBackgroundChange}
            calibrationRequest={calibrationRequest}
          />

          <div className='zone-list-section'>
            <div className='zone-list-head'>
              <h3>Зоны этажа ({zones ? zones.length : '…'})</h3>
              <button
                type='button'
                className='icon'
                title='Добавить новую зону: инструмент «Зона» (Z)'
                onClick={() => setTool('zone')}
              >
                <Plus size={14} />
              </button>
            </div>

            {zones && zones.length > 8 ? (
              <div className='zone-list-search'>
                <input
                  value={zoneSearch}
                  placeholder='Поиск по коду и названию…'
                  aria-label='Поиск зоны'
                  onChange={(event) => setZoneSearch(event.target.value)}
                />
              </div>
            ) : null}

            {zones === null ? <Spinner label='Загружаем зоны этажа…' /> : null}

            {zones && zones.length === 0 ? (
              <div className='empty-state-card'>
                <SquareDashed size={20} color='var(--primary)' />
                <p><strong>Зон пока нет</strong></p>
                <span>
                  Возьмите инструмент «Зона» (Z) и растяните область на холсте. Сетка размечена
                  в метрах зала.
                </span>
                <Button kind='secondary' onClick={() => setTool('zone')}>Взять инструмент «Зона»</Button>
              </div>
            ) : null}

            {zones && zones.length > 0 && visibleZones.length === 0 ? (
              <div className='empty-state-card'>
                <Search size={18} color='var(--ink-muted)' />
                <p><strong>Ничего не найдено</strong></p>
                <span>Ни одна зона этажа не совпала с запросом.</span>
              </div>
            ) : null}

            <ul className='zone-list'>
              {visibleZones.map((zone) => {
                const isCurrent = zone.zoneId === activeZoneId;
                const framed = zone.geometry.width > 0 && zone.geometry.height > 0;
                const kind = zoneKindOf(zone.geometry);
                return (
                  <li key={zone.zoneId}>
                    <div
                      className={`zone ${isCurrent ? 'on' : ''}`}
                      onClick={() => {
                        setActiveZoneId(zone.zoneId);
                        setSelection([]);
                        if (framed) controller.current?.focusZone(zone.zoneId);
                      }}
                    >
                      <span
                        className='zone-swatch'
                        style={{ background: zone.geometry.color }}
                      />
                      <div className='zone-name'>
                        <b>{zone.geometry.code} · {zone.geometry.name}</b>
                        <em>{zoneSummary(zone.geometry)}</em>
                      </div>
                      <div className='zone-actions'>
                        <span className='zone-kind'>
                          {kind === 'Numbered' ? 'мест' : kind === 'Free' ? 'своб' : 'стол'}
                        </span>
                        {!framed ? (
                          <span className='zone-warn' title='У зоны нет рамки: на холсте её не видно'>
                            <AlertTriangle size={13} />
                          </span>
                        ) : null}
                        {zone.dirty ? (
                          <span className='zone-dot' title='Есть несохранённые правки' />
                        ) : null}
                        {framed ? (
                          <button
                            type='button'
                            className='icon'
                            title='Сфокусировать камеру на зоне'
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveZoneId(zone.zoneId);
                              setSelection([]);
                              controller.current?.focusZone(zone.zoneId);
                            }}
                          >
                            <Crosshair size={14} />
                          </button>
                        ) : (
                          <button
                            type='button'
                            className='icon'
                            title='Задать рамку: поставить границы зоны в центре видимой области холста'
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelection([]);
                              frameZoneAtViewport(zone.zoneId);
                            }}
                          >
                            <SquareDashed size={14} />
                          </button>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </aside>

        {/* Center Canvas Viewport */}
        {/* Фокус и Tab-остановка живут на самом <canvas> (editor.ts) — у обёртки
            их нет, чтобы холст не давал две остановки по Tab на одну и ту же область. */}
        <div
          className='editor-canvas'
          ref={host}
        >
          {/* Floating Canvas HUD */}
          <div className='canvas-hud'>
            <button
              type='button'
              className={`canvas-hud-btn ${snapGridEnabled ? 'active' : ''}`}
              onClick={() => setSnapGridEnabled(!snapGridEnabled)}
              title={snapGridEnabled
                ? 'Привязка к сетке включена (Alt — временно отключить)'
                : 'Привязка к сетке отключена'}
            >
              <Grid size={13} />
              <span>Сетка</span>
            </button>
            <select
              className='canvas-hud-btn canvas-hud-value'
              value={gridStep}
              onChange={(e) => setGridStep(Number(e.target.value))}
              aria-label='Шаг сетки'
              title='Шаг сетки в размерах зала: единица схемы равна метру'
              style={{ border: 0, outline: 'none', background: 'transparent', cursor: 'pointer', paddingRight: 4 }}
            >
              {gridSteps.map((step) => (
                <option key={step.value} value={step.value}>{step.title}</option>
              ))}
            </select>
            <button
              type='button'
              className='canvas-hud-btn'
              onClick={() => controller.current?.fit()}
              title='Вписать всю схему в экран'
            >
              <Maximize2 size={13} />
              <span>По размеру</span>
            </button>
            {hasBackground ? (
              <>
                <button
                  type='button'
                  className={`canvas-hud-btn ${backgroundView.visible ? 'active' : ''}`}
                  onClick={() => setBackgroundView((current) => ({ ...current, visible: !current.visible }))}
                  title={backgroundView.visible ? 'Скрыть подложку' : 'Показать подложку'}
                >
                  <Layers size={13} />
                  <span>Подложка</span>
                </button>
                <input
                  type='range'
                  min={5}
                  max={100}
                  step={5}
                  value={Math.round(backgroundView.opacity * 100)}
                  aria-label='Прозрачность подложки'
                  title={`Прозрачность подложки: ${Math.round(backgroundView.opacity * 100)}%`}
                  disabled={!backgroundView.visible}
                  onChange={(event) =>
                    setBackgroundView((current) => ({ ...current, opacity: Number(event.target.value) / 100 }))}
                  style={{ width: 70, accentColor: 'var(--primary)' }}
                />
                <button
                  type='button'
                  className='canvas-hud-btn'
                  onClick={() => controller.current?.fitBackground()}
                  title='Показать подложку целиком'
                >
                  <span>К подложке</span>
                </button>
              </>
            ) : null}
            <button
              type='button'
              className={`canvas-hud-btn ${criticalCount ? 'danger' : warningCount ? 'warn' : ''}`}
              onClick={() => setReview(inspectAllFloors())}
              title={criticalCount || warningCount
                ? `На этом этаже критических ${criticalCount}, предупреждений ${warningCount}.`
                  + ' Откройте отчёт по всей схеме.'
                : 'Замечаний на этом этаже нет. Откройте отчёт по всей схеме.'}
            >
              <ShieldCheck size={13} />
              <span>Проверка</span>
              {criticalCount || warningCount ? (
                <span className='canvas-hud-value'>{criticalCount || warningCount}</span>
              ) : null}
            </button>
            <button
              type='button'
              className={`canvas-hud-btn ${showLegend ? 'active' : ''}`}
              onClick={() => setShowLegend((prev) => !prev)}
              title='Легенда обозначений видов мест'
            >
              <HelpCircle size={13} />
              <span>Легенда</span>
            </button>
          </div>

          {/* Сообщения плавают над холстом и не двигают разметку */}
          <div className='canvas-alerts'>
            {alerts.map((item) => (
              <div className='canvas-alert' key={item.key}>
                {item.node}
                <button
                  type='button'
                  className='icon canvas-alert-close'
                  aria-label='Скрыть сообщение'
                  onClick={() => {
                    if (item.key === 'local') setLocalError('');
                    else setDismissedError(error);
                  }}
                >
                  <X size={14} />
                </button>
              </div>
            ))}

            {backgroundGap !== null && backgroundGap > 5_000 ? (
              <div className='canvas-alert canvas-alert-plain'>
                <Note tone='warn'>
                  Схема лежит в {formatMetres(backgroundGap)} от подложки, поэтому в кадре видно
                  только одно из двух.{' '}
                  <button type='button' className='link' onClick={() => controller.current?.fitBackground()}>
                    Показать подложку
                  </button>
                  {' · '}
                  <button type='button' className='link' onClick={() => controller.current?.fit()}>
                    Показать схему
                  </button>
                </Note>
              </div>
            ) : null}

            {saveConfirmation ? (
              <div className='canvas-alert'>
                <Note tone='ok'>
                  Записано на сервер: {plural(saveConfirmation.zoneCount, 'зона', 'зоны', 'зон')}
                  {saveConfirmation.newCount
                    ? `, из них ${plural(saveConfirmation.newCount, 'новая', 'новые', 'новых')}`
                    : ''}.
                </Note>
                <button
                  type='button'
                  className='icon canvas-alert-close'
                  aria-label='Скрыть подтверждение'
                  onClick={() => setSaveConfirmation(null)}
                >
                  <X size={14} />
                </button>
              </div>
            ) : null}
          </div>

          {/* Floating Selection Bar: быстрые пространственные действия мышью */}
          {active && selection.length > 0 ? (
            <div className='canvas-selection-bar'>
              <div className='canvas-selection-meta'>
                <Armchair size={15} color='var(--primary)' />
                <span>
                  Выбрано: <strong>{selection.length}</strong>
                  {singleRow !== null ? ` · ряд ${active.geometry.rows[singleRow].label}` : ''}
                </span>
              </div>
              <div className='canvas-selection-actions'>
                {inlineActions.map((action) => (
                  <button
                    key={action.key}
                    type='button'
                    className='btn btn-studio'
                    onClick={action.run}
                    title={action.title}
                  >
                    {action.icon}
                    <span>{action.label}</span>
                  </button>
                ))}

                {overflowActions.length ? (
                  <div className='canvas-more'>
                    <button
                      type='button'
                      className='btn btn-studio'
                      onClick={() => setShowMore((prev) => !prev)}
                      title='Ещё действия'
                      aria-expanded={showMore}
                    >
                      <MoreHorizontal size={14} />
                    </button>
                    {showMore ? (
                      <div className='canvas-more-menu'>
                        {overflowActions.map((action) => (
                          <button
                            key={action.key}
                            type='button'
                            onClick={() => {
                              action.run();
                              setShowMore(false);
                            }}
                            title={action.title}
                          >
                            {action.label}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <button
                  type='button'
                  className='btn btn-studio danger'
                  onClick={() => {
                    editActive((geometry) => removeSeats(geometry, selection));
                    setSelection([]);
                  }}
                  title='Удалить выбранные места (Delete)'
                >
                  <Trash2 size={13} />
                  <span>Удалить</span>
                </button>
              </div>
            </div>
          ) : null}

          {/* Строка состояния: масштаб и курсор в настоящих метрах зала */}
          <div className='canvas-status'>
            <span>1 м схемы = <b>{view.scale ? Math.round(view.scale) : '—'}</b> пкс · кресло {gridStep} мм</span>
            <span className='canvas-status-sep' />
            <span>
              {view.x !== null && view.y !== null
                ? <>{formatMetres(view.x)} · {formatMetres(view.y)}</>
                : 'курсор вне холста'}
            </span>
            {active ? (
              <>
                <span className='canvas-status-sep' />
                <span><b>{active.geometry.code}</b> · {zoneSummary(active.geometry)}</span>
              </>
            ) : null}
          </div>

          {/* Легенда видов мест */}
          <SeatLegend open={showLegend} onClose={() => setShowLegend(false)} />
        </div>

        {/*
          Правая панель — параметрический инспектор: точный ввод, формулы нумерации
          и иерархия свойств. Быстрые пространственные действия мышью живут на холсте
          и здесь намеренно не повторяются, чтобы одна и та же кнопка не существовала дважды.
        */}
        <aside className='editor-right'>
          <div className='inspector-context'>
            <Settings2 size={14} color='var(--primary)' />
            <b>{selectionContext}</b>
          </div>

          {active ? (
            <ZoneInspector
              zone={active}
              floors={floors}
              selectedTableIndex={singleTable}
              onSelectTable={handleSelectTable}
              onChange={(change) => editActive(change)}
              onDelete={() => setConfirmZone(true)}
              onSetFrame={() => frameZoneAtViewport(active.zoneId)}
            />
          ) : (
            <HallDefaultsInspector
              hall={props.hall}
              version={version}
              onHallChanged={props.onHallChanged}
              onVersionChanged={setVersion}
            />
          )}

          {active && !hasFrame ? (
            <Note tone='warn'>
              У зоны нет рамки, поэтому на холсте её не видно и выбрать её можно только в списке.
              «Подогнать границы под места» вернёт рамку, когда в зоне появятся места.
            </Note>
          ) : null}

          {active && activeKind === 'Numbered' && seatPitch !== null && seatPitch > 2_000 ? (
            <Note tone='warn'>
              Средний шаг мест в зоне — {formatLength(seatPitch)}. Единица схемы равна метру,
              поэтому такая зона нарисована не в том масштабе и под калиброванную подложку
              не ляжет. «Масштаб зоны» в параметрах приведёт её к настоящему шагу.
            </Note>
          ) : null}

          {active ? (
            <details className='inspector-section' open>
              <summary>Свойства зоны</summary>
              <div className='inspector-section-body'>
                <PropertiesEditor
                  title='Свойства зоны'
                  hint='Ряды и места зоны наследуют эти значения. Правка свойств зоны не переписывает состав мест.'
                  properties={active.geometry.properties}
                  inherited={inheritedTitles(
                    resolveProperties(null, null, null, props.hall.properties),
                  )}
                  onChange={(properties) =>
                    editActive((geometry) => ({ ...geometry, properties }))
                  }
                />
              </div>
            </details>
          ) : null}

          {active && selection.length ? (
            <details className='inspector-section' open>
              <summary>
                Выбранные места
                <span className='inspector-section-count'>{selection.length}</span>
              </summary>
              <div className='inspector-section-body'>
                {singleRow !== null ? (
                  <>
                    <Text
                      label='Подпись ряда'
                      value={active.geometry.rows[singleRow].label}
                      maxLength={64}
                      onChange={(value) =>
                        editActive((geometry) => setRowLabel(geometry, singleRow, value))
                      }
                    />
                    <RowNumbering
                      positionCount={active.geometry.rows[singleRow].positions.length}
                      onApply={(rule) =>
                        editActive((geometry) =>
                          renumberRowWithRule(geometry, singleRow, rule),
                        )
                      }
                    />
                    <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                      <Button
                        kind='secondary'
                        icon={<Plus size={13} />}
                        onClick={() => editActive((geometry) => addSeatToRow(geometry, singleRow))}
                        title='Добавить место в конец этого ряда'
                      >
                        Место
                      </Button>
                      <Button
                        kind='danger'
                        icon={<Trash2 size={13} />}
                        onClick={() => {
                          editActive((geometry) => removeRow(geometry, singleRow));
                          setSelection([]);
                        }}
                        title='Удалить этот ряд со всеми его местами'
                      >
                        Удалить ряд
                      </Button>
                    </div>
                  </>
                ) : (
                  <Note tone='info'>
                    Выбраны места из разных рядов — перенумерация и подпись доступны при выборе мест
                    одного ряда.
                  </Note>
                )}

                {selection.length === 1 && (() => {
                  const singleSeat = flattenZone(active.geometry).find((s) => s.slot === selection[0]);
                  if (!singleSeat) return null;
                  return (
                    <div className='pair' style={{ marginTop: 8, marginBottom: 8 }}>
                      <Numeric
                        label='Позиция X, м'
                        value={Math.round(singleSeat.x / 10) / 100}
                        step={0.05}
                        onChange={(val) => {
                          const targetX = Math.round(val * 1_000);
                          editActive((geometry) => setSeatPosition(geometry, selection[0], targetX, singleSeat.y));
                        }}
                      />
                      <Numeric
                        label='Позиция Y, м'
                        value={Math.round(singleSeat.y / 10) / 100}
                        step={0.05}
                        onChange={(val) => {
                          const targetY = Math.round(val * 1_000);
                          editActive((geometry) => setSeatPosition(geometry, selection[0], singleSeat.x, targetY));
                        }}
                      />
                    </div>
                  );
                })()}

                <div className='field'>
                  <label>Поворот мест</label>
                  <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                    {[0, 90, 180, 270].map((deg) => (
                      <button
                        key={deg}
                        type='button'
                        className='btn btn-studio'
                        onClick={() =>
                          editActive((geometry) =>
                            rotateSeats(geometry, selection, Math.round(deg * 1_000)),
                          )
                        }
                      >
                        {deg}°
                      </button>
                    ))}
                  </div>
                  <Numeric
                    label='Точный угол (градусы 0–359)'
                    value={selectionRotation === null ? null : selectionRotation / 1_000}
                    placeholder='Смешанные значения'
                    min={0}
                    max={359}
                    onChange={(value) =>
                      editActive((geometry) =>
                        rotateSeats(geometry, selection, Math.round(value * 1_000)),
                      )
                    }
                  />
                </div>

                {/* Удаление выбранных мест — только на холсте (плавающая панель
                    выделения, кнопка «Удалить», Delete): пространственное действие,
                    одинаковое по составу с ним, здесь не дублируется. */}
              </div>
            </details>
          ) : null}

          {active && singleRow !== null ? (
            <details className='inspector-section'>
              <summary>Свойства ряда {active.geometry.rows[singleRow].label}</summary>
              <div className='inspector-section-body'>
                <PropertiesEditor
                  title={`Свойства ряда ${active.geometry.rows[singleRow].label}`}
                  hint='Места этого ряда наследуют эти значения. Не переопределённые свойства берутся из зоны.'
                  properties={active.geometry.rows[singleRow].properties}
                  inherited={inheritedTitles(
                    resolveProperties(
                      null,
                      active.geometry.rows[singleRow].properties,
                      active.geometry.properties,
                      props.hall.properties,
                    ),
                  )}
                  onChange={(properties) =>
                    editActive((geometry) =>
                      setRowProperties(geometry, singleRow, properties),
                    )
                  }
                />
              </div>
            </details>
          ) : null}

          {active && selection.length > 0 && selectionProperties ? (
            <details className='inspector-section'>
              <summary>
                Свойства мест
                <span className='inspector-section-count'>{selection.length}</span>
              </summary>
              <div className='inspector-section-body'>
                <PropertiesEditor
                  title={`Свойства мест (${selection.length})`}
                  hint='Индивидуальные значения выбранных мест. Не переопределённые свойства берутся из ряда или зоны.'
                  properties={
                    selection.length === 1
                      ? seats[selection[0]]?.properties
                      : undefined
                  }
                  inherited={inheritedTitles(selectionProperties)}
                  onChange={(properties) =>
                    editActive((geometry) =>
                      setSeatProperties(geometry, selection, properties),
                    )
                  }
                />
              </div>
            </details>
          ) : null}
        </aside>
      </div>

      {/* Confirmation Modal */}
      {confirmZone && active ? (
        <Modal
          title='Убрать зону из схемы'
          onClose={() => setConfirmZone(false)}
          footer={
            <>
              <Button onClick={() => setConfirmZone(false)} disabled={zoneDeleteBusy}>
                Отмена
              </Button>
              <Button
                kind='danger'
                icon={<Trash2 size={14} />}
                disabled={zoneDeleteBusy}
                onClick={confirmDeleteZone}
              >
                {zoneDeleteBusy ? 'Удаляем…' : 'Убрать зону'}
              </Button>
            </>
          }
        >
          <p style={{ marginBottom: 14 }}>
            Зона <strong>«{active.geometry.name}»</strong> будет удалена из черновика схемы.
          </p>
          {active.isNew ? (
            <Note tone='info'>Зона ещё не сохранена на сервере и будет сразу исключена.</Note>
          ) : (
            <Note tone='warn'>
              Сервер сразу допишет новую редакцию черновика без этой зоны. История и места
              зоны в прежних редакциях сохранятся, но вернуть зону в текущий черновик будет
              нельзя.
            </Note>
          )}
        </Modal>
      ) : null}

      {/* Отчёт проверки схемы (артефакт 14 §11) */}
      {review ? (
        <Modal
          wide
          title='Проверка схемы'
          subtitle={review.length === 0
            ? 'Замечаний нет'
            : `Критических: ${review.filter((finding) => finding.level === 'critical').length} · `
              + `предупреждений: ${review.filter((finding) => finding.level === 'warning').length}`}
          onClose={() => { setReview(null); setServerReview(null); }}
          footer={
            <>
              <Button onClick={() => setReview(null)}>Закрыть</Button>
              {hasCritical(review) ? null : (
                <Button
                  kind='primary'
                  icon={<Save size={14} />}
                  onClick={() => {
                    setConfirmedWarnings(warningSignature(review));
                    setReview(null);
                    void writeZones();
                  }}
                >
                  {review.length
                    ? 'Подтвердить и сохранить'
                    : 'Сохранить'}
                </Button>
              )}
            </>
          }
        >
          {hasCritical(review) ? (
            <Note tone='warn'>
              Критические нарушения блокируют сохранение: схема остаётся черновиком, пока они
              не исправлены. Предупреждения сохранить можно, подтвердив их явно.
            </Note>
          ) : null}

          {review.length === 0 ? (
            <Note tone='ok'>Схема прошла проверку: дублей адресов, наложений зон и мест, пересечений рядов и мест вне контура нет.</Note>
          ) : (
            <div className='table-wrap'>
              <table className='table small'>
                <thead>
                  <tr>
                    <th style={{ width: 120 }}>Уровень</th>
                    <th style={{ width: 200 }}>Проверка</th>
                    <th>Что найдено</th>
                    <th style={{ width: 90 }} />
                  </tr>
                </thead>
                <tbody>
                  {review.map((finding, index) => (
                    <tr key={`${finding.code}-${finding.zoneId}-${index}`}
                      className={finding.level === 'critical' ? 'failed' : undefined}>
                      <td>
                        <Badge tone={finding.level === 'critical' ? 'danger' : 'warning'}>
                          {finding.level === 'critical' ? 'Критическая' : 'Предупреждение'}
                        </Badge>
                      </td>
                      <td className='mono'>{finding.code}</td>
                      <td>{finding.message}</td>
                      <td>
                        <button
                          type='button'
                          className='link'
                          onClick={() => {
                            setActiveZoneId(finding.zoneId);
                            setSelection([]);
                            controller.current?.focusZone(finding.zoneId);
                            setReview(null);
                          }}
                        >
                          Показать
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/*
            Валидатор принадлежит ядру, а не редактору (§11): здешний проход показывает
            находки во время правки, но последнее слово за сервером по сохранённой редакции.
          */}
          <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <Button
              kind='secondary'
              icon={<ShieldCheck size={14} />}
              disabled={serverCheck.busy}
              onClick={() => void serverCheck.run(async () => {
                const result = await api.validateConfiguration(props.hall.id);
                setServerReview(result);
                return result;
              })}
            >
              {serverCheck.busy ? 'Сверяем с сервером…' : 'Сверить с сервером'}
            </Button>
            <span className='inspector-note'>
              Сервер проверяет сохранённую редакцию, а не текущий черновик на холсте.
            </span>
          </div>

          <Problem error={serverCheck.error} />

          {serverReview ? (
            <Note tone={serverReview.isTruncated || serverReview.findings.length ? 'warn' : 'ok'}>
              {serverReview.revision === null
                ? 'Состав ещё не сохранён: проверять на сервере пока нечего.'
                : serverReview.isTruncated
                  ? `Ядро проверило редакцию ${serverReview.revision}: показаны первые ${serverReview.findings.length} находок. Отчёт усечён; проверить всю схему по нему нельзя.`
                : serverReview.findings.length === 0
                  ? `Ядро проверило редакцию ${serverReview.revision}: замечаний нет.`
                  : `Ядро проверило редакцию ${serverReview.revision} и нашло ${serverReview.findings.length}:`}
              {serverReview.findings.length ? (
                <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>
                  {serverReview.findings.map((finding, index) => (
                    <li key={`${finding.code}-${finding.zoneId}-${index}`}>
                      <span className='mono'>{finding.code}</span> — {finding.message}
                    </li>
                  ))}
                </ul>
              ) : null}
            </Note>
          ) : null}

          <p className='inspector-note' style={{ marginTop: 12 }}>
            Расхождение вместимости не проверяется: заявленной вместимости у конфигурации
            в контракте нет. Подвижные элементы и уровень идентификации импорта в контракте
            тоже отсутствуют.
          </p>
        </Modal>
      ) : null}

      {/* Hotkeys Shortcuts Dialog */}
      {showShortcuts ? (
        <Modal
          title='Горячие клавиши Seating Studio'
          subtitle='Перемещение и масштаб работают, когда холст в фокусе: щёлкните по нему или дойдите клавишей Tab.'
          onClose={() => setShowShortcuts(false)}
          footer={<Button kind='primary' onClick={() => setShowShortcuts(false)}>Понятно</Button>}
        >
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 20px', fontSize: 13 }}>
            {[
              ['V', 'Инструмент «Выбор»'],
              ['Z', 'Инструмент «Зона»'],
              ['R', 'Инструмент «Ряд»'],
              ['S', 'Инструмент «Место»'],
              ['T', 'Инструмент «Стол»'],
              ['Стрелки', 'Перемещение по холсту (фокус на холсте)'],
              ['+ / −', 'Приближение и отдаление'],
              ['[ / ]', 'Переход между зонами'],
              ['Пробел + перетаскивание', 'Панорамирование любым инструментом'],
              ['Shift при перетаскивании', 'Движение строго по оси'],
              ['Alt при перетаскивании', 'Временно без привязки к сетке'],
              ['Del / Backspace', 'Удалить выбранные места'],
              ['Esc', 'Снять выбор'],
              ['Ctrl + Z', 'Отменить действие'],
              ['Ctrl + Shift + Z', 'Вернуть действие'],
            ].map(([key, title]) => (
              <div key={key}>
                <kbd style={{ background: 'var(--line-subtle)', padding: '2px 6px', borderRadius: 4, border: '1px solid var(--line)' }}>
                  {key}
                </kbd>
                <span style={{ marginLeft: 8 }}>{title}</span>
              </div>
            ))}
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
