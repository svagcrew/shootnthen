/* eslint-disable radix */
import type { Config } from '@/lib/config.js'
import {
  concatAudios,
  createSilentAudio,
  getAudioDuration,
  normalizeAudioDuration,
  syncAudiosDuration,
} from '@/lib/editor.js'
import { getEnv } from '@/lib/env.js'
import { parseFileName } from '@/lib/meta.js'
import { addSuffixToFilePath } from '@/lib/utils.js'
import { promises as fs } from 'fs'
import sdk from 'microsoft-cognitiveservices-speech-sdk'
import path from 'path'
import SrtParser from 'srt-parser-2'
import { isFileExistsSync, log } from 'svag-cli-utils'

type Subtitle = {
  id: string
  startTime: string
  startSeconds: number
  endTime: string
  endSeconds: number
  text: string
}

type TtsTask = {
  ssml: string
  durationMs: number
  type: 'speach' | 'gap'
  voiceName: string
}

// Helper function to convert time string to milliseconds
const timeStringToMilliseconds = (timeString: string): number => {
  // Format HH:MM:SS,mmm
  const [hours, minutes, rest] = timeString.split(':')
  const [seconds, milliseconds] = rest.replace(',', '.').split('.')
  const totalMs =
    parseInt(hours) * 3_600_000 + parseInt(minutes) * 60_000 + parseInt(seconds) * 1_000 + parseInt(milliseconds)
  return totalMs
}

// Helper function to escape XML special characters
const escapeXml = (unsafe: string): string => {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

const subtitlesToTtsTasks = ({
  desiredTotalDurationMs,
  subtitles,
  voiceName,
  lang,
}: {
  desiredTotalDurationMs: number
  subtitles: Subtitle[]
  voiceName: string
  lang: string
}) => {
  const ttsTasks: TtsTask[] = []

  let currentTotalDurationMs = 0
  let prevEndMs = 0

  for (const subtitle of subtitles) {
    let ssml = ''
    ssml += `<?xml version="1.0" encoding="UTF-8"?>\n`
    ssml += `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${lang}">\n`
    ssml += `<voice name="${voiceName}">\n`

    const text = subtitle.text

    const startTime = subtitle.startTime // in format HH:MM:SS,mmm
    const endTime = subtitle.endTime

    // Convert startTime and endTime to milliseconds
    const startMs = timeStringToMilliseconds(startTime)
    const endMs = timeStringToMilliseconds(endTime)

    // Calculate gap from previous end to current start
    const gapMs = startMs - prevEndMs

    // Calculate the desired duration for this subtitle
    const desiredDurationMs = endMs - startMs

    if (gapMs > 0) {
      currentTotalDurationMs += gapMs
      ttsTasks.push({
        ssml: `<break time="${gapMs}ms"/>`,
        durationMs: gapMs,
        type: 'gap',
        voiceName,
      })
    }

    ssml += `<prosody duration="${desiredDurationMs}ms">${escapeXml(text)}</prosody>\n`
    ssml += `</voice>\n`
    ssml += `</speak>`

    prevEndMs = endMs
    currentTotalDurationMs += desiredDurationMs
    ttsTasks.push({
      ssml,
      durationMs: desiredDurationMs,
      type: 'speach',
      voiceName,
    })
  }

  const remainingDurationMs = desiredTotalDurationMs - currentTotalDurationMs
  if (remainingDurationMs > 0) {
    ttsTasks.push({
      ssml: `<break time="${remainingDurationMs}ms"/>`,
      durationMs: remainingDurationMs,
      type: 'gap',
      voiceName,
    })
  }
  return ttsTasks
}

const executeTtsTask = async ({
  ttsTask,
  outputAudioPath,
  verbose,
}: {
  ttsTask: TtsTask
  outputAudioPath: string
  verbose?: boolean
}) => {
  if (ttsTask.type === 'gap') {
    verbose && log.normal(`Creating silent audio for gap (duration: ${ttsTask.durationMs}ms)`)
    await createSilentAudio({
      durationMs: ttsTask.durationMs,
      outputAudioPath,
      verbose,
    })
    verbose && log.normal(`Created silent audio for gap`)
    return ttsTask
  }

  // Azure Speech SDK credentials
  const subscriptionKey = getEnv('AZURE_AI_KEY')
  const serviceRegion = getEnv('AZURE_AI_REGION')
  // Initialize the Azure Speech SDK speech config
  const speechConfig = sdk.SpeechConfig.fromSubscription(subscriptionKey, serviceRegion)
  speechConfig.speechSynthesisOutputFormat = sdk.SpeechSynthesisOutputFormat.Audio16Khz32KBitRateMonoMp3
  speechConfig.speechSynthesisVoiceName = ttsTask.voiceName

  let tryIndex = 0
  // eslint-disable-next-line no-unreachable-loop
  while (tryIndex < 10) {
    try {
      // Create the Speech Synthesizer
      const audioConfig = sdk.AudioConfig.fromAudioFileOutput(outputAudioPath)
      const synthesizer = new sdk.SpeechSynthesizer(speechConfig, audioConfig)

      // Synthesize the SSML to audio file (async)
      verbose && log.normal(`Synthesizing SSML (duration: ${ttsTask.durationMs}ms)`, ttsTask.ssml)
      await new Promise<void>((resolve, reject) => {
        synthesizer.speakSsmlAsync(
          ttsTask.ssml,
          (result) => {
            if (result.reason === sdk.ResultReason.SynthesizingAudioCompleted) {
              resolve()
            } else {
              reject(new Error(`Speech synthesis failed: ${result.errorDetails}`))
            }
            synthesizer.close()
          },
          (err) => {
            synthesizer.close()
            reject(err)
          }
        )
      })
      verbose && log.normal(`Synthesized SSML chunk`)
      await normalizeAudioDuration({
        audioPath: outputAudioPath,
        durationMs: ttsTask.durationMs,
        verbose,
      })
      return ttsTask
    } catch (error: any) {
      if (
        error.messages ===
        'Speech synthesis failed: Status(StatusCode="ResourceExhausted", Detail="No free synthesizer") websocket error code: 1013'
      ) {
        verbose && log.normal('Speech synthesis failed: No free synthesizer', { tryIndex })
        tryIndex++
        await new Promise((resolve) => setTimeout(resolve, 10_000))
      }
      throw error
    }
  }
  return ttsTask
}

export const ttsByAzureai = async ({
  config,
  srtPath,
  srcAudioPath,
  lang,
  force,
  verbose,
}: {
  config: Config
  srtPath: string
  srcAudioPath: string
  lang?: string
  force?: boolean
  verbose?: boolean
}) => {
  verbose && log.normal('Ttsing', { srtPath, lang })
  const parsed = parseFileName(srtPath)
  if (parsed.ext !== 'srt') {
    throw new Error('Only srt files are allowed')
  }
  if (!lang) {
    if (parsed.langSingle) {
      lang = parsed.langSingle
    } else {
      throw new Error('Language not found')
    }
  }
  const distAudioName = `${parsed.name}.${lang}.mp3`
  const distAudioPath = path.resolve(config.contentDir, distAudioName)
  const { fileExists } = isFileExistsSync({ filePath: distAudioPath })
  if (fileExists && !force) {
    verbose && log.normal('Audio file already exists', { distAudioPath })
    return { distAudioPath }
  }
  await ttsSimpleByAzureai({
    // config,
    srtPath,
    distAudioPath,
    srcAudioPath,
    lang,
    verbose,
  })
  verbose && log.normal('Ttsed', { audioFilePath: distAudioPath })
  return { audioFilePath: distAudioPath }
}

const Stratched = async <T>(promises: Array<() => Promise<T>>): Promise<T[]> => {
  const results = []
  for (const promise of promises) {
    results.push(await promise())
  }
  return results
}

export const ttsSimpleByAzureai = async ({
  // config,
  srtPath,
  distAudioPath,
  srcAudioPath,
  lang,
  verbose,
}: {
  // config: Config,
  srtPath: string
  distAudioPath: string
  srcAudioPath: string
  lang: string
  verbose?: boolean
}) => {
  const desiredTotalDurationMs = await getAudioDuration({ audioPath: srcAudioPath })

  // Map language codes to voice names
  const voiceMap: { [key: string]: string } = {
    en: 'en-US-AndrewMultilingualNeural',
    // ru: 'ru-RU-SvetlanaNeural',
    // Add more mappings as needed
  }
  const voiceName = voiceMap[lang] || 'en-US-AriaNeural' // default voice if language not found

  // Read and parse the SRT file
  const srtContent = await fs.readFile(srtPath, 'utf8')
  const parser = new SrtParser()
  const subtitles = parser.fromSrt(srtContent) // Parse SRT

  const ttsTasks = subtitlesToTtsTasks({
    desiredTotalDurationMs,
    subtitles,
    voiceName,
    lang,
  })

  verbose && log.normal(`Generated ${ttsTasks.length} tts tasks`)

  console.dir(ttsTasks, { depth: null })

  const promises = ttsTasks.map((ttsTask, i) => async () => {
    console.log(123123123, i)
    const outputAudioPath = addSuffixToFilePath({ filePath: distAudioPath, suffix: `temp-${i}` })
    await executeTtsTask({ ttsTask, outputAudioPath, verbose })
    console.log(234234234, i)
    return outputAudioPath
  })
  // const ttsResultsPaths = await Promise.all(promises.map(async (promise) => await promise()))
  const ttsTempResultsPaths = await Stratched(promises)

  await concatAudios({ audioPaths: ttsTempResultsPaths, outputAudioPath: distAudioPath, verbose })
  // delete temp files
  await Promise.all(ttsTempResultsPaths.map(async (ttsTempResultPath) => await fs.unlink(ttsTempResultPath)))
  await syncAudiosDuration({
    srcAudioPath,
    distAudioPath,
    verbose,
  })
}

// TODO:ASAP do much more many temp ssml results to sync correct chronology
// TODO:ASAP manual translate by chatgpt
// TODO:ASAP tru zure stt but not revai
// TODO:ASAP split voice and background
