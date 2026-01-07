export function logHeader(title: string): void {
  console.log(`\n=== ${title} ===`);
}

export function formatPercent(value: number): string {
  return `${value.toFixed(2)}%`;
}
