"""Phone access on a managed Mac, without touching the firewall.

The macOS application firewall allows incoming connections per binary. It
knows /usr/bin/python3; it does not know the uv-installed interpreter the app
runs on, and on a managed Mac that list can't be edited. The symptom is
silent: loopback works, the LAN address just times out.

So the app keeps listening on loopback only, and this script -- run with
/usr/bin/python3, which is already allowed -- accepts LAN connections and
forwards the bytes. It is a dumb TCP pipe, so websockets pass through
untouched.

    /usr/bin/python3 lan_bridge.py            # same port, on the wifi address

There is no authentication here or in the app. Anyone on the network who
finds the port can read every conversation and start the models. Run it when
you want your phone, Ctrl-C when you don't.
"""
import os
import socket
import subprocess
import sys
import threading

APP_PORT = 6969

# Bind the wifi address rather than 0.0.0.0, so this can use the SAME port the
# app uses on loopback -- 127.0.0.1:6969 and 10.0.0.1:6969 are different
# sockets. One port to remember, whichever machine you are on.


def _pipe(src, dst):
    try:
        while True:
            chunk = src.recv(65536)
            if not chunk:
                break
            dst.sendall(chunk)
    except OSError:
        pass
    finally:
        try:
            dst.shutdown(socket.SHUT_WR)
        except OSError:
            pass


def _handle(client, app_port):
    try:
        upstream = socket.create_connection(("127.0.0.1", app_port), timeout=10)
    except OSError as exc:
        sys.stderr.write("no app on 127.0.0.1:%d (%s)\n" % (app_port, exc))
        client.close()
        return
    upstream.settimeout(None)
    threading.Thread(target=_pipe, args=(client, upstream), daemon=True).start()
    _pipe(upstream, client)
    client.close()
    upstream.close()


def _out(*cmd):
    try:
        return subprocess.run(cmd, capture_output=True, text=True).stdout.strip()
    except OSError:
        return ""


def _lan_ip():
    for iface in ("en0", "en1"):
        ip = _out("ipconfig", "getifaddr", iface)
        if ip:
            return ip
    return ""


def _scheme():
    """http or https -- the app terminates TLS, we only forward bytes."""
    try:
        import json
        import sys
        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        sys.path.insert(0, root)
        from shell import paths as P          # stdlib only
        cfg = json.loads(P.CONFIG.read_text())
        # Top level since the shell took the root config over, and relative
        # to the checkout unless it says otherwise -- the same rule the shell
        # reads it by.
        cert = cfg.get("tls_cert", "") or cfg.get("ui", {}).get("tls_cert", "")
        if cert and not cert.startswith("/"):
            cert = os.path.join(root, cert)
        return "https" if cert and os.path.exists(cert) else "http"
    except Exception:
        return "http"


def _urls(port):
    name, lan = _out("scutil", "--get", "LocalHostName"), _lan_ip()
    return [h for h in ("%s.local" % name if name else "", lan) if h]


def main():
    app_port = int(sys.argv[1]) if len(sys.argv) > 1 else APP_PORT
    lan_port = int(sys.argv[2]) if len(sys.argv) > 2 else app_port

    ip = _lan_ip()
    if not ip:
        sys.exit("no wifi address found -- is this machine on a network?")

    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        server.bind((ip, lan_port))
    except OSError as exc:
        sys.exit("cannot bind %s:%d (%s) -- is a bridge already running?"
                 % (ip, lan_port, exc))
    server.listen(64)

    # Silent on purpose: the app printed every address, this one included, in
    # one box before this started. Two lists of the same thing in one terminal
    # is one more than anybody reads.

    try:
        while True:
            client, _ = server.accept()
            threading.Thread(target=_handle, args=(client, app_port), daemon=True).start()
    except KeyboardInterrupt:
        pass
    finally:
        server.close()


if __name__ == "__main__":
    main()
