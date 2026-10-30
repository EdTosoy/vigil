-- Human identity is separate from financial evidence and operations reads.
RESET ROLE;
DO $$ DECLARE r text; BEGIN
 FOREACH r IN ARRAY ARRAY['flow_auth_runtime','flow_auth_seeder'] LOOP
  IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname=r) THEN
   EXECUTE format('CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',r);
  END IF;
  IF EXISTS(SELECT FROM pg_roles WHERE rolname=r AND (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)) THEN RAISE EXCEPTION 'Unsafe auth capability'; END IF;
 END LOOP;
END $$;
CREATE SCHEMA app_auth AUTHORIZATION flow_ledger_owner;
REVOKE ALL ON SCHEMA app_auth FROM PUBLIC;
SET LOCAL ROLE flow_ledger_owner;
-- Better Auth 1.7 core schema. No library-managed schema changes at runtime.
CREATE TABLE app_auth."user" (
 id text PRIMARY KEY, name text NOT NULL, email text NOT NULL UNIQUE,
 "emailVerified" boolean NOT NULL DEFAULT false, image text,
 "createdAt" timestamptz NOT NULL, "updatedAt" timestamptz NOT NULL
);
CREATE TABLE app_auth.session (
 id text PRIMARY KEY, "expiresAt" timestamptz NOT NULL, token text NOT NULL UNIQUE,
 "createdAt" timestamptz NOT NULL, "updatedAt" timestamptz NOT NULL,
 "ipAddress" text, "userAgent" text, "userId" text NOT NULL REFERENCES app_auth."user" ON DELETE CASCADE
);
CREATE INDEX ON app_auth.session("userId");
CREATE TABLE app_auth.account (
 id text PRIMARY KEY, "accountId" text NOT NULL, "providerId" text NOT NULL,
 "userId" text NOT NULL REFERENCES app_auth."user" ON DELETE CASCADE,
 "accessToken" text, "refreshToken" text, "idToken" text,
 "accessTokenExpiresAt" timestamptz, "refreshTokenExpiresAt" timestamptz,
 scope text, password text, "createdAt" timestamptz NOT NULL, "updatedAt" timestamptz NOT NULL,
 UNIQUE("providerId","accountId")
);
CREATE INDEX ON app_auth.account("userId");
CREATE TABLE app_auth.verification (
 id text PRIMARY KEY, identifier text NOT NULL, value text NOT NULL,
 "expiresAt" timestamptz NOT NULL, "createdAt" timestamptz NOT NULL, "updatedAt" timestamptz NOT NULL
);
CREATE INDEX ON app_auth.verification(identifier);
CREATE TABLE app_auth."rateLimit" (id text PRIMARY KEY, key text NOT NULL UNIQUE, count integer NOT NULL, "lastRequest" bigint NOT NULL);
CREATE TABLE app_auth.principal (
 user_id text PRIMARY KEY REFERENCES app_auth."user" ON DELETE CASCADE,
 role text NOT NULL CHECK(role IN ('Admin','Operator','Viewer')),
 synthetic_only boolean NOT NULL DEFAULT false,
 CHECK(NOT synthetic_only OR role='Viewer')
);
CREATE TABLE app_auth.book_grant (
 user_id text NOT NULL REFERENCES app_auth.principal ON DELETE CASCADE,
 book_id uuid NOT NULL REFERENCES ledger.book ON DELETE RESTRICT,
 PRIMARY KEY(user_id,book_id)
);
-- Authorization metadata is never writable by the web application. Even an
-- accidental grant to a synthetic-only identity cannot expose another environment.
CREATE FUNCTION app_auth.allowed_books(uid text) RETURNS TABLE(id uuid,code text,environment text,"cursorTime" text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT b.id,b.code,b.environment,b.created_at::text
 FROM app_auth.principal p JOIN app_auth.book_grant g ON g.user_id=p.user_id
 JOIN ledger.book b ON b.id=g.book_id
 WHERE p.user_id=uid AND (NOT p.synthetic_only OR b.environment='synthetic')
 ORDER BY b.created_at,b.id
$$;
CREATE FUNCTION app_auth.seed_book(bk uuid,only_synthetic boolean) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT EXISTS(SELECT FROM ledger.book WHERE id=bk AND (NOT only_synthetic OR environment='synthetic'))
$$;
REVOKE ALL ON ALL TABLES IN SCHEMA app_auth FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app_auth FROM PUBLIC;
GRANT USAGE ON SCHEMA app_auth TO flow_auth_runtime,flow_auth_seeder;
GRANT SELECT,INSERT,UPDATE,DELETE ON app_auth."user",app_auth.session,app_auth.account,app_auth.verification,app_auth."rateLimit" TO flow_auth_runtime;
GRANT SELECT ON app_auth.principal TO flow_auth_runtime;
GRANT EXECUTE ON FUNCTION app_auth.allowed_books(text) TO flow_auth_runtime;
GRANT SELECT,INSERT ON app_auth."user",app_auth.account,app_auth.principal,app_auth.book_grant TO flow_auth_seeder;
GRANT EXECUTE ON FUNCTION app_auth.seed_book(uuid,boolean) TO flow_auth_seeder;
RESET ROLE;
