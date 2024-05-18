import type { Config } from '@/lib/config'
import { getGoogleAuthClient } from '@/lib/google'
import { getMetaByFilePath, parseFileName, updateMeta } from '@/lib/meta'
import fsync from 'fs'
import { google } from 'googleapis'
import path from 'path'
import { isFileExists, log } from 'svag-cli-utils'

type GoogleDriveFile = {
  id: string
  name: string
  mimeType: string
}

const getDrive = async ({ config }: { config: Config }) => {
  const { authClient } = await getGoogleAuthClient({ config })
  const drive = google.drive({ version: 'v3', auth: authClient })
  return { drive }
}

const getAllFilesInDir = async ({ config, dirId }: { config: Config; dirId: string }) => {
  const files: GoogleDriveFile[] = []
  let nextPageToken: string | undefined
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

const getGoogleDriveFileMeta = async ({ config, fileId }: { config: Config; fileId: string }) => {
  const { drive } = await getDrive({ config })
  const res = await drive.files.get({ fileId, fields: 'name,parents,size' })
  const googleDriveFileMeta = res.data
  const dirId = googleDriveFileMeta.parents?.[0]
  const name = googleDriveFileMeta.name
  const size = googleDriveFileMeta.size ? Number(googleDriveFileMeta.size) : null
  if (!dirId || !name || !size) {
    throw new Error('No dirId or name or size in google drive file meta')
  }
  return { dirId, name, size }
}

const getFileIdFromUrl = (fileUrl: string) => {
  // https://drive.google.com/file/d/106DebrXU6KW-p05mRXCP8lALetUJjmRz/view?usp=drive_link
  const googleDriveFileId = fileUrl.match(/\/file\/d\/([^/]+)/)?.[1]
  if (!googleDriveFileId) {
    throw new Error('No fileId in url')
  }
  return { googleDriveFileId }
}

const downloadFile = async ({
  config,
  verbose,
  force,
  ...restProps
}: {
  config: Config
  filePath?: string
  verbose?: boolean
  force?: boolean
} & (
  | {
      fileId: string
    }
  | {
      fileUrl: string
    }
)) => {
  verbose && log.normal('Downloading google drive file', { ...restProps })
  const fileId =
    'fileId' in restProps && restProps.fileId
      ? restProps.fileId
      : 'fileUrl' in restProps && restProps.fileUrl
        ? getFileIdFromUrl(restProps.fileUrl).googleDriveFileId
        : null
  if (!fileId) {
    throw new Error('No fileId')
  }
  const { dirId, name, size } = await getGoogleDriveFileMeta({ config, fileId })
  if (!dirId) {
    throw new Error('No dirId')
  }
  const filePath = 'filePath' in restProps && restProps.filePath ? restProps.filePath : name
  if (!filePath) {
    throw new Error('No file path')
  }
  const filePathAbs = path.resolve(config.contentDir, filePath)
  const { drive } = await getDrive({ config })
  const { meta, metaFilePath } = getMetaByFilePath({ filePath: filePathAbs, config })
  const exRecordBefore = meta.googleDrive.files.find((file) => file.id === fileId && file.filePath === filePathAbs)
  if (exRecordBefore && !force) {
    const { fileExists } = await isFileExists({ filePath: filePathAbs })
    if (fileExists) {
      verbose && log.normal('File already downloaded', { filePath, fileId })
      return { filePath: filePathAbs }
    }
  }

  await new Promise((resolve, reject) => {
    let receivedBytes = 0
    let lastLogAt: Date | null = null
    const dest = fsync.createWriteStream(filePathAbs)
    drive.files
      .get({ fileId, alt: 'media' }, { responseType: 'stream' })
      .then((res) => {
        res.data
          .on('data', (chunk) => {
            receivedBytes += chunk.length
            const percentage = ((receivedBytes / size) * 100).toFixed(2)
            const secondsSinceLastLog = lastLogAt ? (Date.now() - lastLogAt.getTime()) / 1_000 : 0
            const shouldLog = !lastLogAt || secondsSinceLastLog > 1
            if (shouldLog) {
              lastLogAt = new Date()
              verbose && log.normal(`Download progress: ${percentage}%`)
            }
          })
          .on('end', () => {
            resolve(true)
          })
          .on('error', (err) => {
            reject(err)
          })
          .pipe(dest)
      })
      .catch((error) => {
        reject(error)
      })
  })
  const fileBasename = path.basename(filePathAbs)
  const parsedFileName = parseFileName(fileBasename)
  const exRecord = meta.googleDrive.files.find((file) => file.id === fileId)
  if (!exRecord) {
    meta.googleDrive.files.push({ id: fileId, name: fileBasename, dirId, filePath: filePathAbs })
    updateMeta({ meta, metaFilePath })
  }
  if (!meta.title) {
    meta.title = parsedFileName.name
    updateMeta({ meta, metaFilePath })
  }
  verbose && log.normal('Downloaded google drive file', { filePath, fileId })
  return { filePath: filePathAbs }
}

const uploadFile = async ({
  config,
  filePath,
  dirId,
  force,
  verbose,
}: {
  config: Config
  filePath: string
  dirId: string
  force?: boolean
  verbose?: boolean
}) => {
  verbose && log.normal('Uploading file to google drive', { filePath, dirId })
  const { drive } = await getDrive({ config })
  const filePathAbs = path.resolve(config.contentDir, filePath)
  const { meta, metaFilePath } = getMetaByFilePath({ filePath: filePathAbs, config })
  const fileBasename = path.basename(filePathAbs)
  const exRecord = meta.googleDrive.files.find((file) => file.name === fileBasename)
  if (exRecord && !force) {
    verbose && log.normal('File already uploaded to google drive', { filePath, dirId })
    return { googleDriveData: { id: exRecord.id }, filePath: filePathAbs }
  }
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
  if (!id) {
    throw new Error('No id after upload')
  }
  meta.googleDrive.files.push({ id, name: fileBasename, dirId, filePath: filePathAbs })
  updateMeta({ meta, metaFilePath })
  verbose && log.normal('Uploaded file to google drive', { filePath, dirId })
  return {
    filePath: filePathAbs,
    googleDriveData: res.data,
  }
}

const getPublicUrl = async ({ config, fileId }: { config: Config; fileId: string }) => {
  const { drive } = await getDrive({ config })
  await drive.permissions.create({
    fileId,
    requestBody: {
      role: 'reader',
      type: 'anyone',
    },
  })
  const googleDrivePublicUrl = `https://drive.google.com/file/d/${fileId}/view`
  return { googleDrivePublicUrl }
}

export const googleDrive = {
  searchFiles,
  downloadFile,
  uploadFile,
  getAllFilesInDir,
  getPublicUrl,
}
