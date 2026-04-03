export function formatCurrency(amountMinor: number, currency = 'EUR') {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency,
  }).format(amountMinor / 100);
}
