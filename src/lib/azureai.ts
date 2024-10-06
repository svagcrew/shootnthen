/* eslint-disable radix */
import type { Config } from '@/lib/config.js'
import { syncAudiosDuration } from '@/lib/editor.js'
import { getEnv } from '@/lib/env.js'
import { parseFileName } from '@/lib/meta.js'
import { promises as fs } from 'fs'
import sdk from 'microsoft-cognitiveservices-speech-sdk'
import path from 'path'
import SrtParser from 'srt-parser-2'
import { isFileExistsSync, log } from 'svag-cli-utils'

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
  // Azure Speech SDK credentials
  const subscriptionKey = getEnv('AZURE_AI_KEY')
  const serviceRegion = getEnv('AZURE_AI_REGION')

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

  // Initialize the Azure Speech SDK speech config
  const speechConfig = sdk.SpeechConfig.fromSubscription(subscriptionKey, serviceRegion)
  speechConfig.speechSynthesisOutputFormat = sdk.SpeechSynthesisOutputFormat.Audio16Khz32KBitRateMonoMp3

  // Map language codes to voice names
  const voiceMap: { [key: string]: string } = {
    en: 'en-US-AndrewMultilingualNeural',
    // ru: 'ru-RU-SvetlanaNeural',
    // Add more mappings as needed
  }

  const voiceName = voiceMap[lang] || 'en-US-AriaNeural' // default voice if language not found
  speechConfig.speechSynthesisVoiceName = voiceName

  // Create the Speech Synthesizer
  const audioConfig = sdk.AudioConfig.fromAudioFileOutput(distAudioPath)
  const synthesizer = new sdk.SpeechSynthesizer(speechConfig, audioConfig)
  // TODO.0 fix it

  // Read and parse the SRT file
  const srtContent = await fs.readFile(srtPath, 'utf8')
  const parser = new SrtParser()
  const subtitles = parser.fromSrt(srtContent) // Parse SRT

  // Build the SSML
  let ssml = `<?xml version="1.0" encoding="UTF-8"?>\n`
  ssml += `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${lang}">\n`
  ssml += `<voice name="${voiceName}">\n`

  let prevEndMs = 0

  for (const subtitle of subtitles) {
    const text = subtitle.text

    const startTime = subtitle.startTime // in format HH:MM:SS,mmm
    const endTime = subtitle.endTime

    // Convert startTime and endTime to milliseconds
    const startMs = timeStringToMilliseconds(startTime)
    const endMs = timeStringToMilliseconds(endTime)

    // Calculate gap from previous end to current start
    const gapMs = startMs - prevEndMs
    if (gapMs > 0) {
      ssml += `<break time="${gapMs}ms"/>\n`
    }

    // Calculate the desired duration for this subtitle
    const desiredDurationMs = endMs - startMs

    // Add the text with specified duration using prosody
    ssml += `<prosody duration="${desiredDurationMs}ms">${escapeXml(text)}</prosody>\n`

    prevEndMs = endMs
  }

  ssml += `</voice>\n`
  ssml += `</speak>`

  verbose && log.normal('SSML:', ssml)

  // Synthesize the SSML to audio file (async)
  await new Promise<void>((resolve, reject) => {
    synthesizer.speakSsmlAsync(
      ssml,
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

  // Synthesize the SSML to audio file (batch start)
  // TODO.1

  // Synthesize the SSML to audio file (batch check)
  // TODO.2

  // Synthesize the SSML to audio file (batch retrieve and save to file)
  // TODO.3

  await syncAudiosDuration({
    srcAudioPath,
    distAudioPath,
    verbose,
  })
}
