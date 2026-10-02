import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Archive,
  Building2,
  DoorOpen,
  Edit2,
  MapPin,
  Plus,
  RefreshCw,
  Search,
} from 'lucide-react';
import {
  newIdempotencyKey,
  type CityResult,
  type Language,
  type VenueResult,
} from '@tickets/seating';

import type { Directory } from './directory';
import { useLab, useRequest } from './state';
import { Badge, Button, Empty, Modal, Note, Numeric, Problem, Section, Select, Spinner, Text } from './ui';

const languages: { value: Language; title: string }[] = [
  { value: 'Hy', title: 'Армянский' },
  { value: 'Ru', title: 'Русский' },
  { value: 'En', title: 'Английский' },
];

export function VenuesPage({
  directory,
  openSpaceForm,
  onSpaceFormClosed,
}: {
  directory: Directory;
  openSpaceForm: boolean;
  onSpaceFormClosed: () => void;
}) {
  const { api, signedIn } = useLab();
  const [venues, setVenues] = useState<VenueResult[] | null>(null);
  const [cities, setCities] = useState<CityResult[]>([]);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<VenueResult | 'new' | null>(null);
  const [space, setSpace] = useState(false);
  const [archiving, setArchiving] = useState<VenueResult | null>(null);
  const { busy, error, run } = useRequest();

  useEffect(() => {
    if (openSpaceForm) setSpace(true);
  }, [openSpaceForm]);

  const load = useCallback(async () => {
    const result = await run(() => api.listVenues({ limit: 100, language: 'Ru' }));
    if (result) setVenues(result.items);
  }, [api, run]);

  useEffect(() => {
    if (!signedIn) return;
    void load();
    api
      .listCities({ limit: 200, language: 'Ru' })
      .then((page) => setCities(page.items))
      .catch(() => setCities([]));
  }, [signedIn, load, api]);

  const cityName = useMemo(() => {
    const map = new Map(cities.map((city) => [city.id, city.name]));
    return (id: string) => map.get(id) ?? 'Город вне справочника';
  }, [cities]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (venues ?? []).filter(
      (venue) =>
        !needle ||
        venue.name.toLowerCase().includes(needle) ||
        venue.code.toLowerCase().includes(needle),
    );
  }, [venues, search]);

  async function archive() {
    if (!archiving) return;
    const done = await run(() => api.archiveVenue(archiving.id, newIdempotencyKey()));
    if (done !== undefined) {
      setArchiving(null);
      await load();
      await directory.reload();
    }
  }

  return (
    <Section
      title='Площадки и помещения'
      description='Платформенный справочник зданий и помещений. Площадка — физическое здание, помещение — конкретный зал внутри него.'
      action={
        <div style={{ display: 'flex', gap: 8 }}>
          <Button
            kind='secondary'
            icon={<DoorOpen size={15} />}
            onClick={() => setSpace(true)}
          >
            Создать помещение
          </Button>
          <Button
            kind='primary'
            icon={<Plus size={15} />}
            onClick={() => setEditing('new')}
          >
            Создать площадку
          </Button>
        </div>
      }
    >
      <div className='toolbar'>
        <div className='search-wrap'>
          <Search size={16} className='search-icon' />
          <input
            className='search'
            value={search}
            placeholder='Поиск по названию или коду площадки...'
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <Button
          kind='secondary'
          icon={<RefreshCw size={14} className={busy ? 'animate-spin' : ''} />}
          onClick={load}
          disabled={busy}
        >
          Обновить
        </Button>
      </div>

      <Problem error={error} />
      {venues === null && busy ? <Spinner label='Загружаем справочник площадок…' /> : null}
      {venues !== null && visible.length === 0 ? (
        <Empty
          title='Площадки не найдены'
          icon={<Building2 size={40} />}
        >
          Создайте первую площадку здания, затем добавьте в неё помещения.
        </Empty>
      ) : null}

      {visible.length ? (
        <div className='table-wrap' style={{ marginBottom: 32 }}>
          <table className='table'>
            <thead>
              <tr>
                <th>Название</th>
                <th>Город</th>
                <th>Адрес</th>
                <th>Код</th>
                <th>Помещения</th>
                <th style={{ textAlign: 'right' }}>Действия</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((venue) => (
                <tr key={venue.id} className={venue.archivedAt ? 'muted-row' : undefined}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <b>{venue.name}</b>
                      {venue.archivedAt ? (
                        <Badge tone='neutral' dot>
                          в архиве
                        </Badge>
                      ) : null}
                    </div>
                  </td>
                  <td>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                      <MapPin size={13} color='var(--ink-muted)' />
                      {cityName(venue.cityId)}
                    </span>
                  </td>
                  <td style={{ color: 'var(--ink-secondary)' }}>{venue.address}</td>
                  <td className='mono'>{venue.code}</td>
                  <td>
                    <Badge tone='brand'>
                      {directory.spacesOfVenue(venue.id).length} помещений
                    </Badge>
                  </td>
                  <td className='row-actions'>
                    <Button
                      kind='studio'
                      icon={<Edit2 size={13} />}
                      onClick={() => setEditing(venue)}
                    >
                      Изменить
                    </Button>
                    {venue.archivedAt ? null : (
                      <Button
                        kind='studio'
                        icon={<Archive size={13} />}
                        onClick={() => setArchiving(venue)}
                      >
                        В архив
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 16, fontWeight: 650, marginBottom: 12 }}>
          Зарегистрированные помещения ({directory.spaces.length})
        </h2>
        {directory.spaces.length === 0 ? (
          <Empty title='Помещений пока нет'>
            Помещение — конкретный зал площадки, в нём организатор размечает схему мест.
          </Empty>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
            {directory.spaces.map((item) => (
              <div
                key={item.id}
                style={{
                  background: 'var(--card)',
                  border: '1px solid var(--line)',
                  borderRadius: 'var(--radius-md)',
                  padding: '12px 14px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                }}
              >
                <div
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--primary-light)',
                    color: 'var(--primary)',
                    display: 'grid',
                    placeItems: 'center',
                    flexShrink: 0,
                  }}
                >
                  <DoorOpen size={18} />
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <b style={{ fontSize: 13, display: 'block', color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.name}
                  </b>
                  <span style={{ fontSize: 11.5, color: 'var(--ink-muted)', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {directory.venueName(item.venue.id)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {editing ? (
        <VenueForm
          venue={editing === 'new' ? null : editing}
          cities={cities}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
            await directory.reload();
          }}
        />
      ) : null}

      {space ? (
        <SpaceForm
          directory={directory}
          onClose={() => {
            setSpace(false);
            onSpaceFormClosed();
          }}
          onSaved={async () => {
            setSpace(false);
            onSpaceFormClosed();
            await directory.reload();
          }}
        />
      ) : null}

      {archiving ? (
        <Modal
          title='Убрать площадку в архив'
          onClose={() => setArchiving(null)}
          footer={
            <>
              <Button onClick={() => setArchiving(null)}>Отмена</Button>
              <Button kind='danger' disabled={busy} onClick={archive}>
                Убрать в архив
              </Button>
            </>
          }
        >
          <p>
            Площадка <strong>«{archiving.name}»</strong> перестанет предлагаться при создании новых
            залов.
          </p>
          <Problem error={error} />
        </Modal>
      ) : null}
    </Section>
  );
}

function VenueForm(props: {
  venue: VenueResult | null;
  cities: CityResult[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { api } = useLab();
  const [cityId, setCityId] = useState(props.venue?.cityId ?? '');
  const [name, setName] = useState(props.venue?.name ?? '');
  const [address, setAddress] = useState(props.venue?.address ?? '');
  const [language, setLanguage] = useState<Language>(props.venue?.language ?? 'Ru');
  const [latitude, setLatitude] = useState(props.venue?.latitude ?? 40.18);
  const [longitude, setLongitude] = useState(props.venue?.longitude ?? 44.51);
  const [code, setCode] = useState(props.venue?.code ?? '');
  const { busy, error, run } = useRequest();

  function pickCity(value: string) {
    setCityId(value);
    const city = props.cities.find((item) => item.id === value);
    if (city && !props.venue) {
      if (city.centerLatitude !== null) setLatitude(city.centerLatitude);
      if (city.centerLongitude !== null) setLongitude(city.centerLongitude);
    }
  }

  async function submit() {
    const result = await run(() =>
      props.venue
        ? api.updateVenue(
            props.venue.id,
            {
              name: name.trim(),
              address: address.trim(),
              cityId,
              code: code.trim() || null,
              latitude,
              longitude,
            },
            newIdempotencyKey(),
          )
        : api.createVenue(
            {
              cityId,
              name: name.trim(),
              address: address.trim(),
              sourceLanguage: language,
              latitude,
              longitude,
              code: code.trim() || null,
            },
            newIdempotencyKey(),
          ),
    );
    if (result) props.onSaved();
  }

  return (
    <Modal
      title={props.venue ? 'Изменить площадку' : 'Новая площадка'}
      subtitle='Название и адрес будут автоматически локализованы платформой.'
      onClose={props.onClose}
      wide
      footer={
        <>
          <Button onClick={props.onClose}>Отмена</Button>
          <Button
            kind='primary'
            disabled={busy || !cityId || !name.trim() || !address.trim()}
            onClick={submit}
          >
            {busy ? 'Сохраняем…' : 'Сохранить'}
          </Button>
        </>
      }
    >
      <Select
        label='Город'
        value={cityId}
        placeholder='— выберите город —'
        onChange={pickCity}
        options={props.cities.map((city) => ({ value: city.id, title: city.name }))}
      />
      <Text
        label='Название площадки'
        value={name}
        onChange={setName}
        maxLength={200}
        placeholder='Например, Концертный зал им. Хачатуряна'
      />
      <Text
        label='Физический адрес'
        value={address}
        onChange={setAddress}
        maxLength={300}
        placeholder='Улица, номер здания'
      />
      <div className='pair'>
        <Select
          label='Язык оригинала'
          value={language}
          options={languages}
          disabled={Boolean(props.venue)}
          onChange={setLanguage}
          hint={props.venue ? 'Задан при создании' : 'Язык исходного ввода названия и адреса'}
        />
        <Text
          label='Устойчивый код'
          value={code}
          onChange={setCode}
          maxLength={64}
          placeholder='необязательно'
          hint='Для интеграции с внешними системами'
        />
      </div>
      <div className='pair'>
        <Numeric
          label='Широта (Latitude)'
          value={latitude}
          onChange={setLatitude}
          step={0.0001}
          min={-90}
          max={90}
        />
        <Numeric
          label='Долгота (Longitude)'
          value={longitude}
          onChange={setLongitude}
          step={0.0001}
          min={-180}
          max={180}
        />
      </div>
      <Problem error={error} />
    </Modal>
  );
}

function SpaceForm(props: { directory: Directory; onClose: () => void; onSaved: () => void }) {
  const { api } = useLab();
  const [venueId, setVenueId] = useState('');
  const [name, setName] = useState('');
  const { busy, error, run } = useRequest();

  async function submit() {
    const result = await run(() =>
      api.createVenueSpace({ venueId, name: name.trim() }, newIdempotencyKey()),
    );
    if (result) props.onSaved();
  }

  return (
    <Modal
      title='Новое помещение'
      subtitle='Помещение привязывается к площадке. Схему мест внутри него создает организатор.'
      onClose={props.onClose}
      footer={
        <>
          <Button onClick={props.onClose}>Отмена</Button>
          <Button kind='primary' disabled={busy || !venueId || !name.trim()} onClick={submit}>
            {busy ? 'Создаём…' : 'Создать помещение'}
          </Button>
        </>
      }
    >
      <Select
        label='Площадка'
        value={venueId}
        placeholder='— выберите площадку —'
        onChange={setVenueId}
        options={props.directory.venues.map((venue) => ({ value: venue.id, title: venue.name }))}
      />
      <Text
        label='Название помещения'
        value={name}
        onChange={setName}
        maxLength={200}
        placeholder='Например, Малый зал или Амфитеатр'
      />
      <Note tone='info'>Создание помещения требует полномочий администратора площадки.</Note>
      <Problem error={error} />
    </Modal>
  );
}
