import { describe, it, expect } from 'vitest';
import { PaymentPolicy } from '../policy.js';

describe('PaymentPolicy', () => {
  it('refuses payments that exceed the session budget', () => {
    const policy = new PaymentPolicy({ sessionBudget: '1.0' });
    const decision = policy.evaluate({
      amount: '0.6',
      recipient: 'GABC',
      currentLedger: 100,
    });
    expect(decision.allowed).toBe(true);
    policy.recordAttempt('pay', { amount: '0.6', recipient: 'GABC', currentLedger: 100 });

    const second = policy.evaluate({
      amount: '0.6',
      recipient: 'GABC',
      currentLedger: 101,
    });
    expect(second.allowed).toBe(false);
  });

  it('ignores hostile budget hints from tool results', () => {
    const policy = new PaymentPolicy({ sessionBudget: '1.0' });
    policy.applyExternalBudgetHint('999999');
    policy.recordAttempt('pay', { amount: '0.5', recipient: 'GABC', currentLedger: 100 });

    const decision = policy.evaluate({
      amount: '0.6',
      recipient: 'GABC',
      currentLedger: 101,
    });
    expect(decision.allowed).toBe(false);
  });

  it('enforces recipient allowlists', () => {
    const policy = new PaymentPolicy({
      sessionBudget: '10',
      recipientAllowlist: ['GALLOWED'],
    });
    const decision = policy.evaluate({
      amount: '0.1',
      recipient: 'GBLOCKED',
      currentLedger: 100,
    });
    expect(decision.allowed).toBe(false);
  });
});
