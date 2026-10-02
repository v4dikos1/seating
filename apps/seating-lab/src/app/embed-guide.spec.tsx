import { describe, expect, it } from 'vitest';
import { embedExamples } from './embed-guide';

describe('Встраивание', () => {
  it('подставляет выбранный ID показа во все примеры', () => {
    const examples = embedExamples('11111111-2222-4333-8444-555555555555');
    for (const code of Object.values(examples)) expect(code).toContain("occurrenceId: '11111111-2222-4333-8444-555555555555'");
  });
});
