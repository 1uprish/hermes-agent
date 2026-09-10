# MacMan third-party notices

## Cua Driver 0.22.1

MacMan bundles the Cua Driver executable and TypeScript SDK from the
[`cua-driver-rs-v0.22.1`](https://github.com/trycua/cua/releases/tag/cua-driver-rs-v0.22.1)
release. The corresponding source is available at that tag.

MIT License

Copyright (c) 2025 Cua AI, Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

### Cua Driver Node runtime notice

`cua_driver_node_runtime.node` is a compatibility build derived from the N-API
runtime in `uniffi-bindgen-react-native` 0.31.0-3, copyright its contributors
and licensed under the Mozilla Public License 2.0.

The corresponding source is the pinned npm development dependency plus the
deterministic transformations in `scripts/build-node-runtime.mjs`. The source
and build script are available in the Cua repository at the release tag that
matches this package.

<https://www.mozilla.org/MPL/2.0/>

## gogcli 0.39.1

MacMan bundles the `gog` command-line runtime from
[`openclaw/gogcli`](https://github.com/openclaw/gogcli/releases/tag/v0.39.1)
for Gmail authentication and operations. The release archive is selected per
Mac architecture and verified against its published SHA-256 digest before it
is packaged.

MIT License

Copyright (c) gogcli contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## platform-imessage 0.24.4

MacMan bundles the universal `imessage-cli` runtime from
[`beeper/platform-imessage`](https://github.com/beeper/platform-imessage/releases/tag/v0.24.4).
The archive is verified against its published SHA-256 digest before packaging.

MIT License

Copyright (c) Beeper Inc. and platform-imessage contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## WhatsApp bridge dependencies

MacMan packages the locked production dependencies from
`scripts/whatsapp-bridge/package-lock.json` during the release build. It does
not install those dependencies on the user's Mac while handling a task. The
individual package license files remain alongside their packaged modules.
