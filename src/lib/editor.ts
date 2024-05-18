import type { Config } from '@/lib/config'
import { parseFileName } from '@/lib/meta'
import type { Lang } from '@/lib/utils'
import { fromRawLang } from '@/lib/utils'
import ffmpeg from 'fluent-ffmpeg'
import langCodesLib from 'langs'
import path from 'path'
import { isFileExistsSync, log, spawn } from 'svag-cli-utils'

export const extractAudioSimple = async ({
  inputVideoPath,
  outputAudioPath,
}: {
  inputVideoPath: string
  outputAudioPath: string
}) => {
  return await new Promise((resolve, reject) => {
    ffmpeg(inputVideoPath)
      .outputOptions('-map 0:a:0') // Selects the first audio track
      .audioCodec('libmp3lame') // Sets the audio codec to mp3
      .audioBitrate('320k')
      .noVideo() // No video data is processed
      .output(outputAudioPath)
      .on('end', () => {
        resolve(true)
      })
      .on('error', (err) => {
        reject(err)
      })
      .run()
  })
}

export const extractAudio = async ({
  config,
  filePath,
  lang,
  force,
  verbose,
}: {
  config: Config
  filePath: string
  lang: string
  force?: boolean
  verbose?: boolean
}) => {
  verbose && log.normal('Extracting audio', { filePath, lang })
  const parsed = parseFileName(filePath)
  const audioFileName = `${parsed.name}.${lang}.mp3`
  const audioFilePath = path.resolve(config.contentDir, audioFileName)
  const { fileExists } = isFileExistsSync({ filePath: audioFilePath })
  if (fileExists && !force) {
    verbose && log.normal('Audio file already exists', { audioFilePath })
    return { audioFilePath }
  }
  await extractAudioSimple({ inputVideoPath: filePath, outputAudioPath: audioFilePath })
  verbose && log.normal('Extracted audio', { audioFilePath })
  return { audioFilePath }
}

export const applyAudiosToVideoSimple = async ({
  inputVideoPath,
  inputAudios,
  outputVideoPath,
}: {
  inputVideoPath: string
  inputAudios: Array<{ lang: string; audioPath: string }>
  outputVideoPath: string
}) => {
  let nativeCommand = `ffmpeg -i "${inputVideoPath}"`
  for (const audio of inputAudios) {
    nativeCommand += ` -i "${audio.audioPath}"`
  }
  nativeCommand += ` -map 0:v`
  for (const [index] of inputAudios.entries()) {
    nativeCommand += ` -map ${index + 1}:a`
  }
  for (const [index, audio] of inputAudios.entries()) {
    const langData = langCodesLib.where('1', audio.lang)
    if (!langData) {
      throw new Error(`Language not found: ${audio.lang}`)
    }
    const lang2 = langData['2']
    if (!lang2) {
      throw new Error(`Language not found: ${audio.lang}`)
    }
    nativeCommand += ` -metadata:s:a:${index} language=${lang2}`
  }
  nativeCommand += ` -c:v copy -c:a aac -y "${outputVideoPath}"`
  await spawn({ command: nativeCommand, cwd: process.cwd() })
}

export const applyAudiosToVideo = async ({
  inputVideoPath,
  config,
  langs,
  verbose,
}: {
  inputVideoPath: string
  config: Config
  langs: Lang[]
  verbose?: boolean
}) => {
  verbose && log.normal('Applying audios to video', { inputVideoPath, langs })
  const parsed = parseFileName(inputVideoPath)
  if (langs.length === 0) {
    throw new Error('No languages provided')
  }
  const outputVideoMarks = [...parsed.notLangMarks, ...langs]
  const outputVideoFileName = `${parsed.name}.${outputVideoMarks.join('.')}.mp4`
  const outputVideoPath = path.resolve(config.contentDir, outputVideoFileName)
  const inputAudios: Array<{ lang: string; audioPath: string }> = []
  for (const lang of langs) {
    const langProcessed = fromRawLang(lang)
    const audioFileName = `${parsed.name}.${langProcessed}.mp3`
    const audioFilePath = path.resolve(config.contentDir, audioFileName)
    const { fileExists } = isFileExistsSync({ filePath: audioFilePath })
    if (!fileExists) {
      throw new Error(`Audio file not found: ${audioFilePath}`)
    }
    inputAudios.push({ lang, audioPath: audioFilePath })
  }
  await applyAudiosToVideoSimple({ inputVideoPath, inputAudios, outputVideoPath })
  verbose && log.normal('Applied audios to video', { outputVideoPath })
  return { outputVideoPath }
}

export const converWavToMp3 = async ({
  inputWavPath,
  outputMp3Path,
}: {
  inputWavPath: string
  outputMp3Path: string
}) => {
  const nativeCommand = `ffmpeg -i "${inputWavPath}" -codec:a libmp3lame -qscale:a 2 -y "${outputMp3Path}"`
  await spawn({ command: nativeCommand, cwd: process.cwd() })
  return {
    inputWavPath,
    outputMp3Path,
  }
}
