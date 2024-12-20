import type { Config } from '@/lib/config.js'
import { getGoogleAuthClient } from '@/lib/google.js'
import { getMetaByFilePath, updateMeta } from '@/lib/meta.js'
import fsync, { createWriteStream } from 'fs'
import { google } from 'googleapis'
import path from 'path'
import { isFileExistsSync, log } from 'svag-cli-utils'
import ytdl from 'ytdl-core'

const getYoutubeClient = async ({ config }: { config: Config }) => {
  const { authClient } = await getGoogleAuthClient({ config })
  const youtubeClient = google.youtube({ version: 'v3', auth: authClient })
  return { youtubeClient }
}

const uploadFile = async ({
  config,
  title,
  description = '',
  playlistId,
  privacyStatus,
  publishAt,
  thumbnailPath,
  filePath,
  force,
  verbose,
}: {
  config: Config
  title?: string
  description?: string
  playlistId?: string
  privacyStatus?: 'private' | 'public' | 'unlisted'
  publishAt?: Date
  thumbnailPath?: string
  filePath: string
  force?: boolean
  verbose?: boolean
}) => {
  playlistId = playlistId || config.youtubePlaylistId || undefined
  privacyStatus = privacyStatus || config.youtubePrivacyStatus || undefined
  verbose && log.normal('Uploading file to youtube', { filePath })
  const { youtubeClient } = await getYoutubeClient({ config })
  const filePathAbs = path.resolve(config.contentDir, filePath)
  const { meta, metaFilePath } = getMetaByFilePath({ filePath: filePathAbs, config })
  const exRecord = meta.youtube.videos.find((v) => v.filePath === filePathAbs)
  if (exRecord && !force) {
    verbose && log.normal('File already uploaded', { filePath })
    return { filePath: filePathAbs, id: exRecord.id, editUrl: exRecord.editUrl, skip: true }
  }
  title = title || meta.title
  if (!title) {
    throw new Error('No title')
  }
  if (publishAt && privacyStatus !== 'private') {
    throw new Error('publishAt can only be used with privacyStatus=private')
  }
  const res = await youtubeClient.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title,
        description,
      },
      status: {
        privacyStatus,
        madeForKids: false,
        selfDeclaredMadeForKids: false,
        ...(privacyStatus === 'private' && !!publishAt && { publishAt: publishAt.toISOString() }),
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

  if (thumbnailPath) {
    const thumbnailPathAbs = path.resolve(config.contentDir, thumbnailPath)
    verbose && log.normal('Uploading thumbnail', { thumbnailPath: thumbnailPathAbs })
    await youtubeClient.thumbnails.set({
      videoId: id,
      media: {
        body: fsync.createReadStream(thumbnailPathAbs),
      },
    })
    verbose && log.normal('Thumbnail uploaded', { thumbnailPath: thumbnailPathAbs })
  }

  if (playlistId) {
    await youtubeClient.playlistItems.insert({
      part: ['snippet'],
      requestBody: {
        snippet: {
          playlistId,
          resourceId: {
            kind: 'youtube#video',
            videoId: id,
          },
          // position: 0,
          // Playlist should use manual sorting to support position.
        },
      },
    })
    verbose && log.normal('Added video to playlist', { playlistId })
  }
  const editUrl = `https://studio.youtube.com/video/${id}/edit`
  const viewUrl = `https://www.youtube.com/watch?v=${id}`
  meta.youtube.videos.push({ id, filePath: filePathAbs, title, viewUrl, editUrl })
  updateMeta({ meta, metaFilePath })
  verbose && log.normal('Uploaded file to youtube', { filePath })
  return {
    filePath: filePathAbs,
    editUrl,
    id,
    skip: false,
  }
}

const addThumbnail = async ({
  config,
  videoId,
  thumbnailPath,
  verbose,
}: {
  config: Config
  videoId: string
  thumbnailPath: string
  verbose?: boolean
}) => {
  const { youtubeClient } = await getYoutubeClient({ config })
  const thumbnailPathAbs = path.resolve(config.contentDir, thumbnailPath)
  verbose && log.normal('Uploading thumbnail', { thumbnailPath: thumbnailPathAbs })
  await youtubeClient.thumbnails.set({
    videoId,
    media: {
      body: fsync.createReadStream(thumbnailPathAbs),
    },
  })
  verbose && log.normal('Thumbnail uploaded', { thumbnailPath: thumbnailPathAbs })
}

const downloadFile = async ({
  config,
  url,
  filePath,
  force,
  verbose,
}: {
  config: Config
  url: string
  filePath?: string
  force?: boolean
  verbose?: boolean
}) => {
  verbose && log.normal('Downloading file from youtube', { url })
  const videoId = ytdl.getURLVideoID(url)
  filePath = path.resolve(config.contentDir, filePath || `${videoId}.mp4`)
  const { fileExists } = isFileExistsSync({ filePath })
  if (fileExists && !force) {
    verbose && log.normal('Video file already exists', { filePath })
    return { filePath }
  }
  const ydtlStream = ytdl(url)
  const writeStream = createWriteStream(filePath)
  ydtlStream.pipe(writeStream)
  await new Promise((resolve, reject) => {
    writeStream.on('finish', resolve)
    writeStream.on('error', reject)
  })
  verbose && log.normal('Downloaded file from youtube', { filePath })
  return {
    filePath,
  }
}

export const youtube = {
  uploadFile,
  addThumbnail,
  downloadFile,
}
