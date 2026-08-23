# Vendored

**three** — the 3-D engine the rooms are drawn with, copied from npm rather
than fetched, because the game is offline and a CDN is a dependency on the
weather. Two files, both as published:

    three.module.js       the library
    three.core.min.js     what it imports; the name is the import specifier

To take a newer one:

    npm pack three && tar xf three-*.tgz
    cp package/build/three.module.js package/build/three.core.min.js .

Nothing here is edited. If it ever needs to be, it stops being vendored.
