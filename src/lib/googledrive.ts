/* eslint-disable no-console */
import { Config } from '@/lib/config'
import { getMetaByFilePath, parseFileName, updateMeta } from '@/lib/meta'
import { authenticate } from '@google-cloud/local-auth'
import fsync from 'fs'
import fs from 'fs/promises'
import { google } from 'googleapis'
import path from 'path'
import { log } from 'svag-cli-utils'

// https://developers.google.com/drive/api/quickstart/nodejs?hl=ru

type GoogleDriveFile = {
  id: string
  name: string
  mimeType: string
}

const getAuthClient = async ({ config }: { config: Config }) => {
  const SCOPES = ['https://www.googleapis.com/auth/drive']

  async function loadSavedCredentialsIfExist() {
    try {
      const content = await fs.readFile(config.googleTokenJsonPath, 'utf8')
      const credentials = JSON.parse(content)
      return google.auth.fromJSON(credentials)
    } catch (err) {
      return null
    }
  }

  async function saveCredentials(client: any) {
    const content = await fs.readFile(config.googleCredentialsJsonPath, 'utf8')
    const keys = JSON.parse(content)
    const key = keys.installed || keys.web
    const payload = JSON.stringify({
      type: 'authorized_user',
      client_id: key.client_id,
      client_secret: key.client_secret,
      refresh_token: client.credentials.refresh_token,
    })
    await fs.writeFile(config.googleTokenJsonPath, payload)
  }

  const clientJson = await loadSavedCredentialsIfExist()
  if (clientJson) {
    return { authClient: clientJson }
  }
  const clientOauth = await authenticate({
    scopes: SCOPES,
    keyfilePath: config.googleCredentialsJsonPath,
  })
  await saveCredentials(clientOauth)
  return { authClient: clientOauth }
}

const getDrive = async ({ config }: { config: Config }) => {
  const { authClient } = await getAuthClient({ config })
  const drive = google.drive({ version: 'v3', auth: authClient as any })
  return { drive }
}

const getAllFilesInDir = async ({ config, dirId }: { config: Config; dirId: string }) => {
  const files: GoogleDriveFile[] = []
  let nextPageToken: string | undefined = undefined
  do {
    const { drive } = await getDrive({ config })
    const res = await drive.files.list({
      q: `'${dirId}' in parents`,
      pageSize: 100,
      pageToken: nextPageToken,
    })
    nextPageToken = res.data.nextPageToken as string | undefined
    const resFiles = (res.data.files || []) as GoogleDriveFile[]
    files.push(...resFiles)
  } while (nextPageToken)
  return files
}

const searchFiles = async ({
  config,
  dirId,
  search,
  marks,
  ext,
}: {
  config: Config
  dirId: string
  search: string
  marks?: string[]
  ext?: string
}) => {
  const files = await getAllFilesInDir({ config, dirId })
  const searchWithotSymbols = search.replace(/[.,/#!$%^&*;:{}=\\'"`~]/g, '')
  const matchedFiles = files.filter((file) => {
    const parsed = parseFileName(file.name)
    const searchMatch = parsed.name.includes(search) || parsed.name.includes(searchWithotSymbols)
    const marksMatch = !marks || marks.every((mark) => parsed.marks.includes(mark))
    const extMatch = !ext || parsed.ext === ext
    return searchMatch && marksMatch && extMatch
  })
  return matchedFiles
}

const downloadFile = async ({
  config,
  fileId,
  filePath,
  verbose,
}: {
  config: Config
  fileId: string
  filePath: string
  verbose?: boolean
}) => {
  verbose && log.normal('Downloading google drive file', fileId, filePath)
  const { drive } = await getDrive({ config })
  const filePathAbs = path.resolve(config.contentDir, filePath)
  const { meta, metaFilePath } = getMetaByFilePath({ filePath, config })
  await new Promise((resolve, reject) => {
    const dest = fsync.createWriteStream(filePathAbs)
    drive.files
      .get({ fileId, alt: 'media' }, { responseType: 'stream' })
      .then((res) => {
        res.data
          .on('end', () => {
            resolve(true)
          })
          .on('error', (err) => {
            console.error(err)
            reject(err)
          })
          .pipe(dest)
      })
      .catch((err) => {
        console.error(err)
        reject(err)
      })
  })
  const fileBasename = path.basename(filePathAbs)
  const exRecord = meta.googleDrive.files.find((file) => file.id === fileId)
  if (!exRecord) {
    meta.googleDrive.files.push({ id: fileId, name: fileBasename })
    updateMeta({ meta, metaFilePath })
  }
  verbose && log.normal('Downloaded google drive file', fileId, filePath)
  return { filePath: filePathAbs }
}

const uploadFile = async ({
  config,
  filePath,
  dirId,
  verbose,
}: {
  config: Config
  filePath: string
  dirId: string
  verbose?: boolean
}) => {
  verbose && log.normal('Uploading file to google drive', filePath, dirId)
  const { drive } = await getDrive({ config })
  const filePathAbs = path.resolve(config.contentDir, filePath)
  const { meta, metaFilePath } = getMetaByFilePath({ filePath: filePathAbs, config })
  const fileBasename = path.basename(filePathAbs)
  const ext = path.extname(fileBasename)
  const mimeType = ext === '.mp4' ? 'video/mp4' : ext === '.mp3' ? 'audio/mp3' : 'application/octet-stream'
  const res = await drive.files.create({
    media: {
      mimeType,
      body: fsync.createReadStream(filePathAbs),
    },
    requestBody: {
      name: fileBasename,
      parents: [dirId],
    },
  })
  const id = res.data.id
  console.dir(res.data, { depth: null })
  if (!id) {
    throw new Error('No id after upload')
  }
  meta.googleDrive.files.push({ id, name: fileBasename })
  updateMeta({ meta, metaFilePath })
  verbose && log.normal('Uploaded file to google drive', filePath, dirId)
  return {
    filePath: filePathAbs,
    googleDriveData: res.data,
  }
}

export const googleDrive = {
  searchFiles,
  downloadFile,
  uploadFile,
  getAllFilesInDir,
}
