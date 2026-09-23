# N2AB Client build tools

The client ships **pre-built and obfuscated** (there are no upstream sources in
this repo), so changes to it are applied as a repeatable transform rather than
by editing the minified file by hand.

```bash
node tools/build-n2ab-client.js           # apply everything, rewrite the bundle
node tools/build-n2ab-client.js --check   # verify only, write nothing
```

The build is **idempotent** - running it repeatedly produces an identical file.

| File | Purpose |
| --- | --- |
| `build-n2ab-client.js` | Rebrand + inject CSS + inject modules, with safety checks |
| `modules.js` | The extra modules added to the panel |
| `ui-polish.css` | Panel restyle, appended to the shadow-DOM stylesheet |
| `obfuscated-string-codec.js` | Encode/decode for the bundle's string table |
| `panel-preview.html` | Side-by-side before/after of the panel |

## How the bundle stores strings

Every literal lives in one array, each entry encoded with a custom base64
alphabet. At startup the array is **rotated** until a checksum over nine
specific entries equals `0xe681e` - 348 rotations for this build.

Two rules follow, and the build enforces both:

1. Those nine checksum entries must stay byte-identical, or the loader spins
   forever. They are pinned in `CHECKSUM_INDICES`.
2. Rewriting an entry's *value* in place is safe, because indices are resolved
   after rotation.

The build fails loudly if the rotation stops being 348, if any brand token
survives, or if the result is not valid JavaScript.

## Adding a module

Append to `modules.js` and re-run the build:

```js
__api.registerFeature("myModule", {
  label: "My Module",
  description: "Shown under the name in the panel.",
  category: "HUD",              // Movement | HUD | Network | Render
  settings: {
    amount: { type: "range", label: "Amount", min: 0, max: 100, step: 5, default: 50 },
    enabled: { type: "bool", label: "Enabled", default: true },
  },
  onState(state) {
    const s = state.myModule;   // { active, amount, enabled }
    if (!s.active) return;
  },
});
```

Settings support `range`, `bool` and `text`. State is persisted under the
`N2AB_SETTINGS` localStorage key; add `transient: true` to opt out.

## Note on domains

`polytraqqq.com` is deliberately **not** renamed: it is the live update server
and logo host. Renaming it would break the auto-updater. Only names, labels,
identifiers, CSS tokens and storage keys were rebranded.
