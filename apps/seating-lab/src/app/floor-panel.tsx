import { useCallback, useEffect, useRef, useState } from 'react';
import { ImageOff, Image as ImageIcon, Pencil, Plus } from 'lucide-react';
import { ResponseException } from 'pdfjs-dist';
import { type FloorBackgroundTransform, type FloorCalibration, type FloorPlacement,
  type SeatingConfigurationResult, type SeatingFloorResult, formatLength, newIdempotencyKey } from '@tickets/seating';
import { useLab } from './state';
import { BackgroundWizard } from './background-wizard';
import { Button, Note, Spinner } from './ui';
import { pdfCalibrationTransform, renderPdfPage, type RenderedPdfPage } from './pdf-background';

const pdfUrlRenewalMarginMs = 60_000;

function pdfLoadMessage(reason: unknown): string {
  if (reason instanceof ResponseException) {
    return reason.status === 403
      ? 'Не удалось загрузить PDF-план после обновления ссылки. Повторите загрузку.'
      : `Не удалось загрузить PDF-план (HTTP ${reason.status}). Повторите загрузку.`;
  }
  return reason instanceof Error ? reason.message : String(reason);
}

/**
 * Боковая панель этажа намеренно коротка: раньше здесь жила вся работа с PDF —
 * загрузка, страница, превью и калибровка, — и список зон уезжал за пределы окна.
 * Подложка переехала в отдельное окно-мастер.
 */
export function FloorPanel(props: {
  configurationId: string;
  configurationVersion: number;
  selectedFloorId: string;
  onFloorSelect: (floorId: string) => void;
  otherDirtyZoneCount: number;
  onFloorsChange?: (floors: SeatingFloorResult[]) => void;
  onConfigurationChange: (configuration: SeatingConfigurationResult) => void;
  onBackgroundChange: (canvas: HTMLCanvasElement | null, transform: FloorBackgroundTransform | null) => void;
  calibrationRequest?: number;
}) {
  const { api } = useLab();
  const { configurationId, selectedFloorId, onFloorSelect, onBackgroundChange, onFloorsChange } = props;
  const [floors, setFloors] = useState<SeatingFloorResult[]>([]);
  const [name, setName] = useState('');
  const [rename, setRename] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [creating, setCreating] = useState(false);
  const [rendered, setRendered] = useState<RenderedPdfPage | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState('');
  const [pdfRetry, setPdfRetry] = useState(0);
  const pdfRefresh = useRef({ key: '', beforeExpiry: false, afterForbidden: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [wizard, setWizard] = useState(false);
  const [wizardMethod, setWizardMethod] = useState<'distance' | 'seats' | undefined>();
  useEffect(() => {
    if (props.calibrationRequest) {
      setWizardMethod('seats');
      setWizard(true);
    }
  }, [props.calibrationRequest]);
  const [pendingPdfs, setPendingPdfs] = useState<Array<{
    configurationId: string;
    floorId: string;
    floorVersion: number;
    fileId: string;
    fileName: string;
    idempotencyKey: string;
  }>>([]);
  const selected = floors.find((floor) => floor.id === selectedFloorId)
    ?? floors.find((floor) => floor.isDefault) ?? floors[0] ?? null;
  const floorsRef = useRef(floors);
  floorsRef.current = floors;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  const selectedFloorIdRef = useRef(selected?.id ?? selectedFloorId);
  selectedFloorIdRef.current = selected?.id ?? selectedFloorId;
  const configurationIdRef = useRef(configurationId);
  configurationIdRef.current = configurationId;
  const onFloorSelectRef = useRef(onFloorSelect);
  onFloorSelectRef.current = onFloorSelect;
  const onFloorsChangeRef = useRef(onFloorsChange);
  onFloorsChangeRef.current = onFloorsChange;

  const pendingPdf = pendingPdfs.find((pending) =>
    pending.configurationId === configurationId && pending.floorId === selected?.id,
  ) ?? null;

  const reload = useCallback(async (keepId?: string) => {
    const items: SeatingFloorResult[] = [];
    let offset = 0;
    let totalItems = 0;
    do {
      const page = await api.listFloors(configurationId, {
        offset, limit: 200, sortBy: 'Id', sortDirection: 'Asc',
      });
      items.push(...page.items);
      totalItems = page.totalItems;
      offset += page.items.length;
    } while (offset < totalItems && offset > 0);
    setFloors(items);
    onFloorsChangeRef.current?.(items);
    const preferred = keepId ?? selectedFloorIdRef.current;
    const next = items.some((floor) => floor.id === preferred)
      ? preferred : items.find((floor) => floor.isDefault)?.id ?? items[0]?.id ?? '';
    if (next && next !== selectedFloorIdRef.current) onFloorSelectRef.current(next);
  }, [api, configurationId]);

  useEffect(() => {
    void reload().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, [configurationId, reload]);

  useEffect(() => {
    setRendered(null);
    // Drop the previously selected floor's image while this floor's PDF loads.
    onBackgroundChange(null, null);
    setError('');
    setRename(selectedRef.current?.name ?? '');
    const currentFloor = selectedRef.current;
    const currentBackground = currentFloor?.background;
    if (!currentFloor || !currentBackground?.file.url) {
      setPdfLoading(false);
      setPdfError('');
      return;
    }
    setPdfLoading(true);
    setPdfError('');
    let cancelled = false;
    const refreshKey = `${configurationId}:${currentFloor.id}:${currentBackground.page}:${pdfRetry}`;
    if (pdfRefresh.current.key !== refreshKey) {
      pdfRefresh.current = { key: refreshKey, beforeExpiry: false, afterForbidden: false };
    }
    const attempts = pdfRefresh.current;
    const refreshFloor = async (): Promise<boolean> => {
      const fresh = await api.getFloor(configurationId, currentFloor.id);
      if (cancelled) return true;
      if (fresh.background?.file.url === currentBackground.file.url) return false;
      setFloors((items) => items.map((floor) => floor.id === fresh.id ? fresh : floor));
      onFloorsChangeRef.current?.(floorsRef.current.map((floor) => floor.id === fresh.id ? fresh : floor));
      return true;
    };
    const loadPdf = async () => {
      const expiresAt = Date.parse(currentBackground.file.urlExpiresAt);
      if (Number.isFinite(expiresAt) && expiresAt <= Date.now() + pdfUrlRenewalMarginMs
        && !attempts.beforeExpiry) {
        const refreshed = await refreshFloor();
        if (cancelled) return;
        attempts.beforeExpiry = true;
        if (refreshed) return;
      }
      try {
        return await renderPdfPage(currentBackground.file.url, currentBackground.page);
      } catch (reason) {
        if (cancelled) return;
        if (reason instanceof ResponseException && reason.status === 403
          && !attempts.afterForbidden) {
          const refreshed = await refreshFloor();
          if (cancelled) return;
          attempts.afterForbidden = true;
          if (refreshed) return;
        }
        throw reason;
      }
    };
    void loadPdf()
      .then((page) => {
        if (!page || cancelled) return;
        setRendered(page);
        setPdfLoading(false);
        const transform = currentBackground.calibration
          ? pdfCalibrationTransform(page.viewport, currentBackground.calibration, currentBackground.placement)
          : null;
        onBackgroundChange(transform ? page.canvas : null, transform);
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          const message = pdfLoadMessage(reason);
          setPdfError(message);
          setError(message);
          setPdfLoading(false);
          onBackgroundChange(null, null);
        }
      });
    return () => { cancelled = true; };
  }, [api, configurationId, selected?.id, selected?.background?.file.url,
    selected?.background?.file.urlExpiresAt, selected?.background?.page,
    selected?.background?.calibration, selected?.background?.placement, selected?.name, onBackgroundChange, pdfRetry]);

  async function finishChange(keepId: string) {
    const configuration = await api.getConfiguration(props.configurationId);
    props.onConfigurationChange(configuration);
    await reload(keepId);
  }

  async function createFloor() {
    const floorName = name.trim();
    if (!floorName) return;
    setBusy(true); setError('');
    try {
      const floor = await api.createFloor(props.configurationId,
        { expectedVersion: props.configurationVersion, name: floorName }, newIdempotencyKey());
      setName('');
      setCreating(false);
      await finishChange(floor.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally { setBusy(false); }
  }

  async function updateFloor(change: {
    name?: string;
    background?: { file?: string; page?: number; calibration?: FloorCalibration | null;
      placement?: Partial<FloorPlacement> } | null;
  }) {
    if (!selected) return;
    setBusy(true); setError('');
    try {
      await api.updateFloor(props.configurationId, selected.id,
        { expectedFloorVersion: selected.versions.floorVersion, ...change }, newIdempotencyKey());
      await finishChange(selected.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally { setBusy(false); }
  }

  async function saveUploadedPdf(pending: NonNullable<typeof pendingPdf>) {
    if (pending.configurationId !== configurationIdRef.current || pending.floorId !== selectedFloorIdRef.current) return;
    setBusy(true); setError('');
    try {
      await api.updateFloor(pending.configurationId, pending.floorId, {
        expectedFloorVersion: pending.floorVersion,
        background: { file: pending.fileId, page: 1, calibration: null },
      }, pending.idempotencyKey);
      if (configurationIdRef.current !== pending.configurationId) {
        return;
      }
      if (selectedFloorIdRef.current !== pending.floorId) {
        await reload();
        setPendingPdfs((current) => current.filter((item) => item.idempotencyKey !== pending.idempotencyKey));
        return;
      }
      await finishChange(pending.floorId);
      setPendingPdfs((current) => current.filter((item) => item.idempotencyKey !== pending.idempotencyKey));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally { setBusy(false); }
  }

  async function attachPdf(file: File) {
    if (!selected) return;
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setError('Выберите файл PDF.'); return;
    }
    setBusy(true); setError('');
    try {
      const fileId = await api.uploadFile(file, newIdempotencyKey(), 'application/pdf');
      const pending = {
        configurationId: props.configurationId,
        floorId: selected.id,
        floorVersion: selected.versions.floorVersion,
        fileId,
        fileName: file.name,
        idempotencyKey: newIdempotencyKey(),
      };
      setPendingPdfs((current) => [
        ...current.filter((item) => item.configurationId !== pending.configurationId || item.floorId !== pending.floorId),
        pending,
      ]);
      if (configurationIdRef.current === pending.configurationId && selectedFloorIdRef.current === pending.floorId) {
        await saveUploadedPdf(pending);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally { setBusy(false); }
  }

  const millimetresPerPixel = rendered && selected?.background?.calibration
    ? pdfCalibrationTransform(rendered.viewport, selected.background.calibration,
      selected.background.placement)?.scale ?? null
    : null;

  return <section className='floor-panel' aria-label='Этаж и подложка'>
    <div className='floor-panel-title'>Этаж</div>

    {floors.length ? (
      <select aria-label='Этаж' value={selected?.id ?? ''} disabled={busy} onChange={(event) => onFloorSelect(event.target.value)}>
        {floors.map((floor) => <option key={floor.id} value={floor.id}>{floor.name}</option>)}
      </select>
    ) : (
      <Note>Создайте этаж, чтобы начать схему. Существующие зоны останутся на этаже по умолчанию.</Note>
    )}

    {props.otherDirtyZoneCount ? (
      <Note tone='warn'>
        Есть {props.otherDirtyZoneCount} несохранённых зон на других этажах. Вернитесь на них, чтобы сохранить правки.
      </Note>
    ) : null}

    {creating ? (
      <div className='floor-panel-create'>
        <input
          aria-label='Название нового этажа'
          value={name}
          autoFocus
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') void createFloor(); }}
          placeholder='Например, Балкон'
          maxLength={200}
        />
        <Button disabled={busy || !name.trim()} onClick={() => void createFloor()}>Создать</Button>
        <Button kind='ghost' onClick={() => { setCreating(false); setName(''); }}>Отмена</Button>
      </div>
    ) : renaming && selected ? (
      <div className='floor-panel-create'>
        <input
          aria-label='Название этажа'
          value={rename}
          autoFocus
          onChange={(event) => setRename(event.target.value)}
          maxLength={200}
        />
        <Button
          disabled={busy || !rename.trim() || rename.trim() === selected.name}
          onClick={() => { void updateFloor({ name: rename.trim() }); setRenaming(false); }}
        >
          Имя
        </Button>
        <Button kind='ghost' onClick={() => { setRenaming(false); setRename(selected.name); }}>Отмена</Button>
      </div>
    ) : (
      <div className='floor-panel-create'>
        <Button kind='secondary' icon={<Plus size={13} />} onClick={() => setCreating(true)}>Этаж</Button>
        {selected ? (
          <Button kind='ghost' icon={<Pencil size={13} />} onClick={() => setRenaming(true)} title='Переименовать этаж' />
        ) : null}
      </div>
    )}

    {selected ? (
      <>
        <div className='floor-panel-summary'>
          {selected.background ? <ImageIcon size={13} /> : <ImageOff size={13} />}
          <span title={selected.background?.file.fileName}>
            {!selected.background
              ? 'Плана нет'
              : !selected.background?.calibration
                ? 'План без масштаба'
                : millimetresPerPixel !== null
                  ? `1 пкс плана = ${formatLength(millimetresPerPixel)}`
                  : 'План загружен'}
          </span>
        </div>
        <Button kind='secondary' full onClick={() => { setWizardMethod(undefined); setWizard(true); }}>
          {selected.background ? 'Настроить подложку…' : 'Загрузить план помещения…'}
        </Button>
        {selected.background && !selected.background.calibration ? (
          <Note tone='warn'>Пока не задан масштаб, план под схемой не показывается.</Note>
        ) : null}
        {pendingPdf && pendingPdf.configurationId === configurationId && pendingPdf.floorId === selected.id && !busy ? (
          <Note tone='warn'>
            PDF загружен: {pendingPdf.fileName} · ID {pendingPdf.fileId}. Сохранение подложки не завершилось.
            <Button kind='secondary' onClick={() => void saveUploadedPdf(pendingPdf)}>
              Повторить прикрепление PDF
            </Button>
          </Note>
        ) : null}
      </>
    ) : null}

    {error ? <p className='floor-error' role='alert'>{error}</p> : null}
    {busy ? <Spinner label='Сохраняем этаж…' /> : null}

    {wizard && selected ? (
      <BackgroundWizard
        floor={selected}
        initialMethod={wizardMethod}
        rendered={rendered}
        pdfLoading={pdfLoading}
        pdfError={pdfError}
        busy={busy}
        error={error}
        onClose={() => setWizard(false)}
        onAttach={(file) => void attachPdf(file)}
        onDetach={() => void updateFloor({ background: null })}
        onPageChange={(page) => void updateFloor({ background: { page } })}
        onCalibrate={(calibration, placement) => void updateFloor({ background: { calibration, placement } })}
        onRetry={() => {
          pdfRefresh.current.key = '';
          setPdfRetry((current) => current + 1);
          void reload(selected.id).catch((reason: unknown) =>
            setPdfError(reason instanceof Error ? reason.message : String(reason)));
        }}
      />
    ) : null}
  </section>;
}
