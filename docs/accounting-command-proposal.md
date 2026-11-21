# Proposed authorized accounting slice

Status: the user approved this precise synthetic slice on 2026-11-21. Its
implementation decision is recorded in [ADR-022](architecture/adr/022-synthetic-authorized-accounting.md).
Executed verification is recorded separately; approval does not establish test
success or production accounting policy.

The audit follow-up authorizes reliability, verification and operational work,
then independent payment commands and accounting orchestration. ADR-004 requires
domain approval of accounting templates. ADR-011 keeps processor observations
separate from internal authorization. The following is the smallest proposed
financial slice; the hardening work can proceed independently.

## Proposed boundary

Support synthetic books only. Introduce an independently authorized synthetic
capture-recognition command and full reversal. This records a synthetic internal
accounting expectation; it neither initiates a payment nor proves processor
capture, settlement, bank receipt or source completeness.

The proposed fixed capture template debits a configured processor-receivable
asset account and credits a configured merchant-payable liability account for
the same positive exact amount and currency. The template makes no revenue,
tax, fee, FX or bank-recognition claim. An offline provisioner fixes the book,
currency, accounts and version. Accounts must belong to that synthetic book and
have the required classifications and normal sides.

An offline authorizer capability approves the complete semantic command,
including business identity, amount, currency, effective time, reason and policy
version. An independent executor capability can execute that exact authorization
but cannot create or change approvals. Neither the operations app nor a Stripe,
ingestion or normalization credential receives either capability.

Approvals and execution receipts are immutable. Execution atomically binds the
authorization to the journal, receipt, audit and outbox using the existing ledger
posting functions. Replays converge on one journal; conflicting reuse fails.
Database constraints and controlled routines protect this even under concurrency
and direct SQL. Unknown commits recover through the unchanged command identity.

A separately authorized full reversal references the original capture and uses
the existing exact inverse-entry routine. Original history is preserved.
Partial capture/refund, replacement, arbitrary journals, real payments, money
movement, live Stripe, web mutations and production recognition remain outside
this first slice.

## Acceptance before claiming implementation

- Exact-money and command-canonicalization unit/property tests.
- Real PostgreSQL permission, book/currency/account-policy and immutability tests.
- Missing, changed, wrong-kind and wrong-book authorization rejection.
- Synchronized duplicate/conflicting execution and competing reversal tests.
- Rollback, transaction composition and unknown-COMMIT recovery tests.
- Atomic command/journal/approval/audit/outbox linkage and retained history.
- No automatic accounting from external processor or bank observations.
- Existing migration, financial, oracle and read-only application gates retained.

## Approved decision

The user approved this synthetic capture/full-reversal template and capability
separation. A different financial template still requires its actual business
model and recognition policy. This approval does not authorize cloud changes or
production use.
