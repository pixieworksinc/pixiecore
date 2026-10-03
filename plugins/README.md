# Project plugins

This directory is PixieCore's project-local installation slot for third-party
plugins. Entries are normally directory symbolic links whose targets own a
named manifest, entry point, implementation, and tests:

```text
plugins/
└── vendor/
    └── converter -> ../../external/pixiecore-converter
```

PixieCore discovers this directory by default. Plugin manifests remain disabled
unless their IDs are selected in `pixiecore.plugins.yml`; disabled modules are
not imported. Additional managed roots may still be listed in that state file,
and the legacy `pluginsDir` option remains separate and compatible.

Local installation links are ignored by Git. Keep distributable plugin source
in its own repository or package.
