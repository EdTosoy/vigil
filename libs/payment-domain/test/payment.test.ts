import assert from 'node:assert/strict';
import { test } from 'node:test';
import fc from 'fast-check';
import { Money, MAX_MINOR_UNITS, type Currency } from '@vigil/money';
import {
  commandFromJSON,
  serializeCommand,
  serializePolicy,
  validateCommand,
  type AccountingCommand,
  type AccountingPolicy,
} from '../src';

const bookId = '11111111-1111-4111-8111-111111111111';
const policyId = '22222222-2222-4222-8222-222222222222';
const receiptId = '33333333-3333-4333-8333-333333333333';
const receivableAccountId = '44444444-4444-4444-8444-444444444444';
const payableAccountId = '55555555-5555-4555-8555-555555555555';
function capture(
  amount = 9007199254740993n,
  code: Currency = 'PHP',
): AccountingCommand {
  return {
    bookId,
    commandKey: 'approve:capture-1',
    businessKey: 'capture-1',
    kind: 'CAPTURE',
    policyId,
    money: Money.of(amount, code),
    effectiveAt: '2026-11-21T00:00:00.000Z',
    actorId: 'offline-authorizer',
    reason: 'Approved synthetic capture expectation',
    originalCaptureId: null,
  };
}
function policy(): AccountingPolicy {
  return {
    bookId,
    policyVersion: 'synthetic-capture-v1',
    currency: 'PHP',
    receivableAccountId,
    payableAccountId,
  };
}

test('wire representation retains exact unsafe-number money and explicit capture identity', () => {
  const command = capture();
  const wire = JSON.parse(serializeCommand(command)) as Record<string, unknown>;
  assert.equal(wire['amountMinor'], '9007199254740993');
  assert.equal(wire['currency'], 'PHP');
  assert.equal(wire['originalCaptureId'], null);
  assert(!Object.hasOwn(wire, 'money'));
  assert.deepEqual(
    Object.keys(wire).sort(),
    [
      'bookId',
      'commandKey',
      'businessKey',
      'kind',
      'policyId',
      'amountMinor',
      'currency',
      'effectiveAt',
      'actorId',
      'reason',
      'originalCaptureId',
    ].sort(),
  );
  assert.equal(
    serializeCommand(commandFromJSON(wire)),
    serializeCommand(command),
  );
  assert(Object.isFrozen(commandFromJSON(wire)));
});

test('kind requires a deliberate capture/null or full-reversal/execution-receipt identity', () => {
  const original = capture();
  const reversal: AccountingCommand = {
    ...original,
    kind: 'REVERSAL',
    originalCaptureId: receiptId,
  };
  validateCommand(reversal);
  assert.equal(
    commandFromJSON(JSON.parse(serializeCommand(reversal))).originalCaptureId,
    receiptId,
  );
  for (const invalid of [
    { ...original, kind: 'CAPTURE', originalCaptureId: receiptId },
    { ...original, kind: 'REVERSAL', originalCaptureId: null },
    { ...original, kind: 'REFUND' },
    { ...original, originalCaptureId: undefined },
  ])
    assert.throws(() => serializeCommand(invalid as AccountingCommand));
});

test('positive Money, every field and supported currencies are required without defaults', () => {
  for (const amount of [0n, -1n])
    assert.throws(() => serializeCommand(capture(amount)), /positive/);
  const wire = JSON.parse(serializeCommand(capture())) as Record<
    string,
    unknown
  >;
  for (const amountMinor of [
    '01',
    '-1',
    '0',
    '1.0',
    '1e3',
    ' 1',
    '+1',
    '9223372036854775808',
    9007199254740992,
  ])
    assert.throws(() => commandFromJSON({ ...wire, amountMinor }));
  for (const currency of ['EUR', 'php', '', null, 2])
    assert.throws(() => commandFromJSON({ ...wire, currency }));
  for (const key of Object.keys(wire)) {
    const missing = { ...wire };
    delete missing[key];
    assert.throws(() => commandFromJSON(missing), 'missing ' + key);
  }
  assert.throws(
    () =>
      serializeCommand({
        ...capture(),
        money: { amountMinor: 1n, currency: 'PHP' },
      } as AccountingCommand),
    /Money/,
  );
});

test('commands reject arbitrary journal fields, invalid UUIDs, dates and noncanonical text', () => {
  for (const extra of [
    'entries',
    'journalId',
    'amountMinor',
    'currency',
    'approved',
    '__proto__',
  ]) {
    const command = Object.defineProperty({ ...capture() }, extra, {
      value: [],
      enumerable: true,
    });
    assert.throws(() => serializeCommand(command), /exact contract/);
  }
  for (const key of ['bookId', 'policyId'])
    assert.throws(() =>
      serializeCommand({ ...capture(), [key]: 'not-a-uuid' }),
    );
  for (const effectiveAt of [
    '2026-11-21',
    '2026-11-21T00:00:00Z',
    '2026-11-21T00:00:00.000+00:00',
    '2026-02-30T00:00:00.000Z',
    '0000-01-01T00:00:00.000Z',
    '2026-11-21T00:00:00.0000Z',
  ])
    assert.throws(() => serializeCommand({ ...capture(), effectiveAt }));
  for (const key of ['commandKey', 'businessKey', 'actorId', 'reason'])
    for (const value of ['', ' padded ', 'a\0b', '\ud800', 'x'.repeat(513)])
      assert.throws(
        () => serializeCommand({ ...capture(), [key]: value }),
        key,
      );
  assert.throws(
    () =>
      commandFromJSON({
        ...JSON.parse(serializeCommand(capture())),
        approved: true,
      }),
    /exact contract/,
  );
  assert.throws(
    () => serializeCommand(Object.assign(Object.create({}), capture())),
    /plain/,
  );
  assert.throws(
    () => serializeCommand({ ...capture(), [Symbol('unapproved')]: true }),
    /exact contract/,
  );
});

test('serialization snapshots caller fields once and ignores insertion order', () => {
  const original = capture();
  const reversed = Object.fromEntries(
    Object.entries(original).reverse(),
  ) as AccountingCommand;
  assert.equal(serializeCommand(original), serializeCommand(reversed));
  let reads = 0;
  const mutable = { ...original };
  Object.defineProperty(mutable, 'businessKey', {
    enumerable: true,
    get() {
      reads++;
      return reads === 1 ? 'approved-original' : 'changed-after-snapshot';
    },
  });
  const serialized = serializeCommand(mutable);
  assert.equal(reads, 1);
  assert.equal(JSON.parse(serialized).businessKey, 'approved-original');
});

test('policy serialization accepts only an explicit independent account mapping', () => {
  assert.deepEqual(JSON.parse(serializePolicy(policy())), policy());
  assert.throws(
    () =>
      serializePolicy({ ...policy(), payableAccountId: receivableAccountId }),
    /differ/,
  );
  assert.throws(() =>
    serializePolicy({
      ...policy(),
      currency: 'EUR',
    } as unknown as AccountingPolicy),
  );
  assert.throws(
    () => serializePolicy({ ...policy(), entries: [] } as AccountingPolicy),
    /exact contract/,
  );
  assert.throws(() => serializePolicy({ ...policy(), policyVersion: '' }));
});

test('property: all supported positive BIGINT amounts retain value, scope and reversal identity through JSON', () => {
  fc.assert(
    fc.property(
      fc.bigInt({ min: 1n, max: MAX_MINOR_UNITS }),
      fc.constantFrom<Currency>('PHP', 'USD'),
      fc.boolean(),
      (amount, code, reversing) => {
        const command: AccountingCommand = reversing
          ? {
              ...capture(amount, code),
              kind: 'REVERSAL',
              originalCaptureId: receiptId,
            }
          : capture(amount, code);
        const serialized = serializeCommand(command);
        const restored = commandFromJSON(JSON.parse(serialized));
        assert(restored.money.equals(command.money));
        assert.equal(restored.kind, command.kind);
        assert.equal(restored.originalCaptureId, command.originalCaptureId);
        assert.equal(serializeCommand(restored), serialized);
      },
    ),
    { numRuns: 500, seed: 150021 },
  );
});
