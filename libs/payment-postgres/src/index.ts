import type { Pool, PoolClient } from 'pg';
import {
  serializeCommand,
  serializePolicy,
  type AccountingCommand,
  type AccountingPolicy,
  type AuthorizationResult,
  type ExecutionResult,
  type PaymentCommands,
} from '@vigil/payment-domain';

export type PaymentRecoveryIdentity =
  | {
      readonly operation: 'authorize';
      readonly bookId: string;
      readonly commandKey: string;
    }
  | { readonly operation: 'execute'; readonly authorizationId: string };

export class UnknownPaymentCommit extends Error {
  readonly identity: PaymentRecoveryIdentity;
  constructor(identity: PaymentRecoveryIdentity, options: ErrorOptions) {
    super(
      'Payment commit outcome unknown; recover using the unchanged identity',
      options,
    );
    this.identity = Object.freeze({ ...identity });
  }
  get operation() {
    return this.identity.operation;
  }
}
export class PaymentDatabaseError extends Error {
  constructor(
    readonly code: string,
    options: ErrorOptions,
  ) {
    super('Accounting database command rejected (' + code + ')', options);
  }
}
function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
    ? error.code
    : undefined;
}
function authorizationIdentifier(value: string): string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    throw new TypeError('Expected authorization UUID');
  return value.toLowerCase();
}

/** Caller owns the transaction and original-identity recovery; SQL enforces its capability. */
export function paymentCommandsInTransaction(
  client: PoolClient,
): PaymentCommands {
  return {
    async authorize(command) {
      const payload = serializeCommand(command);
      return (
        await client.query<{ result: AuthorizationResult }>(
          'SELECT payments.authorize($1::jsonb) AS result',
          [payload],
        )
      ).rows[0]!.result;
    },
    async execute(id) {
      const authorizationId = authorizationIdentifier(id);
      return (
        await client.query<{ result: ExecutionResult }>(
          'SELECT payments.execute($1::uuid) AS result',
          [authorizationId],
        )
      ).rows[0]!.result;
    },
  };
}

/** Explicit offline provisioner only; this function never acquires an owner credential. */
export async function configurePolicyInTransaction(
  client: PoolClient,
  policy: AccountingPolicy,
): Promise<string> {
  const payload = serializePolicy(policy);
  return (
    await client.query<{ id: string }>(
      'SELECT payments.configure_policy($1::jsonb) AS id',
      [payload],
    )
  ).rows[0]!.id;
}

/** Independently provisioned authorizer/executor pools; no ambient database configuration. */
export class PostgresPayments implements PaymentCommands {
  constructor(
    private readonly authorizer: Pool,
    private readonly executor: Pool,
  ) {
    if (authorizer === executor)
      throw new TypeError(
        'Authorization and execution require separate scoped pools',
      );
  }
  async authorize(command: AccountingCommand): Promise<AuthorizationResult> {
    // Snapshot before waiting for a connection or attempting a retry.
    const payload = serializeCommand(command);
    const identity = JSON.parse(payload) as {
      bookId: string;
      commandKey: string;
    };
    return this.write(
      this.authorizer,
      'SELECT payments.authorize($1::jsonb) AS result',
      payload,
      {
        operation: 'authorize',
        bookId: identity.bookId,
        commandKey: identity.commandKey,
      },
    );
  }
  async execute(id: string): Promise<ExecutionResult> {
    const authorizationId = authorizationIdentifier(id);
    return this.write(
      this.executor,
      'SELECT payments.execute($1::uuid) AS result',
      authorizationId,
      { operation: 'execute', authorizationId },
    );
  }
  private async write<T>(
    pool: Pool,
    sql: string,
    value: string,
    identity: PaymentRecoveryIdentity,
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const client = await pool.connect();
      let committing = false;
      let discard = false;
      const onError = () => {
        discard = true;
      };
      client.on('error', onError);
      try {
        await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        await client.query(
          "SET LOCAL synchronous_commit=on; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s'; SET LOCAL idle_in_transaction_session_timeout='30s'",
        );
        const result = await client.query<{ result: T }>(sql, [value]);
        committing = true;
        await client.query('COMMIT');
        return result.rows[0]!.result;
      } catch (error) {
        const code = errorCode(error);
        try {
          await client.query('ROLLBACK');
        } catch {
          discard = true;
        }
        if ((code === '40001' || code === '40P01') && attempt < 4) {
          await new Promise((resolve) =>
            setTimeout(resolve, 10 * 2 ** attempt),
          );
          continue;
        }
        if (committing && !(code && /^(22|23|40|42|P[1-9])/.test(code))) {
          discard = true;
          throw new UnknownPaymentCommit(identity, { cause: error });
        }
        if (code) throw new PaymentDatabaseError(code, { cause: error });
        throw error;
      } finally {
        client.removeListener('error', onError);
        client.release(discard);
      }
    }
  }
}
