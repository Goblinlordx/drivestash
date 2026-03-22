import { describe, it, expect } from 'vitest'
import { createDeflateCodec } from './codec'

describe('createDeflateCodec', () => {
  const codec = createDeflateCodec()

  describe('roundtrip', () => {
    it('encodes and decodes a simple string', async () => {
      const input = '{"records":[{"id":"1","updatedAt":"2026-01-01T00:00:00Z"}]}'
      const encoded = await codec.encode(input)
      expect(encoded).toBeInstanceOf(ArrayBuffer)
      expect(encoded.byteLength).toBeGreaterThan(0)

      const decoded = await codec.decode(encoded)
      expect(decoded).toBe(input)
    })

    it('produces output smaller than input for repetitive data', async () => {
      const records = Array.from({ length: 50 }, (_, i) => ({
        id: String(i),
        updatedAt: '2026-01-01T00:00:00Z',
        name: `Record number ${i}`,
      }))
      const input = JSON.stringify({ version: 1, records })
      const encoded = await codec.encode(input)

      expect(encoded.byteLength).toBeLessThan(input.length)
    })

    it('roundtrips a large payload', async () => {
      const records = Array.from({ length: 200 }, (_, i) => ({
        id: `item-${i}`,
        updatedAt: new Date(2026, 0, 1, 0, 0, i).toISOString(),
        title: `Task ${i}: ${'x'.repeat(50)}`,
      }))
      const input = JSON.stringify({ version: 1, lastModified: new Date().toISOString(), records })
      const encoded = await codec.encode(input)
      const decoded = await codec.decode(encoded)

      expect(decoded).toBe(input)
    })
  })

  describe('edge cases', () => {
    it('handles an empty string', async () => {
      const encoded = await codec.encode('')
      const decoded = await codec.decode(encoded)
      expect(decoded).toBe('')
    })

    it('handles unicode characters', async () => {
      const input = JSON.stringify({ emoji: '🌍🚀', cjk: '日本語テスト', arabic: 'مرحبا' })
      const encoded = await codec.encode(input)
      const decoded = await codec.decode(encoded)
      expect(decoded).toBe(input)
    })

    it('handles a minimal JSON object', async () => {
      const input = '{}'
      const encoded = await codec.encode(input)
      const decoded = await codec.decode(encoded)
      expect(decoded).toBe(input)
    })

    it('returns ArrayBuffer from encode', async () => {
      const encoded = await codec.encode('test')
      expect(encoded).toBeInstanceOf(ArrayBuffer)
    })
  })
})
