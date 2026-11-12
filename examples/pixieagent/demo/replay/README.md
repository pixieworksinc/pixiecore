# PixieAgent fixture replay

The four public assets replay the six original synthetic inputs and scripted
results. They do not contact a model. Animation timing is illustrative, not
measured execution latency. Japanese titles and notes are display annotations.

From the repository root, run:

```sh
node --test examples/pixieagent/demo/replay/replay.test.mjs
```

See the [deployment guide](../README.md) for Docker startup. Select each case,
replay it, inspect the JSON, and switch cases during playback: stale playback
must not replace a new selection. The original layout includes a mobile
breakpoint and reduced-motion support.
