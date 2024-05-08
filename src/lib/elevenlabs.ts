/* eslint-disable no-console */
import { getEnv } from '@/lib/env'
import { parseFileName } from '@/lib/meta'
import { Lang } from '@/lib/utils'
import axios, { isAxiosError } from 'axios'
import { fileFromPath } from 'formdata-node/file-from-path'

const createDubbingProject = async ({
  srcFilePath,
  srcLang,
  distLang,
}: {
  srcFilePath: string
  srcLang: Lang
  distLang: Lang
}) => {
  const parsedName = parseFileName(srcFilePath)
  const apiKey = getEnv('ELEVENLABS_API_KEY')
  const projectName = `${parsedName.name}.${distLang}`
  const file = await fileFromPath(srcFilePath)

  const data = {
    mode: 'dubbing',
    file, // Attach the file as a Buffer
    name: projectName,
    source_lang: srcLang,
    target_lang: distLang,
    num_speakers: 1,
    highest_resolution: true,
  }

  const form = (() => {
    const result = new FormData()
    for (const key in data) {
      if (key === 'file') {
        result.append(key, (data as any)[key], parsedName.basename) // Append the file with its original base name
      } else {
        result.append(key, (data as any)[key])
      }
    }
    return result
  })()

  try {
    const res = await axios.post('https://api.elevenlabs.io/v1/dubbing', form, {
      headers: {
        'Content-Type': 'multipart/form-data',
        'xi-api-key': apiKey,
      },
    })
    console.dir(res.data, { depth: null })
  } catch (err) {
    if (isAxiosError(err)) {
      console.error(err.response?.data)
    } else {
      console.error(err)
    }
  }
}

export const elevenlabs = {
  createDubbingProject,
}
