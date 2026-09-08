// Print the SHA256 of an asar's header string — the value Electron's
// ElectronAsarIntegrity check compares against. Zero deps beyond the asar
// package resolution: reads the header length prefix manually so the kit
// doesn't need node_modules at all.
//
// Usage: node asar-header-hash.js /path/to/app.asar
const crypto = require('node:crypto')
const fs = require('node:fs')

const file = process.argv[2]

if (!file) {
  console.error('usage: node asar-header-hash.js <app.asar>')
  process.exit(1)
}

const fd = fs.openSync(file, 'r')
// asar layout: [u32 4][u32 headerPickleSize][u32 ...][u32 headerStringLen][json]
const sizeBuf = Buffer.alloc(16)

fs.readSync(fd, sizeBuf, 0, 16, 0)

const headerStringLen = sizeBuf.readUInt32LE(12)
const headerBuf = Buffer.alloc(headerStringLen)

fs.readSync(fd, headerBuf, 0, headerStringLen, 16)
fs.closeSync(fd)

process.stdout.write(crypto.createHash('sha256').update(headerBuf).digest('hex'))
