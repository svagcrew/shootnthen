/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable no-console */

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
  const data = {
    access_token: getEnv('VK_ACCESS_TOKEN'),
    v: '5.199',
    name: title,
    description,
    ...(groupId ? { group_id: Math.abs(+groupId).toString() } : {}),
    ...(albumId ? { album_id: Math.abs(+albumId).toString() } : {}),
    // ...(groupId ? { group_id: groupId } : {}),
    // ...(albumId ? { album_id: albumId } : {}),
    wallpost: 0,
    is_private: privacyStatus === 'private' ? 1 : 0,
  }
  const formData0 = new FormData()
  for (const [key, value] of Object.entries(data)) {
    formData0.append(key, value)
  }
  const uploadUrlResponse = await axios.post('https://api.vk.com/method/video.save', formData0, {
    headers: {
      ...formData0.getHeaders(),
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

  if (!config.vkGroupId) {
    throw new Error('No VK group ID')
  }

  const videoIdParts = videoId.split('_')
  const validVideoId = videoIdParts[1] || videoIdParts[0]
  const uploadUrlResponse = await axios.get('https://api.vk.com/method/video.getThumbUploadUrl', {
    params: {
      access_token: getEnv('VK_ACCESS_TOKEN'),
      v: '5.199',
      video_id: validVideoId,
      owner_id: config.vkGroupId,
    },
  })
  console.dir(uploadUrlResponse.data, { depth: null })
  const uploadUrlResponseError = uploadUrlResponse.data.error_msg || uploadUrlResponse.data.error?.error_msg
  if (uploadUrlResponseError) {
    throw new Error(`Error uploading thumbnail: ${uploadUrlResponseError}`)
  }

  const uploadUrl = uploadUrlResponse.data.response.upload_url

  const formData = new FormData()
  formData.append('file', fsync.createReadStream(thumbnailPathAbs))

  const thumbnailResponse = await axios.post(uploadUrl, formData, {
    headers: {
      ...formData.getHeaders(),
    },
  })
  console.dir(thumbnailResponse.data, { depth: null })
  const thumbnailResponseError = thumbnailResponse.data.error_msg || thumbnailResponse.data.error?.error_msg
  if (thumbnailResponseError) {
    throw new Error(`Error uploading thumbnail: ${thumbnailResponseError}`)
  }

  const formData1 = new FormData()
  formData1.append('access_token', getEnv('VK_ACCESS_TOKEN'))
  formData1.append('owner_id', config.vkGroupId)
  formData1.append('thumb_json', JSON.stringify(thumbnailResponse.data))
  formData1.append('video_id', validVideoId)
  formData1.append('set_thumb', 1)
  formData1.append('v', '5.199')
  const thumbnailSaveResponse = await axios.post('https://api.vk.com/method/video.saveUploadedThumb', formData1, {
    headers: {
      ...formData1.getHeaders(),
    },
  })
  console.dir(thumbnailSaveResponse.data, { depth: null })
  const thumbnailSaveResponseError = thumbnailSaveResponse.data.error_msg || thumbnailSaveResponse.data.error?.error_msg
  if (thumbnailSaveResponseError) {
    throw new Error(`Error uploading thumbnail: ${thumbnailSaveResponseError}`)
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

  if (!config.vkGroupId) {
    throw new Error('No VK group ID')
  }

  // Log before starting the update if verbose mode is enabled
  verbose && log.normal('Updating desc and title', { videoId, desc, title })

  const videoIdParts = videoId.split('_')
  const validVideoId = videoIdParts[1] || videoIdParts[0]
  // Fetch the current video details
  const data = {
    access_token: getEnv('VK_ACCESS_TOKEN'),
    v: '5.199',
    video_id: validVideoId,
    name: title,
    desc,
    owner_id: config.vkGroupId,
  }
  const formData = new FormData()
  for (const [key, value] of Object.entries(data)) {
    formData.append(key, value)
  }
  const videoDetailsResponse = await (async () => {
    try {
      return await axios.post('https://api.vk.com/method/video.edit', formData, {
        headers: {
          ...formData.getHeaders(),
        },
      })
    } catch (error: any) {
      const errorData = error.response?.data
      if (errorData?.error) {
        throw new Error(`Error updating video: ${errorData.error.error_msg}`)
      } else {
        console.error(errorData)
        throw error
      }
    }
  })()

  if (videoDetailsResponse.data.error) {
    throw new Error(`Error updating video: ${videoDetailsResponse.data.error.error_msg}`)
  }

  verbose && log.normal('Desc and title uploaded', { videoId, desc, title })

  return videoDetailsResponse.data.response
}

const changeOrder = async ({
  config,
  videoId,
  prevVideoId,
  albumId,
  groupId,
  verbose,
}: {
  config: Config
  videoId: string
  prevVideoId: string
  albumId: string
  groupId: string
  verbose?: boolean
}) => {
  // Log before starting the update if verbose mode is enabled
  verbose && log.normal('Updating video order', { videoId, prevVideoId })

  const videoIdParts = videoId.split('_')
  const validVideoId = videoIdParts[1] || videoIdParts[0]
  const prevVideoIdParts = prevVideoId.split('_')
  const validPrevVideoId = prevVideoIdParts[1] || prevVideoIdParts[0]
  // Fetch the current video details
  const data = {
    access_token: getEnv('VK_ACCESS_TOKEN'),
    v: '5.199',
    album_id: albumId,
    video_id: validVideoId,
    target_id: groupId,
    owner_id: groupId,
    after_video_id: validPrevVideoId,
    after_owner_id: groupId,
  }
  console.log(data)
  const formData = new FormData()
  for (const [key, value] of Object.entries(data)) {
    formData.append(key, value)
  }
  const reorderResponse = await (async () => {
    try {
      return await axios.post('https://api.vk.com/method/video.reorderVideos', formData, {
        headers: {
          ...formData.getHeaders(),
        },
      })
    } catch (error: any) {
      const errorData = error.response?.data
      if (errorData?.error) {
        throw new Error(`Error updating video: ${errorData.error.error_msg}`)
      } else {
        console.error(errorData)
        throw error
      }
    }
  })()

  if (reorderResponse.data.error) {
    throw new Error(`Error updating video: ${reorderResponse.data.error.error_msg}`)
  }

  verbose && log.normal('Video order updated', { videoId, prevVideoId })

  return reorderResponse.data.response
}

const post = async ({
  config,
  videoId,
  groupId,
  message,
  verbose,
  publishDate,
}: {
  config: Config
  videoId: string
  groupId: string
  message: string
  verbose?: boolean
  publishDate?: Date
}) => {
  // Log before starting the update if verbose mode is enabled
  verbose && log.normal('Posting video', { videoId, message })

  const videoIdParts = videoId.split('_')
  const validVideoId = videoIdParts[1] || videoIdParts[0]
  // Fetch the current video details
  const data = {
    access_token: getEnv('VK_ACCESS_TOKEN'),
    v: '5.199',
    video_id: validVideoId,
    owner_id: groupId,
    message,
    from_group: 1,
    attachments: `video${groupId}_${validVideoId}`,
    ...(publishDate
      ? {
          // unix timestamp
          publish_date: Math.floor(publishDate.getTime() / 1_000),
        }
      : {}),
  }
  console.log(data)
  const formData = new FormData()
  for (const [key, value] of Object.entries(data)) {
    formData.append(key, value)
  }
  const postReponse = await (async () => {
    try {
      return await axios.post('https://api.vk.com/method/wall.post', formData, {
        headers: {
          ...formData.getHeaders(),
        },
      })
    } catch (error: any) {
      const errorData = error.response?.data
      if (errorData?.error) {
        throw new Error(`Error posting video: ${errorData.error.error_msg}`)
      } else {
        console.error(errorData)
        throw error
      }
    }
  })()

  if (postReponse.data.error) {
    throw new Error(`Error posting video: ${postReponse.data.error.error_msg}`)
  }

  verbose && log.normal('Video posted', { videoId, message })

  return postReponse.data.response
}

export const vk = {
  post,
  uploadFile,
  addThumbnail,
  updateTexts,
  changeOrder,
}
