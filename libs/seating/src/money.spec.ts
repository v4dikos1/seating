import { describe, expect, it } from 'vitest'

import { formatMoney } from './money'

const normalize = (value: string) => value.replace(/\s/g, ' ')

describe('formatMoney', () => {
  it('shows whole drams for minor units', () => {
    expect(normalize(formatMoney(450000, 'AMD'))).toBe('4 500 AMD')
  })

  it('keeps lumas when the amount is not whole', () => {
    expect(normalize(formatMoney(450050, 'AMD'))).toBe('4 500,5 AMD')
  })

  it('shows zero', () => {
    expect(normalize(formatMoney(0, 'AMD'))).toBe('0 AMD')
  })
})
