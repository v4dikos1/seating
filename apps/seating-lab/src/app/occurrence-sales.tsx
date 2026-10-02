import { useEffect, useMemo, useState } from 'react';
import { Link2, RefreshCw, Tag, Ticket } from 'lucide-react';
import {
  SalesApi, SeatingApiError, newIdempotencyKey,
  type ApplyOccurrencePricingZone, type OccurrenceSalesResult, type OccurrenceSalesSetupResult,
  type PriceTemplateListResult, type PriceTemplateVersionResult, type SeatingConfigurationResult,
  formatMoney,
} from '@tickets/seating';

import { useLab, useRequest } from './state';
import { CopyId } from './journey-id';
import { Badge, Button, Note, Numeric, Problem, Section, Select, Spinner, Text } from './ui';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface EventListItem { id: string; title: string; status?: string }
interface EventOccurrence { id: string; startsAt: string; timeZone?: string | null }

/** Сервер отдаёт суммы в минорных единицах (1 AMD = 100); в экране показываем драмы. */
/** Дата и время показа в его часовом поясе (при неизвестном поясе — в локальном). */
function formatOccurrenceStart(startsAt: string, timeZone?: string | null): string {
  const options: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' };
  try {
    return new Intl.DateTimeFormat('ru-RU', { ...options, timeZone: timeZone || undefined }).format(new Date(startsAt))
      + (timeZone ? ` (${timeZone})` : '');
  } catch {
    return new Intl.DateTimeFormat('ru-RU', options).format(new Date(startsAt));
  }
}

/** Причина, по которой зона не продаётся в первом срезе, — по виду зоны. */
function unsupportedReason(kind: string): string {
  return kind === 'Free' ? 'свободная зона' : 'стол целиком';
}

/** В `libs/seating` нет клиента событий: тот же токен соединения, тот же формат ошибок. */
async function getJson<T>(baseUrl: string, token: string | undefined, path: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(baseUrl.replace(/\/+$/, '') + path, {
      method: 'GET',
      headers: { Accept: 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    });
  } catch (reason) {
    throw new SeatingApiError(0, null, 'Сеть недоступна: ' + (reason instanceof Error ? reason.message : String(reason)));
  }
  const text = await response.text();
  let parsed: unknown = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
  if (!response.ok) {
    throw new SeatingApiError(response.status, (parsed ?? null) as Record<string, unknown> | null, 'HTTP ' + response.status);
  }
  return parsed as T;
}

/**
 * Организатор выбирает показ по цепочке «событие → показ» (`GET /api/events`, `GET /api/events/{id}`);
 * администратору организаторские маршруты недоступны, он вводит UUID показа вручную.
 */
export function OccurrenceSalesPage({ isAdmin, initialEventId = '', initialOccurrenceId = '' }: { isAdmin: boolean; initialEventId?: string; initialOccurrenceId?: string }) {
  const { api, connection, signedIn } = useLab();
  const salesApi = useMemo(
    () => new SalesApi({ baseUrl: connection.baseUrl, token: connection.token }),
    [connection],
  );

  const [occurrenceId, setOccurrenceId] = useState(initialOccurrenceId);
  const [configurations, setConfigurations] = useState<SeatingConfigurationResult[]>([]);
  const [setup, setSetup] = useState<OccurrenceSalesSetupResult | null>(null);
  const [dashboard, setDashboard] = useState<OccurrenceSalesResult | null>(null);
  const [loaded, setLoaded] = useState(false);
  const { busy, error, run, setError } = useRequest();

  const [bindConfigId, setBindConfigId] = useState('');
  const [bindRevision, setBindRevision] = useState<number | null>(null);

  const [events, setEvents] = useState<EventListItem[]>([]);
  const [eventId, setEventId] = useState(initialEventId);
  const [occurrences, setOccurrences] = useState<EventOccurrence[]>([]);
  const [eventBusy, setEventBusy] = useState(false);
  const [eventError, setEventError] = useState<unknown>(null);

  const [templates, setTemplates] = useState<PriceTemplateListResult[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [templateVersion, setTemplateVersion] = useState<PriceTemplateVersionResult | null>(null);
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const pricing = useRequest();

  useEffect(() => {
    if (!signedIn || isAdmin) return;
    api.listConfigurations({ limit: 200, sortBy: 'UpdatedAt', sortDirection: 'Desc' })
      .then((page) => setConfigurations(page.items)).catch(() => setConfigurations([]));
    salesApi.listPriceTemplates({ limit: 200 })
      .then((page) => setTemplates(page.items)).catch(() => setTemplates([]));
    getJson<EventListItem[] | { items?: EventListItem[] }>(connection.baseUrl, connection.token, '/api/events')
      .then((result) => setEvents(Array.isArray(result) ? result : result?.items ?? []))
      .catch(() => setEvents([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, isAdmin]);

  useEffect(() => {
    if (!initialEventId || isAdmin) return;
    getJson<{ occurrences?: EventOccurrence[] }>(connection.baseUrl, connection.token, '/api/events/' + initialEventId)
      .then((card) => setOccurrences(card?.occurrences ?? []))
      .catch(setEventError);
    // Начальный выбор передаётся навигацией; ручная смена события обрабатывается selectEvent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialEventId, isAdmin]);

  async function selectEvent(id: string) {
    setEventId(id);
    setOccurrences([]);
    setOccurrenceId('');
    setEventError(null);
    if (!id) return;
    setEventBusy(true);
    try {
      const card = await getJson<{ occurrences?: EventOccurrence[] }>(
        connection.baseUrl, connection.token, '/api/events/' + id);
      setOccurrences(card?.occurrences ?? []);
    } catch (reason) {
      setEventError(reason);
    } finally {
      setEventBusy(false);
    }
  }

  const configName = (id: string) => configurations.find((c) => c.id === id)?.name;
  const hallLabel = (id: string) => (
    <span title={id}>{configName(id) ? `«${configName(id)}»` : 'зал не найден в списке'}</span>
  );
  const templateName = (id: string) => templates.find((t) => t.id === id)?.name;

  async function load() {
    if (!uuidPattern.test(occurrenceId.trim())) {
      setError(new Error('Введите корректный идентификатор показа (UUID).'));
      return;
    }
    const id = occurrenceId.trim();
    setLoaded(false);
    setDashboard(null);
    setSetup(null);
    const result = await run(async () => {
      if (isAdmin) {
        return { setupResult: null, dashboardResult: await salesApi.getAdminSales(id) };
      }
      let setupResult: OccurrenceSalesSetupResult | null;
      try {
        setupResult = await salesApi.getOccurrenceSalesSetup(id);
      } catch (reason) {
        if (reason instanceof SeatingApiError && reason.errorCode === 'OccurrenceLayoutNotFound') setupResult = null;
        else throw reason;
      }
      const dashboardResult = setupResult ? await salesApi.getOrganizerSales(id) : null;
      return { setupResult, dashboardResult };
    });
    if (result) {
      setSetup(result.setupResult);
      setDashboard(result.dashboardResult);
      setLoaded(true);
      setAssignments(Object.fromEntries(
        (result.setupResult?.zones ?? [])
          .filter((zone) => zone.categoryCode)
          .map((zone) => [zone.zoneId, zone.categoryCode as string]),
      ));
    }
  }

  async function bind() {
    const id = occurrenceId.trim();
    if (!bindConfigId) return;
    const result = await run(() => salesApi.bindLayout(
      id,
      { configurationId: bindConfigId, configurationRevision: bindRevision ?? undefined },
      newIdempotencyKey(),
    ));
    if (result) await load();
  }

  async function selectTemplate(id: string) {
    setTemplateId(id);
    setTemplateVersion(null);
    if (!id) return;
    const result = await pricing.run(() => salesApi.getPriceTemplate(id));
    if (result) setTemplateVersion(result);
  }

  async function applyPricing() {
    if (!setup || !templateVersion) return;
    const zones: ApplyOccurrencePricingZone[] = Object.entries(assignments)
      .filter(([, code]) => code)
      .map(([zoneId, categoryCode]) => ({ zoneId, categoryCode }));
    const result = await run(() => salesApi.applyPricing(
      occurrenceId.trim(),
      { templateId: templateVersion.templateId, templateVersion: templateVersion.version, zones },
      newIdempotencyKey(),
    ));
    if (result) await load();
  }

  const zoneLabel = (zoneId: string) => {
    const found = setup?.zones.find((z) => z.zoneId === zoneId);
    if (found) return `${found.code} — ${found.name}`;
    const publicZone = dashboard?.seating.zones.find((z) => z.zoneId === zoneId);
    return publicZone ? `${publicZone.geometry.code} — ${publicZone.geometry.name}` : zoneId;
  };
  const sellableZones = setup?.zones.filter((zone) => zone.saleable) ?? [];

  return (
    <Section
      title={isAdmin ? 'Показ: продажи' : 'Показ: компоновка и цены'}
      description={isAdmin ? 'Снимок продаж любого показа платформы.'
        : 'Привязка схемы к показу, применение ценового шаблона и статусы продаж своей организации.'}
    >
      <div className='occ-form'>
        {isAdmin ? <Note tone='info'>ID показа можно получить в разделе «Модерация» после публикации либо попросить организатора скопировать его в «Пути до продаж».</Note> : null}
        {eventId && !isAdmin ? <CopyId label='ID события' value={eventId} /> : null}
        {!isAdmin ? (
          <div className='occ-select-row'>
            <Select label='Событие' value={eventId} placeholder='Выберите событие'
              options={events.map((e) => ({ value: e.id, title: e.status ? `${e.title} · ${e.status}` : e.title }))}
              onChange={selectEvent} />
            <Select label='Показ' value={occurrences.some((o) => o.id === occurrenceId) ? occurrenceId : ''}
              placeholder={eventId ? 'Выберите показ' : 'Сначала выберите событие'}
              disabled={!eventId || eventBusy}
              options={occurrences.map((o) => ({ value: o.id, title: formatOccurrenceStart(o.startsAt, o.timeZone) }))}
              onChange={setOccurrenceId} />
          </div>
        ) : null}
        {!isAdmin ? <Problem error={eventError} /> : null}
        {isAdmin ? (
          <div className='occ-load-row'>
            <Text label='Идентификатор показа (UUID)' value={occurrenceId} onChange={setOccurrenceId}
              placeholder='00000000-0000-0000-0000-000000000000' />
            <Button kind='primary' icon={<RefreshCw size={14} className={busy ? 'animate-spin' : ''} />} onClick={load}>
              Загрузить
            </Button>
          </div>
        ) : (
          <>
            <details className='occ-manual'>
              <summary>Ввести идентификатор вручную</summary>
              <Text label='Идентификатор показа (UUID)' value={occurrenceId} onChange={setOccurrenceId}
                placeholder='00000000-0000-0000-0000-000000000000' />
            </details>
            <div>
              <Button kind='primary' icon={<RefreshCw size={14} className={busy ? 'animate-spin' : ''} />} onClick={load}>
                Загрузить
              </Button>
            </div>
          </>
        )}
      </div>

      {occurrenceId && uuidPattern.test(occurrenceId.trim()) ? <CopyId label='ID показа' value={occurrenceId.trim()} /> : null}

      <Problem error={error} />
      {busy && !loaded ? <Spinner label={isAdmin ? 'Загружаем продажи показа…' : 'Загружаем компоновку показа…'} /> : null}

      {loaded && !isAdmin && !setup ? (
        <>
          <Note tone='warn'>Компоновка продаж этому показу ещё не привязана.</Note>
          <div className='inspector-panel occ-panel'>
            <div className='inspector-panel-head'><h3><Link2 size={16} color='var(--primary)' /> Привязать конфигурацию</h3></div>
            <Select label='Схема зала' value={bindConfigId} placeholder='Выберите зал'
              options={configurations.map((c) => ({ value: c.id, title: c.name }))}
              onChange={setBindConfigId} />
            <Numeric label='Редакция состава (пусто — текущая)' value={bindRevision} min={1}
              onChange={(value) => setBindRevision(value > 0 ? Math.round(value) : null)} />
            <div><Button kind='primary' disabled={!bindConfigId || busy} onClick={bind}>Привязать</Button></div>
          </div>
        </>
      ) : null}

      {!isAdmin && setup ? (
        <>
          <div className='inspector-panel occ-panel'>
            <div className='inspector-panel-head'>
              <h3><Link2 size={16} color='var(--primary)' /> Компоновка</h3>
              <Badge tone='brand'>цены v{setup.pricingVersion}</Badge>
            </div>
            <p className='inspector-note'>
              Зал {hallLabel(setup.configurationId)}, редакция {setup.configurationRevision}.
              {setup.sourceTemplateId ? (
                <> Применён шаблон <span title={setup.sourceTemplateId}>{templateName(setup.sourceTemplateId) ?? 'из списка шаблонов'}</span> v{setup.sourceTemplateVersion}.</>
              ) : ' Цены ещё не применены.'}
            </p>
            <Select label='Перепривязать другую схему' value={bindConfigId} placeholder='Заменить схему (до первой брони)'
              options={configurations.map((c) => ({ value: c.id, title: c.name }))}
              onChange={setBindConfigId} />
            {bindConfigId ? <div><Button kind='secondary' disabled={busy} title={bindConfigId} onClick={bind}>Перепривязать к «{configName(bindConfigId) ?? 'выбранному залу'}»</Button></div> : null}
          </div>

          <div className='inspector-panel occ-panel'>
            <div className='inspector-panel-head'><h3><Tag size={16} color='var(--primary)' /> Применить цену</h3></div>
            <Select label='Ценовой шаблон' value={templateId} placeholder='Выберите шаблон'
              options={templates.map((t) => ({ value: t.id, title: t.name }))}
              onChange={selectTemplate} />
            {pricing.busy ? <Spinner label='Загружаем версию шаблона…' /> : null}
            {templateVersion ? (
              <>
                <p className='inspector-note'>Версия v{templateVersion.version} · категории: {templateVersion.categories.map((c) => c.code).join(', ') || '—'}</p>
                {sellableZones.length === 0 ? (
                  <Note tone='info'>В компоновке нет зон, поддерживающих продажу (Free и Whole/MinimumQuantity-столы не продаются).</Note>
                ) : null}
                {setup.zones.map((zone) => zone.saleable ? (
                  <div key={zone.zoneId} className='occ-zone-row'>
                    <div className='field'>
                      <label>Зона</label>
                      <p className='inspector-note' style={{ margin: 0 }} title={zone.zoneId}>{zone.code} — {zone.name}</p>
                    </div>
                    <Select label='Категория' value={assignments[zone.zoneId] ?? ''} placeholder='Не продавать'
                      options={templateVersion.categories.map((c) => ({ value: c.code, title: `${c.code} — ${c.name} · ${formatMoney(c.basePrice.amountMinor, c.basePrice.currency)}` }))}
                      onChange={(value) => setAssignments((current) => ({ ...current, [zone.zoneId]: value }))} />
                  </div>
                ) : (
                  <div key={zone.zoneId} className='occ-zone-row occ-zone-off'>
                    <div className='field'>
                      <label>Зона</label>
                      <p className='inspector-note' style={{ margin: 0 }} title={zone.zoneId}>{zone.code} — {zone.name}</p>
                    </div>
                    <div className='field'>
                      <label>Категория</label>
                      <p className='inspector-note' style={{ margin: 0 }}>Не продаётся в первом срезе: {unsupportedReason(zone.kind)}</p>
                    </div>
                  </div>
                ))}
                <div>
                  <Button kind='primary' disabled={busy || sellableZones.length === 0} onClick={applyPricing}>
                    Применить версию v{templateVersion.version}
                  </Button>
                </div>
              </>
            ) : null}
          </div>
        </>
      ) : null}

      {loaded && (isAdmin || setup) ? (
          <div className='inspector-panel occ-panel'>
            <div className='inspector-panel-head'><h3><Ticket size={16} color='var(--primary)' /> Продажи</h3></div>
            {!dashboard ? <Note tone='info'>Загрузите показ ещё раз, чтобы обновить статусы.</Note> : (
              <>
                <p className='inspector-note'>Снимок на {new Date(dashboard.asOf).toLocaleString('ru-RU')}.</p>
                <div className='table-wrap'>
                  <table className='table'>
                    <thead>
                      <tr><th>Показатель</th><th>Значение</th></tr>
                    </thead>
                    <tbody>
                      <tr><td>Всего продаваемых мест</td><td>{dashboard.summary.total}</td></tr>
                      <tr><td>Свободно</td><td>{dashboard.summary.available}</td></tr>
                      <tr><td>Удержано</td><td>{dashboard.summary.held}</td></tr>
                      <tr><td>Продано</td><td>{dashboard.summary.sold}</td></tr>
                    </tbody>
                  </table>
                </div>
                {dashboard.zones.length > 0 ? (
                  <div className='table-wrap' style={{ marginTop: 10 }}>
                    <table className='table'>
                      <thead>
                        <tr><th>Зона</th><th>Всего</th><th>Свободно</th><th>Удержано</th><th>Продано</th></tr>
                      </thead>
                      <tbody>
                        {dashboard.zones.map((zone) => (
                          <tr key={zone.zoneId ?? 'total'}>
                            <td title={zone.zoneId ?? undefined}>{zone.zoneId ? zoneLabel(zone.zoneId) : 'Весь показ'}</td>
                            <td>{zone.total}</td><td>{zone.available}</td><td>{zone.held}</td><td>{zone.sold}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
                {isAdmin ? (
                  <Note tone='info'>
                    Владелец удержания или билета видно в самом снимке единиц ({dashboard.units.length} шт.) —
                    поиск по конкретному месту в этой версии стенда не выведен отдельно.
                  </Note>
                ) : null}
              </>
            )}
          </div>
      ) : null}
    </Section>
  );
}
