/* eslint-disable no-console */
import { Config } from '@/lib/config'
import { getEnv } from '@/lib/env'
import { getMetaByFilePath, parseFileName, updateMeta } from '@/lib/meta'
import { Lang, LangProcessed } from '@/lib/utils'
import axios, { isAxiosError } from 'axios'
import FormData from 'form-data'
import fs from 'fs'
import path from 'path'
import { isFileExists } from 'svag-cli-utils'

const createDubbing = async ({
  config,
  filePath,
  srcLang,
  distLang,
}: {
  config: Config
  filePath: string
  srcLang: Lang
  distLang: Lang
}) => {
  const filePathAbs = path.resolve(config.contentDir, filePath)
  const { meta, metaFilePath } = getMetaByFilePath({ filePath, config })
  const parsedName = parseFileName(filePath)
  const apiKey = getEnv('ELEVENLABS_API_KEY')
  const projectName = `${parsedName.name}.${distLang}.${parsedName.ext}`
  if (!parsedName.ext || !['mp4', 'mp3'].includes(parsedName.ext)) {
    throw new Error('Only mp4 and mp3 files are allowed')
  }
  const { fileExists } = await isFileExists({ filePath: filePathAbs })
  if (!fileExists) {
    throw new Error('File not found')
  }
  const contentType = parsedName.ext === 'mp4' ? 'video/mp4' : 'audio/mp3'
  const fileSize = fs.statSync(filePathAbs).size
  const file = fs.createReadStream(filePathAbs)

  const data = {
    mode: 'dubbing',
    file,
    name: projectName,
    source_lang: srcLang,
    target_lang: distLang,
    num_speakers: '1',
    highest_resolution: 'true',
  }

  const form = (() => {
    const result = new FormData()
    for (const key in data) {
      if (key === 'file') {
        result.append(key, (data as any)[key], {
          contentType,
          filename: projectName,
          knownLength: fileSize,
        })
      } else {
        result.append(key, (data as any)[key])
      }
    }
    return result
  })()

  const res = await (async () => {
    try {
      return await axios({
        method: 'post',
        url: 'https://api.elevenlabs.io/v1/dubbing',
        headers: {
          ...form.getHeaders(),
          'Content-Type': 'multipart/form-data',
          'xi-api-key': apiKey,
        },
        data: form,
      })
    } catch (err) {
      if (isAxiosError(err)) {
        throw new Error(JSON.stringify(err.response?.data, null, 2))
      }
      throw err
    }
  })()
  const dubbingId = res.data.dubbing_id
  const duration = res.data.expected_duration_sec
  if (!dubbingId) {
    throw new Error('No dubbingId after upload')
  }
  if (!duration) {
    throw new Error('No duration after upload')
  }
  meta.elevenlabs.dubbings.push({
    id: dubbingId,
    duration,
    srcLang,
    distLang,
    distFilePath: null,
    srcFilePath: filePathAbs,
    srcUrl: null,
  })
  updateMeta({ meta, metaFilePath })
  return { dubbingId, duration, srcLang, distLang }
}

const createDubbingByUrl = async ({
  config,
  url,
  filePath, // only for meta creation and ext getter
  srcLang,
  distLang,
}: {
  config: Config
  url: string
  filePath: string
  srcLang: Lang
  distLang: Lang
}) => {
  const { meta, metaFilePath } = getMetaByFilePath({ filePath, config })
  const parsedName = parseFileName(filePath)
  const apiKey = getEnv('ELEVENLABS_API_KEY')
  const projectName = `${parsedName.name}.${distLang}.${parsedName.ext}`
  if (!parsedName.ext || !['mp4', 'mp3'].includes(parsedName.ext)) {
    throw new Error('Only mp4 and mp3 files are allowed')
  }

  const data = {
    mode: 'dubbing',
    source_url: url,
    name: projectName,
    source_lang: srcLang,
    target_lang: distLang,
    num_speakers: '1',
    highest_resolution: 'true',
  }

  const form = (() => {
    const result = new FormData()
    for (const key in data) {
      result.append(key, (data as any)[key])
    }
    return result
  })()

  const res = await (async () => {
    try {
      return await axios({
        method: 'post',
        url: 'https://api.elevenlabs.io/v1/dubbing',
        headers: {
          ...form.getHeaders(),
          'Content-Type': 'multipart/form-data',
          'xi-api-key': apiKey,
        },
        data: form,
      })
    } catch (err) {
      if (isAxiosError(err)) {
        throw new Error(JSON.stringify(err.response?.data, null, 2))
      }
      throw err
    }
  })()
  console.dir(res.data, { depth: null })
  const dubbingId = res.data.dubbing_id
  const duration = res.data.expected_duration_sec
  if (!dubbingId) {
    throw new Error('No dubbingId after upload')
  }
  if (!duration && duration !== 0) {
    throw new Error('No duration after upload')
  }
  meta.elevenlabs.dubbings.push({
    id: dubbingId,
    duration,
    srcLang,
    distLang,
    distFilePath: null,
    srcFilePath: null,
    srcUrl: url,
  })
  updateMeta({ meta, metaFilePath })
  return { dubbingId, duration, srcLang, distLang }
}

const getDubbing = async ({ dubbingId }: { dubbingId: string }) => {
  const apiKey = getEnv('ELEVENLABS_API_KEY')
  const res = await (async () => {
    try {
      return await axios({
        method: 'get',
        url: `https://api.elevenlabs.io/v1/dubbing/${dubbingId}`,
        headers: {
          'xi-api-key': apiKey,
        },
      })
    } catch (err) {
      if (isAxiosError(err)) {
        throw new Error(JSON.stringify(err.response?.data, null, 2))
      }
      throw err
    }
  })()
  console.dir(res.data, { depth: null })
  const error = res.data.error
  const name = res.data.name
  const status = res.data.status
  const targetLangs = res.data.target_languages
  if (!name) {
    throw new Error('No name in response')
  }
  if (!status) {
    throw new Error('No status in response')
  }
  if (!targetLangs) {
    throw new Error('No targetLangs in response')
  }
  return { name, status, targetLangs, error } as {
    name: string
    status: 'dubbing' | 'done' | 'error'
    targetLangs: string[]
    error: string | undefined | null
  }
}

export const downloadDubbing = async ({
  config,
  dubbingId,
  lang,
  filePath,
}: {
  config: Config
  dubbingId: string
  lang: LangProcessed
  filePath: string
}) => {
  const filePathAbs = path.resolve(config.contentDir, filePath)
  const { meta, metaFilePath } = getMetaByFilePath({ filePath, config })
  const apiKey = getEnv('ELEVENLABS_API_KEY')

  const res = await (async () => {
    try {
      return await axios({
        method: 'get',
        url: `https://api.elevenlabs.io/v1/dubbing/${dubbingId}/audio/${lang}`,
        headers: {
          'xi-api-key': apiKey,
        },
      })
    } catch (err) {
      if (isAxiosError(err)) {
        throw new Error(JSON.stringify(err.response?.data, null, 2))
      }
      throw err
    }
  })()

  const fileContent = res.data
  fs.writeFileSync(filePathAbs, fileContent)
  const exRecord = meta.elevenlabs.dubbings.find((dubbing) => dubbing.id === dubbingId)
  if (exRecord) {
    exRecord.distFilePath = filePathAbs
    updateMeta({ meta, metaFilePath })
  }
  return {
    filePath: filePathAbs,
  }
}

export const elevenlabs = {
  createDubbing,
  createDubbingByUrl,
  getDubbing,
  downloadDubbing,
}
