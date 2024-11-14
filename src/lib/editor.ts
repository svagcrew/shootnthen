/* eslint-disable unicorn/no-for-loop */
/* eslint-disable unicorn/prefer-type-error */
import type { Config } from '@/lib/config.js'
import { parseFileName } from '@/lib/meta.js'
import type { Lang } from '@/lib/utils.js'
import { addSuffixToFilePath, fromRawLang, replaceExt } from '@/lib/utils.js'
import ffmpeg from 'fluent-ffmpeg'
import { promises as fs } from 'fs'
import langCodesLib from 'langs'
import _ from 'lodash'
import path from 'path'
import sharp from 'sharp'
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
  filePath = path.resolve(config.contentDir, filePath)
  const parsed = parseFileName(filePath)
  const audioFileName = `${parsed.name}.${lang}.mp3`
  const audioFilePath = path.resolve(parsed.dirname, audioFileName)
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
  inputVideoPath = path.resolve(config.contentDir, inputVideoPath)
  const parsed = parseFileName(inputVideoPath)
  if (langs.length === 0) {
    throw new Error('No languages provided')
  }
  const outputVideoMarks = [...parsed.notLangMarks, ...langs]
  const outputVideoFileName = `${parsed.name}.${outputVideoMarks.join('.')}.mp4`
  const outputVideoPath = path.resolve(parsed.dirname, outputVideoFileName)
  const inputAudios: Array<{ lang: string; audioPath: string }> = []
  for (const lang of langs) {
    const langProcessed = fromRawLang(lang)
    const audioFileName = `${parsed.name}.${langProcessed}.mp3`
    const audioFilePath = path.resolve(parsed.dirname, audioFileName)
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

export const convertMp3ToWav = async ({
  inputMp3Path,
  outputWavPath,
}: {
  inputMp3Path: string
  outputWavPath?: string
}) => {
  outputWavPath = outputWavPath || replaceExt({ filePath: inputMp3Path, ext: 'wav' })
  const nativeCommand = `ffmpeg -i "${inputMp3Path}" -y "${outputWavPath}"`
  await spawn({ command: nativeCommand, cwd: process.cwd() })
  return {
    inputMp3Path,
    outputWavPath,
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

export const concatSilentVideos = async ({
  inputVideoPaths,
  outputVideoPath,
  verbose,
}: {
  inputVideoPaths: string[]
  outputVideoPath: string
  verbose?: boolean
}) => {
  const inputFiles = inputVideoPaths.map((path) => `-i "${path}"`).join(' ')

  // Generate the filter_complex string for video-only concatenation
  const filterInput = inputVideoPaths.map((_, index) => `[${index}:v]`).join('')
  const filterComplex = `"${filterInput}concat=n=${inputVideoPaths.length}:v=1:a=0[outv]"`

  const nativeCommand = `ffmpeg ${inputFiles} -y -filter_complex ${filterComplex} -map "[outv]" "${outputVideoPath}"`
  verbose && log.normal('Executing ffmpeg command:', nativeCommand)
  await spawn({ command: nativeCommand, cwd: process.cwd() })
  return {
    inputVideoPaths,
    outputVideoPath,
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
  return Math.floor(duration * 1_000)
}

export const stretchAudioDuration = async ({
  durationMs,
  audioPath,
  verbose,
}: {
  durationMs: number // in milliseconds
  audioPath: string
  verbose?: boolean
}) => {
  const srcDurationS = durationMs / 1_000
  const distDurationMs = await getAudioDuration({ audioPath })
  const distDurationS = distDurationMs / 1_000
  verbose &&
    log.normal('Staretching audio duration', { distDuration: distDurationS, srcDuration: srcDurationS, audioPath })
  const audioPathBak = addSuffixToFilePath({ filePath: audioPath, suffix: 'bak' })
  const copyCommand = `cp "${audioPath}" "${audioPathBak}"`
  await spawn({ command: copyCommand, cwd: process.cwd() })
  const audioPathTemp = addSuffixToFilePath({ filePath: audioPath, suffix: 'temp' })
  const diffDuration = srcDurationS - distDurationS
  if (diffDuration === 0) {
    verbose && log.normal('No need to stretch audio', { durationMs, audioPath })
    return {
      audioPath,
      durationMs,
    }
  }
  const srcDurationWithExtra = srcDurationS + 0.001
  const atempo = distDurationS / srcDurationWithExtra
  const atempoCommand = `ffmpeg -i "${audioPath}" -filter:a "atempo=${atempo}" -y "${audioPathTemp}"`
  verbose && log.normal('Atemping', { durationMs, audioPath, atempo }, atempoCommand)
  await spawn({ command: atempoCommand, cwd: process.cwd() })

  // replace original with temp
  const replaceCommand = `mv "${audioPathTemp}" "${audioPath}"`
  await spawn({ command: replaceCommand, cwd: process.cwd() })

  const cutCommand = `ffmpeg -i "${audioPath}" -ss 0 -to ${srcDurationS} -y "${audioPathTemp}"`
  verbose && log.normal('Cutting audio', { durationMs, audioPath })
  await spawn({ command: cutCommand, cwd: process.cwd() })

  // replace original with temp
  const replaceCommand2 = `mv "${audioPathTemp}" "${audioPath}"`
  await spawn({ command: replaceCommand2, cwd: process.cwd() })

  await fs.unlink(audioPathBak)

  verbose && log.normal('Stratched audio duration', { durationMs, audioPath })
  return {
    audioPath,
    durationMs,
  }
}

// add silen
export const addSilenceToAudio = async ({
  silenceDurationMs,
  audioPath,
  policy,
  verbose,
}: {
  silenceDurationMs: number // in milliseconds
  audioPath: string
  policy: 'before' | 'after'
  verbose?: boolean
}) => {
  verbose && log.normal('Adding silence to audio', { silenceDurationMs, audioPath, policy })
  const audioBakPath = addSuffixToFilePath({ filePath: audioPath, suffix: 'bak' })
  const audioTempPath = addSuffixToFilePath({ filePath: audioPath, suffix: 'temp' })
  const copyCommand = `cp "${audioPath}" "${audioBakPath}"`
  await spawn({ command: copyCommand, cwd: process.cwd() })
  const silenceAudioPath = addSuffixToFilePath({ filePath: audioPath, suffix: 'silence' })
  const silenceAudio = await createSilentAudio({ durationMs: silenceDurationMs, outputAudioPath: silenceAudioPath })
  if (policy === 'before') {
    await concatAudios({ audioPaths: [silenceAudio.outputAudioPath, audioPath], outputAudioPath: audioTempPath })
  } else if (policy === 'after') {
    await concatAudios({ audioPaths: [audioPath, silenceAudio.outputAudioPath], outputAudioPath: audioTempPath })
  } else {
    throw new Error('Invalid policy')
  }
  const replaceCommand = `mv "${audioTempPath}" "${audioPath}"`
  await spawn({ command: replaceCommand, cwd: process.cwd() })
  await fs.unlink(silenceAudio.outputAudioPath)
  await fs.unlink(audioBakPath)
  verbose && log.normal('Added silence to audio', { silenceDurationMs, audioPath, policy })
  return {
    silenceDurationMs,
    audioPath,
    policy,
  }
}

export const createSilentAudio = async ({
  durationMs,
  outputAudioPath,
  verbose,
}: {
  durationMs: number // in milliseconds
  outputAudioPath: string
  verbose?: boolean
}) => {
  const durationS = durationMs / 1_000
  verbose && log.normal('Creating silent audio', { durationMs, outputAudioPath })
  const nativeCommand = `ffmpeg -f lavfi -i anullsrc=r=44100:cl=stereo -t ${durationS} -y "${outputAudioPath}"`
  await spawn({ command: nativeCommand, cwd: process.cwd() })
  verbose && log.normal('Created silent audio', { durationMs, outputAudioPath })
  return {
    durationMs,
    outputAudioPath,
  }
}

export const normalizeAudioDuration = async ({
  durationMs,
  audioPath,
  verbose,
}: {
  durationMs: number // in seconds
  audioPath: string
  verbose?: boolean
}) => {
  verbose && log.normal('Normalizing audio duration', { durationMs, audioPath })
  const srcDurationMs = durationMs
  const srcDurationS = durationMs / 1_000
  const distDurationMs = await getAudioDuration({ audioPath })
  const distDurationS = distDurationMs / 1_000
  if (srcDurationS < distDurationS) {
    const result = await stretchAudioDuration({ durationMs: srcDurationMs, audioPath, verbose })
    return {
      audioPath: result.audioPath,
      durationMs: result.durationMs,
    }
  } else {
    const silenceDurationMs = srcDurationMs - distDurationMs
    const result = await addSilenceToAudio({
      silenceDurationMs,
      audioPath,
      policy: 'after',
      verbose,
    })
    return {
      audioPath: result.audioPath,
      durationMs: result.silenceDurationMs + distDurationMs,
    }
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
  const srcDurationMs = await getAudioDuration({ audioPath: srcAudioPath })
  const result = await stretchAudioDuration({ durationMs: srcDurationMs, audioPath: distAudioPath, verbose })
  verbose && log.normal('Synced audios duration', { srcAudioPath, distAudioPath })
  return result
}

export const concatAudios = async ({
  audioPaths,
  outputAudioPath,
  verbose,
}: {
  audioPaths: string[]
  outputAudioPath: string
  verbose?: boolean
}) => {
  verbose && log.normal('Concatenating audios', { audioPaths, outputAudioPath })
  const inputAudioPaths = audioPaths.map((audioPath) => `-i "${audioPath}"`).join(' ')
  const nativeCommand = `ffmpeg ${inputAudioPaths} -filter_complex concat=n=${audioPaths.length}:v=0:a=1 -y "${outputAudioPath}"`
  await spawn({ command: nativeCommand, cwd: process.cwd() })
  verbose && log.normal('Concatenated audios', { audioPaths, outputAudioPath })
  return {
    audioPaths,
    outputAudioPath,
  }
}

// Utility function to get image dimensions
export const getImageDimensions = async ({ imagePath }: { imagePath: string }) => {
  const metadata = await sharp(imagePath).metadata()
  if (!metadata.width || !metadata.height) {
    throw new Error(`Unable to retrieve dimensions for image: ${imagePath}`)
  }
  return { width: metadata.width, height: metadata.height }
}

export const getVideoDimensions = async ({ videoPath }: { videoPath: string }) => {
  const metadata = await new Promise<{ width: number; height: number }>((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) {
        reject(err)
      } else {
        const width = metadata.streams[0].width
        const height = metadata.streams[0].height
        if (!width || !height) {
          reject(new Error(`Unable to retrieve dimensions for video: ${videoPath}`))
          return
        }
        resolve({ width, height })
      }
    })
  })
  return metadata
}

export const concatImagesToVideo = async ({
  imagesPaths,
  durationsMs,
  outputVideoPath,
  verbose,
}: {
  imagesPaths: string[]
  durationsMs: number[]
  outputVideoPath: string
  verbose?: boolean
}) => {
  verbose && log.normal('Concatenating images to video', { imagesPaths, outputVideoPath })

  if (imagesPaths.length !== durationsMs.length) {
    throw new Error('Images and durations must have the same length')
  }

  if (imagesPaths.length === 0) {
    throw new Error('No images provided for video creation')
  }

  // Get the resolution of the first image
  const { width, height } = await getImageDimensions({ imagePath: imagesPaths[0] })

  // Build ffmpeg input arguments
  const inputArgs = imagesPaths.flatMap((imagePath, index) => {
    const duration = durationsMs[index] / 1_000 // Convert ms to seconds
    return ['-loop', '1', '-t', `${duration}`, '-i', `"${imagePath}"`]
  })

  // Construct the filter_complex for concatenation
  let filterComplex = ''
  const totalInputs = imagesPaths.length
  for (let i = 0; i < totalInputs; i++) {
    filterComplex += `[${i}:v]scale=${width}:${height},setsar=1[v${i}];`
  }

  // Concatenate all scaled inputs
  const concatInputs = Array.from({ length: totalInputs }, (_, i) => `[v${i}]`).join('')
  filterComplex += `${concatInputs}concat=n=${totalInputs}:v=1:a=0,format=yuv420p[v]`

  // Final ffmpeg command arguments
  const ffmpegArgs = [
    ...inputArgs,
    '-filter_complex',
    `"${filterComplex}"`,
    '-map',
    '"[v]"',
    '-c:v',
    'libx264',
    '-crf',
    '18', // Adjust CRF for quality (lower is better)
    '-preset',
    'veryslow', // Adjust preset for encoding speed vs compression
    '-r',
    '25', // Frames per second
    '-y',
    `"${outputVideoPath}"`,
  ]

  // Join arguments into a single command string
  const nativeCommand = `ffmpeg ${ffmpegArgs.join(' ')}`

  verbose && log.normal('Executing ffmpeg command:', nativeCommand)

  // Execute the ffmpeg command
  await spawn({ command: nativeCommand, cwd: process.cwd() })

  verbose && log.normal('Concatenated images to video', { imagesPaths, outputVideoPath })

  return {
    imagesPaths,
    outputVideoPath,
  }
}

export const convertImagesToVideosWithoutTransitions = async ({
  imagesPaths,
  durationsMs,
  normalizedTransitions,
  width,
  height,
  tempDirPath,
  cont,
  verbose,
}: {
  imagesPaths: string[]
  durationsMs: number[]
  normalizedTransitions: Array<{ transitionDurationMs: number; transitionName: TransitionName }>
  width: number
  height: number
  tempDirPath: string
  cont?: boolean
  verbose?: boolean
}) => {
  const getTempVideoFilePath = (index: number) => path.resolve(tempDirPath, `${index}.mp4`)
  const tempVideoPaths: string[] = []

  // Generate individual video files for each image
  for (let i = 0; i < imagesPaths.length; i++) {
    const imagePath = imagesPaths[i]
    let durationMs = durationsMs[i]

    // Adjust duration for transitions
    if (i < imagesPaths.length - 1) {
      const transitionDuration = normalizedTransitions[i].transitionDurationMs
      durationMs -= transitionDuration * 3
      if (durationMs < 0) {
        throw new Error(`Duration of image at index ${i} is less than its transition duration`)
      }
    }

    const durationSec = durationMs / 1_000
    const tempVideoPath = getTempVideoFilePath(i)
    tempVideoPaths.push(tempVideoPath)
    const { fileExists } = isFileExistsSync({ filePath: tempVideoPath })
    if (fileExists && cont) {
      verbose && log.normal('Video file already exists', { tempVideoPath })
      continue
    }

    // Build ffmpeg arguments
    const ffmpegArgs = [
      '-loop',
      '1',
      '-t',
      `${durationSec}`,
      '-i',
      `"${imagePath}"`,
      '-vf',
      `"scale=${width}:${height},setsar=1"`,
      '-c:v',
      'libx264',
      '-crf',
      '24',
      '-preset',
      'ultrafast',
      '-r',
      '25',
      '-y',
      `"${tempVideoPath}"`,
    ]

    // Execute ffmpeg command
    const ffmpegCommand = `ffmpeg ${ffmpegArgs.join(' ')}`
    verbose && log.normal('Executing ffmpeg command:', ffmpegCommand)
    await spawn({ command: ffmpegCommand, cwd: process.cwd() })
  }

  return {
    imagesPaths,
    tempVideoPaths,
    tempDirPath,
    normalizedTransitions,
  }
}

export const convertImagesToVideosForTransitions = async ({
  imagesPaths,
  normalizedTransitions,
  width,
  height,
  tempDirPath,
  cont,
  verbose,
}: {
  imagesPaths: string[]
  normalizedTransitions: Array<{ transitionDurationMs: number; transitionName: TransitionName }>
  width: number
  height: number
  tempDirPath: string
  cont?: boolean
  verbose?: boolean
}) => {
  const getVideoForTransitionFilePath = (index: number, position: 'start' | 'end') =>
    path.resolve(tempDirPath, `${index}.${position}.mp4`)
  const getTransitionVideoFilePath = (currenIndex: number, nextIndex: number) =>
    path.resolve(tempDirPath, `${currenIndex}_${nextIndex}.transition.mp4`)
  const concatVideosWithTransitionsArgsArray: Array<{
    inputVideoPaths: string[]
    outputVideoPath: string
    normalizedTransitions: Array<{
      transitionDurationMs: number
      transitionName: TransitionName
    }>
  }> = []

  // Generate individual video files for each image
  for (let i = 0; i < normalizedTransitions.length; i++) {
    const imagePathCurrent = imagesPaths[i]
    const imagePathNext = imagesPaths[i + 1]
    const transition = normalizedTransitions[i]
    const durationMs = transition.transitionDurationMs * 2
    const durationSec = durationMs / 1_000
    const tempVideoForTransitionPathCurrent = getVideoForTransitionFilePath(i, 'end')
    const tempVideoForTransitionPathNext = getVideoForTransitionFilePath(i + 1, 'start')
    concatVideosWithTransitionsArgsArray.push({
      inputVideoPaths: [tempVideoForTransitionPathCurrent, tempVideoForTransitionPathNext],
      outputVideoPath: getTransitionVideoFilePath(i, i + 1),
      normalizedTransitions: [transition],
    })
    const { fileExists: tempVideoForTransitionPathCurrentExists } = isFileExistsSync({
      filePath: tempVideoForTransitionPathCurrent,
    })
    const { fileExists: tempVideoForTransitionPathNextExists } = isFileExistsSync({
      filePath: tempVideoForTransitionPathNext,
    })
    if (tempVideoForTransitionPathCurrentExists && tempVideoForTransitionPathNextExists && cont) {
      verbose &&
        log.normal('Video files already exists', { tempVideoForTransitionPathCurrent, tempVideoForTransitionPathNext })
      continue
    }

    const ffmpegArgs = [
      '-loop',
      '1',
      '-t',
      `${durationSec}`,
      '-i',
      `"${imagePathCurrent}"`,
      '-vf',
      `"scale=${width}:${height},setsar=1"`,
      '-c:v',
      'libx264',
      '-crf',
      '24',
      '-preset',
      'ultrafast',
      '-r',
      '25',
      '-y',
      `"${tempVideoForTransitionPathCurrent}"`,
    ]
    const ffmpegCommand = `ffmpeg ${ffmpegArgs.join(' ')}`
    verbose && log.normal('Executing ffmpeg command:', ffmpegCommand)
    await spawn({ command: ffmpegCommand, cwd: process.cwd() })

    const ffmpegArgs2 = [
      '-loop',
      '1',
      '-t',
      `${durationSec}`,
      '-i',
      `"${imagePathNext}"`,
      '-vf',
      `"scale=${width}:${height},setsar=1"`,
      '-c:v',
      'libx264',
      '-crf',
      '24',
      '-preset',
      'ultrafast',
      '-r',
      '25',
      '-y',
      `"${tempVideoForTransitionPathNext}"`,
    ]
    const ffmpegCommand2 = `ffmpeg ${ffmpegArgs2.join(' ')}`
    verbose && log.normal('Executing ffmpeg command:', ffmpegCommand2)
    await spawn({ command: ffmpegCommand2, cwd: process.cwd() })
  }

  return {
    concatVideosWithTransitionsArgsArray,
  }
}

export const concatVideosWithTransitions = async ({
  inputVideoPaths,
  normalizedTransitions,
  outputVideoPath,
  tempDirPath,
  index,
  cont,
  verbose,
}: {
  inputVideoPaths: string[]
  normalizedTransitions: Array<{ transitionDurationMs: number; transitionName: TransitionName }>
  outputVideoPath: string
  tempDirPath: string
  index: number
  cont?: boolean
  verbose?: boolean
}) => {
  const tempConcatDirPath = path.resolve(tempDirPath, 'concat')
  await fs.mkdir(tempConcatDirPath, { recursive: true })
  const tempTransitionFilePath = path.resolve(tempDirPath, `transitions-${index}.json`)
  const { fileExists } = isFileExistsSync({ filePath: outputVideoPath })
  if (fileExists && cont) {
    verbose && log.normal('concatVideosWithTransitions: video file already exists', { outputVideoPath })
    return
  }
  // Prepare transitions for ffmpeg-concat
  const transitionSettings = normalizedTransitions.map((transition) => ({
    name: transition.transitionName,
    duration: transition.transitionDurationMs, // Convert ms to seconds
  }))
  await fs.writeFile(tempTransitionFilePath, JSON.stringify(transitionSettings))

  // Use ffmpeg-concat to concatenate videos with transitions
  verbose && log.normal('Concatenating videos with transitions using ffmpeg-concat')
  const tempFilesSpaceSeparated = inputVideoPaths.map((inputVideoPath) => `'${inputVideoPath}'`).join(' ')
  await spawn({
    command: `ffmpeg-concat -O '${tempConcatDirPath}' -T '${tempTransitionFilePath}' -o '${outputVideoPath}' ${tempFilesSpaceSeparated}`,
    cwd: process.cwd(),
  })
  await fs.rmdir(tempConcatDirPath, { recursive: true })
}

// export const prepareArgumentsForConcatManyVideosWithTransitions = ({
//   inputVideoPaths,
//   normalizedTransitions,
//   outputVideoPath,
//   tempDirPath,
// }: {
//   inputVideoPaths: string[]
//   normalizedTransitions: Array<{ transitionDurationMs: number; transitionName: TransitionName }> // inputVideoPaths.length - 1
//   outputVideoPath: string
//   tempDirPath: string
// }) => {
//   // INPUT:
//   // inputVideoPaths: [0.mp4, 1.mp4, 2.mp4, 3.mp4, 4.mp4, ...]
//   // outputVideoPath: xmp4
//   // normalizedTransitions: [...]
//   // OUTPUT:
//   // [{inputVideoPaths: [0.mp4, 1.mp4], outputVideoPath: 0-1.mp4, normalizedTransitions: [srcNormalizedTransitions[0]]},{inputVideoPaths: [0-1.mp4, 2.mp4], outputVideoPath: 0-1-2.mp4, normalizedTransitions: [srcNormalizedTransitions[1]]},{inputVideoPaths: [0-1-2.mp4, 3.mp4], outputVideoPath: x.mp4, normalizedTransitions: [srcNormalizedTransitions[2]]}]
//   // Initialize the array to hold the arguments
//   const argsArray: Array<{
//     inputVideoPaths: string[]
//     outputVideoPath: string
//     normalizedTransitions: Array<{
//       transitionDurationMs: number
//       transitionName: TransitionName
//     }>
//   }> = []

//   // Start with the first video path
//   let lastOutputVideoPath = inputVideoPaths[0]

//   for (let index = 0; index < normalizedTransitions.length; index++) {
//     const transition = normalizedTransitions[index]
//     const nextInputVideoPath = inputVideoPaths[index + 1]

//     // Determine the output path for the current concatenation
//     const isLastTransition = index === normalizedTransitions.length - 1
//     const outputPath = isLastTransition
//       ? outputVideoPath // Use the final output path if it's the last transition
//       : path.join(
//           tempDirPath,
//           `${path.basename(lastOutputVideoPath, path.extname(lastOutputVideoPath))}-${path.basename(
//             nextInputVideoPath,
//             path.extname(nextInputVideoPath)
//           )}.mp4`
//         )

//     // Add the current set of arguments to the array
//     argsArray.push({
//       inputVideoPaths: [lastOutputVideoPath, nextInputVideoPath],
//       outputVideoPath: outputPath,
//       normalizedTransitions: [transition],
//     })

//     // Update the last output video path for the next iteration
//     lastOutputVideoPath = outputPath
//   }

//   return { argsArray }
// }

const knowTransitionNames = [
  'fade', // simple
  'circleopen', // simple
  'directionalwarp', // best
  'directionalwipe', // best
  'crosswarp', // best
  'crosszoom', // best
  'dreamy', // best
  // 'squareswire', // bad
  // 'angular', // bad
  // 'radial', // bad
  // 'cube', // bad
  // 'swap', // bad
] as const
type TransitionName = (typeof knowTransitionNames)[number]
export const concatImagesToVideoWithTransitions = async ({
  imagesPaths,
  durationsMs,
  transitionDurationMs = 1_000,
  transitionNames,
  transitions,
  outputVideoPath,
  cont,
  verbose,
}: {
  imagesPaths: string[]
  durationsMs: number[]
  transitionDurationMs?: number
  transitionNames?: TransitionName[]
  transitions?: Array<{ transitionDurationMs?: number; transitionName?: TransitionName }>
  outputVideoPath: string
  cont?: boolean
  verbose?: boolean
}) => {
  const normalizedTransitions: Array<{ transitionDurationMs: number; transitionName: TransitionName }> = []
  verbose && log.normal('Concatenating images to video with transitions', { imagesPaths, outputVideoPath })
  transitionNames = transitionNames || _.shuffle([...knowTransitionNames])
  if (!transitions) {
    for (const i of imagesPaths.keys()) {
      if (i === 0) {
        continue
      }
      normalizedTransitions.push({
        transitionDurationMs,
        transitionName: transitionNames[i % transitionNames.length],
      })
    }
  } else {
    for (const [i, transition] of transitions.entries()) {
      normalizedTransitions.push({
        transitionDurationMs: transition.transitionDurationMs || transitionDurationMs,
        transitionName: transition.transitionName || transitionNames[i % transitionNames.length],
      })
    }
  }

  if (normalizedTransitions.length !== imagesPaths.length - 1) {
    throw new Error('Transitions must have the same length as imagesPaths - 1')
  }

  if (imagesPaths.length !== durationsMs.length) {
    throw new Error('Images and durations must have the same length')
  }

  if (imagesPaths.length === 0) {
    throw new Error('No images provided for video creation')
  }

  const outputVideoDirPath = path.dirname(outputVideoPath)
  const outputVideoBaseName = path.basename(outputVideoPath, path.extname(outputVideoPath))
  const tempDirPath = path.resolve(outputVideoDirPath, `${outputVideoBaseName}.temp`)
  await fs.mkdir(tempDirPath, { recursive: true })

  // Get the resolution of the first image
  const { width, height } = await getImageDimensions({ imagePath: imagesPaths[0] })

  const { tempVideoPaths } = await convertImagesToVideosWithoutTransitions({
    imagesPaths,
    durationsMs,
    normalizedTransitions,
    width,
    height,
    tempDirPath,
    cont,
    verbose,
  })

  const { concatVideosWithTransitionsArgsArray } = await convertImagesToVideosForTransitions({
    imagesPaths,
    normalizedTransitions,
    width,
    height,
    tempDirPath,
    cont,
    verbose,
  })

  for (const [index, args] of concatVideosWithTransitionsArgsArray.entries()) {
    await concatVideosWithTransitions({ ...args, index, cont, verbose, tempDirPath })
  }

  const allVideosFilePaths: string[] = []
  for (const [i, videoPath] of tempVideoPaths.entries()) {
    allVideosFilePaths.push(videoPath)
    if (i < normalizedTransitions.length) {
      allVideosFilePaths.push(concatVideosWithTransitionsArgsArray[i].outputVideoPath)
    }
  }

  // ASAP
  verbose && log.normal('Concatenating all videos into a single video', { allVideosFilePaths, outputVideoPath })
  await concatSilentVideos({ inputVideoPaths: allVideosFilePaths, outputVideoPath, verbose })

  // Clean up temporary video files
  verbose && log.normal('Cleaning up temporary video files')
  // ASAP
  // await fs.rmdir(tempDirPath, { recursive: true })

  verbose && log.normal('Successfully concatenated images to video with transitions', { imagesPaths, outputVideoPath })

  return {
    imagesPaths,
    outputVideoPath,
  }
}

export const applyAssSubtitlesToVideo = async ({
  inputVideoPath,
  outputVideoPath,
  wordsTimestamps,
  verbose,
}: {
  inputVideoPath: string
  outputVideoPath: string
  wordsTimestamps: Array<{
    word: string
    startMs: number
    endMs: number
  }>
  verbose?: boolean
}) => {
  const { width, height } = await getVideoDimensions({ videoPath: inputVideoPath })

  // Function to convert milliseconds to ASS time format (h:mm:ss.cc)
  const msToAssTime = (ms: number): string => {
    const totalSeconds = ms / 1_000
    const hours = Math.floor(totalSeconds / 3_600)
    const minutes = Math.floor((totalSeconds % 3_600) / 60)
    const seconds = Math.floor(totalSeconds % 60)
    const centiseconds = Math.floor((totalSeconds * 100) % 100)
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(
      2,
      '0'
    )}.${String(centiseconds).padStart(2, '0')}`
  }

  // Function to split words into sentences
  const splitWordsIntoSentences = (
    wordsTimestamps: Array<{
      word: string
      startMs: number
      endMs: number
    }>
  ) => {
    const sentences = []
    let currentSentence = []
    const timeGapThreshold = 700 // milliseconds

    for (let i = 0; i < wordsTimestamps.length; i++) {
      const wordObj = wordsTimestamps[i]
      currentSentence.push(wordObj)

      // Check for punctuation marks
      if (/[.!?]$/.test(wordObj.word)) {
        sentences.push(currentSentence)
        currentSentence = []
        continue
      }

      // Check for too long sentences
      const currentSentenceLength = currentSentence.reduce((acc, w) => acc + w.word.length, 0)
      if (currentSentenceLength > 50) {
        sentences.push(currentSentence)
        currentSentence = []
        continue
      }

      // Check time gap if not at the last word
      if (i < wordsTimestamps.length - 1) {
        const nextWordObj = wordsTimestamps[i + 1]
        const gap = nextWordObj.startMs - wordObj.endMs
        if (gap > timeGapThreshold) {
          sentences.push(currentSentence)
          currentSentence = []
        }
      }
    }
    if (currentSentence.length > 0) {
      sentences.push(currentSentence)
    }
    return sentences
  }

  // Generate ASS subtitle content
  const generateAssSubtitleContent = () => {
    const fontSize = Math.ceil(width / 18)
    const margin = fontSize
    const assHeader = `[Script Info]
Title: Generated by applyNiceSubtitlesToVideo
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name,    Fontname,     Fontsize,    PrimaryColour,     SecondaryColour,    OutlineColour,      BackColour,     Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow,  Alignment, MarginL,   MarginR,   MarginV,    Encoding
Style:  Default, ArialBlack,   ${fontSize}, &H00FFFFFF,        &H000000FF,         &H00000000,         &H00000000,     1,    0,      0,         0,         100,    100,    0,       0,     0,           10,      0,       2,         ${margin}, ${margin}, ${margin},  1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`

    // Split words into sentences
    const sentences = splitWordsIntoSentences(wordsTimestamps)

    const dialogueEvents = []

    for (const sentenceWords of sentences) {
      // const sentenceText = sentenceWords.map((w) => w.word).join(' ')

      for (let index = 0; index < sentenceWords.length; index++) {
        const currentWordObj = sentenceWords[index]
        const nextWordObj = sentenceWords[index + 1]
        const currentWordStart = msToAssTime(currentWordObj.startMs)
        const currentWordEnd = msToAssTime(currentWordObj.endMs)
        const nextWordStart = nextWordObj ? msToAssTime(nextWordObj.startMs) : currentWordEnd

        // Build the text with the current word highlighted
        const text = sentenceWords
          .map((w, i) => {
            if (i === index) {
              // Highlight current word (e.g., change color to red)
              return `{\\c&H00FFFF&}${w.word}{\\c&HFFFFFF&}`
            } else {
              return w.word
            }
          })
          .join(' ')

        dialogueEvents.push(`Dialogue: 0,${currentWordStart},${nextWordStart},Default,,0,0,0,,${text}`)
      }
    }

    return assHeader + dialogueEvents.join('\n')
  }

  const assContent = generateAssSubtitleContent()

  // Write the ASS content to a temporary file
  const outputVideoDirPath = path.dirname(outputVideoPath)
  const outputVideoBasename = path.basename(outputVideoPath, path.extname(outputVideoPath))
  const assFilePath = path.resolve(outputVideoDirPath, `${outputVideoBasename}.ass`)
  await fs.writeFile(assFilePath, assContent, 'utf8')

  // Use ffmpeg to overlay the subtitles onto the video
  verbose && log.normal('Applying ass subtitles to video')
  // allow override
  const ffmpegCommand = `ffmpeg -i "${inputVideoPath}" -vf "ass='${assFilePath}'" -c:a copy "${outputVideoPath}" -y`
  await spawn({ command: ffmpegCommand, cwd: process.cwd() })
  verbose && log.normal('Applyed ass subtitles to video')
  return {
    inputVideoPath,
    outputVideoPath,
  }
}
