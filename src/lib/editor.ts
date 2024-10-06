/* eslint-disable unicorn/prefer-type-error */
import type { Config } from '@/lib/config.js'
import { parseFileName } from '@/lib/meta.js'
import type { Lang } from '@/lib/utils.js'
import { fromRawLang } from '@/lib/utils.js'
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

export const cutVideo = async ({
  inputVideoPath,
  outputVideoPath,
  start,
  end,
  cwd,
}: {
  inputVideoPath: string
  outputVideoPath: string
  start: string
  end: string
  cwd: string
}) => {
  const normalizedInputVideoPath = path.resolve(cwd, inputVideoPath)
  const normalizedOutputVideoPath = path.resolve(cwd, outputVideoPath)
  const nativeCommand = `ffmpeg -i "${normalizedInputVideoPath}" -ss ${start} -to ${end} -c copy -y "${normalizedOutputVideoPath}"`
  await spawn({ command: nativeCommand, cwd: process.cwd() })
  return {
    inputVideoPath: normalizedInputVideoPath,
    outputVideoPath: normalizedOutputVideoPath,
  }
}

// bad audio syncing
// export const decutVideo = async ({
//   inputVideoPath,
//   outputVideoPath,
//   times,
//   cwd,
// }: {
//   inputVideoPath: string
//   outputVideoPath: string
//   times: Array<[string, string]> // [[00:05:24, 00:06:27], [00:10:51, 00:14:04]]
//   cwd: string
// }) => {
//   const normalizedInputVideoPath = path.resolve(cwd, inputVideoPath)
//   const normalizedOutputVideoPath = path.resolve(cwd, outputVideoPath)
//   const inputExt = path.extname(normalizedInputVideoPath)
//   const inputBase = path.basename(normalizedInputVideoPath, inputExt)
//   const inputDir = path.dirname(normalizedInputVideoPath)
//   const concatFilePath = path.resolve(inputDir, `${inputBase}.concat.txt`)

//   // An array to store the paths of the video parts
//   const partPaths = []

//   // Handle the first segment before the first unwanted section
//   let lastEndTime = '00:00:00'
//   for (const [i, [start, end]] of times.entries()) {
//     const partPath = path.resolve(inputDir, `${inputBase}.part${i + 1}${inputExt}`)

//     // Cut each part of the video before the unwanted sections using smart seeking
//     const cutCommand = `ffmpeg -ss ${lastEndTime} -i "${normalizedInputVideoPath}" -to ${start} -c copy -y "${partPath}"`
//     await spawn({ command: cutCommand, cwd: process.cwd() })

//     partPaths.push(partPath)
//     lastEndTime = end // Update last end time to the current segment's end
//   }

//   // Handle the segment after the last unwanted section
//   const lastPartPath = path.resolve(inputDir, `${inputBase}.part${times.length + 1}${inputExt}`)
//   const cutLastPartCommand = `ffmpeg -ss ${lastEndTime} -i "${normalizedInputVideoPath}" -c copy -y "${lastPartPath}"`
//   await spawn({ command: cutLastPartCommand, cwd: process.cwd() })
//   partPaths.push(lastPartPath)

//   // Write the paths of the parts to the concat list file
//   const concatFileContent = partPaths.map((partPath) => `file '${partPath}'`).join('\n')
//   await fs.writeFile(concatFilePath, concatFileContent)

//   // Concatenate all the parts together using the concat demuxer
//   const concatCommand = `ffmpeg -f concat -safe 0 -i "${concatFilePath}" -c copy -y "${normalizedOutputVideoPath}"`
//   await spawn({ command: concatCommand, cwd: process.cwd() })

//   // Clean up temporary files
//   for (const partPath of partPaths) {
//     await fs.unlink(partPath)
//   }
//   await fs.unlink(concatFilePath)

//   return {
//     inputVideoPath: normalizedInputVideoPath,
//     outputVideoPath: normalizedOutputVideoPath,
//   }
// }

export const decutVideo = async ({
  inputVideoPath,
  outputVideoPath,
  times,
  fast,
  cwd,
}: {
  inputVideoPath: string
  outputVideoPath: string
  times: Array<[string, string]> // [[00:05:24, 00:06:27], [00:10:51, 00:14:04]]
  fast?: boolean
  cwd: string
}) => {
  const normalizedInputVideoPath = path.resolve(cwd, inputVideoPath)
  const normalizedOutputVideoPath = path.resolve(cwd, outputVideoPath)

  // Convert time strings to seconds
  const convertToSeconds = (time: string) => {
    const [hh, mm, ss] = time.split(':').map(Number)
    return hh * 3_600 + mm * 60 + ss
  }

  // Create a filter for select and aselect based on the times array
  const filterParts = times.map(([start, end]) => {
    const startSec = convertToSeconds(start)
    const endSec = convertToSeconds(end)
    return `between(t,${startSec},${endSec})`
  })

  const command = (() => {
    if (fast) {
      // const selectFilter = `select='not(${filterParts.join('+')})', setpts=N/FRAME_RATE/TB`
      // const fpsFilter = `fps=fps=30`
      // const videoFilter = `${selectFilter},${fpsFilter}`
      // const aselectFilter = `aselect='not(${filterParts.join('+')})', asetpts=N/SR/TB`
      // return `ffmpeg -i "${normalizedInputVideoPath}" -vf "${videoFilter}" -af "${aselectFilter}" -c:v libx264 -preset ultrafast -crf 18 -c:a aac -y "${normalizedOutputVideoPath}"`
      const selectFilter = `select='not(${filterParts.join('+')})', setpts=N/FRAME_RATE/TB`
      const fpsFilter = `fps=fps=10`
      const videoFilter = `${selectFilter},${fpsFilter}`
      const aselectFilter = `aselect='not(${filterParts.join('+')})', asetpts=N/SR/TB`
      return `ffmpeg -i "${normalizedInputVideoPath}" -vf "${videoFilter}" -af "${aselectFilter}" -c:v libx264 -preset ultrafast -crf 28 -c:a aac -y "${normalizedOutputVideoPath}"`
      // return `ffmpeg -i "${normalizedInputVideoPath}" -vf "${videoFilter}" -af "${aselectFilter}" -c:v libx264 -preset ultrafast -crf 45 -c:a aac -y "${normalizedOutputVideoPath}"`
    } else {
      // const selectFilter = `select='not(${filterParts.join('+')})', setpts=N/FRAME_RATE/TB`
      // const aselectFilter = `aselect='not(${filterParts.join('+')})', asetpts=N/SR/TB`
      // return `ffmpeg -i "${normalizedInputVideoPath}" -vf "${selectFilter}" -af "${aselectFilter}" -c:v libx264 -preset slow -crf 24 -c:a aac -b:a 128k -y "${normalizedOutputVideoPath}"`
      const selectFilter = `select='not(${filterParts.join('+')})', setpts=N/FRAME_RATE/TB`
      const aselectFilter = `aselect='not(${filterParts.join('+')})', asetpts=N/SR/TB`
      return `ffmpeg -i "${normalizedInputVideoPath}" -vf "${selectFilter}" -af "${aselectFilter}" -c:v libx264 -preset veryfast -crf 20 -c:a aac -b:a 128k -y "${normalizedOutputVideoPath}"`
    }
  })()
  await spawn({ command, cwd: process.cwd() })

  return {
    inputVideoPath: normalizedInputVideoPath,
    outputVideoPath: normalizedOutputVideoPath,
  }
}

export const getAudioDuration = async ({ audioPath }: { audioPath: string }) => {
  const result = await spawn({
    command: `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`,
    cwd: process.cwd(),
  })
  const duration = parseFloat(result) // in seconds
  if (isNaN(duration)) {
    throw new Error('Invalid duration')
  }
  return duration
}

const addSuffixToFilePath = ({ filePath, suffix }: { filePath: string; suffix: string }) => {
  const ext = path.extname(filePath)
  const base = path.basename(filePath, ext)
  return `${base}.${suffix}${ext}`
}

export const stretchAudioDuration = async ({
  duration,
  audioPath,
  verbose,
}: {
  duration: number // in seconds
  audioPath: string
  verbose?: boolean
}) => {
  const srcDuration = duration
  const distDuration = await getAudioDuration({ audioPath })
  verbose && log.normal('Staretching audio duration', { distDuration, srcDuration, audioPath })
  const audioPathBak = addSuffixToFilePath({ filePath: audioPath, suffix: 'bak' })
  const copyCommand = `cp "${audioPath}" "${audioPathBak}"`
  await spawn({ command: copyCommand, cwd: process.cwd() })
  const audioPathTemp = addSuffixToFilePath({ filePath: audioPath, suffix: 'temp' })
  const diffDuration = srcDuration - distDuration
  if (diffDuration === 0) {
    verbose && log.normal('No need to stretch audio', { duration, audioPath })
    return {
      audioPath,
      duration,
    }
  }
  const srcDurationWithExtra = srcDuration + 0.001
  const atempo = distDuration / srcDurationWithExtra
  const atempoCommand = `ffmpeg -i "${audioPath}" -filter:a "atempo=${atempo}" -y "${audioPathTemp}"`
  verbose && log.normal('Atemping', { duration, audioPath, atempo }, atempoCommand)
  await spawn({ command: atempoCommand, cwd: process.cwd() })

  // replace original with temp
  const replaceCommand = `mv "${audioPathTemp}" "${audioPath}"`
  await spawn({ command: replaceCommand, cwd: process.cwd() })

  const cutCommand = `ffmpeg -i "${audioPath}" -ss 0 -to ${srcDuration} -y "${audioPathTemp}"`
  verbose && log.normal('Cutting audio', { duration, audioPath })
  await spawn({ command: cutCommand, cwd: process.cwd() })

  // replace original with temp
  const replaceCommand2 = `mv "${audioPathTemp}" "${audioPath}"`
  await spawn({ command: replaceCommand2, cwd: process.cwd() })

  verbose && log.normal('Staretched audio duration', { duration, audioPath })
  return {
    audioPath,
    duration,
  }
}

export const syncAudiosDuration = async ({
  distAudioPath,
  srcAudioPath,
  verbose,
}: {
  distAudioPath: string
  srcAudioPath: string
  verbose?: boolean
}) => {
  verbose && log.normal('Syncing audios duration', { srcAudioPath, distAudioPath })
  const srcDuration = await getAudioDuration({ audioPath: srcAudioPath })
  const result = await stretchAudioDuration({ duration: srcDuration, audioPath: distAudioPath, verbose })
  return result
}
