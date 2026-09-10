const base = require('./package.json').build

const rebrandMacPermissionCopy = entries =>
  Object.fromEntries(
    Object.entries(entries || {}).map(([key, value]) => [
      key,
      typeof value === 'string' ? value.replace(/\bHermes\b/g, 'MacMan') : value
    ])
  )

module.exports = {
  ...base,
  appId: 'com.macman.app',
  productName: 'MacMan',
  executableName: 'MacMan',
  extraMetadata: {
    name: 'macman',
    productName: 'MacMan',
    description: 'Private desktop agent for macOS.',
    author: 'MacMan'
  },
  artifactName: 'MacMan-${version}-${os}-${arch}.${ext}',
  protocols: [{ name: 'MacMan Protocol', schemes: ['macman'] }],
  directories: { ...base.directories, output: 'release-macman' },
  extraResources: [
    ...base.extraResources,
    { from: 'macman-distribution.json', to: 'macman-distribution.json' },
    { from: 'build/macman-cua/cua-driver', to: 'cua-driver' },
    {
      from: '../../node_modules/@trycua/cua-driver',
      to: 'macman-cua-sdk/node_modules/@trycua/cua-driver'
    },
    {
      from: '../../node_modules/@ubjs/core',
      to: 'macman-cua-sdk/node_modules/@ubjs/core'
    },
    {
      from: '../../node_modules/@ubjs/node',
      to: 'macman-cua-sdk/node_modules/@ubjs/node'
    },
    {
      from: 'dist/node_modules/@trycua/cua-driver-darwin-arm64',
      to: 'macman-cua-sdk/node_modules/@trycua/cua-driver-darwin-arm64'
    },
    {
      from: 'dist/node_modules/@trycua/cua-driver-darwin-x64',
      to: 'macman-cua-sdk/node_modules/@trycua/cua-driver-darwin-x64'
    },
    { from: 'build/macman-connectors', to: 'macman-connectors' },
    { from: 'THIRD_PARTY_NOTICES.md', to: 'THIRD_PARTY_NOTICES.md' }
  ],
  asarUnpack: [...base.asarUnpack, '**/*.dylib'],
  mac: {
    ...base.mac,
    binaries: [
      'Contents/Resources/cua-driver',
      'Contents/Resources/macman-connectors/gmail/gog',
      'Contents/Resources/macman-connectors/imessage/universal/imessage-cli'
    ],
    // Local directory builds need a structurally valid signature for TCC and
    // launch testing. Release builds leave identity discovery untouched so a
    // Developer ID certificate can replace this with a distributable signature.
    identity: process.env.MACMAN_ADHOC_SIGN === '1' ? '-' : base.mac.identity,
    extendInfo: {
      ...rebrandMacPermissionCopy(base.mac.extendInfo),
      CFBundleDisplayName: 'MacMan',
      CFBundleExecutable: 'MacMan',
      CFBundleName: 'MacMan',
      NSAppleEventsUsageDescription:
        'MacMan controls other applications only when carrying out an action you requested.',
      NSContactsUsageDescription:
        'MacMan accesses contacts only when a task needs help identifying someone you named.',
      NSLocationUsageDescription:
        'MacMan uses your location only for local results such as weather, travel time, and nearby places.',
      NSScreenCaptureUsageDescription:
        'MacMan captures the screen so it can see and interact with applications you ask it to control.'
    }
  },
  dmg: { ...base.dmg, title: 'Install MacMan' }
}
