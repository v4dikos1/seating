import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Building2,
  Calendar,
  Copy,
  DoorOpen,
  Edit3,
  Layers,
  Layers3,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Users,
} from 'lucide-react';
import {
  duplicateConfiguration, newIdempotencyKey,
  type DuplicateProgress, type SeatingConfigurationResult,
} from '@tickets/seating';

import type { Directory } from './directory';
import { useLab, useRequest } from './state';
import { Badge, Button, Empty, Modal, Note, Problem, Section, Select, Spinner, Text } from './ui';

const dateFormat = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' });

/** Что о схеме известно из списочных маршрутов; null — счётчики прочитать не удалось. */
type HallStats = { zones: number; floors: number; freeCapacity: number } | null;

export function HallsPage(props: {
  directory: Directory;
  isAdmin: boolean;
  onOpen: (hall: SeatingConfigurationResult) => void;
  onCreateSpace: () => void;
}) {
  const { api, signedIn } = useLab();
  const [halls, setHalls] = useState<SeatingConfigurationResult[] | null>(null);
  const [search, setSearch] = useState('');
  const [spaceId, setSpaceId] = useState('');
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<SeatingConfigurationResult | null>(null);
  const [duplicating, setDuplicating] = useState<SeatingConfigurationResult | null>(null);
  const [stats, setStats] = useState<Record<string, HallStats>>({});
  const { busy, error, run } = useRequest();

  // Поиск и отбор по помещению выполняет сервер: клиентский фильтр по сотне
  // загруженных карточек молча терял всё, что в эту сотню не попало.
  const load = useCallback(async (query: string, space: string) => {
    const result = await run(() =>
      api.listConfigurations({
        limit: 100,
        sortBy: 'UpdatedAt',
        sortDirection: 'Desc',
        searchQuery: query.trim() || undefined,
        spaceId: space || undefined,
      }),
    );
    if (result) setHalls(result.items);
  }, [api, run]);

  useEffect(() => {
    if (!signedIn) return;
    const timer = setTimeout(() => void load(search, spaceId), search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [signedIn, load, search, spaceId]);

  // Счётчики схемы подгружаются отдельно и не задерживают список.
  useEffect(() => {
    if (!halls?.length) return;
    let cancelled = false;
    void (async () => {
      for (const hall of halls) {
        if (cancelled) return;
        // Именно «ключ уже есть», а не «значение истинно»: неудачная попытка пишет null,
        // и проверка на истинность крутила бы запрос по кругу.
        if (hall.id in stats) continue;
        try {
          const [zones, floors] = await Promise.all([
            api.listZones(hall.id, { limit: 200, revision: hall.versions.configurationRevision ?? undefined }),
            api.listFloors(hall.id, { limit: 200 }),
          ]);
          if (cancelled) return;
          // Числа мест список зон не отдаёт — только вид и лимит свободных зон,
          // поэтому карточка показывает то, что действительно известно.
          const free = zones.items
            .filter((zone) => zone.kind === 'Free')
            .reduce((total, zone) => total + (zone.capacity ?? 0), 0);
          setStats((current) => ({
            ...current,
            [hall.id]: { zones: zones.totalItems, floors: floors.totalItems, freeCapacity: free },
          }));
        } catch {
          // Счётчики — украшение карточки: их отсутствие не ломает список залов.
          if (!cancelled) setStats((current) => ({ ...current, [hall.id]: null }));
        }
      }
    })();
    return () => { cancelled = true; };
  }, [halls, api, stats]);

  const visible = useMemo(() => halls ?? [], [halls]);

  return (
    <Section
      title='Залы и конфигурации'
      description='Схемы посадочных мест и свободного размещения. Каждый зал привязан к помещению выбранной площадки.'
      action={
        <Button
          kind='primary'
          icon={<Plus size={16} />}
          onClick={() => setCreating(true)}
        >
          Создать зал
        </Button>
      }
    >
      <div className='toolbar'>
        <div className='search-wrap'>
          <Search size={16} className='search-icon' />
          <input
            className='search'
            value={search}
            placeholder='Поиск по названию зала...'
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <select
          className='search'
          aria-label='Помещение'
          value={spaceId}
          style={{ maxWidth: 260 }}
          onChange={(event) => setSpaceId(event.target.value)}
        >
          <option value=''>Все помещения</option>
          {props.directory.spaces.map((space) => (
            <option key={space.id} value={space.id}>
              {space.venue.name} · {space.name}
            </option>
          ))}
        </select>
        <Button
          kind='secondary'
          icon={<RefreshCw size={14} className={busy ? 'animate-spin' : ''} />}
          onClick={() => void load(search, spaceId)}
          disabled={busy}
        >
          Обновить
        </Button>
        {halls ? (
          <span style={{ marginLeft: 'auto', fontSize: 13, color: 'var(--ink-muted)' }}>
            Найдено залов: <strong>{halls.length}</strong>
          </span>
        ) : null}
      </div>

      <Problem error={error} />
      {halls === null && busy ? <Spinner label='Загружаем схемы залов…' /> : null}

      {halls !== null && visible.length === 0 ? (
        <Empty
          title={search ? 'Ничего не найдено' : 'Залов пока нет'}
          icon={<Layers size={40} />}
        >
          {search
            ? 'Попробуйте изменить поисковый запрос.'
            : 'Создайте первый зал площадки — затем в конфигураторе можно будет нарисовать схему мест.'}
        </Empty>
      ) : null}

      <div className='cards'>
        {visible.map((hall) => {
          const venueName = hall.venue.name;
          const spaceName = hall.space.name;
          const isDraft = hall.versions.configurationRevision == null;
          const stat = stats[hall.id];

          return (
            <article className='card' key={hall.id}>
              <header>
                <div>
                  <h3>{hall.name}</h3>
                  <div className='card-badges' style={{ marginTop: 6 }}>
                    {isDraft ? (
                      <Badge tone='neutral' dot>
                        Черновик
                      </Badge>
                    ) : (
                      <Badge tone='brand' dot>
                        Редакция {hall.versions.configurationRevision}
                      </Badge>
                    )}
                  </div>
                </div>
                <button
                  type='button'
                  className='icon'
                  aria-label='Переименовать зал'
                  title='Переименовать зал'
                  onClick={() => setRenaming(hall)}
                >
                  <MoreHorizontal size={18} />
                </button>
              </header>

              <dl>
                <div>
                  <dt style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Building2 size={13} /> Площадка
                  </dt>
                  <dd title={venueName}>{venueName}</dd>
                </div>
                <div>
                  <dt style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <DoorOpen size={13} /> Помещение
                  </dt>
                  <dd title={spaceName}>{spaceName}</dd>
                </div>
                <div>
                  <dt style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Layers3 size={13} /> Схема
                  </dt>
                  <dd>
                    {stat === undefined
                      ? '…'
                      : stat === null
                        ? 'нет данных'
                        : `${stat.floors} эт. · ${stat.zones} зон`}
                  </dd>
                </div>
                {stat ? (
                  <div>
                    <dt style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Users size={13} /> Свободные зоны
                    </dt>
                    <dd>{stat.freeCapacity ? `лимит ${stat.freeCapacity}` : '—'}</dd>
                  </div>
                ) : null}
                <div>
                  <dt style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Calendar size={13} /> Изменён
                  </dt>
                  <dd>{dateFormat.format(new Date(hall.updatedAt))}</dd>
                </div>
              </dl>

              <footer>
                <Button
                  kind='secondary'
                  icon={<Copy size={15} />}
                  title='Создать новый зал на основе этого'
                  onClick={() => setDuplicating(hall)}
                >
                  Дублировать
                </Button>
                <Button
                  kind='primary'
                  icon={<Edit3 size={15} />}
                  onClick={() => props.onOpen(hall)}
                >
                  <span>Открыть конфигуратор</span>
                  <ArrowRight size={14} />
                </Button>
              </footer>
            </article>
          );
        })}
      </div>

      {creating ? (
        <CreateHall
          directory={props.directory}
          isAdmin={props.isAdmin}
          onCreateSpace={() => {
            setCreating(false);
            props.onCreateSpace();
          }}
          onClose={() => setCreating(false)}
          onCreated={(hall) => {
            setCreating(false);
            setHalls((current) => [hall, ...(current ?? [])]);
            props.onOpen(hall);
          }}
        />
      ) : null}

      {renaming ? (
        <RenameHall
          hall={renaming}
          onClose={() => setRenaming(null)}
          onRenamed={(hall) => {
            setRenaming(null);
            setHalls((current) => (current ?? []).map((item) => (item.id === hall.id ? hall : item)));
          }}
        />
      ) : null}

      {duplicating ? (
        <DuplicateHall
          hall={duplicating}
          onClose={() => setDuplicating(null)}
          onDuplicated={(hall) => {
            setDuplicating(null);
            setHalls((current) => [hall, ...(current ?? [])]);
            props.onOpen(hall);
          }}
        />
      ) : null}
    </Section>
  );
}

function CreateHall(props: {
  directory: Directory;
  isAdmin: boolean;
  onClose: () => void;
  onCreated: (hall: SeatingConfigurationResult) => void;
  onCreateSpace: () => void;
}) {
  const { api } = useLab();
  const [venueId, setVenueId] = useState('');
  const [spaceId, setSpaceId] = useState('');
  const [name, setName] = useState('');
  const { busy, error, run } = useRequest();

  const spaces = venueId ? props.directory.spacesOfVenue(venueId) : [];

  async function submit() {
    const result = await run(() =>
      api.createConfiguration({ spaceId, name: name.trim() }, newIdempotencyKey()),
    );
    if (result) props.onCreated(result);
  }

  return (
    <Modal
      title='Новый зал'
      subtitle='Выберите площадку и помещение здания, затем задайте понятное название схемы.'
      onClose={props.onClose}
      footer={
        <>
          <Button onClick={props.onClose}>Отмена</Button>
          <Button
            kind='primary'
            disabled={busy || !spaceId || !name.trim()}
            onClick={submit}
          >
            {busy ? 'Создаём карточку…' : 'Создать и открыть студию'}
          </Button>
        </>
      }
    >
      <Select
        label='Площадка (здание)'
        value={venueId}
        placeholder='— выберите площадку —'
        options={props.directory.venues.map((venue) => ({ value: venue.id, title: venue.name }))}
        onChange={(value) => {
          setVenueId(value);
          setSpaceId('');
        }}
      />

      {venueId && spaces.length === 0 ? (
        <Note tone='warn'>
          У выбранной площадки пока нет зарегистрированных помещений.{' '}
          {props.isAdmin ? (
            <button type='button' className='link' onClick={props.onCreateSpace}>
              Создать помещение сейчас
            </button>
          ) : (
            'Создание помещений доступно администратору платформы.'
          )}
        </Note>
      ) : (
        <Select
          label='Помещение внутри площадки'
          value={spaceId}
          placeholder='— выберите помещение —'
          disabled={!venueId}
          options={spaces.map((space) => ({ value: space.id, title: space.name }))}
          onChange={setSpaceId}
        />
      )}

      <Text
        label='Название зала'
        value={name}
        placeholder='Например, Главная сцена или Большой зал'
        maxLength={200}
        onChange={setName}
      />

      <Problem error={error} />
    </Modal>
  );
}

function RenameHall(props: {
  hall: SeatingConfigurationResult;
  onClose: () => void;
  onRenamed: (hall: SeatingConfigurationResult) => void;
}) {
  const { api } = useLab();
  const [name, setName] = useState(props.hall.name);
  const { busy, error, run } = useRequest();

  async function submit() {
    const result = await run(() =>
      api.renameConfiguration(
        props.hall.id,
        { expectedVersion: props.hall.versions.configurationVersion, name: name.trim() },
        newIdempotencyKey(),
      ),
    );
    if (result) props.onRenamed(result);
  }

  return (
    <Modal
      title='Переименовать зал'
      subtitle={`Текущая версия схемы: v${props.hall.versions.configurationVersion}`}
      onClose={props.onClose}
      footer={
        <>
          <Button onClick={props.onClose}>Отмена</Button>
          <Button
            kind='primary'
            disabled={busy || !name.trim() || name.trim() === props.hall.name}
            onClick={submit}
          >
            {busy ? 'Сохраняем…' : 'Сохранить название'}
          </Button>
        </>
      }
    >
      <Text
        label='Новое название зала'
        value={name}
        maxLength={200}
        autoFocus
        onChange={setName}
      />
      <Problem error={error} />
    </Modal>
  );
}

/**
 * Дублирование зала (CFG-14). Серверной команды копирования нет, поэтому копия
 * собирается теми же командами, что и ручная разметка, и проходит те же проверки.
 * Ход копирования показывается честно: при отказе на середине копия остаётся
 * частично заполненной, а удалить её нечем — маршрута удаления конфигурации в API нет.
 */
function DuplicateHall(props: {
  hall: SeatingConfigurationResult;
  onClose: () => void;
  onDuplicated: (hall: SeatingConfigurationResult) => void;
}) {
  const { api } = useLab();
  const [name, setName] = useState(`${props.hall.name} (копия)`);
  const [progress, setProgress] = useState<DuplicateProgress | null>(null);
  const { busy, error, run } = useRequest();

  async function submit() {
    setProgress(null);
    const result = await run(() =>
      duplicateConfiguration(api, props.hall.id, name.trim(), { onProgress: setProgress }),
    );
    if (result) props.onDuplicated(result);
  }

  const stageTitles: Record<DuplicateProgress['stage'], string> = {
    configuration: 'Создаём карточку',
    floors: 'Переносим этажи',
    zones: 'Переносим зоны',
  };

  return (
    <Modal
      title='Дублировать зал'
      subtitle={`Копия «${props.hall.name}» в том же помещении: этажи, подложки и схема мест.`}
      onClose={busy ? () => undefined : props.onClose}
      footer={
        <>
          <Button disabled={busy} onClick={props.onClose}>Отмена</Button>
          <Button
            kind='primary'
            icon={<Copy size={14} />}
            disabled={busy || !name.trim() || name.trim() === props.hall.name}
            onClick={submit}
          >
            {busy ? 'Копируем…' : 'Создать копию'}
          </Button>
        </>
      }
    >
      <Text
        label='Название копии'
        value={name}
        maxLength={200}
        autoFocus
        onChange={setName}
        hint='Название должно отличаться от исходного, иначе залы не различить в списке.'
      />

      <Note tone='info'>
        Ключи рядов и мест выдаёт сервер, поэтому в копию они не переносятся: копия получает
        свои. Подложка этажа переиспользует тот же файл плана вместе с калибровкой.
      </Note>

      {progress ? (
        <p className='inspector-note'>
          {stageTitles[progress.stage]}
          {progress.total ? `: ${progress.done} из ${progress.total}` : '…'}
        </p>
      ) : null}

      {busy ? <Spinner label='Копируем конфигурацию…' /> : null}

      {error ? (
        <Note tone='warn'>
          Копирование прервалось на середине. Скопированное уже сохранено отдельным залом
          и остаётся черновиком; удалить его нечем — маршрута удаления конфигурации в API нет.
        </Note>
      ) : null}
      <Problem error={error} />
    </Modal>
  );
}
