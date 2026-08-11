# OB AI Papers ingestion and loading reliability design

## Goal

Eliminate two confirmed production failures: duplicate source records rolling back neighboring inserts, and client data requests leaving pages in an infinite loading state. Repair the most recent 30 days of affected data without performing a full-history backfill.

## Scope

- Cover daily Crossref, OpenAlex, and arXiv ingestion plus the historical English and arXiv import entry points.
- Keep the existing global uniqueness rule on `(source, source_record_id)`.
- Backfill papers published from 2026-07-12 through 2026-08-11 only.
- Add reliable loading failure behavior to the home, recent, favorites, about, and paper-detail pages.
- Preserve unrelated project behavior, scoring thresholds, and visual design.

## Ingestion design

Create a focused raw-record writer in `src/pipeline/raw_ingest.py`. Each insert runs inside `session.begin_nested()`, so an expected unique-key conflict rolls back only that savepoint. The writer returns an explicit inserted/duplicate outcome and raises contextual errors for all non-duplicate database failures.

Every ingestion run records three separate values while executing: API candidates, inserted rows, and duplicates. `SourceRun.records_fetched` represents rows actually inserted. Before a successful run commits, query the number of raw records associated with the run and require it to equal the inserted counter. A mismatch fails the run instead of publishing a false success.

The daily and historical entry points call the same writer, preventing a bypass from retaining the old transaction behavior. Network/source failures remain run-level failures and retain their error message.

## Frontend design

Add a shared `fetchJson` helper that:

- aborts after 15 seconds;
- rejects non-2xx responses with the URL and status;
- converts network and timeout failures into concise Chinese messages.

Add one reusable error component with a retry button. Every data page owns `loading`, `error`, and a retry key. Effects clear the prior error, ignore updates after unmount, and always leave loading state in `finally`. Successful behavior and rendering remain unchanged.

## Backfill and release design

Download the latest `db-snapshot` Release asset to a temporary directory. Run the corrected ingestion over the latest 30-day publication window, normalize new raw rows, process only the resulting recent papers through the existing scoring/enrichment pipeline, and export web JSON/RSS. Reject or remove newly created papers outside the approved publication window before publishing.

Validate SQLite integrity, inserted-versus-persisted counts, recent date scope, score/output completeness for published papers, and web export consistency. Commit exported web data on the feature branch. After code is merged and the production deployment succeeds, replace the Release database asset and verify its SHA-256 digest.

## Testing

- Unit-test duplicate isolation, preservation of neighboring inserts, non-duplicate error propagation, and persisted-count assertions.
- Integration-test daily Crossref/OpenAlex/arXiv counters and run status.
- Run the complete Python test suite, compileall, `git diff --check`, and the Next.js production build.
- Browser-test normal loading, forced data-request failure, retry recovery, a recent paper detail page, console errors, and production deployment.

## Rollback

The code change is isolated to a squashable PR. The previous database snapshot remains recoverable from the downloaded source and local temporary copy until production verification completes. If production fails, restore the previous Release asset and revert the merge commit.
