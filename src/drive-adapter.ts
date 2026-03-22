/** Token provider function — returns a valid access token or null if not authenticated. */
export type TokenProvider = () => string | null

/** Google Drive file metadata returned by the Files API. */
export interface DriveFileMeta {
  id: string
  name: string
  mimeType: string
  modifiedTime: string
}

/** Response shape from Drive Files.list. */
interface FileListResponse {
  files: DriveFileMeta[]
}

/** Error detail from the Drive API. */
export interface DriveApiErrorDetail {
  domain: string
  reason: string
  message: string
}

/** Structured Drive API error response body. */
interface DriveErrorBody {
  error: {
    code: number
    message: string
    errors?: DriveApiErrorDetail[]
  }
}

/** Error thrown by DriveAdapter operations. Includes HTTP status and Drive API error details. */
export class DriveError extends Error {
  readonly status: number
  readonly details: DriveApiErrorDetail[]

  constructor(message: string, status: number, details: DriveApiErrorDetail[] = []) {
    super(message)
    this.name = 'DriveError'
    this.status = status
    this.details = details
  }
}

const DRIVE_API = 'https://www.googleapis.com/drive/v3/files'
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3/files'

/**
 * Google Drive appDataFolder adapter.
 *
 * Provides typed CRUD operations for JSON documents stored in the
 * appDataFolder space. Requires a token provider function — no built-in auth.
 */
export class DriveAdapter {
  private readonly getAccessToken: TokenProvider

  constructor(getAccessToken: TokenProvider) {
    this.getAccessToken = getAccessToken
  }

  /** Get a valid token or throw if not authenticated. */
  private requireToken(): string {
    const token = this.getAccessToken()
    if (token === null) {
      throw new DriveError('Not authenticated — token provider returned null', 401)
    }
    return token
  }

  /** Make an authorized fetch request and handle errors. */
  private async request(url: string, init: RequestInit = {}): Promise<Response> {
    const token = this.requireToken()
    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${token}`)

    const response = await fetch(url, { ...init, headers })

    if (!response.ok) {
      let message = `Drive API error: ${response.status} ${response.statusText}`
      let details: DriveApiErrorDetail[] = []

      try {
        const body = (await response.json()) as DriveErrorBody
        if (body.error) {
          message = body.error.message
          details = body.error.errors ?? []
        }
      } catch {
        // Response body wasn't JSON — use the default message
      }

      throw new DriveError(message, response.status, details)
    }

    return response
  }

  /**
   * List files in appDataFolder, optionally filtered by name.
   *
   * @param name - Optional file name to filter by (exact match).
   * @returns Array of file metadata objects.
   */
  async listFiles(name?: string): Promise<DriveFileMeta[]> {
    const params = new URLSearchParams({
      spaces: 'appDataFolder',
      fields: 'files(id,name,mimeType,modifiedTime)',
    })

    if (name !== undefined) {
      params.set('q', `name = '${name}'`)
    }

    const response = await this.request(`${DRIVE_API}?${params}`)
    const data = (await response.json()) as FileListResponse
    return data.files
  }

  /**
   * Download and parse a JSON file from appDataFolder.
   *
   * @param fileId - The Drive file ID to download.
   * @returns The parsed JSON content.
   */
  async downloadFile<T>(fileId: string): Promise<T> {
    const params = new URLSearchParams({ alt: 'media' })
    const response = await this.request(`${DRIVE_API}/${fileId}?${params}`)
    return (await response.json()) as T
  }

  /**
   * Create a new JSON file in appDataFolder via multipart upload.
   *
   * @param name - The file name.
   * @param content - The JSON-serializable content.
   * @returns The created file's metadata.
   */
  async createFile<T>(name: string, content: T): Promise<DriveFileMeta> {
    const metadata = {
      name,
      parents: ['appDataFolder'],
      mimeType: 'application/json',
    }

    const form = new FormData()
    form.append(
      'metadata',
      new Blob([JSON.stringify(metadata)], { type: 'application/json' }),
    )
    form.append(
      'file',
      new Blob([JSON.stringify(content)], { type: 'application/json' }),
    )

    const response = await this.request(
      `${UPLOAD_API}?uploadType=multipart&fields=id,name,mimeType,modifiedTime`,
      { method: 'POST', body: form },
    )
    return (await response.json()) as DriveFileMeta
  }

  /**
   * Update an existing file's JSON content via media upload.
   *
   * @param fileId - The Drive file ID to update.
   * @param content - The new JSON-serializable content.
   * @returns The updated file's metadata.
   */
  async updateFile<T>(fileId: string, content: T): Promise<DriveFileMeta> {
    const response = await this.request(
      `${UPLOAD_API}/${fileId}?uploadType=media&fields=id,name,mimeType,modifiedTime`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(content),
      },
    )
    return (await response.json()) as DriveFileMeta
  }

  /**
   * Delete a file from appDataFolder.
   *
   * @param fileId - The Drive file ID to delete.
   */
  async deleteFile(fileId: string): Promise<void> {
    await this.request(`${DRIVE_API}/${fileId}`, { method: 'DELETE' })
  }
}
