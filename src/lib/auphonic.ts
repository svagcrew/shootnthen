import { Config } from '@/lib/config'
import { getEnv } from '@/lib/env'
import { getMetaByFilePath, parseFileName, updateMeta } from '@/lib/meta'
import { wait } from '@/lib/utils'
import axios, { isAxiosError } from 'axios'
import FormData from 'form-data'
import fs from 'fs'
import path from 'path'
import { pipeline } from 'stream'
import { isFileExists, log } from 'svag-cli-utils'
import util from 'util'
const streamPipeline = util.promisify(pipeline)

type Output = {
  format: string
  ending: string
  suffix: string
  filename: string
  split_on_chapters: boolean
  bitrate: number
  mono_mixdown: boolean
  size: number
  size_string: string
  download_url: string
  outgoing_services: string[]
  checksum: string
}

const createProject = async ({
  config,
  presetId,
  filePath,
  verbose,
}: {
  config: Config
  presetId?: string
  filePath: string
  verbose?: boolean
}) => {
  verbose && log.normal('Creating project', filePath)
  const filePathAbs = path.resolve(config.contentDir, filePath)
  const { meta, metaFilePath } = getMetaByFilePath({ filePath, config })
  const parsedName = parseFileName(filePath)
  const email = getEnv('AUPHONIC_EMAIL')
  const password = getEnv('AUPHONIC_PASSWORD')
  const projectName = parsedName.basename
  if (!parsedName.ext || !['mp4', 'mp3'].includes(parsedName.ext)) {
    throw new Error('Only mp4 and mp3 files are allowed')
  }
  const { fileExists } = await isFileExists({ filePath: filePathAbs })
  if (!fileExists) {
    throw new Error('File not found')
  }
  presetId = presetId || config.auphonicPresetId || undefined
  if (!presetId) {
    throw new Error('No presetId')
  }
  const contentType = parsedName.ext === 'mp4' ? 'video/mp4' : 'audio/mp3'
  const fileSize = fs.statSync(filePathAbs).size
  const file = fs.createReadStream(filePathAbs)

  const data = {
    input_file: file,
    preset: presetId,
    title: projectName,
    action: 'start',
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
        url: 'https://auphonic.com/api/simple/productions.json',
        auth: {
          username: email,
          password,
        },
        headers: {
          ...form.getHeaders(),
          'Content-Type': 'multipart/form-data',
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
  const projectId = res.data.data?.uuid
  if (!projectId) {
    throw new Error('No projectId after upload')
  }
  meta.auphonic.projects.push({
    id: projectId,
    srcFilePath: filePathAbs,
    distFilePath: null,
  })
  updateMeta({ meta, metaFilePath })
  verbose && log.normal('Created project', projectId)
  return { projectId }
}

const getProject = async ({ projectId, verbose }: { projectId: string; verbose?: boolean }) => {
  verbose && log.normal('Getting project', projectId)
  const email = getEnv('AUPHONIC_EMAIL')
  const password = getEnv('AUPHONIC_PASSWORD')
  const res = await (async () => {
    try {
      return await axios({
        method: 'get',
        url: `https://auphonic.com/api/production/${projectId}.json`,
        auth: {
          username: email,
          password,
        },
      })
    } catch (err) {
      if (isAxiosError(err)) {
        throw new Error(JSON.stringify(err.response?.data, null, 2))
      }
      throw err
    }
  })()
  const error = res.data.error_message
  const status =
    res.data.data.status_string === 'Done'
      ? ('done' as const)
      : res.data.data.status_string === 'Error'
        ? ('error' as const)
        : ('processing' as const)
  const outputs = (res.data.data.output_files || []) as Output[]
  // '0': 'File Upload',
  // '1': 'Waiting',
  // '2': 'Error',
  // '3': 'Done',
  // '4': 'Audio Processing',
  // '5': 'Audio Encoding',
  // '6': 'Outgoing File Transfer',
  // '7': 'Audio Mono Mixdown',
  // '8': 'Split Audio On Chapter Marks',
  // '9': 'Incomplete',
  // '10': 'Production Not Started Yet',
  // '11': 'Production Outdated',
  // '12': 'Incoming File Transfer',
  // '13': 'Stopping the Production',
  // '14': 'Speech Recognition',
  // '15': 'Production Changed',

  if (!status) {
    throw new Error('No status in response')
  }
  if (status === 'done' && !outputs.length) {
    throw new Error('No outputs in response')
  }
  const result = { status, error, outputs }
  verbose && log.normal('Got project', result)
  return result
}

const waitWhileProcessing = async ({
  projectId,
  verbose,
}: {
  projectId: string
  verbose?: boolean
}): Promise<{
  status: 'done'
  error: undefined
  outputs: Output[]
}> => {
  const result = await getProject({ projectId: projectId, verbose })
  if (result.status === 'done') {
    verbose && log.normal('Processing finished', result)
    return { ...result, status: 'done' }
  }
  if (result.status === 'error') {
    throw new Error(result.error || 'Error while processing')
  }
  verbose && log.normal('Waiting while processing', projectId)
  await wait(10)
  const awaitedResult = await waitWhileProcessing({ projectId })
  verbose && log.normal('Processing finished', result)
  return awaitedResult
}

const downloadProject = async ({
  config,
  projectId,
  filePath,
  verbose,
}: {
  config: Config
  projectId: string
  filePath: string
  verbose?: boolean
}) => {
  verbose && log.normal('Downloading project', projectId, filePath)
  const filePathAbs = path.resolve(config.contentDir, filePath)
  const { meta, metaFilePath } = getMetaByFilePath({ filePath, config })
  const { status, outputs } = await getProject({ projectId, verbose })
  if (status !== 'done') {
    throw new Error('Project is not done')
  }
  const outputMp3 = outputs.find((output) => output.format === 'mp3')
  if (!outputMp3) {
    throw new Error('No mp3 output')
  }
  const downloadUrl = outputMp3.download_url
  if (!downloadUrl) {
    throw new Error('No download_url')
  }
  const email = getEnv('AUPHONIC_EMAIL')
  const password = getEnv('AUPHONIC_PASSWORD')

  await (async () => {
    try {
      const response = await axios({
        method: 'get',
        url: downloadUrl,
        auth: {
          username: email,
          password,
        },
        responseType: 'stream',
      })
      await streamPipeline(response.data, fs.createWriteStream(filePathAbs))
      return response
    } catch (err) {
      if (isAxiosError(err)) {
        throw new Error(JSON.stringify(err.response?.data, null, 2))
      }
      throw err
    }
  })()

  const exRecord = meta.auphonic.projects.find((p) => p.id === projectId)
  if (exRecord) {
    exRecord.distFilePath = filePathAbs
    updateMeta({ meta, metaFilePath })
  }
  verbose && log.normal('Downloaded project', projectId, filePathAbs)
  return {
    filePath: filePathAbs,
  }
}

const createWaitDownload = async ({
  config,
  srcFilePath,
  distFilePath,
  verbose,
}: {
  config: Config
  srcFilePath: string
  distFilePath: string
  verbose?: boolean
}) => {
  const { projectId } = await createProject({ config, filePath: srcFilePath })
  await waitWhileProcessing({ projectId, verbose })
  const result = await downloadProject({ config, projectId, filePath: distFilePath, verbose })
  return result
}

export const auphonic = {
  createProject,
  getProject,
  waitWhileProcessing,
  downloadProject,
  createWaitDownload,
}
