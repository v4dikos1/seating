import { describe, expect, it } from 'vitest';
import { deriveJourneyStatus } from './journey';
import type { EventCard } from './events-api';

const card: EventCard = {
  id: 'event-1', status: 'Draft', isPublished: false,
  pendingChange: { status: 'Editing', attributes: { occurrences: [{ startsAt: '2027-01-01T12:00:00Z', endsAt: '2027-01-01T14:00:00Z' }] } },
  moderation: [], occurrences: [],
};

describe('Путь до продаж', () => {
  it('показывает несохранённую схему и черновик по ответам API', () => {
    expect(deriveJourneyStatus([{ versions: { configurationVersion: 1, configurationRevision: null } }], card, null)).toMatchObject({ hall: false, event: true, moderation: 'draft', published: false, sales: false });
  });

  it('различает очередь, одобрение и отказ с причиной', () => {
    const hall = [{ versions: { configurationVersion: 1, configurationRevision: 2 } }];
    expect(deriveJourneyStatus(hall, { ...card, status: 'PendingModeration' }, null).moderation).toBe('pending');
    expect(deriveJourneyStatus(hall, { ...card, status: 'Approved' }, null).moderation).toBe('approved');
    expect(deriveJourneyStatus(hall, { ...card, status: 'Rejected', moderation: [{ id: 'r1', decision: 'Reject', reason: 'Исправьте описание' }] }, null))
      .toMatchObject({ moderation: 'rejected', reason: 'Исправьте описание' });
  });

  it('завершает продажи и встраивание только при публикации и применённой цене', () => {
    const published = { ...card, status: 'Published', isPublished: true, occurrences: [{ id: 'occ-1', startsAt: '2027-01-01T12:00:00Z' }] };
    expect(deriveJourneyStatus([{ versions: { configurationVersion: 1, configurationRevision: 2 } }], published, 0)).toMatchObject({ published: true, sales: false, embed: false });
    expect(deriveJourneyStatus([{ versions: { configurationVersion: 1, configurationRevision: 2 } }], published, 3)).toMatchObject({ published: true, sales: true, embed: true });
  });
});
