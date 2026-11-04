#!/bin/bash
# Local end-to-end test: a throw-away Postgres (any 16+) stands in for Supabase, the mock serves Auth + rpc on localhost:8080.
# Needs: psql + a running Postgres (PGARGS, default "-h /tmp -p 5499 -U postgres -d dame"), node 20+, playwright (PLAYWRIGHT_ROOT = its node_modules), Chrome (CHROME).
# Creates the database from scratch: supabase-stub.sql, db/core/001_init.sql, core tests, seed, demo SQL, demo tests, then the browser run.
set -e
cd "$(dirname "$0")/../.."
: "${PGARGS:=-h /tmp -p 5499 -U postgres -d dame}"
DB=$(echo "$PGARGS" | sed -n 's/.*-d \([^ ]*\).*/\1/p')
ADMIN=$(echo "$PGARGS" | sed "s/-d $DB/-d postgres/")
psql $ADMIN -qc "drop database if exists $DB" ; psql $ADMIN -qc "create database $DB"
psql $PGARGS -q -v ON_ERROR_STOP=1 -f tools/test/supabase-stub.sql
psql $PGARGS -q -v ON_ERROR_STOP=1 -f db/core/001_init.sql
psql $PGARGS -q -v ON_ERROR_STOP=1 -f db/core/002_email_domain.sql
psql $PGARGS -q -v ON_ERROR_STOP=1 -f db/core/003_email_domain.sql
psql $PGARGS -q -v ON_ERROR_STOP=1 -f db/core/tests.sql 2>&1 | grep -E 'ERROR|PASSED'
psql $PGARGS -q -v ON_ERROR_STOP=1 -f db/core/seed-staging.sql > /dev/null
psql $PGARGS -q -v ON_ERROR_STOP=1 -f demo/db/demo/001_init.sql > /dev/null
psql $PGARGS -q -v ON_ERROR_STOP=1 -f demo/db/demo/tests.sql 2>&1 | grep -E 'ERROR|PASSED'
psql $PGARGS -c "select * from core.security_check()"
mkdir -p tools/test/out
node tools/test/mock-supabase.mjs > tools/test/out/mock.log 2>&1 & MOCK=$!
sleep 1
PGARGS="$PGARGS" node tools/test/e2e.mjs || true
kill $MOCK
