import { Money, currency, type Currency } from '@vigil/money';
import { effectiveTime, text, uuid } from '@vigil/ledger-domain';

interface CommandFields {
  readonly bookId: string;
  readonly commandKey: string;
  readonly businessKey: string;
  readonly policyId: string;
  readonly money: Money;
  readonly effectiveAt: string;
  readonly actorId: string;
  readonly reason: string;
}

/** Independent synthetic accounting authorization, never processor evidence. */
export type AccountingCommand = CommandFields &
  (
    | { readonly kind: 'CAPTURE'; readonly originalCaptureId: null }
    | { readonly kind: 'REVERSAL'; readonly originalCaptureId: string }
  );

export interface AccountingPolicy {
  readonly bookId: string;
  readonly currency: Currency;
  readonly policyVersion: string;
  readonly receivableAccountId: string;
  readonly payableAccountId: string;
}

export interface AuthorizationResult {
  readonly id: string;
  readonly replayed: boolean;
}
export interface ExecutionResult {
  /** Immutable execution receipt identity; reversal commands reference this ID. */
  readonly id: string;
  readonly journalId: string;
  readonly replayed: boolean;
}
export interface PaymentAuthorizer {
  authorize(command: AccountingCommand): Promise<AuthorizationResult>;
}
export interface PaymentExecutor {
  execute(authorizationId: string): Promise<ExecutionResult>;
}
export interface PaymentCommands extends PaymentAuthorizer, PaymentExecutor {}

const commandKeys = [
  'bookId',
  'commandKey',
  'businessKey',
  'kind',
  'policyId',
  'money',
  'effectiveAt',
  'actorId',
  'reason',
  'originalCaptureId',
] as const;
const wireKeys = [
  ...commandKeys.filter((key) => key !== 'money'),
  'amountMinor',
  'currency',
];
const policyKeys = [
  'bookId',
  'currency',
  'policyVersion',
  'receivableAccountId',
  'payableAccountId',
];

function record(value: unknown, keys: readonly string[]) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    throw new TypeError('Expected a plain accounting command object');
  const own = Reflect.ownKeys(value);
  if (
    own.length !== keys.length ||
    own.some((key) => typeof key !== 'string' || !keys.includes(key))
  )
    throw new TypeError('Accounting fields must match the exact contract');
  return value as Record<string, unknown>;
}

function identifier(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError('Expected UUID');
  uuid(value);
  return value.toLowerCase();
}
function commandText(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError('Expected text');
  text(value);
  if (
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
      value,
    )
  )
    throw new TypeError('Accounting text must contain valid Unicode');
  return value;
}

/** Read caller-owned fields once and validate that stable value before any await. */
function snapshot(command: AccountingCommand): AccountingCommand {
  const input = record(command, commandKeys);
  const money = input['money'];
  if (!(money instanceof Money))
    throw new TypeError('Accounting amount must be Money');
  const amount = Money.of(money.amountMinor, currency(money.currency));
  if (amount.amountMinor <= 0n)
    throw new RangeError('Accounting amount must be positive');
  const effectiveAt = input['effectiveAt'];
  if (typeof effectiveAt !== 'string')
    throw new TypeError('Expected timestamp');
  effectiveTime(effectiveAt);
  if (effectiveAt.startsWith('0000-'))
    throw new TypeError('Accounting timestamp requires a nonzero year');
  const fields: CommandFields = {
    bookId: identifier(input['bookId']),
    commandKey: commandText(input['commandKey']),
    businessKey: commandText(input['businessKey']),
    policyId: identifier(input['policyId']),
    money: amount,
    effectiveAt,
    actorId: commandText(input['actorId']),
    reason: commandText(input['reason']),
  };
  const kind = input['kind'];
  const originalCaptureId = input['originalCaptureId'];
  if (kind === 'CAPTURE' && originalCaptureId === null)
    return Object.freeze({ ...fields, kind, originalCaptureId });
  if (kind === 'REVERSAL')
    return Object.freeze({
      ...fields,
      kind,
      originalCaptureId: identifier(originalCaptureId),
    });
  throw new TypeError('Capture/reversal identity does not match command kind');
}

export function validateCommand(command: AccountingCommand): void {
  snapshot(command);
}

/** Fixed fields, exact minor units and explicit null produce stable wire identity. */
export function serializeCommand(command: AccountingCommand): string {
  const c = snapshot(command);
  return JSON.stringify({
    bookId: c.bookId,
    commandKey: c.commandKey,
    businessKey: c.businessKey,
    kind: c.kind,
    policyId: c.policyId,
    amountMinor: c.money.amountMinor.toString(),
    currency: c.money.currency,
    effectiveAt: c.effectiveAt,
    actorId: c.actorId,
    reason: c.reason,
    originalCaptureId: c.originalCaptureId,
  });
}

/** Strict untrusted JSON ingress; no default currency, amount, kind or identity. */
export function commandFromJSON(value: unknown): AccountingCommand {
  const input = record(value, wireKeys);
  const code = currency(input['currency']);
  if (typeof input['amountMinor'] !== 'string')
    throw new TypeError('Accounting amount must be an exact integer string');
  const command = {
    bookId: input['bookId'],
    commandKey: input['commandKey'],
    businessKey: input['businessKey'],
    kind: input['kind'],
    policyId: input['policyId'],
    money: Money.parse(input['amountMinor'], code),
    effectiveAt: input['effectiveAt'],
    actorId: input['actorId'],
    reason: input['reason'],
    originalCaptureId: input['originalCaptureId'],
  };
  return snapshot(command as AccountingCommand);
}

/** Provisioning binds account semantics in PostgreSQL, outside runtime grants. */
export function serializePolicy(policy: AccountingPolicy): string {
  const p = record(policy, policyKeys);
  const receivableAccountId = identifier(p['receivableAccountId']);
  const payableAccountId = identifier(p['payableAccountId']);
  if (receivableAccountId === payableAccountId)
    throw new TypeError('Receivable and payable accounts must differ');
  return JSON.stringify({
    bookId: identifier(p['bookId']),
    currency: currency(p['currency']),
    policyVersion: commandText(p['policyVersion']),
    receivableAccountId,
    payableAccountId,
  });
}

export function validatePolicy(policy: AccountingPolicy): void {
  serializePolicy(policy);
}
