BEGIN;

DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'traverse_ddl') THEN
    CREATE ROLE traverse_ddl NOLOGIN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'traverse_runtime') THEN
    CREATE ROLE traverse_runtime NOLOGIN;
  END IF;
END
$roles$;

ALTER ROLE traverse_ddl
  NOLOGIN
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOINHERIT
  NOREPLICATION
  NOBYPASSRLS;

ALTER ROLE traverse_runtime
  NOLOGIN
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOINHERIT
  NOREPLICATION
  NOBYPASSRLS;

REVOKE traverse_ddl FROM traverse_runtime;
REVOKE traverse_runtime FROM traverse_ddl;
CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA public;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

DO $database_grants$
BEGIN
  EXECUTE format(
    'GRANT CONNECT, CREATE ON DATABASE %I TO traverse_ddl',
    current_database()
  );
  EXECUTE format(
    'GRANT CONNECT ON DATABASE %I TO traverse_runtime',
    current_database()
  );
END
$database_grants$;

GRANT traverse_ddl TO CURRENT_USER;
SET ROLE traverse_ddl;

CREATE SCHEMA IF NOT EXISTS app AUTHORIZATION traverse_ddl;
ALTER SCHEMA app OWNER TO traverse_ddl;
REVOKE ALL ON SCHEMA app FROM PUBLIC;

CREATE SCHEMA IF NOT EXISTS pgboss AUTHORIZATION traverse_ddl;
ALTER SCHEMA pgboss OWNER TO traverse_ddl;
REVOKE ALL ON SCHEMA pgboss FROM PUBLIC;

CREATE OR REPLACE FUNCTION app.current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
PARALLEL SAFE
SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$function$;

CREATE OR REPLACE FUNCTION app.current_actor_id()
RETURNS uuid
LANGUAGE sql
STABLE
PARALLEL SAFE
SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
  SELECT NULLIF(current_setting('app.actor_id', true), '')::uuid
$function$;

CREATE OR REPLACE FUNCTION app.current_actor_role()
RETURNS text
LANGUAGE sql
STABLE
PARALLEL SAFE
SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
  SELECT NULLIF(current_setting('app.role', true), '')
$function$;

CREATE OR REPLACE FUNCTION app.current_coach_id()
RETURNS uuid
LANGUAGE sql
STABLE
PARALLEL SAFE
SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
  SELECT NULLIF(current_setting('app.coach_id', true), '')::uuid
$function$;

CREATE OR REPLACE FUNCTION app.current_client_id()
RETURNS uuid
LANGUAGE sql
STABLE
PARALLEL SAFE
SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
  SELECT NULLIF(current_setting('app.client_id', true), '')::uuid
$function$;

CREATE OR REPLACE FUNCTION app.current_practice_role()
RETURNS text
LANGUAGE sql
STABLE
PARALLEL SAFE
SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
  SELECT NULLIF(current_setting('app.practice_role', true), '')
$function$;

REVOKE ALL ON FUNCTION app.current_tenant_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.current_actor_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.current_actor_role() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.current_coach_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.current_client_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.current_practice_role() FROM PUBLIC;

GRANT USAGE ON SCHEMA app TO traverse_runtime;
GRANT USAGE ON SCHEMA pgboss TO traverse_runtime;
GRANT EXECUTE ON FUNCTION app.current_tenant_id() TO traverse_runtime;
GRANT EXECUTE ON FUNCTION app.current_actor_id() TO traverse_runtime;
GRANT EXECUTE ON FUNCTION app.current_actor_role() TO traverse_runtime;
GRANT EXECUTE ON FUNCTION app.current_coach_id() TO traverse_runtime;
GRANT EXECUTE ON FUNCTION app.current_client_id() TO traverse_runtime;
GRANT EXECUTE ON FUNCTION app.current_practice_role() TO traverse_runtime;

ALTER DEFAULT PRIVILEGES IN SCHEMA app
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO traverse_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA app
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO traverse_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA app
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA app
  GRANT EXECUTE ON FUNCTIONS TO traverse_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA pgboss
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO traverse_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA pgboss
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO traverse_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA pgboss
  GRANT EXECUTE ON FUNCTIONS TO traverse_runtime;

RESET ROLE;

ALTER ROLE traverse_ddl SET search_path = app, pg_catalog;
ALTER ROLE traverse_runtime SET search_path = app, pg_catalog;
ALTER ROLE traverse_runtime SET row_security = on;

REVOKE traverse_ddl FROM CURRENT_USER;

COMMIT;
