# Vigil authentication redesign

Implemented and verified locally on 2026-10-30 with installed Hallmark 2.0.0.
Design direction: **Calm Financial Workspace**. Scope: authentication presentation
and focused browser coverage. No deployment, backend, schema, financial-domain,
Stripe or Terraform changes.

## Read-only audit

Inspected the sign-in page/component, global stylesheet, original logo assets,
Better Auth service, auth route allowlist, proxy, visitor configuration and
existing auth integration tests before editing. Captured the original running
page with Playwright at 320, 375, 414, 768 and 1440px.

| Area                      | Finding and improvement                                                                                                                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hierarchy and composition | Generic centered card; content touched its edges. Replace it with an open, aligned form and a restrained desktop brand panel.                                                                           |
| Typography and spacing    | Dense 14px base text and tracked uppercase eyebrow. Use system sans, 16px field values, clear labels, deliberate spacing and sentence case.                                                             |
| Brand                     | Preserve the original lime logo, deep ink and teal action. No generated artwork, remote fonts, invented metrics or marketing sections.                                                                  |
| Usability                 | Retain field names, required semantics and password-manager autocomplete. Add email keyboard hints and a keyboard-accessible password visibility control.                                               |
| Feedback                  | Original generic errors and loading label needed guidance. Add associated inline errors, an announced loading state, duplicate-submit guard and distinct credential/rate-limit/service errors.          |
| Stability                 | During implementation, blur validation moved the submit button before its click completed. Reserve field-feedback space; the browser test now verifies that the first invalid submission focuses email. |
| Mobile                    | Original page had no horizontal overflow. Preserve that at every requested width; below 960px, show the identity and form without the desktop brand statement.                                          |
| Account access            | Make administrator provisioning explicit immediately after the form. Keep the synthetic Viewer option separate and conditional; add no unsupported account actions.                                     |

## Design and implementation

- `apps/ops/app/sign-in/page.tsx`: server-rendered desktop split, mobile identity,
  original logo, specific page title and unchanged public-demo rejection.
- `apps/ops/app/sign-in/sign-in.module.css`: scoped layout, states, instant focus
  outlines, 48px inputs/submit and a 44px password-toggle target. No animation.
- `apps/ops/app/sign-in/tokens.css`: prefixed authentication tokens derived from
  existing brand colors. No shared dashboard token is changed.
- `apps/ops/components/sign-in.tsx`: validation, visibility toggle, in-flight
  submit guard, accessible feedback and administrator-access guidance.
- `tests/helpers/auth-experience.ts`: five-width Playwright/axe checks and form
  interaction/failure coverage, called by the existing integration suite.
- `tests/auth.integration.test.ts`: retain prior assertions; add administrator
  browser sign-in, visitor-flag-off and public-demo browser/API checks.
- This directory: dated audit, screenshots, comparison and verification evidence.

The original investigation statement is retained on desktop. The tracked
“VIGIL · FINANCIAL OPERATIONS” eyebrow becomes the normal-case brand identity.
Account guidance now says to contact the administrator and explicitly preserves
disabled registration. Field labels, visitor credentials and synthetic Viewer
restriction are retained. No sign-up page is needed.

The client still posts the same email/password/`rememberMe: false` payload to
`/api/auth/sign-in/email` and redirects to `/`. Better Auth 1.7.14, cookie/session
policy, rate limits, role/book authorization, visitor feature flag and isolated
public snapshot behavior are unchanged. No database/schema or financial
invariant changes. No dependencies added.

The installed Next.js 16.4.3 [CSS guide](../../apps/ops/node_modules/next/dist/docs/01-app/01-getting-started/11-css.md)
informed the CSS Module boundary and page-level token import. React review kept
the page server-rendered and client state confined to actual form interactions.

## Screenshots

Open [the comparison](compare.html) for side-by-side views. All matching captures
use 900px viewport height, full-page capture and the enabled synthetic visitor
option. Original captures use the development server and include its existing
debug indicator; final captures use the production build. The exposed visitor
credentials are the repository's deliberately shared synthetic Viewer account,
not administrator credentials.

| Width | Before                              | After                                |
| ----- | ----------------------------------- | ------------------------------------ |
| 320   | [Original](before/sign-in-320.png)  | [Redesigned](after/sign-in-320.png)  |
| 375   | [Original](before/sign-in-375.png)  | [Redesigned](after/sign-in-375.png)  |
| 414   | [Original](before/sign-in-414.png)  | [Redesigned](after/sign-in-414.png)  |
| 768   | [Original](before/sign-in-768.png)  | [Redesigned](after/sign-in-768.png)  |
| 1440  | [Original](before/sign-in-1440.png) | [Redesigned](after/sign-in-1440.png) |

Additional captures: [visitor disabled](after/visitor-disabled-1440.png),
[invalid credentials](after/invalid-credentials-375.png),
[submission in progress](after/loading-375.png).

The previous compact layout placed more visitor details above the fold on small
screens. The redesign prioritizes the sign-in form; optional visitor details can
require scrolling. No account action or policy was removed.

## Executed verification

| Command                                                                              | Result                                                                   |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| `pnpm --filter @vigil/ops build`                                                     | PASS, production webpack build                                           |
| `pnpm typecheck`                                                                     | PASS, root and operations application                                    |
| `pnpm lint`                                                                          | PASS, including dependency/oracle boundaries                             |
| `pnpm format:check`                                                                  | PASS, repository formatting gate                                         |
| `pnpm exec tsx --test tests/operations-boundaries.test.ts tests/demo-access.test.ts` | PASS, 5 tests                                                            |
| `pnpm test:integration tests/auth.integration.test.ts`                               | PASS, 8 tests against disposable PostgreSQL 18.6 and production Chromium |

Browser coverage: all five requested widths, no horizontal overflow, one H1,
16px input values, visible submit button, password-manager attributes, skip link,
Tab/Space navigation, instant focus ring, show/hide without value loss, required
and invalid-email feedback, first-invalid-field focus, actual backend 401,
loading/disabled state, one request during repeated submission, recoverable 429,
503 and network errors, successful Admin/Viewer sign-in, sign-out, expired and
forged sessions, role/book isolation, visitor flag off, denied signup and
public-demo rejection. Only loading and service/network fault responses are
intercepted; real login, cookies, roles, signup denial and rate limits use the
unchanged backend and real PostgreSQL.

[Axe results](after/accessibility.json): zero automated WCAG A/AA violations at
320, 375, 414, 768 and 1440px. This is not a complete accessibility certification.
At the four narrower widths, axe could not determine the heading background and
left `color-contrast` incomplete. A [targeted browser check](after/heading-contrast.json)
confirmed the heading's 14.36:1 computed contrast and unobscured rectangle at all
five widths. Automated scans do not replace assistive-technology review.

Hallmark scoped static sweep: **0 FAIL, 0 REFLEX, 0 open WARN**; one short-caption
measure warning dismissed under gate 25's lede exception. Kept-record check:
2/2 fields and the existing submit handler preserved. The initial full global
stylesheet audit also reported dashboard findings outside this task's scope;
they were not treated as authentication defects or repaired here.

Hallmark's `--render` tier was attempted but could not run because Puppeteer is
not installed. Playwright supplied the visual/interaction evidence. The finish
review ran in-thread under Hallmark's Codex guidance; no independent-agent
review or Hallmark rendering pass is claimed.

Not run: complete financial integration suite, other browser engines, physical
mobile devices or assistive-technology testing. Password-manager compatibility
is supported by retained native fields/autocomplete, not a third-party manager
certification. Registration, recovery and access-request backends remain
intentionally unavailable. No deployment or external publication was performed.
