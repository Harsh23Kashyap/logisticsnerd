"""Prepare only the known backup mount, then drop privileges permanently."""
import os
import sys


def main():
    os.umask(0o077)
    if os.geteuid() == 0:
        try:
            os.mkdir('/app/backups', 0o700)
        except FileExistsError:
            pass
        # Never follow a replacement symlink or recursively change mounted data.
        descriptor = os.open('/app/backups', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fchown(descriptor, 1000, 1000)
            os.fchmod(descriptor, 0o700)
        finally:
            os.close(descriptor)
        os.setgroups([])
        os.setgid(1000)
        os.setuid(1000)
    if os.geteuid() != 1000:
        raise SystemExit('The application must run as its unprivileged container user.')
    os.environ['HOME'] = '/home/node'
    command = sys.argv[1:] or ['node', 'server/start-production.mjs']
    os.execvp(command[0], command)


if __name__ == '__main__':
    main()
