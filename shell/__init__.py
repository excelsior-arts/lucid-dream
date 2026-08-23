"""Lucid Dream — a shell, and the apps it opens.

The shell owns the machine-level things: which port to serve on, which
certificate to use, whether your phone can reach it. It knows nothing about
what any app does. Each app owns everything else — its config, its data, its
page — and is mounted underneath a route of its own.
"""
