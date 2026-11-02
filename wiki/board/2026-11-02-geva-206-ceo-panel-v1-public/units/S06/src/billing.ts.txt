export type Subscription = {
  id: string; customer: string; product: string;
  annualCents: number; starts: number; ends: number; active: boolean;
};
export type Invoice = { subscription: string; cents: number; due: number };

export function register(ledger: Subscription[], entry: Subscription): void {
  if (ledger.some(s => s.id === entry.id)) throw new Error('Repeated subscription');
  if (entry.annualCents < 0 || entry.ends <= entry.starts) throw new Error('Invalid terms');
  ledger.push({ ...entry });
}

export function invoice(entry: Subscription): Invoice {
  return { subscription: entry.id, cents: entry.annualCents, due: entry.starts };
}

export function renew(entry: Subscription, nextEnd: number): Subscription {
  if (!entry.active || nextEnd <= entry.ends) throw new Error('Cannot renew');
  return { ...entry, starts: entry.ends, ends: nextEnd };
}

export function cancel(entry: Subscription, at: number): { entry: Subscription; credit: number } {
  if (!entry.active) return { entry, credit: 0 };
  const remaining = Math.max(0, Math.min(entry.ends - entry.starts, entry.ends - at));
  return {
    entry: { ...entry, active: false },
    credit: Math.round(entry.annualCents * remaining / (entry.ends - entry.starts))
  };
}
