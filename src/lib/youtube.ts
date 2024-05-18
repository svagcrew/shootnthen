import type { Config } from '@/lib/config'
import { getGoogleAuthClient } from '@/lib/google'
import { getMetaByFilePath, updateMeta } from '@/lib/meta'
import fsync from 'fs'
import { google } from 'googleapis'
import path from 'path'
import { log } from 'svag-cli-utils'

const getYoutubeClient = async ({ config }: { config: Config }) => {
  const { authClient } = await getGoogleAuthClient({ config })
  const youtubeClient = google.youtube({ version: 'v3', auth: authClient })
  return { youtubeClient }
}

const uploadFile = async ({
  config,
  title,
  filePath,
  force,
  verbose,
}: {
  config: Config
  title?: string
  filePath: string
  force?: boolean
  verbose?: boolean
}) => {
  verbose && log.normal('Uploading file to youtube', { filePath })
  const { youtubeClient } = await getYoutubeClient({ config })
  const filePathAbs = path.resolve(config.contentDir, filePath)
  const { meta, metaFilePath } = getMetaByFilePath({ filePath: filePathAbs, config })
  const exRecord = meta.youtube.videos.find((v) => v.filePath === filePathAbs)
  if (exRecord && !force) {
    verbose && log.normal('File already uploaded', { filePath })
    return { filePath: filePathAbs }
  }
  title = title || meta.title
  if (!title) {
    throw new Error('No title')
  }
  const res = await youtubeClient.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title,
      },
      status: {
        privacyStatus: 'private',
      },
    },
    media: {
      body: fsync.createReadStream(filePathAbs),
    },
  })
  const id = res.data.id
  if (!id) {
    throw new Error('No id after upload')
  }
  const editUrl = `https://studio.youtube.com/video/${id}/edit`
  const viewUrl = `https://www.youtube.com/watch?v=${id}`
  meta.youtube.videos.push({ id, filePath: filePathAbs, title, viewUrl, editUrl })
  updateMeta({ meta, metaFilePath })
  verbose && log.normal('Uploaded file to youtube', { filePath })
  return {
    filePath: filePathAbs,
    editUrl,
  }
}

export const youtube = {
  uploadFile,
}
