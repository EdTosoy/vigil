import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { Overview, Integrity } from '../components/views';
import { object, type Model } from '../components/model';
import {
  overviewBook as book,
  overviewEvaluation as evaluation,
  alternateEvaluation,
  overviewChoices,
  overviewFixture,
  overviewRun,
  overviewCase,
} from './overview-fixtures';

const render = (
  model = overviewFixture(),
  selected: string | null = evaluation,
  choices: Model | null = overviewChoices,
) =>
  renderToStaticMarkup(
    <Overview
      model={model}
      book={book}
      evaluation={selected ?? undefined}
      evaluations={choices}
    />,
  );
const links = (html: string) =>
  [...html.matchAll(/href="([^"]+)"/g)].map(
    (match) => new URL(match[1]!.replaceAll('&amp;', '&'), 'http://local'),
  );
const selectedBlock = (html: string) =>
  html.slice(
    html.indexOf('id="evaluation-scope"'),
    html.indexOf('aria-label="Selected evaluation exposure"'),
  );

test('Overview puts assurance, exact book and selected evaluation beside its selector before exposure', () => {
  const html = render();
  assert(html.includes('UI-fixture-book'));
  assert(html.includes('synthetic'));
  assert(html.includes('Book <span class="identifier">' + book));
  assert(selectedBlock(html).includes(evaluation));
  assert(
    html.indexOf('Current financial assurance') <
      html.indexOf('id="evaluation-scope"'),
  );
  assert(
    html.indexOf('id="evaluation-scope"') <
      html.indexOf('Unreconciled exposure'),
  );
  assert(html.includes('CURRENT'));
  assert(html.includes('UNCHANGED_INPUTS'));
  assert(html.includes('PHP 1,250,043.25'));
  assert(!html.includes('Latest completed evaluation'));
});

test('explicit evaluation changes replace the corresponding presentation and clear unrelated URL state', () => {
  const model = overviewFixture();
  const e = object(model.data!['evaluation']);
  e['id'] = alternateEvaluation;
  e['version'] = 'controls_v2.0-EXACT';
  e['exposure'] = [];
  const html = render(model, alternateEvaluation);
  assert(selectedBlock(html).includes('controls_v2.0-EXACT'));
  assert(!html.includes('PHP 1,250,043.25'));
  assert.match(
    html,
    new RegExp('option value="' + alternateEvaluation + '" selected=""'),
  );
  const form = html.slice(html.indexOf('<form'), html.indexOf('</form>'));
  assert(form.includes('method="get"'));
  assert(form.includes('name="book" value="' + book));
  for (const key of ['cursor', 'from', 'status', 'id', 'key'])
    assert(!form.includes('name="' + key + '"'));
});

test('a reported historical PASS remains separate from STALE applicability and the current sweep', () => {
  const model = overviewFixture();
  Object.assign(object(model.data!['evaluation']), {
    assurance: 'PASS',
    current: false,
    currentReason: 'INPUTS_CHANGED',
  });
  object(model.data!['integrity'])['financialAssurance'] = 'UNKNOWN';
  const html = render(model);
  assert(selectedBlock(html).includes('PASS'));
  assert(selectedBlock(html).includes('STALE'));
  assert(
    selectedBlock(html).includes(
      'This result does not establish current assurance.',
    ),
  );
  const current = html.slice(
    html.indexOf('class="overview-current"'),
    html.indexOf('id="evaluation-scope"'),
  );
  assert(current.includes('UNKNOWN'));
  assert(current.includes('No single cause is supplied'));
});

test('incomplete, unsupported and missing currentness remain explicit without timestamp inference', () => {
  for (const [current, currentReason, expected] of [
    [false, 'INCOMPLETE', 'INCOMPLETE'],
    [false, 'CURRENT_POPULATION_UNSUPPORTED', 'UNKNOWN'],
    [undefined, 'UNCHANGED_INPUTS', 'UNKNOWN'],
  ] as const) {
    const model = overviewFixture();
    const e = object(model.data!['evaluation']);
    Object.assign(e, {
      assurance: 'UNKNOWN',
      currentReason,
      state: 'EVALUATING',
    });
    if (current === undefined) delete e['current'];
    else e['current'] = current;
    const html = selectedBlock(render(model));
    assert(html.includes(expected));
    assert(!html.includes('> CURRENT<'));
    assert(html.includes('EVALUATING'));
  }
});

test('a current evaluation does not replace a failed current sweep with its own PASS', () => {
  const model = overviewFixture();
  object(model.data!['integrity'])['financialAssurance'] = 'FAIL';
  object(model.data!['evaluation'])['assurance'] = 'PASS';
  const html = render(model);
  assert(selectedBlock(html).includes('CURRENT'));
  const current = html.slice(
    html.indexOf('class="overview-current"'),
    html.indexOf('id="evaluation-scope"'),
  );
  assert(current.includes('FAIL'));
  assert(!current.includes('PASS</span></p><p>Read-time'));
});

test('no evaluation is automatically selected by a timestamp or by populated choices', () => {
  const model = overviewFixture();
  const html = render(model, null);
  assert(html.includes('No evaluation selected'));
  assert(html.includes('Assurance: UNKNOWN for unselected frozen controls'));
  assert(!html.includes('PHP 1,250,043.25'));
  assert(!links(html).some((href) => href.searchParams.has('evaluation')));
  assert.match(html, /option value="" selected=""/);
});

test('missing or foreign selected evaluation evidence never leaks another scope into destinations', () => {
  for (const wrong of [
    null,
    { id: evaluation, bookId: alternateEvaluation },
    { id: alternateEvaluation, bookId: book },
  ]) {
    const model = overviewFixture();
    model.data!['evaluation'] = wrong;
    const html = render(model);
    assert(html.includes('unavailable in this book'));
    assert(html.includes('No alternative evaluation was selected'));
    assert(!html.includes('PHP 1,250,043.25'));
    assert(!links(html).some((href) => href.searchParams.has('evaluation')));
    assert(
      links(html)
        .filter((href) => href.searchParams.has('book'))
        .every(
          (href) =>
            href.searchParams.get('book') === book ||
            href.searchParams.get('book') === '',
        ),
    );
  }
});

test('genuine zero counts and absent evaluation results differ from unavailable evidence', () => {
  const zero = overviewFixture();
  const sweep = object(zero.data!['integrity']);
  object(sweep['open'])['exceptions'] = 0;
  object(sweep['work'])['terminal'] = 0;
  Object.assign(object(zero.data!['evaluation']), {
    reconciliation: [],
    exposure: [],
  });
  const html = render(zero);
  assert(html.includes('No open operational cases in this sweep'));
  assert(html.includes('No terminal work recorded in this sweep'));
  assert(
    html.includes('No reconciliation results were recorded in this evaluation'),
  );
  assert(html.includes('No selected mapping exposure. UNKNOWN'));
  assert(!html.includes('PHP 0.00'));
  sweep['open'] = {};
  sweep['work'] = {};
  delete object(zero.data!['evaluation'])['exposure'];
  const missing = render(zero);
  assert(missing.includes('Unavailable (not supplied)'));
  assert(!missing.includes('No open operational cases in this sweep'));
  assert(!missing.includes('No terminal work recorded in this sweep'));
  assert(missing.includes('Exposure evidence is unavailable'));
});

test('unavailable current data and evaluation choices are explicit and never an empty healthy result', () => {
  const model = overviewFixture();
  model.data!['integrity'] = null;
  const html = render(model, evaluation, null);
  assert(html.includes('Current sweep evidence is unavailable'));
  assert(html.includes('Evaluation choices are unavailable'));
  assert(html.includes('Check evidence unavailable'));
  assert(!html.includes('No open operational cases in this sweep'));
  const noChoices = render(model, null, { ...overviewChoices, items: [] });
  assert(
    noChoices.includes('No evaluations are available on this results page'),
  );
});

test('investigation links preserve selected scope and only supplied record relationships', () => {
  const html = render();
  const destinations = links(html);
  for (const path of [
    '/exceptions',
    '/workers',
    '/reconciliation',
    '/controls',
    '/integrity',
  ]) {
    const href = destinations.find((href) => href.pathname === path)!;
    assert(href, path);
    assert.equal(href.searchParams.get('book'), book);
    assert.equal(href.searchParams.get('evaluation'), evaluation);
    assert(!href.searchParams.has('from'));
    assert(!href.searchParams.has('cursor'));
  }
  assert(
    destinations.some(
      (href) => href.pathname === '/reconciliation/' + overviewRun,
    ),
  );
  assert(
    destinations.some(
      (href) => href.pathname === '/exceptions/' + overviewCase,
    ),
  );
  const terminal = destinations.find(
    (href) => href.pathname === '/workers' && href.searchParams.get('status'),
  )!;
  assert.equal(terminal.searchParams.get('status'), 'FAILED_TERMINAL');
  assert(html.includes('not a source-period detail route'));
  const integrity = renderToStaticMarkup(
    <Integrity model={overviewFixture()} book={book} evaluation={evaluation} />,
  );
  for (const href of destinations.filter(
    (href) => href.pathname === '/integrity' && href.hash,
  ))
    assert(integrity.includes('id="' + href.hash.slice(1) + '"'));
});

test('evaluation choice pagination retains scope and limit, while selection starts a new page', () => {
  const html = renderToStaticMarkup(
    <Overview
      model={overviewFixture()}
      book={book}
      evaluation={evaluation}
      evaluations={{ ...overviewChoices, nextCursor: 'opaque-next-page' }}
      filters={{ limit: '1' }}
    />,
  );
  const next = links(html).find((href) => href.searchParams.has('cursor'))!;
  assert.equal(next.searchParams.get('book'), book);
  assert.equal(next.searchParams.get('evaluation'), evaluation);
  assert.equal(next.searchParams.get('limit'), '1');
  assert.equal(next.hash, '#evaluation-scope');
  assert(html.includes('name="limit" value="1"'));
});

test('an existing validated investigation origin survives evidence links, but evaluation switching starts fresh', () => {
  const from = JSON.stringify({
    book,
    section: 'workers',
    evaluation,
    filters: { status: 'FAILED_TERMINAL', limit: '1' },
  });
  const html = renderToStaticMarkup(
    <Overview
      model={overviewFixture()}
      book={book}
      evaluation={evaluation}
      evaluations={overviewChoices}
      from={from}
    />,
  );
  for (const href of links(html).filter((href) =>
    [
      '/integrity',
      '/controls',
      '/exceptions',
      '/workers',
      '/reconciliation',
    ].some((path) => href.pathname.startsWith(path)),
  ))
    assert.equal(href.searchParams.get('from'), from);
  const form = html.slice(html.indexOf('<form'), html.indexOf('</form>'));
  assert(!form.includes('name="from"'));
});

test('several control relationships to the same case produce one bounded destination per record', () => {
  const model = overviewFixture();
  const ids = Array.from(
    { length: 6 },
    (_, i) => '66666666-6666-4666-8666-' + String(i).padStart(12, '0'),
  );
  object(model.data!['evaluation'])['cases'] = ids.flatMap((caseId) => [
    { key: 'source_period:one', caseId },
    { key: 'source_period:two', caseId },
  ]);
  const html = render(model);
  const destinations = links(html).filter((href) =>
    href.pathname.startsWith('/exceptions/'),
  );
  assert.equal(destinations.length, 5);
  assert.equal(new Set(destinations.map((href) => href.pathname)).size, 5);
  assert(html.includes('Showing five supplied case links'));
  assert(!destinations.some((href) => href.pathname.endsWith(ids[5]!)));
});

test('a DRAFT evaluation is incomplete without a claim that its inputs were frozen', () => {
  const model = overviewFixture();
  Object.assign(object(model.data!['evaluation']), {
    state: 'DRAFT',
    frozenAt: null,
    completedAt: null,
    current: false,
    currentReason: 'INCOMPLETE',
    assurance: 'UNKNOWN',
    exposure: [],
  });
  const html = render(model);
  assert(selectedBlock(html).includes('DRAFT'));
  assert(selectedBlock(html).includes('INCOMPLETE'));
  assert(html.includes('Not recorded'));
  assert(!html.includes('From selected frozen evaluation'));
  assert(!html.includes('PHP 0.00'));
});
