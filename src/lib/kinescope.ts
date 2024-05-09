import { Config } from '@/lib/config'
import { getEnv } from '@/lib/env'
import { getMetaByFilePath, parseFileName, updateMeta } from '@/lib/meta'
import axios, { isAxiosError } from 'axios'
import fs from 'fs'
import path from 'path'
import { log } from 'svag-cli-utils'
import { slugify, transliterate } from 'transliteration'

const uploadFile = async ({
  config,
  filePath,
  parentId,
  videoId,
  verbose,
  title,
}: {
  config: Config
  filePath: string
  parentId?: string
  videoId?: string
  verbose?: boolean
  title?: string
}) => {
  verbose &&
    log.normal(`Uploading file to Kinescope`, {
      filePath,
      parentId,
      videoId,
    })
  if (!videoId && !parentId) {
    throw new Error('parentId or videoId required')
  }
  const filePathAbs = path.resolve(config.contentDir, filePath)
  const { meta, metaFilePath } = getMetaByFilePath({ filePath: filePathAbs, config })
  const { name, basename, ext } = parseFileName(filePath)
  if (ext !== 'mp4') {
    throw new Error('Only mp4 files allowed')
  }
  title = title || meta.title || name

  const fileDataBinary = fs.createReadStream(filePathAbs)
  const res = await (async () => {
    try {
      return await axios({
        method: 'post',
        url: 'https://uploader.kinescope.io/v2/video',
        headers: {
          Authorization: `Bearer ${getEnv('KINESCOPE_API_KEY')}`,
          ...(videoId ? { 'X-Replace-Video-ID': videoId } : {}),
          ...(parentId && !videoId ? { 'X-Parent-ID': parentId } : {}),
          'X-Video-Title': transliterate(title),
          'X-File-Name': slugify(basename),
          'Content-type': 'video/mp4',
        },
        data: fileDataBinary,
      })
    } catch (err) {
      if (isAxiosError(err) && err.response?.data) {
        throw new Error(JSON.stringify(err.response.data, null, 2))
      }
      throw err
    }
  })()

  const id = res.data.data.id
  if (!id) {
    throw new Error(`No id after upload, ${JSON.stringify(res.data, null, 2)}`)
  }
  verbose && log.normal('Uploaded file to Kinescope', { id, filePath: filePathAbs })

  verbose && log.normal('Changing title in Kinescope')
  try {
    await axios({
      method: 'patch',
      url: `https://api.kinescope.io/v1/videos/${id}`,
      headers: {
        Authorization: `Bearer ${getEnv('KINESCOPE_API_KEY')}`,
      },
      data: {
        title,
      },
    })
  } catch (err: any) {
    if (isAxiosError(err)) {
      log.red(JSON.stringify(err.response?.data, null, 2))
    }
    log.red(err?.message || err)
  }
  verbose && log.normal('Changed title in Kinescope')

  const newFilesWithoutOldRecord = meta.kinescope.videos.filter((file) => file.id !== id)
  const newFilesWithNewRecord = [...newFilesWithoutOldRecord, { id, filePath: filePathAbs }]
  meta.kinescope.videos = newFilesWithNewRecord
  updateMeta({ meta, metaFilePath })
  return {
    filePath: filePathAbs,
    kinescopeData: res.data,
  }
}

export const getProjects = async () => {
  const res = await axios.get('https://api.kinescope.io/v1/projects', {
    headers: {
      Authorization: `Bearer ${getEnv('KINESCOPE_API_KEY')}`,
    },
    params: {
      catalog_type: 'vod',
      per_page: 100,
      page: 1,
    },
  })
  return res.data
}

export const kinescope = {
  uploadFile,
  getProjects,
}
