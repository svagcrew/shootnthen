import type { Config } from '@/lib/config.js'
import { getEnv } from '@/lib/env.js'
import { parseFileName } from '@/lib/meta.js'
import { prettifySrtContent } from '@/lib/srt.js'
import type { Lang } from '@/lib/utils.js'
import { wait } from '@/lib/utils.js'
import { promises as fs } from 'fs'
import path from 'path'
import { RevAiApiClient, TranslationModel } from 'revai-node-sdk'
import { isFileExistsSync, log } from 'svag-cli-utils'

export const extractSrtByRevai = async ({
  config,
  filePath,
  lang,
  translatedLangs = [],
  force,
  verbose,
}: {
  config: Config
  filePath: string
  lang?: string
  translatedLangs?: Lang[]
  force?: boolean
  verbose?: boolean
}) => {
  verbose && log.normal('Extracting srt', { filePath, lang })
  filePath = path.resolve(config.contentDir, filePath)
  const parsed = parseFileName(filePath)
  if (parsed.ext !== 'mp3') {
    throw new Error('Only mp3 files are allowed')
  }
  if (!lang) {
    if (parsed.langSingle) {
      lang = parsed.langSingle
    } else {
      throw new Error('Language not found')
    }
  }
  const srtFileName = `${parsed.name}.${lang}.srt`
  const srtFilePath = path.resolve(parsed.dirname, srtFileName)
  const jsonFileName = `${parsed.name}.${lang}.json`
  const jsonFilePath = path.resolve(parsed.dirname, jsonFileName)
  const txtFileName = `${parsed.name}.${lang}.txt`
  const txtFilePath = path.resolve(parsed.dirname, txtFileName)
  const { fileExists } = isFileExistsSync({ filePath: srtFilePath })
  if (fileExists && !force) {
    verbose && log.normal('Srt file already exists', { srtFilePath })
    return { srtFilePath }
  }
  await extractSrtSimpleByRevai({
    // config,
    inputAudioPath: filePath,
    outputSrtPath: srtFilePath,
    outputJsonPath: jsonFilePath,
    outputTxtPath: txtFilePath,
    lang,
    translatedLangs,
    verbose,
  })
  verbose && log.normal('Extracted srt', { srtFilePath, jsonFilePath })
  return { srtFilePath }
}

export const extractSrtSimpleByRevai = async ({
  // config,
  inputAudioPath,
  outputSrtPath,
  outputJsonPath,
  outputTxtPath,
  lang,
  translatedLangs,
  verbose,
}: {
  // config: Config,
  inputAudioPath: string
  outputSrtPath: string
  outputJsonPath: string
  outputTxtPath: string
  lang: string
  translatedLangs: Lang[]
  verbose?: boolean
}) => {
  const accessToken = getEnv('REVAI_ACCESS_TOKEN')
  if (!accessToken) {
    throw new Error('REVAI_ACCESS_TOKEN not found')
  }
  const client = new RevAiApiClient(accessToken)
  verbose && log.normal('Submitting job', { inputAudioPath, lang, translatedLangs })
  const job = await client.submitJobLocalFile(inputAudioPath, {
    language: lang,
    ...(translatedLangs?.length
      ? {
          translation_config: {
            target_languages: translatedLangs.map((translatedLang) => ({
              language: translatedLang,
              model: TranslationModel.PREMIUM,
            })),
          },
        }
      : {}),
  })

  while (true) {
    verbose && log.normal('Waiting for job', { jobId: job.id })
    await wait(5)
    const jobDetails = await client.getJobDetails(job.id)
    if (jobDetails.status === 'in_progress') {
      continue
    }
    if (jobDetails.status === 'transcribed') {
      break
    }
    log.error('Wrong status', jobDetails)
    throw new Error('Job failed')
  }

  verbose && log.normal('Getting original captions', { jobId: job.id })
  const captionsRaw = await client.getCaptions(job.id)
  await fs.writeFile(outputSrtPath, captionsRaw)
  const captions = await fs.readFile(outputSrtPath, 'utf8')
  const prettifyedCaptions = await prettifySrtContent({ srtContent: captions })
  await fs.writeFile(outputSrtPath, prettifyedCaptions)
  const json = await client.getTranscriptObject(job.id)
  await fs.writeFile(outputJsonPath, JSON.stringify(json, null, 2))
  const txt = await client.getTranscriptText(job.id)
  await fs.writeFile(outputTxtPath, txt)

  const parsedPath = parseFileName(outputSrtPath)
  const translatedSrtPaths = translatedLangs.map((translatedLang) => {
    const translatedFileName = `${parsedPath.name}.${translatedLang}.srt`
    const translatedFilePath = path.resolve(parsedPath.dirname, translatedFileName)
    return translatedFilePath
  })
  const translatedJsonPaths = translatedLangs.map((translatedLang) => {
    const translatedFileName = `${parsedPath.name}.${translatedLang}.json`
    const translatedFilePath = path.resolve(parsedPath.dirname, translatedFileName)
    return translatedFilePath
  })
  const translatedTxtPaths = translatedLangs.map((translatedLang) => {
    const translatedFileName = `${parsedPath.name}.${translatedLang}.txt`
    const translatedFilePath = path.resolve(parsedPath.dirname, translatedFileName)
    return translatedFilePath
  })
  for (const [i, translatedLang] of translatedLangs.entries()) {
    const translatedSrtPath = translatedSrtPaths[i]
    const translatedJsonPath = translatedJsonPaths[i]
    const translatedTxtPath = translatedTxtPaths[i]
    await wait(5) // waiting for translated captions
    verbose && log.normal('Getting translated captions', { jobId: job.id, translatedLang })
    const translatedCaptionsRaw = await client.getTranslatedCaptions(job.id, translatedLang)
    await fs.writeFile(translatedSrtPath, translatedCaptionsRaw)
    const translatedCaptions = await fs.readFile(translatedSrtPath, 'utf8')
    const translatedPrettifyedCaptions = await prettifySrtContent({ srtContent: translatedCaptions })
    await fs.writeFile(translatedSrtPath, translatedPrettifyedCaptions)
    const translatedJson = await client.getTranslatedTranscriptObject(job.id, translatedLang)
    await fs.writeFile(translatedJsonPath, JSON.stringify(translatedJson, null, 2))
    const translatedTxt = await client.getTranslatedTranscriptText(job.id, translatedLang)
    await fs.writeFile(translatedTxtPath, translatedTxt)
  }
}
