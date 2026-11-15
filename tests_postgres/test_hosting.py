from fastapi.testclient import TestClient

from logistics_persistence.api import Settings, create_app
from logistics_persistence.errors import ConfigurationError
from logistics_persistence.hosting import bootstrap_owner, readiness, initialize_fresh
from .common import PostgresCase


class HostingTests(PostgresCase):
    def test_owner_bootstrap_is_explicit_idempotent_and_creates_no_demo_catalog(self):
        with self.assertRaises(ConfigurationError):
            readiness(self.conn, 'hosted-owner')
        bootstrap_owner(self.conn, 'hosted-owner')
        bootstrap_owner(self.conn, 'hosted-owner')
        self.assertEqual(readiness(self.conn, 'hosted-owner'), {'ready': True})
        rows = self.conn.execute('SELECT kind,external_key FROM logistics.core_bindings').fetchall()
        self.assertEqual(rows, [{'kind': 'actor', 'external_key': 'hosted-owner'}])
        self.assertEqual(self.conn.execute('SELECT count(*) AS n FROM logistics.demand_lines').fetchone()['n'], 0)

    def test_readiness_is_authenticated_and_checks_actual_identity_migrations_and_owner(self):
        client = TestClient(create_app(Settings(self.dsn, 'test-business', 'private-token', 'hosted-owner')), raise_server_exceptions=False)
        self.assertEqual(client.get('/internal/ready').status_code, 401)
        auth = {'Authorization': 'Bearer private-token'}
        self.assertEqual(client.get('/internal/ready', headers=auth).status_code, 503)
        bootstrap_owner(self.conn, 'hosted-owner')
        self.assertEqual(client.get('/internal/ready', headers=auth).json(), {'ready': True})
        # A bad deployment has different source checksums; persisted histories
        # themselves are deliberately immutable and are never rewritten here.
        from pathlib import Path
        from tempfile import TemporaryDirectory
        from unittest.mock import patch
        with TemporaryDirectory() as directory, patch('logistics_persistence.hosting.MIGRATIONS', Path(directory)):
            (Path(directory) / 'unexpected-migration.sql').write_text('SELECT 1;')
            response = client.get('/internal/ready', headers=auth)
            self.assertEqual(response.status_code, 503)
            self.assertEqual(response.json(), {'ready': False})
        self.assertEqual(client.get('/internal/ready', headers=auth).json(), {'ready': True})

    def test_existing_unprivileged_actor_is_not_silently_escalated(self):
        self.bind('actor', 'existing-owner', {'name': 'Existing', 'can_approve_purchases': False})
        with self.assertRaises(ConfigurationError):
            bootstrap_owner(self.conn, 'existing-owner')

    def test_opt_in_startup_only_initializes_an_empty_database(self):
        from uuid import uuid4
        from psycopg import sql
        from psycopg.conninfo import make_conninfo
        name = 'logistics_test_hosting_' + uuid4().hex
        self.conn.execute(sql.SQL('CREATE DATABASE {}').format(sql.Identifier(name)))
        dsn = make_conninfo(self.dsn, dbname=name)
        try:
            initialize_fresh(dsn, 'fresh-hosted-business', 'owner')
            initialize_fresh(dsn, 'fresh-hosted-business', 'owner')
            from logistics_persistence.db import connect
            with connect(dsn, 'fresh-hosted-business') as fresh:
                self.assertEqual(readiness(fresh, 'owner'), {'ready': True})
                self.assertEqual(fresh.execute('SELECT count(*) AS n FROM logistics.core_bindings').fetchone()['n'], 1)
            with self.assertRaises(Exception):
                initialize_fresh(dsn, 'another-business', 'owner')
        finally:
            self.conn.execute(sql.SQL('DROP DATABASE {}').format(sql.Identifier(name)))

    def test_opt_in_startup_does_not_provision_or_upgrade_an_existing_schema(self):
        with self.assertRaises(ConfigurationError):
            initialize_fresh(self.dsn, 'test-business', 'new-unreviewed-owner')
        self.assertEqual(self.conn.execute('SELECT count(*) AS n FROM logistics.core_bindings').fetchone()['n'], 0)
