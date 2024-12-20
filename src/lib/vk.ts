/* eslint-disable no-console */
/* eslint-disable @typescript-eslint/no-unused-vars */
import type { Config } from '@/lib/config.js'
import { getEnv } from '@/lib/env.js'
import { getMetaByFilePath, updateMeta } from '@/lib/meta.js'
import axios from 'axios'
import FormData from 'form-data'
import fsync from 'fs'
import path from 'path'
import { log } from 'svag-cli-utils'

const uploadFile = async ({
  config,
  groupId,
  albumId,
  title,
  description = '',
  privacyStatus,
  thumbnailPath,
  filePath,
  force,
  verbose,
}: {
  config: Config
  groupId?: string
  albumId?: string
  title?: string
  description?: string
  privacyStatus?: 'private' | 'public'
  thumbnailPath?: string
  filePath: string
  force?: boolean
  verbose?: boolean
}) => {
  verbose && log.normal('Uploading file to VK', { filePath })
  const filePathAbs = path.resolve(config.contentDir, filePath)
  const { meta, metaFilePath } = getMetaByFilePath({ filePath: filePathAbs, config })
  const exRecord = meta.vk.videos.find((v) => v.filePath === filePathAbs)
  if (exRecord && !force) {
    verbose && log.normal('File already uploaded', { filePath })
    return { filePath: filePathAbs, id: exRecord.id, skip: true }
  }
  title = title || meta.title
  if (!title) {
    throw new Error('No title')
  }

  // Step 1: Get upload URL
  const uploadUrlResponse = await axios.get('https://api.vk.com/method/video.save', {
    params: {
      access_token: getEnv('VK_ACCESS_TOKEN'),
      v: '5.199',
      name: title,
      description,
      ...(groupId ? { group_id: groupId } : {}),
      ...(albumId ? { album_id: albumId } : {}),
      wallpost: 1,
      is_private: privacyStatus === 'private' ? 1 : 0,
    },
  })
  if (uploadUrlResponse.data.error) {
    throw new Error(`Error getting upload URL: ${uploadUrlResponse.data.error.error_msg}`)
  }

  const uploadUrl = uploadUrlResponse.data.response.upload_url

  // Step 2: Upload the video
  const formData = new FormData()
  formData.append('video_file', fsync.createReadStream(filePathAbs))

  const uploadResponse = await axios.post(uploadUrl, formData, {
    headers: {
      ...formData.getHeaders(),
    },
  })
  console.dir(uploadResponse.data, { depth: null })

  const videoId = uploadResponse.data.video_id?.toString()
  if (!videoId) {
    throw new Error('No video ID received after upload')
  }

  const viewUrl = `https://vk.com/video${videoId}`
  meta.vk.videos.push({ id: videoId, filePath: filePathAbs, title, viewUrl })
  updateMeta({ meta, metaFilePath })
  verbose && log.normal('Uploaded file to VK', { filePath })

  if (thumbnailPath) {
    await addThumbnail({ config, videoId, thumbnailPath, verbose })
  }

  return {
    filePath: filePathAbs,
    viewUrl,
    id: videoId,
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
  const thumbnailPathAbs = path.resolve(config.contentDir, thumbnailPath)
  verbose && log.normal('Uploading thumbnail', { thumbnailPath: thumbnailPathAbs })

  const uploadUrlResponse = await axios.get('https://api.vk.com/method/video.getThumbUploadUrl', {
    params: {
      access_token: getEnv('VK_ACCESS_TOKEN'),
      v: '5.199',
      video_id: videoId,
    },
  })
  console.dir(uploadUrlResponse.data, { depth: null })
  if (uploadUrlResponse.data.error) {
    throw new Error(`Error getting upload URL: ${uploadUrlResponse.data.error.error_msg}`)
  }

  const uploadUrl = uploadUrlResponse.data.response.upload_url

  const formData = new FormData()
  formData.append('thumb', fsync.createReadStream(thumbnailPathAbs))

  const thumbnailResponse = await axios.post(uploadUrl, formData, {
    headers: {
      ...formData.getHeaders(),
    },
  })
  console.dir(thumbnailResponse.data, { depth: null })

  if (thumbnailResponse.data.error) {
    throw new Error(`Error uploading thumbnail: ${thumbnailResponse.data.error.error_msg}`)
  }

  verbose && log.normal('Thumbnail uploaded', { thumbnailPath: thumbnailPathAbs })
}

const updateTexts = async ({
  config,
  videoId,
  title,
  desc,
  verbose,
}: {
  config: Config
  videoId: string
  title?: string
  desc?: string
  verbose?: boolean
}) => {
  if (!title && !desc) {
    throw new Error('No title or desc')
  }

  // Log before starting the update if verbose mode is enabled
  verbose && log.normal('Updating desc and title', { videoId, desc, title })

  // Fetch the current video details
  const videoDetailsResponse = await axios.get('https://api.vk.com/method/video.edit', {
    params: {
      access_token: getEnv('VK_ACCESS_TOKEN'),
      v: '5.199',
      video_id: videoId,
      name: title,
      description: desc,
    },
  })

  if (videoDetailsResponse.data.error) {
    throw new Error(`Error updating video: ${videoDetailsResponse.data.error.error_msg}`)
  }

  verbose && log.normal('Desc and title uploaded', { videoId, desc, title })

  return videoDetailsResponse.data.response
}

export const vk = {
  uploadFile,
  addThumbnail,
  updateTexts,
}
