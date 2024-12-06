/* eslint-disable no-console */

import type { Config } from '@/exports.js'
import {
  concatAudios,
  createSilentAudio,
  getAudioDuration,
  stretchAudioDuration,
  syncAudiosDuration,
} from '@/lib/editor.js'
import { getEnv } from '@/lib/env.js'
import { parseFileName } from '@/lib/meta.js'
import type { TtsTask } from '@/lib/subtitles.js'
import { subtitlesToTtsTasks } from '@/lib/subtitles.js'
import { addSuffixToFilePath } from '@/lib/utils.js'
import axios from 'axios'
import { promises as fs } from 'fs'
import path from 'path'
import SrtParser from 'srt-parser-2'
import { isFileExistsSync, log } from 'svag-cli-utils'

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

  await ttsMegasimpleByElevenlabs({
    text: ttsTask.text,
    distAudioPath: outputAudioPath,
    lang: ttsTask.lang,
    verbose,
  })
  await stretchAudioDuration({
    audioPath: outputAudioPath,
    durationMs: ttsTask.durationMs,
    verbose,
  })
  return ttsTask
}

export const ttsByElevenlabs = async ({
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
  srtPath = path.resolve(config.contentDir, srtPath)
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
  const distAudioPath = path.resolve(parsed.dirname, distAudioName)
  const { fileExists } = isFileExistsSync({ filePath: distAudioPath })
  if (fileExists && !force) {
    verbose && log.normal('Audio file already exists', { distAudioPath })
    return { distAudioPath }
  }
  await ttsSimpleByElevenlabs({
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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const promiseAllSeq = async <T>(promises: Array<() => Promise<T>>): Promise<T[]> => {
  const results = []
  for (const promise of promises) {
    results.push(await promise())
  }
  return results
}

export const ttsSimpleByElevenlabs = async ({
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
    en: 'e5WNhrdI30aXpS2RSGm1',
    ru: '8PCccElp0PQGRfTFCu0p',
    es: 'Nh2zY9kknu6z4pZy6FhD',
    pt: 'IlrWo5tGgTuxNTHyGhWD',
    it: '13Cuh3NuYvWOVQtLbRN8',
    de: 'hucVGIVBVgfwHixla7pT',
    tr: 'YXfTfjS5baixEmJfseKO',
  }
  // const voiceMapFemale: { [key: string]: string } = {
  //   en: 'en-US-AvaMultilingualNeural',
  //   ru: 'ru-RU-SvetlanaNeural',
  //   es: 'es-ES-ElviraNeural',
  //   pt: 'pt-BR-FranciscaNeural',
  //   it: 'it-IT-ElsaNeural',
  //   de: 'de-DE-KatjaNeural',
  //   tr: 'tr-TR-EmelNeural',
  // }
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
    separateSentences: true,
  })

  verbose && log.normal(`Generated ${ttsTasks.length} tts tasks`)

  const promises = ttsTasks.map((ttsTask, i) => async () => {
    const outputAudioPath = addSuffixToFilePath({ filePath: distAudioPath, suffix: `temp-${i}` })
    await executeTtsTask({ ttsTask, outputAudioPath, verbose })
    return outputAudioPath
  })
  // const ttsTempResultsPaths = await Promise.all(promises.map(async (promise) => await promise()))
  const ttsTempResultsPaths = await promiseAllSeq(promises)

  await concatAudios({ audioPaths: ttsTempResultsPaths, outputAudioPath: distAudioPath, verbose })
  // delete temp files
  await Promise.all(ttsTempResultsPaths.map(async (ttsTempResultPath) => await fs.unlink(ttsTempResultPath)))
  await syncAudiosDuration({
    srcAudioPath,
    distAudioPath,
    verbose,
  })
}

export const getVoicesElevenlabs = async () => {
  const apiKey = getEnv('ELEVENLABS_API_KEY')
  if (!apiKey) {
    throw new Error('ElevenLabs API key not found')
  }

  const url = 'https://api.elevenlabs.io/v1/shared-voices'
  const headers = {
    'xi-api-key': apiKey,
  }

  try {
    const response = await axios.get(url, { headers })
    const data = response.data
    return data
  } catch (error) {
    throw new Error(`Error fetching voices: ${error}`)
  }
}

export const ttsMegasimpleByElevenlabs = async ({
  text,
  distAudioPath,
  lang,
  verbose,
}: {
  text: string
  distAudioPath: string
  lang: string
  verbose?: boolean
}) => {
  verbose &&
    log.normal(`Synthesizing speech for text`, {
      text,
      lang,
      distAudioPath,
    })

  // Map language codes to ElevenLabs voice IDs
  const voiceMap: { [key: string]: string } = {
    en: 'e5WNhrdI30aXpS2RSGm1',
    ru: '8PCccElp0PQGRfTFCu0p',
    es: 'Nh2zY9kknu6z4pZy6FhD',
    pt: 'IlrWo5tGgTuxNTHyGhWD',
    it: '13Cuh3NuYvWOVQtLbRN8',
    de: 'hucVGIVBVgfwHixla7pT',
    tr: 'YXfTfjS5baixEmJfseKO',
  }

  const voiceId = voiceMap[lang]
  if (!voiceId) {
    throw new Error(`Voice ID not found for language ${lang}`)
  }

  // ElevenLabs API key
  const apiKey = getEnv('ELEVENLABS_API_KEY')
  if (!apiKey) {
    throw new Error('ElevenLabs API key not found')
  }

  // Prepare the API request
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`

  const headers = {
    'Content-Type': 'application/json',
    'xi-api-key': apiKey,
  }

  const data = {
    text,
    model_id: 'eleven_multilingual_v2',
    voice_settings: {
      stability: 0.5,
      similarity_boost: 0.75,
    },
  }

  // Make the API request
  try {
    const response = await axios.post(url, data, {
      headers,
      responseType: 'arraybuffer',
    })
    // Save the audio data to the file
    await fs.writeFile(distAudioPath, response.data)
    verbose && log.normal(`Synthesized audio saved to ${distAudioPath}`)
  } catch (error) {
    throw new Error(`Error synthesizing speech: ${error}`)
  }
}

export const ttsMegasimpleWithTimestampsByElevenlabs = async ({
  text,
  distAudioPath,
  distDataPath,
  lang,
  verbose,
}: {
  text: string
  distAudioPath: string
  distDataPath: string
  lang: string
  verbose?: boolean
}) => {
  // Map language codes to ElevenLabs voice IDs
  const voiceMap: { [key: string]: string } = {
    en: 'e5WNhrdI30aXpS2RSGm1',
    // ru: '8PCccElp0PQGRfTFCu0p',
    ru: 'sRk0zCqhS2Cmv0bzx5wA',
    es: 'Nh2zY9kknu6z4pZy6FhD',
    pt: 'IlrWo5tGgTuxNTHyGhWD',
    it: '13Cuh3NuYvWOVQtLbRN8',
    de: 'hucVGIVBVgfwHixla7pT',
    tr: 'YXfTfjS5baixEmJfseKO',
  }

  const voiceId = voiceMap[lang]
  if (!voiceId) {
    throw new Error(`Voice ID not found for language ${lang}`)
  }

  // ElevenLabs API key
  const apiKey = getEnv('ELEVENLABS_API_KEY')
  if (!apiKey) {
    throw new Error('ElevenLabs API key not found')
  }

  // Prepare the API request
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps`

  const headers = {
    'Content-Type': 'application/json',
    'xi-api-key': apiKey,
  }

  const data = {
    text,
    model_id: 'eleven_multilingual_v2',
    voice_settings: {
      stability: 0.5,
      similarity_boost: 0.75,
    },
  }

  // Make the API request
  try {
    verbose && log.normal('Synthesizing speech with timestamps...')
    const response = await axios.post(url, data, { headers })

    // The response data should be a JSON object with 'audio' and 'timestamps'
    // alignment || normalized_alignment
    const { audio_base64, normalized_alignment: choosen_alignment } = response.data
    console.dir(response.data, { depth: null })

    if (!audio_base64 || !choosen_alignment) {
      throw new Error('Invalid response from ElevenLabs API')
    }

    // Decode the base64 audio data and save to distAudioPath
    const audioBuffer = Buffer.from(audio_base64, 'base64')
    await fs.writeFile(distAudioPath, audioBuffer as never as Uint8Array)

    // Save the timestamps data to distDataPath
    await fs.writeFile(distDataPath, JSON.stringify(choosen_alignment, null, 2))

    verbose && log.normal(`Synthesized`, { distAudioPath, distDataPath })
  } catch (error: any) {
    const data = error.response?.data || error
    log.error('Error synthesizing speech with timestamps:', data)
    throw error
  }
}
