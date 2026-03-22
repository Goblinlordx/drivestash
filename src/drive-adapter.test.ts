import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { DriveAdapter, DriveError } from './drive-adapter'
import type { DriveFileMeta } from './drive-adapter'

const DRIVE_API = 'https://www.googleapis.com/drive/v3/files'
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3/files'

const TEST_TOKEN = 'test-access-token'
const TEST_FILE: DriveFileMeta = {
  id: 'file-1',
  name: 'data.json',
  mimeType: 'application/json',
  modifiedTime: '2026-01-01T00:00:00.000Z',
}

function mockFetch(body: unknown, init: Partial<Response> = {}): Mock {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: () => Promise.resolve(body),
    ...init,
  })
}

function mockFetchError(status: number, errorBody: unknown): Mock {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    statusText: 'Error',
    json: () => Promise.resolve(errorBody),
  })
}

describe('DriveAdapter', () => {
  let adapter: DriveAdapter
  let fetchMock: Mock

  beforeEach(() => {
    adapter = new DriveAdapter(() => TEST_TOKEN)
    vi.restoreAllMocks()
  })

  describe('auth guard', () => {
    it('throws DriveError when token provider returns null', async () => {
      const nullAdapter = new DriveAdapter(() => null)
      await expect(nullAdapter.listFiles()).rejects.toThrow(DriveError)
      await expect(nullAdapter.listFiles()).rejects.toMatchObject({
        status: 401,
        message: expect.stringContaining('Not authenticated'),
      })
    })
  })

  describe('listFiles', () => {
    it('lists files in appDataFolder', async () => {
      fetchMock = mockFetch({ files: [TEST_FILE] })
      vi.stubGlobal('fetch', fetchMock)

      const files = await adapter.listFiles()

      expect(files).toEqual([TEST_FILE])
      expect(fetchMock).toHaveBeenCalledOnce()

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(url).toContain(DRIVE_API)
      expect(url).toContain('spaces=appDataFolder')
      expect((init.headers as Headers).get('Authorization')).toBe(`Bearer ${TEST_TOKEN}`)
    })

    it('filters by name when provided', async () => {
      fetchMock = mockFetch({ files: [TEST_FILE] })
      vi.stubGlobal('fetch', fetchMock)

      await adapter.listFiles('data.json')

      const [url] = fetchMock.mock.calls[0] as [string]
      expect(url).toContain("name+%3D+%27data.json%27")
    })

    it('returns empty array when no files match', async () => {
      fetchMock = mockFetch({ files: [] })
      vi.stubGlobal('fetch', fetchMock)

      const files = await adapter.listFiles('nonexistent.json')
      expect(files).toEqual([])
    })
  })

  describe('downloadFile', () => {
    it('downloads and parses JSON content', async () => {
      const content = { version: 1, records: [{ id: '1' }] }
      fetchMock = mockFetch(content)
      vi.stubGlobal('fetch', fetchMock)

      const result = await adapter.downloadFile<typeof content>('file-1')

      expect(result).toEqual(content)
      const [url] = fetchMock.mock.calls[0] as [string]
      expect(url).toContain(`${DRIVE_API}/file-1`)
      expect(url).toContain('alt=media')
    })
  })

  describe('createFile', () => {
    it('creates a file via multipart upload', async () => {
      fetchMock = mockFetch(TEST_FILE)
      vi.stubGlobal('fetch', fetchMock)

      const content = { version: 1, records: [] }
      const result = await adapter.createFile('data.json', content)

      expect(result).toEqual(TEST_FILE)
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(url).toContain(UPLOAD_API)
      expect(url).toContain('uploadType=multipart')
      expect(init.method).toBe('POST')
      expect(init.body).toBeInstanceOf(FormData)
    })
  })

  describe('updateFile', () => {
    it('updates file content via media upload', async () => {
      fetchMock = mockFetch(TEST_FILE)
      vi.stubGlobal('fetch', fetchMock)

      const content = { version: 1, records: [{ id: '2' }] }
      const result = await adapter.updateFile('file-1', content)

      expect(result).toEqual(TEST_FILE)
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(url).toContain(`${UPLOAD_API}/file-1`)
      expect(url).toContain('uploadType=media')
      expect(init.method).toBe('PATCH')
      expect(init.body).toBe(JSON.stringify(content))
      expect((init.headers as Headers).get('Content-Type')).toBe('application/json')
    })
  })

  describe('deleteFile', () => {
    it('deletes a file by ID', async () => {
      fetchMock = mockFetch(null)
      vi.stubGlobal('fetch', fetchMock)

      await adapter.deleteFile('file-1')

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(url).toBe(`${DRIVE_API}/file-1`)
      expect(init.method).toBe('DELETE')
    })
  })

  describe('error handling', () => {
    it('throws DriveError with API error details', async () => {
      fetchMock = mockFetchError(403, {
        error: {
          code: 403,
          message: 'Insufficient permissions',
          errors: [
            { domain: 'global', reason: 'insufficientPermissions', message: 'Insufficient permissions' },
          ],
        },
      })
      vi.stubGlobal('fetch', fetchMock)

      try {
        await adapter.listFiles()
        expect.fail('Expected DriveError')
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(DriveError)
        const driveErr = err as DriveError
        expect(driveErr.status).toBe(403)
        expect(driveErr.message).toBe('Insufficient permissions')
        expect(driveErr.details).toHaveLength(1)
        expect(driveErr.details[0].reason).toBe('insufficientPermissions')
      }
    })

    it('throws DriveError on 401 unauthorized', async () => {
      fetchMock = mockFetchError(401, {
        error: { code: 401, message: 'Invalid Credentials' },
      })
      vi.stubGlobal('fetch', fetchMock)

      await expect(adapter.downloadFile('file-1')).rejects.toMatchObject({
        status: 401,
        message: 'Invalid Credentials',
      })
    })

    it('throws DriveError on 404 not found', async () => {
      fetchMock = mockFetchError(404, {
        error: { code: 404, message: 'File not found' },
      })
      vi.stubGlobal('fetch', fetchMock)

      await expect(adapter.deleteFile('missing')).rejects.toMatchObject({
        status: 404,
        message: 'File not found',
      })
    })

    it('handles non-JSON error responses gracefully', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: () => Promise.reject(new Error('not json')),
      }))

      await expect(adapter.listFiles()).rejects.toMatchObject({
        status: 500,
        message: expect.stringContaining('500'),
      })
    })

    it('propagates network errors', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

      await expect(adapter.listFiles()).rejects.toThrow('Failed to fetch')
    })
  })
})
