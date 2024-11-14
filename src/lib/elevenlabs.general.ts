/* eslint-disable no-console */
 
import { getEnv } from '@/lib/env.js'
import axios from 'axios'
import { promises as fs } from 'fs'
import { log } from 'svag-cli-utils'

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
    await fs.writeFile('elevenlabs.voices.json', JSON.stringify(data, null, 2))
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
    const { audio_base64, normalized_alignment } = response.data
    console.dir(response.data, { depth: null })

    if (!audio_base64 || !normalized_alignment) {
      throw new Error('Invalid response from ElevenLabs API')
    }

    // Decode the base64 audio data and save to distAudioPath
    const audioBuffer = Buffer.from(audio_base64, 'base64')
    await fs.writeFile(distAudioPath, audioBuffer as never as Uint8Array)

    // Save the timestamps data to distDataPath
    await fs.writeFile(distDataPath, JSON.stringify(normalized_alignment, null, 2))

    verbose && log.normal(`Synthesized`, { distAudioPath, distDataPath })
  } catch (error: any) {
    const data = error.response?.data || error
    log.error('Error synthesizing speech with timestamps:', data)
    throw error
  }
}
