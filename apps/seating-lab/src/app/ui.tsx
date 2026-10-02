import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Info,
  Loader2,
  Sparkles,
  X,
} from 'lucide-react';
import { SeatingApiError } from '@tickets/seating';

export function Button(props: {
  children?: ReactNode;
  onClick?: () => void;
  kind?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'quiet' | 'studio';
  disabled?: boolean;
  title?: string;
  type?: 'button' | 'submit';
  full?: boolean;
  icon?: ReactNode;
  iconOnly?: boolean;
  className?: string;
}) {
  const kind = props.kind ?? 'secondary';
  const classList = [
    'btn',
    `btn-${kind}`,
    props.full ? 'btn-full' : '',
    props.iconOnly ? 'btn-icon-only' : '',
    props.className ?? '',
  ].filter(Boolean).join(' ');

  return (
    <button
      type={props.type ?? 'button'}
      className={classList}
      onClick={props.onClick}
      disabled={props.disabled}
      title={props.title}
    >
      {props.icon}
      {props.children}
    </button>
  );
}

/** Кнопка, за которой нет маршрута API: она видна, выключена и объясняет причину. */
export function Planned({ children, why }: { children: ReactNode; why: string }) {
  return (
    <button type='button' className='btn btn-planned btn-full' disabled title={why}>
      <Sparkles size={14} className='planned-icon' />
      <span>{children}</span>
      <span className='planned-mark'>скоро</span>
    </button>
  );
}

export function Badge(props: {
  children: ReactNode;
  tone?: 'brand' | 'purple' | 'success' | 'warning' | 'danger' | 'neutral';
  dot?: boolean;
  className?: string;
}) {
  const tone = props.tone ?? 'neutral';
  return (
    <span className={`badge badge-${tone} ${props.className ?? ''}`}>
      {props.dot ? (
        <span
          className='badge-dot'
          style={{
            background:
              tone === 'brand'
                ? 'var(--primary)'
                : tone === 'success'
                  ? 'var(--success)'
                  : tone === 'warning'
                    ? 'var(--warning)'
                    : tone === 'danger'
                      ? 'var(--danger)'
                      : 'var(--ink-secondary)',
          }}
        />
      ) : null}
      {props.children}
    </span>
  );
}

export function Note({
  children,
  tone,
}: {
  children: ReactNode;
  tone?: 'info' | 'warn' | 'ok';
}) {
  const Icon = tone === 'warn' ? AlertTriangle : tone === 'ok' ? CheckCircle2 : Info;
  return (
    <div className={`note note-${tone ?? 'info'}`}>
      <Icon size={16} style={{ flexShrink: 0, marginTop: 1 }} />
      <div>{children}</div>
    </div>
  );
}

export function Field(props: {
  label: string;
  hint?: ReactNode;
  children: (id: string) => ReactNode;
  error?: string;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={`field ${props.className ?? ''}`}>
      <label htmlFor={id}>{props.label}</label>
      {props.children(id)}
      {props.error ? <em className='field-error'>{props.error}</em> : null}
      {props.hint && !props.error ? <em className='field-hint'>{props.hint}</em> : null}
    </div>
  );
}

export function Text(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: ReactNode;
  placeholder?: string;
  maxLength?: number;
  type?: string;
  error?: string;
  autoFocus?: boolean;
  icon?: ReactNode;
}) {
  return (
    <Field label={props.label} hint={props.hint} error={props.error}>
      {(id) => (
        <div style={{ position: 'relative' }}>
          {props.icon ? (
            <span
              style={{
                position: 'absolute',
                left: 11,
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--ink-muted)',
                pointerEvents: 'none',
                display: 'inline-flex',
              }}
            >
              {props.icon}
            </span>
          ) : null}
          <input
            id={id}
            value={props.value}
            placeholder={props.placeholder}
            maxLength={props.maxLength}
            type={props.type ?? 'text'}
            autoFocus={props.autoFocus}
            spellCheck={false}
            style={props.icon ? { paddingLeft: 34 } : undefined}
            onChange={(event) => props.onChange(event.target.value)}
          />
        </div>
      )}
    </Field>
  );
}

export function Numeric(props: {
  label: string;
  value: number | null;
  onChange: (value: number) => void;
  hint?: ReactNode;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  placeholder?: string;
}) {
  return (
    <Field label={props.label} hint={props.hint}>
      {(id) => (
        <input
          id={id}
          type='number'
          value={props.value !== null && Number.isFinite(props.value) ? props.value : ''}
          placeholder={props.placeholder}
          min={props.min}
          max={props.max}
          step={props.step}
          disabled={props.disabled}
          onChange={(event) => props.onChange(Number(event.target.value))}
        />
      )}
    </Field>
  );
}

export function Select<T extends string>(props: {
  label: string;
  value: T;
  options: { value: T; title: string }[];
  onChange: (value: T) => void;
  hint?: ReactNode;
  disabled?: boolean;
  placeholder?: string;
}) {
  return (
    <Field label={props.label} hint={props.hint}>
      {(id) => (
        <select
          id={id}
          value={props.value}
          disabled={props.disabled}
          onChange={(event) => props.onChange(event.target.value as T)}
        >
          {props.placeholder ? <option value=''>{props.placeholder}</option> : null}
          {props.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.title}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

export function SegmentedControl<T extends string>(props: {
  value: T;
  options: { value: T; label: ReactNode; icon?: ReactNode }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className='segmented' role='tablist'>
      {props.options.map((opt) => (
        <button
          key={opt.value}
          type='button'
          role='tab'
          aria-selected={props.value === opt.value}
          className={`segmented-btn ${props.value === opt.value ? 'on' : ''}`}
          onClick={() => props.onChange(opt.value)}
        >
          {opt.icon}
          <span>{opt.label}</span>
        </button>
      ))}
    </div>
  );
}

export function Modal(props: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  // Свежий обработчик закрытия без перезапуска эффекта: `props` — новый объект на каждом
  // рендере, и эффект с ним в зависимостях после каждого введённого символа заново ставил
  // фокус на окно, отнимая его у поля ввода.
  const onClose = useRef(props.onClose);
  onClose.current = props.onClose;
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose.current();
    };
    window.addEventListener('keydown', escape);
    // Фокус на окно — один раз при открытии, чтобы работали клавиатура и Escape.
    dialog.current?.focus();
    return () => window.removeEventListener('keydown', escape);
  }, []);

  /*
   * Окно выносится в конец документа порталом. Иначе его перекрывают накладки холста:
   * боковые панели конфигуратора образуют собственный контекст наложения с z-index 10,
   * и окно, отрисованное внутри панели, оказывается ниже сообщений над холстом.
   */
  return createPortal(
    <div className='overlay' onMouseDown={props.onClose}>
      <div
        className={`modal ${props.wide ? 'modal-wide' : ''}`}
        role='dialog'
        aria-modal='true'
        aria-label={props.title}
        tabIndex={-1}
        ref={dialog}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <h2>{props.title}</h2>
            {props.subtitle ? <p>{props.subtitle}</p> : null}
          </div>
          <button
            type='button'
            className='icon'
            aria-label='Закрыть'
            onClick={props.onClose}
          >
            <X size={18} />
          </button>
        </header>
        <div className='modal-body'>{props.children}</div>
        {props.footer ? <footer>{props.footer}</footer> : null}
      </div>
    </div>,
    document.body,
  );
}

export function Problem({ error }: { error: unknown }) {
  if (!error) return null;
  if (!(error instanceof SeatingApiError))
    return (
      <div className='alert' role='alert'>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <AlertCircle size={16} />
          <b>Ошибка</b>
        </div>
        <p>{error instanceof Error ? error.message : String(error)}</p>
      </div>
    );
  const title =
    error.status === 403
      ? 'Недостаточно прав'
      : error.status === 404
        ? 'Запись не найдена'
        : error.status === 409
          ? 'Конфликт версий: данные были изменены другим пользователем'
          : error.status === 0
            ? 'Нет связи с сервером API'
            : 'Запрос отклонён сервером';
  return (
    <div className='alert' role='alert'>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <AlertCircle size={16} />
        <b>{title}</b>
      </div>
      <p>{error.message}</p>
      {error.errors ? (
        <ul>
          {Object.entries(error.errors).map(([field, messages]) => (
            <li key={field}>
              <strong>{field}:</strong> {messages.join('; ')}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function Empty({
  title,
  children,
  icon,
}: {
  title: string;
  children?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className='empty'>
      {icon ? <div style={{ marginBottom: 12, color: 'var(--ink-muted)' }}>{icon}</div> : null}
      <strong>{title}</strong>
      {children ? <p>{children}</p> : null}
    </div>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <div className='spinner' role='status'>
      <Loader2 size={16} className='animate-spin' style={{ animation: 'spin 1s linear infinite' }} />
      <span>{label}</span>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

export function Section(props: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  description?: ReactNode;
}) {
  return (
    <section className='section'>
      <div className='section-head'>
        <div>
          <h1>{props.title}</h1>
          {props.description ? <p>{props.description}</p> : null}
        </div>
        {props.action}
      </div>
      {props.children}
    </section>
  );
}

const presetColors = [
  '#FF5C39', // TomCell Coral
  '#FF7052',
  '#E6421C',
  '#361766', // TomCell Purple
  '#5B21B6',
  '#2563EB', // Blue
  '#059669', // Emerald
  '#D97706', // Amber
  '#DC2626', // Red
  '#475569', // Slate
];

export function ColorPickerPreset(props: {
  id?: string;
  value: string;
  onChange: (color: string) => void;
}) {
  return (
    <div className='field'>
      <label htmlFor={props.id}>Цвет зоны</label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <input
          id={props.id}
          type='color'
          value={props.value}
          onChange={(e) => props.onChange(e.target.value.toUpperCase())}
        />
        <div className='color-presets'>
          {presetColors.map((color) => (
            <button
              key={color}
              type='button'
              className={`color-swatch-btn ${props.value.toUpperCase() === color.toUpperCase() ? 'active' : ''}`}
              style={{ background: color }}
              title={color}
              onClick={() => props.onChange(color)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
