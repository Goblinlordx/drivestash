import type { Codec } from './types'

/** Collect a ReadableStream into a single ArrayBuffer. */
async function streamToArrayBuffer(stream: ReadableStream<Uint8Array>): Promise<ArrayBuffer> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let totalLength = 0

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    totalLength += value.byteLength
  }

  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }

  return result.buffer
}

/**
 * Create a codec that compresses JSON strings using browser-native
 * CompressionStream/DecompressionStream with the DEFLATE algorithm.
 *
 * Zero runtime dependencies — uses only Web APIs available in
 * Chrome 80+, Firefox 113+, Safari 16.4+.
 */
export function createDeflateCodec(): Codec {
  return {
    async encode(data: string): Promise<ArrayBuffer> {
      const encoded = new TextEncoder().encode(data)
      const cs = new CompressionStream('deflate')
      const writer = cs.writable.getWriter()
      writer.write(encoded)
      writer.close()
      return streamToArrayBuffer(cs.readable)
    },

    async decode(data: ArrayBuffer): Promise<string> {
      const ds = new DecompressionStream('deflate')
      const writer = ds.writable.getWriter()
      writer.write(new Uint8Array(data))
      writer.close()
      const decompressed = await streamToArrayBuffer(ds.readable)
      return new TextDecoder().decode(decompressed)
    },
  }
}
