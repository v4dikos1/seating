import { render, screen } from '@testing-library/react';

import { useDirectory } from './directory';
import { LabProvider } from './state';

const storageKey = 'seating-lab.connection';

/**
 * localStorage в этом окружении не является полноценным Storage, а подключение
 * лаборатория читает только из него. Поэтому хранилище подменяется целиком.
 */
function stubStorage(connection: { baseUrl: string; token: string }) {
  const values = new Map<string, string>([[storageKey, JSON.stringify(connection)]]);
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
    clear: () => values.clear(),
  });
}

/** Показывает ровно то, ради чего справочник и читается: названия помещений. */
function Probe() {
  const directory = useDirectory();
  return (
    <ul>
      {directory.spaces.map((space) => (
        <li key={space.id}>{space.name}</li>
      ))}
    </ul>
  );
}

function page(items: unknown[]) {
  return { items, totalItems: items.length, offset: 0, limit: 200 };
}

const hall = {
  id: 'space-1',
  venue: { id: 'venue-1', name: 'Площадка' },
  name: 'Большой зал',
  createdAt: '2026-01-01T00:00:00+00:00',
  venueArchivedAt: null,
};

describe('Справочник лаборатории', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reads the spaces from the admin route when the organizer one denies the subject', async () => {
    const requested: string[] = [];
    vi.stubGlobal('fetch', (url: string) => {
      requested.push(url);
      // Организаторский маршрут закрыт администратору платформы: членства в организации
      // у него нет, и отвечает он тем же 403, что и боевой сервер.
      const denied = url.includes('/api/venue-spaces');
      return Promise.resolve({
        ok: !denied,
        status: denied ? 403 : 200,
        text: () =>
          Promise.resolve(
            JSON.stringify(denied ? { errorCode: 'CapabilityDenied' } : page([hall])),
          ),
      } as Response);
    });
    stubStorage({ baseUrl: 'https://api.test', token: 'jwt' });

    render(
      <LabProvider>
        <Probe />
      </LabProvider>,
    );

    expect(await screen.findByText('Большой зал')).toBeTruthy();
    expect(requested.some((url) => url.includes('/api/admin/venue-spaces'))).toBe(true);
  });

  it('does not ask the admin route when the organizer one answers', async () => {
    const requested: string[] = [];
    vi.stubGlobal('fetch', (url: string) => {
      requested.push(url);
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify(page([hall]))),
      } as Response);
    });
    stubStorage({ baseUrl: 'https://api.test', token: 'jwt' });

    render(
      <LabProvider>
        <Probe />
      </LabProvider>,
    );

    expect(await screen.findByText('Большой зал')).toBeTruthy();
    expect(requested.some((url) => url.includes('/api/admin/venue-spaces'))).toBe(false);
  });
});
