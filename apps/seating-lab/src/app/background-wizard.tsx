import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { RotateCcw, Upload } from 'lucide-react';
import {
  formatLength, formatMetres, SEATING_THEME,
  type FloorCalibration, type FloorCalibrationPoint, type SeatingFloorResult,
} from '@tickets/seating';

import { Button, Modal, Note, Spinner } from './ui';
import { pdfCalibrationTransform, pointAtCanvasPosition, type RenderedPdfPage } from './pdf-background';
import { calibrationFromPoints, distanceBySeats } from './configurator-background';

type Step = 'file' | 'calibrate' | 'check';
const normalizeDegrees = (value: number) => ((value + 180) % 360 + 360) % 360 - 180;

const stepTitles: { id: Step; index: string; title: string; hint: string }[] = [
  { id: 'file', index: 'Шаг 1', title: 'План', hint: 'PDF и его страница' },
  { id: 'calibrate', index: 'Шаг 2', title: 'Масштаб', hint: 'точки, кресла и поворот' },
  { id: 'check', index: 'Шаг 3', title: 'Проверка', hint: 'что получилось' },
];

/**
 * Что такое подложка и зачем она. Раньше этого не было сказано нигде, и работа
 * с PDF выглядела набором полей без объяснения.
 */
export const backgroundPurpose =
  'Подложка — это план помещения в PDF, по которому вы обводите зоны и размечаете ряды. '
  + 'Сервер по ней ничего не создаёт: ни зон, ни рядов, ни мест. Калибровка говорит, '
  + 'сколько метров зала приходится на план, чтобы нарисованная схема совпала с ним по размеру.';

export interface BackgroundWizardProps {
  floor: SeatingFloorResult;
  rendered: RenderedPdfPage | null;
  pdfLoading: boolean;
  pdfError: string;
  busy: boolean;
  error: string;
  onClose: () => void;
  onAttach: (file: File) => void;
  onDetach: () => void;
  onPageChange: (page: number) => void;
  onCalibrate: (calibration: FloorCalibration | null, placement: { originX: number; originY: number; rotationDegrees: number }) => void;
  onRetry: () => void;
  initialMethod?: 'distance' | 'seats';
}

export function BackgroundWizard(props: BackgroundWizardProps) {
  const { floor, rendered } = props;
  const [step, setStep] = useState<Step>(props.initialMethod ? 'calibrate' : floor.background ? (floor.background.calibration ? 'check' : 'calibrate') : 'file');
  const [method, setMethod] = useState<'distance' | 'seats'>(props.initialMethod ?? 'distance');
  const [point1, setPoint1] = useState<FloorCalibrationPoint | null>(floor.background?.calibration?.point1 ?? null);
  const [point2, setPoint2] = useState<FloorCalibrationPoint | null>(floor.background?.calibration?.point2 ?? null);
  const [distanceMetres, setDistanceMetres] = useState(floor.background?.calibration?.distanceMeters ?? 10);
  const [seatCount, setSeatCount] = useState(5);
  const [seatStepMm, setSeatStepMm] = useState(500);
  const [rotation, setRotation] = useState(floor.background?.placement.rotationDegrees ?? 0);
  const [originX, setOriginX] = useState(floor.background?.placement.originX ?? 0);
  const [originY, setOriginY] = useState(floor.background?.placement.originY ?? 0);
  const [alignLine, setAlignLine] = useState(false);
  const [pageNumber, setPageNumber] = useState(floor.background?.page ?? 1);
  const stage = useRef<HTMLCanvasElement>(null);
  const rotatedStage = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    setPoint1(floor.background?.calibration?.point1 ?? null);
    setPoint2(floor.background?.calibration?.point2 ?? null);
    setDistanceMetres(floor.background?.calibration?.distanceMeters ?? 10);
    setRotation(floor.background?.placement.rotationDegrees ?? 0);
    setOriginX(floor.background?.placement.originX ?? 0);
    setOriginY(floor.background?.placement.originY ?? 0);
    setPageNumber(floor.background?.page ?? 1);
  }, [floor.id, floor.background, rendered]);

  const measuredMetres = method === 'seats' ? distanceBySeats(seatCount, seatStepMm) : distanceMetres;
  const validPoints = Boolean(point1 && point2 && Math.hypot(point1.x - point2.x, point1.y - point2.y) > 0);
  const chosen: FloorCalibration | null = rendered && point1 && point2 && validPoints
    && measuredMetres !== null && Number.isFinite(measuredMetres) && measuredMetres > 0
    ? calibrationFromPoints(point1, point2, measuredMetres)
    : null;
  const applied = chosen ?? (step === 'check' ? floor.background?.calibration ?? null : null);
  const placement = { originX, originY, rotationDegrees: ((rotation % 360) + 360) % 360 };
  const transform = rendered && applied ? pdfCalibrationTransform(rendered.viewport, applied, placement) : null;
  const millimetresPerPixel = transform?.scale ?? null;
  const previewPixels = millimetresPerPixel ? seatStepMm / millimetresPerPixel : null;

  useEffect(() => {
    const canvas = rotatedStage.current;
    if (!canvas || !rendered) return;
    canvas.width = rendered.canvas.width;
    canvas.height = rendered.canvas.height;
    const context = canvas.getContext('2d');
    if (!context) return;
    const origin = point1 ? rendered.viewport.convertToViewportPoint(point1.x, point1.y) : [canvas.width / 2, canvas.height / 2];
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.translate(origin[0], origin[1]);
    context.rotate(rotation * Math.PI / 180);
    context.drawImage(rendered.canvas, -origin[0], -origin[1]);
  }, [rendered, rotation, point1, step]);

  // Отрисовка страницы с маркерами точек и линией между ними: без неё щелчок по плану
  // превращается в угадывание, куда именно попал курсор.
  useEffect(() => {
    const target = stage.current;
    if (!target || !rendered) return;
    target.width = rendered.canvas.width;
    target.height = rendered.canvas.height;
    const context = target.getContext('2d');
    if (!context) return;
    context.drawImage(rendered.canvas, 0, 0);
    const viewportOf = (point: FloorCalibrationPoint) => rendered.viewport.convertToViewportPoint(point.x, point.y);
    const radius = Math.max(9, Math.round(rendered.canvas.width / 90));

    if (point1 && point2) {
      const [x1, y1] = viewportOf(point1);
      const [x2, y2] = viewportOf(point2);
      context.save();
      context.strokeStyle = '#0f172a';
      context.lineWidth = Math.max(2, radius / 4);
      context.setLineDash([radius, radius / 2]);
      context.beginPath();
      context.moveTo(x1, y1);
      context.lineTo(x2, y2);
      context.stroke();
      context.restore();

      const label = method === 'seats' ? `${seatCount} мест · ${seatStepMm} мм` : `${distanceMetres} м`;
      context.font = `bold ${radius * 1.6}px Inter, Arial, sans-serif`;
      const width = context.measureText(label).width;
      const midX = (x1 + x2) / 2;
      const midY = (y1 + y2) / 2;
      context.fillStyle = 'rgba(15, 23, 42, 0.9)';
      context.fillRect(midX - width / 2 - 6, midY - radius * 1.4, width + 12, radius * 2.2);
      context.fillStyle = '#ffffff';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(label, midX, midY - radius * 0.3);
    }

    if (point1 && previewPixels && millimetresPerPixel && Number.isFinite(previewPixels)) {
      const [x, y] = viewportOf(point1);
      const angle = rotation * Math.PI / 180;
      const diameter = SEATING_THEME.geometry.seatDiameterMm / millimetresPerPixel;
      context.save();
      context.translate(x, y + Math.max(radius * 3, diameter));
      context.rotate(-angle);
      for (let index = 0; index < 5; index++) {
        context.beginPath();
        context.arc(index * previewPixels, 0, diameter * 0.42, 0, Math.PI * 2);
        context.fillStyle = 'rgba(37, 99, 235, 0.55)';
        context.fill();
        context.strokeStyle = '#ffffff';
        context.lineWidth = Math.max(1, diameter * 0.06);
        context.stroke();
      }
      context.restore();
      context.fillStyle = '#0f172a';
      context.font = `bold ${Math.max(12, radius * 1.1)}px Inter, Arial, sans-serif`;
      context.textAlign = 'left';
      context.fillText(`кресло 500 мм = ${Math.round(500 / millimetresPerPixel)} пкс плана`, Math.max(8, x), Math.max(18, y + radius * 5));
    }

    for (const [point, color, mark] of [[point1, '#f15a3b', '1'], [point2, '#2474db', '2']] as const) {
      if (!point) continue;
      const [x, y] = viewportOf(point);
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.fillStyle = color;
      context.fill();
      context.lineWidth = Math.max(2, radius / 5);
      context.strokeStyle = '#ffffff';
      context.stroke();
      context.fillStyle = '#ffffff';
      context.font = `bold ${radius * 1.2}px Inter, Arial, sans-serif`;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(mark, x, y);
    }
    // `step` в зависимостях обязателен: холст превью появляется в разметке только
    // на шаге калибровки, и без перерисовки при смене шага он остаётся пустым.
  }, [rendered, point1, point2, distanceMetres, seatCount, seatStepMm, method, rotation, previewPixels, millimetresPerPixel, step]);

  function pick(event: MouseEvent<HTMLCanvasElement>) {
    if (!rendered) return;
    const point = pointAtCanvasPosition(rendered.viewport, event.currentTarget, event.clientX, event.clientY);
    setAlignLine(false);
    if (!point1 || point2) {
      setPoint1(point);
      setPoint2(null);
    } else {
      setPoint2(point);
    }
  }

  // Масштаб подложки: сколько миллиметров зала приходится на один пиксель страницы.
  const pageWidthMm = transform && rendered ? rendered.canvas.width * transform.scale : null;
  const pageHeightMm = transform && rendered ? rendered.canvas.height * transform.scale : null;
  const implausible = pageWidthMm !== null && (pageWidthMm < 3_000 || pageWidthMm > 500_000);

  const canCalibrate = Boolean(floor.background);

  return (
    <Modal
      wide
      title={`Подложка этажа «${floor.name}»`}
      subtitle='План помещения, по которому размечается схема'
      onClose={props.onClose}
      footer={<Button kind='primary' onClick={props.onClose}>Готово</Button>}
    >
      <div className='bg-wizard-steps'>
        {stepTitles.map((item) => (
          <button
            key={item.id}
            type='button'
            className={`bg-wizard-step ${step === item.id ? 'on' : ''}`}
            disabled={item.id !== 'file' && !canCalibrate}
            onClick={() => setStep(item.id)}
          >
            <span className='bg-wizard-step-index'>{item.index}</span>
            <b>{item.title}</b>
            <span>{item.hint}</span>
          </button>
        ))}
      </div>

      {step === 'file' ? (
        <>
          <Note>{backgroundPurpose}</Note>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
            <label className='floor-upload btn btn-secondary'>
              <Upload size={14} /> {floor.background ? 'Заменить PDF' : 'Загрузить PDF'}
              <input
                type='file'
                accept='application/pdf,.pdf'
                disabled={props.busy}
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  if (file) props.onAttach(file);
                  event.currentTarget.value = '';
                }}
              />
            </label>
            {floor.background ? (
              <Button kind='ghost' disabled={props.busy} onClick={props.onDetach}>Удалить PDF</Button>
            ) : null}
          </div>

          {floor.background ? (
            <>
              <div className='floor-pdf-meta' style={{ marginBottom: 12 }}>
                {floor.background.file.fileName} · страница {floor.background.page}
                {rendered ? ` из ${rendered.numPages}` : ''}
              </div>
              <label className='floor-page' style={{ marginBottom: 12, display: 'grid', gap: 5, maxWidth: 220 }}>
                Страница плана
                <input
                  type='number'
                  min={1}
                  max={rendered?.numPages || undefined}
                  value={pageNumber}
                  disabled={props.busy}
                  onChange={(event) => setPageNumber(Math.max(1, Math.round(Number(event.target.value) || 1)))}
                  onBlur={() => {
                    if (pageNumber !== (floor.background?.page ?? 1)) props.onPageChange(pageNumber);
                  }}
                />
              </label>
              <Button kind='primary' onClick={() => setStep('calibrate')}>Дальше: масштаб</Button>
            </>
          ) : (
            <Note tone='info'>Пока плана нет, схему можно рисовать по сетке: она размечена в метрах зала.</Note>
          )}
        </>
      ) : null}

      {step === 'calibrate' ? (
        <>
          <p className='floor-calibration-help' style={{ marginBottom: 10 }}>
            Отметьте на плане две точки. Расстояние между ними задаст только масштаб.
            Поворот плана настраивается отдельно ниже.
          </p>
          <div className='configurator-calibration-method' role='group' aria-label='Способ калибровки'>
            <Button kind={method === 'distance' ? 'primary' : 'secondary'} onClick={() => setMethod('distance')}>По расстоянию</Button>
            <Button kind={method === 'seats' ? 'primary' : 'secondary'} onClick={() => setMethod('seats')}>По креслам</Button>
          </div>
          <div className='bg-stage'>
            {rendered ? (
              <>
                <canvas ref={stage} onClick={pick} aria-label='План помещения: отметьте две точки' />
                <span className='bg-stage-hint'>
                  {!point1 ? 'Щёлкните первую точку' : !point2 ? 'Щёлкните вторую точку' : 'Точки отмечены'}
                </span>
              </>
            ) : props.pdfLoading ? (
              <Spinner label='Загружаем план…' />
            ) : (
              <div style={{ padding: 24, textAlign: 'center' }}>
                <p role='alert' style={{ marginBottom: 10 }}>{props.pdfError || 'План не загружен.'}</p>
                <Button kind='secondary' disabled={props.busy} onClick={props.onRetry}>Повторить загрузку</Button>
              </div>
            )}
          </div>

          <div className='bg-points'>
            <div className='bg-point'>
              <span className='bg-point-mark' style={{ background: '#f15a3b' }}>1</span>
              <div>
                <b>Первая точка измерения</b>
                {point1 ? `${point1.x}; ${point1.y}` : 'не отмечена'}
              </div>
            </div>
            <div className='bg-point'>
              <span className='bg-point-mark' style={{ background: '#2474db' }}>2</span>
              <div>
                <b>{method === 'seats' ? 'Последнее кресло' : 'Вторая точка'}</b>
                {point2 ? `${point2.x}; ${point2.y}` : 'не отмечена'}
              </div>
            </div>
          </div>

          {method === 'distance' ? (
            <label className='floor-page configurator-field'>
              Расстояние между точками, метров
              <input type='number' min={0.01} step={0.01} value={distanceMetres}
                onChange={(event) => setDistanceMetres(Number(event.target.value))} />
            </label>
          ) : (
            <div className='configurator-calibration-fields'>
              <label className='floor-page configurator-field'>Число мест от первого до последнего
                <input type='number' min={2} step={1} value={seatCount}
                  onChange={(event) => setSeatCount(Number(event.target.value))} />
              </label>
              <label className='floor-page configurator-field'>Шаг мест, мм
                <input type='number' min={1} step={10} value={seatStepMm}
                  onChange={(event) => setSeatStepMm(Number(event.target.value))} />
              </label>
            </div>
          )}
          {previewPixels && millimetresPerPixel ? <p className='configurator-scale-caption'>кресло 500 мм = {Math.round(500 / millimetresPerPixel)} пкс плана · шаг {seatStepMm} мм = {Math.round(previewPixels)} пкс</p> : null}

          <div className='configurator-rotation-controls'>
            <label className='floor-page configurator-field'>Начало X на схеме, мм
              <input type='number' step={1} value={originX}
                onChange={(event) => setOriginX(Number(event.target.value))} />
            </label>
            <label className='floor-page configurator-field'>Начало Y на схеме, мм
              <input type='number' step={1} value={originY}
                onChange={(event) => setOriginY(Number(event.target.value))} />
            </label>
            <b>Поворот подложки</b>
            <div className='configurator-rotation-row'>
              <Button kind='secondary' onClick={() => { setAlignLine(false); setRotation((value) => normalizeDegrees(value - 90)); }}>−90°</Button>
              <label className='floor-page configurator-field'>Градусы
                <input type='number' step={0.1} value={Math.round(rotation * 10) / 10}
                  onChange={(event) => { setAlignLine(false); setRotation(Number(event.target.value)); }} />
              </label>
              <Button kind='secondary' onClick={() => { setAlignLine(false); setRotation((value) => normalizeDegrees(value + 90)); }}>+90°</Button>
            </div>
            <input aria-label='Поворот подложки, градусы' type='range' min={-180} max={180} step={1}
              value={Math.max(-180, Math.min(180, rotation))}
              onChange={(event) => { setAlignLine(false); setRotation(Number(event.target.value)); }} />
            <label className='configurator-align-line'>
              <input type='checkbox' checked={alignLine} disabled={!point1 || !point2}
                onChange={(event) => {
                  setAlignLine(event.target.checked);
                  if (event.target.checked && rendered && point1 && point2) {
                    const [x1, y1] = rendered.viewport.convertToViewportPoint(point1.x, point1.y);
                    const [x2, y2] = rendered.viewport.convertToViewportPoint(point2.x, point2.y);
                    setRotation(-Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI);
                  }
                }} />
              Выровнять линию между точками по горизонтали
            </label>
          </div>
          {rendered ? <div className='configurator-rotation-preview'>
            <span>Предпросмотр с поворотом {Math.round(rotation * 10) / 10}°</span>
            <canvas ref={rotatedStage} aria-label='План с выбранным поворотом' />
          </div> : null}

          <div className='floor-calibration-actions'>
            <Button
              kind='ghost'
              icon={<RotateCcw size={13} />}
              disabled={!point1 && !point2}
              onClick={() => { setPoint1(null); setPoint2(null); setAlignLine(false); }}
            >
              Сбросить точки
            </Button>
            <Button
              kind='primary'
              disabled={props.busy || !chosen}
              onClick={() => {
                if (chosen) props.onCalibrate(chosen, placement);
                setStep('check');
              }}
            >
              Сохранить масштаб и поворот
            </Button>
          </div>
        </>
      ) : null}

      {step === 'check' ? (
        <>
          {transform && pageWidthMm !== null && pageHeightMm !== null ? (
            <>
              <div className='bg-check'>
                <div><span>Один пиксель плана</span><b>{formatLength(transform.scale)}</b></div>
                <div>
                  <span>Страница целиком</span>
                  <b>{formatMetres(pageWidthMm)} × {formatMetres(pageHeightMm)}</b>
                </div>
                <div>
                  <span>Заявленное расстояние</span>
                  <b>{formatMetres((applied?.distanceMeters ?? 0) * 1_000)}</b>
                </div>
                <div>
                  <span>Поворот плана</span>
                  <b>{Math.round((transform.rotation * 1800) / Math.PI) / 10}°</b>
                </div>
              </div>
              <Button kind='secondary' onClick={() => setStep('calibrate')}>Изменить масштаб или поворот</Button>
              {implausible ? (
                <Note tone='warn'>
                  Судя по масштабу, план получился шириной {formatMetres(pageWidthMm)}. Для помещения
                  это неправдоподобно — обычно ошибка в поле «расстояние между точками» или точки
                  отмечены слишком близко друг к другу. Вернитесь на шаг «Масштаб» и уточните.
                </Note>
              ) : (
                <Note tone='ok'>
                  Масштаб задан. Подложка появится под схемой; её видимость и прозрачность
                  переключаются на холсте.
                </Note>
              )}
            </>
          ) : (
            <Note tone='warn'>
              Масштаб ещё не задан, поэтому подложка под схемой не показывается. Отметьте две точки
              на шаге «Масштаб».
            </Note>
          )}

          {floor.background?.calibration ? (
            <div style={{ marginTop: 12 }}>
              <Button kind='ghost' disabled={props.busy} onClick={() => props.onCalibrate(null, placement)}>
                Снять калибровку
              </Button>
            </div>
          ) : null}
        </>
      ) : null}

      {props.error ? <p className='floor-error' role='alert' style={{ marginTop: 12 }}>{props.error}</p> : null}
      {props.busy ? <Spinner label='Сохраняем этаж…' /> : null}
    </Modal>
  );
}
