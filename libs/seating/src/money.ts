/**
 * Деньги продаж приходят с сервера целыми минорными единицами (`amountMinor`). Показывать их
 * покупателю напрямую нельзя: 450000 — это 4 500 AMD. Перевод в основные единицы делается
 * только для отображения; арифметика и сравнение сумм остаются в минорных единицах.
 */
const minorDigitsByCurrency: Record<string, number> = { AMD: 2 };

export function formatMoney(amountMinor: number, currency: string, locale = 'ru-RU'): string {
  const digits = minorDigitsByCurrency[currency] ?? 2;
  const amount = amountMinor / 10 ** digits;
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    currencyDisplay: 'code',
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  }).format(amount);
}
