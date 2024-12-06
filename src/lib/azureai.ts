import type { Config } from '@/lib/config.js'
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
import { promises as fs } from 'fs'
import sdk from 'microsoft-cognitiveservices-speech-sdk'
import path from 'path'
import SrtParser from 'srt-parser-2'
import { isFileExistsSync, log } from 'svag-cli-utils'

// Rejected: Very slow (x5 slower then revai)
// export const extractSrtByAzureai = async ({
//   config,
//   filePath,
//   lang,
//   force,
//   verbose,
// }: {
//   config: Config
//   filePath: string
//   lang?: string
//   force?: boolean
//   verbose?: boolean
// }) => {
//   verbose && log.normal('Extracting srt', { filePath, lang })
//   const parsed = parseFileName(filePath)
//   if (parsed.ext !== 'mp3') {
//     throw new Error('Only mp3 files are allowed')
//   }
//   if (!lang) {
//     if (parsed.langSingle) {
//       lang = parsed.langSingle
//     } else {
//       throw new Error('Language not found')
//     }
//   }
//   const srtFileName = `${parsed.name}.${lang}.srt`
//   const srtFilePath = path.resolve(config.contentDir, srtFileName)
//   const jsonFileName = `${parsed.name}.${lang}.json`
//   const jsonFilePath = path.resolve(config.contentDir, jsonFileName)
//   const txtFileName = `${parsed.name}.${lang}.txt`
//   const txtFilePath = path.resolve(config.contentDir, txtFileName)
//   const { fileExists } = isFileExistsSync({ filePath: srtFilePath })
//   if (fileExists && !force) {
//     verbose && log.normal('Srt file already exists', { srtFilePath })
//     return { srtFilePath }
//   }
//   await extractSrtSimpleByAzureai({
//     // config,
//     inputAudioPath: filePath,
//     outputSrtPath: srtFilePath,
//     outputJsonPath: jsonFilePath,
//     outputTxtPath: txtFilePath,
//     lang,
//     verbose,
//   })
//   verbose && log.normal('Extracted srt', { srtFilePath, jsonFilePath })
//   return { srtFilePath }
// }

// export const extractSrtSimpleByAzureai = async ({
//   // config,
//   inputAudioPath,
//   outputSrtPath,
//   outputJsonPath,
//   outputTxtPath,
//   lang,
//   verbose,
// }: {
//   // config: Config,
//   inputAudioPath: string
//   outputSrtPath: string
//   outputJsonPath: string
//   outputTxtPath: string
//   lang: string
//   verbose?: boolean
// }) => {
//   // Azure Speech SDK credentials
//   const subscriptionKey = getEnv('AZURE_AI_KEY')
//   const serviceRegion = getEnv('AZURE_AI_REGION')
//   if (!subscriptionKey || !serviceRegion) {
//     throw new Error('Azure Speech SDK credentials not found')
//   }

//   verbose && log.normal('Recognizing speech...')

//   const speechConfig = sdk.SpeechConfig.fromSubscription(subscriptionKey, serviceRegion)
//   speechConfig.speechRecognitionLanguage =
//     {
//       en: 'en-US',
//       ru: 'ru-RU',
//     }[lang] || 'ru-RU'
//   speechConfig.requestWordLevelTimestamps()
//   speechConfig.outputFormat = sdk.OutputFormat.Detailed
//   const { outputWavPath } = await convertMp3ToWav({
//     inputMp3Path: inputAudioPath,
//   })
//   const audioConfig = sdk.AudioConfig.fromWavFileInput(await fs.readFile(outputWavPath))

//   type X = any

//   const res = await new Promise<X[]>((resolve, reject) => {
//     // Create the speech recognizer
//     const speechRecognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig)
//     const results: X[] = []

//     // Set up event handlers for recognized speech
//     speechRecognizer.recognized = (s, e) => {
//       if (e.result.reason === sdk.ResultReason.RecognizedSpeech) {
//         const jsonResponse = JSON.parse(e.result.json)
//         const words = jsonResponse.NBest[0].Words
//         const result = {
//           json: jsonResponse,
//           text: words.map((w: any) => w.Word).join(' '),
//           words,
//         }
//         // console.dir(result, { depth: null })
//         results.push(result)
//       } else if (e.result.reason === sdk.ResultReason.NoMatch) {
//         console.log('NOMATCH: Speech could not be recognized.')
//         reject(new Error('NOMATCH: Speech could not be recognized.'))
//       }
//     }

//     speechRecognizer.canceled = (s, e) => {
//       console.log(`CANCELED: Reason=${e.reason}`)

//       if (e.reason === sdk.CancellationReason.EndOfStream) {
//         console.log('SUCCESS: Speech recognition completed.')
//         resolve(results)
//         speechRecognizer.stopContinuousRecognitionAsync()
//         return
//       }

//       if (e.reason === sdk.CancellationReason.Error) {
//         console.log(`CANCELED: ErrorCode=${e.errorCode}`)
//         console.log(`CANCELED: ErrorDetails=${e.errorDetails}`)
//         console.log('CANCELED: Did you set the speech resource key and region values?')
//       }

//       speechRecognizer.stopContinuousRecognitionAsync()
//       reject(new Error('CANCELED: Speech recognition canceled.'))
//     }

//     speechRecognizer.sessionStopped = (s, e) => {
//       // console.log('\n    Session stopped event.')
//       speechRecognizer.stopContinuousRecognitionAsync()
//     }

//     // Start continuous recognition
//     speechRecognizer.startContinuousRecognitionAsync(
//       () => {
//         console.log('Recognition started.')
//       },
//       (err) => {
//         console.trace('err - ' + err)
//         speechRecognizer.close()
//         reject(err)
//       }
//     )
//   })
//   // const res = await new Promise<sdk.SpeechRecognitionResult[]>((resolve, reject) => {
//   //   const speechRecognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig)
//   //   speechRecognizer.recognizeOnceAsync((result) => {
//   //     switch (result.reason) {
//   //       case sdk.ResultReason.RecognizedSpeech:
//   //         console.log(`RECOGNIZED: Text=${result.text}`)
//   //         speechRecognizer.close()
//   //         resolve(result)
//   //         break
//   //       case sdk.ResultReason.NoMatch:
//   //         console.log('NOMATCH: Speech could not be recognized.')
//   //         speechRecognizer.close()
//   //         reject(new Error('NOMATCH: Speech could not be recognized.'))
//   //         break
//   //       case sdk.ResultReason.Canceled:
//   //         const cancellation = sdk.CancellationDetails.fromResult(result)
//   //         console.log(`CANCELED: Reason=${cancellation.reason}`)

//   //         if (cancellation.reason == sdk.CancellationReason.EndOfStream) {
//   //           console.log('SUCCESS: Speech recognition completed.')
//   //           resolve(result)
//   //           speechRecognizer.close()
//   //           return
//   //         }

//   //         if (cancellation.reason == sdk.CancellationReason.Error) {
//   //           console.log(`CANCELED: ErrorCode=${cancellation.ErrorCode}`)
//   //           console.log(`CANCELED: ErrorDetails=${cancellation.errorDetails}`)
//   //           console.log('CANCELED: Did you set the speech resource key and region values?')
//   //         }
//   //         speechRecognizer.close()
//   //         reject(new Error('CANCELED: Speech recognition canceled.'))
//   //         break
//   //       default:
//   //         console.log('UNRECOGNIZED: Unexpected result')
//   //         speechRecognizer.close()
//   //         reject(new Error('UNRECOGNIZED: Unexpected result'))
//   //         break
//   //     }
//   //   })
//   // })
//   verbose && log.normal('Recognized speech')

//   console.dir({ res }, { depth: null })

//   // const srtContent = res.text
//   // await fs.writeFile(outputSrtPath, srtContent)
//   const jsonContent = JSON.stringify(res, null, 2)
//   await fs.writeFile(outputJsonPath, jsonContent)
//   // const txtContent = res.text
//   // await fs.writeFile(outputTxtPath, txtContent)
// }

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
  if (!subscriptionKey || !serviceRegion) {
    throw new Error('Azure Speech SDK credentials not found')
  }

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
      // await normalizeAudioDuration({
      //   audioPath: outputAudioPath,
      //   durationMs: ttsTask.durationMs,
      //   verbose,
      // })
      await stretchAudioDuration({
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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const promiseAllSeq = async <T>(promises: Array<() => Promise<T>>): Promise<T[]> => {
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
    ru: 'ru-RU-DmitryNeural',
    es: 'es-ES-AlvaroNeural',
    pt: 'pt-BR-AntonioNeural',
    it: 'it-IT-DiegoNeural',
    de: 'de-DE-ConradNeural',
    tr: 'tr-TR-AhmetNeural',
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
  })

  verbose && log.normal(`Generated ${ttsTasks.length} tts tasks`)

  const promises = ttsTasks.map((ttsTask, i) => async () => {
    const outputAudioPath = addSuffixToFilePath({ filePath: distAudioPath, suffix: `temp-${i}` })
    await executeTtsTask({ ttsTask, outputAudioPath, verbose })
    return outputAudioPath
  })
  const ttsTempResultsPaths = await Promise.all(promises.map(async (promise) => await promise()))
  // const ttsTempResultsPaths = await promiseAllSeq(promises)

  await concatAudios({ audioPaths: ttsTempResultsPaths, outputAudioPath: distAudioPath, verbose })
  // delete temp files
  await Promise.all(ttsTempResultsPaths.map(async (ttsTempResultPath) => await fs.unlink(ttsTempResultPath)))
  await syncAudiosDuration({
    srcAudioPath,
    distAudioPath,
    verbose,
  })
}

export const ttsMegasimpleByAzureai = async ({
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
  // Map language codes to voice names
  const voiceMap: { [key: string]: string } = {
    en: 'en-US-AndrewMultilingualNeural',
    ru: 'ru-RU-DmitryNeural',
    es: 'es-ES-AlvaroNeural',
    pt: 'pt-BR-AntonioNeural',
    it: 'it-IT-DiegoNeural',
    de: 'de-DE-ConradNeural',
    tr: 'tr-TR-AhmetNeural',
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

  // Azure Speech SDK credentials
  const subscriptionKey = getEnv('AZURE_AI_KEY')
  const serviceRegion = getEnv('AZURE_AI_REGION')
  if (!subscriptionKey || !serviceRegion) {
    throw new Error('Azure Speech SDK credentials not found')
  }

  // Initialize the Azure Speech SDK speech config
  const speechConfig = sdk.SpeechConfig.fromSubscription(subscriptionKey, serviceRegion)
  speechConfig.speechSynthesisOutputFormat = sdk.SpeechSynthesisOutputFormat.Audio16Khz32KBitRateMonoMp3
  speechConfig.speechSynthesisVoiceName = voiceName

  // Create the audio configuration
  const audioConfig = sdk.AudioConfig.fromAudioFileOutput(distAudioPath)

  // Create the speech synthesizer
  const synthesizer = new sdk.SpeechSynthesizer(speechConfig, audioConfig)

  // Create the speech synthesizer
  // Synthesize the text to speech and save to file
  await new Promise<void>((resolve, reject) => {
    synthesizer.speakTextAsync(
      text,
      (result) => {
        if (result.reason === sdk.ResultReason.SynthesizingAudioCompleted) {
          verbose && log.normal(`Synthesized audio`, distAudioPath)
          synthesizer.close()
          resolve()
        } else {
          synthesizer.close()
          reject(new Error(result.errorDetails))
        }
      },
      (error) => {
        synthesizer.close()
        reject(error)
      }
    )
  })
}

// TODO:ASAP stretch if not end of sentence, else normalize

// TODO:ASAP ! apply srt to mp4

// TODO:ASAP ! translate course

// TODO:ASAP ! split voice and background
