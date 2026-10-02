import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PublicVenueResult, VenueSpaceListResult } from '@tickets/seating';

import { useLab } from './state';

export interface Directory {
  venues: PublicVenueResult[];
  spaces: VenueSpaceListResult[];
  venueName: (venueId: string) => string;
  spaceName: (spaceId: string) => string;
  spaceVenue: (spaceId: string) => string;
  spacesOfVenue: (venueId: string) => VenueSpaceListResult[];
  reload: () => Promise<void>;
  loading: boolean;
}

/**
 * Площадки и помещения нужны почти каждому экрану, чтобы показывать названия вместо
 * идентификаторов. Справочник читается один раз на сеанс и обновляется после создания записи.
 */
export function useDirectory(): Directory {
  const { api, signedIn } = useLab();
  const [venues, setVenues] = useState<PublicVenueResult[]>([]);
  const [spaces, setSpaces] = useState<VenueSpaceListResult[]>([]);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [venuePage, spacePage] = await Promise.all([
        api.listPublicVenues({ limit: 200, language: 'Ru' }).catch(() => null),
        // Лаборатория служит обеим ролям, а маршрут у справочника помещений для каждой
        // свой: организаторский проверяет членство в организации, административный —
        // платформенное VenueRead. Роль здесь неизвестна, поэтому отказ организаторского
        // маршрута — это не пустой справочник, а повод спросить административный.
        api
          .listVenueSpaces({ limit: 200 })
          .catch(() => api.listAdminVenueSpaces({ limit: 200 }))
          .catch(() => null),
      ]);
      if (venuePage) setVenues(venuePage.items);
      if (spacePage) setSpaces(spacePage.items);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    if (signedIn) void reload();
  }, [signedIn, reload]);

  return useMemo<Directory>(() => {
    const venueById = new Map(venues.map((venue) => [venue.id, venue]));
    const spaceById = new Map(spaces.map((space) => [space.id, space]));
    return {
      venues, spaces, loading, reload,
      venueName: (venueId) => venueById.get(venueId)?.name ?? 'Площадка вне справочника',
      spaceName: (spaceId) => spaceById.get(spaceId)?.name ?? 'Помещение вне справочника',
      spaceVenue: (spaceId) => {
        const space = spaceById.get(spaceId);
        return space ? space.venue.name : '';
      },
      spacesOfVenue: (venueId) => spaces.filter((space) => space.venue.id === venueId),
    };
  }, [venues, spaces, loading, reload]);
}
