# ADR-022 — Independently authorized synthetic accounting

Status: accepted for the user-approved synthetic capture/full-reversal slice.
Date: 2026-11-21.

## Decision

Add a higher-level payments module with immutable policy mappings, scoped
principal bindings, exact command-bound authorizations and execution receipts.
An offline provisioner maps a synthetic book/currency/version to an asset/debit
processor receivable and liability/credit merchant payable. Captures debit the
receivable and credit the payable. A separately authorized full reversal invokes
the existing exact inverse-journal operation. This is internal synthetic
recognition, never payment initiation or external confirmation.

Separate narrow authorizer and executor database principals enforce approval
independence. Neither inherits ledger writing or receives table mutation rights.
Each approval binds the entire canonical command, including policy, amount,
currency, effective time, actor, reason and original capture identity. Exact
replay returns the same identity; conflicting command or business-key reuse
fails. A changed command key is not an alias for an old approval.

Controlled PostgreSQL routines atomically persist approvals/executions and typed
append-only audit/outbox records. Execution composes existing ledger posting or
reversal in the same transaction. New notifications register NO_LOCAL_HANDLER;
no queue or unattended financial workflow is introduced. Deferred guards require
companions and approved journal links, including when a generic ledger writer
attempts the reserved payments namespace or reversal of a payment capture.
Unique identities and targeted locks serialize duplicate execution and competing
reversals. Unknown commits recover using the unchanged semantic identity.

The payment domain depends only on Money and ledger validation; its PostgreSQL
adapter depends on that domain and existing pg. Lower-level libraries remain
independent of payments. No new third-party dependency is required. Runtime
operations, ingestion, Stripe and bank credentials gain no command capability.

## Boundaries

Migration 015 is additive; earlier migrations and financial predicates remain
intact. The integrity sweep gains structural payment-companion checks. Frozen
historical results retain their prior evidence and semantics.

Real payments, fees, revenue/tax recognition, partial captures/refunds, arbitrary
journal templates, replacements, web mutation and external-source authorization
remain deferred. Production use requires its own business policy and operational
acceptance. The simpler generic ledger remains available for other legitimate
work, with the new payment boundary protected explicitly.

## Verification

See the scoped payment integration tests and the final hardening verification
record for executed permission, exact-money, immutable-history, synchronized
contention, rollback, unknown-commit, migration-preservation and reversal checks.
