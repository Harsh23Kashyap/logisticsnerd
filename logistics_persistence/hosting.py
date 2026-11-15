"""Explicit hosted-owner bootstrap and read-only deployment readiness."""
import argparse
import hashlib
import os

from . import core
from .db import connect
from .errors import ConfigurationError
from .migrate import MIGRATIONS, initialize_database


def check_history(conn):
    expected = {path.name: hashlib.sha256(path.read_bytes()).hexdigest()
                for path in MIGRATIONS.glob('*.sql')}
    history = {row['version']: row['checksum'] for row in conn.execute(
        'SELECT version,checksum FROM logistics.schema_migrations').fetchall()}
    if not expected or history != expected:
        raise ConfigurationError('The deployed migration history is not current')


def readiness(conn, actor_ref):
    check_history(conn)
    actor = conn.execute("""SELECT snapshot FROM logistics.core_bindings
        WHERE kind='actor' AND external_key=%s AND valid_to IS NULL""", (actor_ref,)).fetchone()
    if actor is None or actor['snapshot'].get('can_approve_purchases') is not True:
        raise ConfigurationError('The configured hosted owner is not provisioned')
    conn.execute('SELECT 1 FROM logistics.command_requests LIMIT 1').fetchall()
    conn.execute('SELECT 1 FROM logistics.record_tables LIMIT 1').fetchall()
    return {'ready': True}


def initialize_fresh(dsn, business_key, actor_ref):
    """Opt-in first start only. Existing histories are never upgraded here."""
    with connect(dsn) as conn:
        exists = conn.execute("SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='logistics') AS found").fetchone()['found']
    if not exists:
        initialize_database(dsn, business_key)
        with connect(dsn, business_key) as conn:
            bootstrap_owner(conn, actor_ref)
            readiness(conn, actor_ref)
    else:
        # Identity, checksums and owner must already be correct. An upgrade or a
        # partially initialized deployment requires an explicit operator action.
        with connect(dsn, business_key) as conn:
            readiness(conn, actor_ref)


def bootstrap_owner(conn, actor_ref):
    if not actor_ref or len(actor_ref) > 200:
        raise ConfigurationError('Configure a stable owner actor reference')
    old = conn.execute("""SELECT snapshot FROM logistics.core_bindings
        WHERE kind='actor' AND external_key=%s AND valid_to IS NULL""", (actor_ref,)).fetchone()
    if old:
        if old['snapshot'].get('can_approve_purchases') is not True:
            raise ConfigurationError('An existing actor must be reviewed explicitly before changing permissions')
        return
    core.bind_reference(conn, 'actor', actor_ref,
        {'name': 'Hosted owner', 'can_approve_purchases': True},
        'hosting:owner:' + hashlib.sha256(actor_ref.encode()).hexdigest())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['bootstrap-owner', 'ready', 'initialize-fresh'])
    args = parser.parse_args()
    try:
        if args.command == 'initialize-fresh':
            initialize_fresh(os.environ.get('LOGISTICS_DATABASE_URL', ''),
                os.environ.get('LOGISTICS_BUSINESS_KEY', ''), os.environ.get('LOGISTICS_ACTOR_REF', ''))
            print('Fresh hosted database initialized or existing deployment verified.')
            return
        with connect(os.environ.get('LOGISTICS_DATABASE_URL', ''),
                     os.environ.get('LOGISTICS_BUSINESS_KEY', '')) as conn:
            actor = os.environ.get('LOGISTICS_ACTOR_REF', '')
            if args.command == 'bootstrap-owner':
                bootstrap_owner(conn, actor)
            else:
                readiness(conn, actor)
    except Exception:
        raise SystemExit('Hosted database check failed. Review private configuration, migration history and owner provisioning.') from None
    print('Hosted owner provisioned.' if args.command == 'bootstrap-owner' else 'Hosted database is ready.')


if __name__ == '__main__':
    main()
