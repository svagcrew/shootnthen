/* eslint-disable @typescript-eslint/no-unused-vars */
import 'source-map-support/register.js'
import { auphonic } from '@/lib/auphonic.js'
import { ttsByAzureai } from '@/lib/azureai.js'
import { getConfig } from '@/lib/config.js'
import {
  applyAudiosToVideo,
  combineTwoAudios,
  converWavToMp3,
  cutVideo,
  decutVideo,
  extractAudio,
  extractAudioBackground,
} from '@/lib/editor.js'
import { elevenlabs } from '@/lib/elevenlabs.dubbing.js'
import { getVoicesElevenlabs, ttsByElevenlabs } from '@/lib/elevenlabs.general.js'
import { removeVideosAndAudios } from '@/lib/fs.js'
import {
  applyAssSubtitlesToStoryVideo,
  generateManyThumbnails,
  generateStoryAndIntroAndPicturesTexts,
  generateStoryAudio,
  generateStoryAudioParts,
  generateStoryDescription,
  generateStoryPictures,
  generateStoryTitle,
  generateStoryVideoByPictures,
  getNextEpisodeNumber,
  uploadStoryToYoutube,
} from '@/lib/gentube.js'
import { getGoogleAuthClient } from '@/lib/google.js'
import { googleDrive } from '@/lib/googledrive.js'
import { kinescope } from '@/lib/kinescope.js'
import { loom } from '@/lib/loom.js'
import { getMetaByFilePath, parseFileName } from '@/lib/meta.js'
import { translateSrtByOpenai } from '@/lib/openai.js'
import { rask } from '@/lib/rask.js'
import { extractSrtByRevai } from '@/lib/revai.js'
import { prettifySrt } from '@/lib/srt.js'
import type { LangProcessed } from '@/lib/utils.js'
import { fromRawLang, zLang, zLangProcessed } from '@/lib/utils.js'
import { youtube } from '@/lib/youtube.js'
import dedent from 'dedent'
import _ from 'lodash'
import path from 'path'
import readlineSync from 'readline-sync'
import { defineCliApp, getFlagAsBoolean, getFlagAsString, log, spawn } from 'svag-cli-utils'
import z from 'zod'

defineCliApp(async ({ cwd, command, args, argr, flags }) => {
  const startedAt = new Date()
  const verbose = getFlagAsBoolean({
    flags,
    keys: ['verbose'],
    coalesce: true,
  })
  const force = getFlagAsBoolean({
    flags,
    keys: ['force'],
    coalesce: false,
  })
  const { config } = await getConfig({
    dirPath: cwd,
  })

  switch (command) {
    case 'config':
    case 'c': {
      log.gray(config)
      break
    }
    case 'cut-video':
    case 'cut': {
      const input = z
        .object({
          inputVideoPath: z.string().min(1),
          outputVideoPath: z.string().min(1),
          start: z.string().regex(/^\d{2}:\d{2}:\d{2}(\.\d{3})?$/),
          end: z.string().regex(/^\d{2}:\d{2}:\d{2}(\.\d{3})?$/),
          // fast: z.boolean().optional().default(false),
        })
        .parse({
          inputVideoPath: args[0],
          outputVideoPath: args[1],
          start: args[2],
          end: args[3],
          // fast: getFlagAsBoolean({
          //   flags,
          //   keys: ['fast', 'f'],
          //   coalesce: false,
          // }),
        })
      const { inputVideoPath, outputVideoPath, start, end } = input
      const result = await cutVideo({ inputVideoPath, outputVideoPath, start, end, cwd })
      log.green(result)
      break
    }
    case 'decut-video':
    case 'decut': {
      const timesArgs = args.slice(2) // 00:05:24 00:06:27 00:10:51 00:14:04
      const input = z
        .object({
          inputVideoPath: z.string().min(1),
          outputVideoPath: z.string().min(1),
          times: z
            .array(
              z.tuple([
                z.string().regex(/^\d{2}:\d{2}:\d{2}(\.\d{3})?$/),
                z.string().regex(/^\d{2}:\d{2}:\d{2}(\.\d{3})?$/),
              ])
            )
            .min(1),
          fast: z.boolean().optional().default(false),
        })
        .parse({
          inputVideoPath: args[0],
          outputVideoPath: args[1],
          times: _.chunk(timesArgs, 2),
          fast: getFlagAsBoolean({
            flags,
            keys: ['fast', 'f'],
            coalesce: false,
          }),
        })
      const { inputVideoPath, outputVideoPath, times, fast } = input
      const result = await decutVideo({ cwd, inputVideoPath, outputVideoPath, times, fast })
      log.green(result)
      break
    }

    case 'google-auth':
    case 'ga': {
      await getGoogleAuthClient({ config })
      log.green('Auth client is ready')
      break
    }

    case 'download-from-google-drive':
    case 'dg': {
      const { fileId, fileUrl, filePath } = z
        .object({
          fileId: z.string().optional(),
          fileUrl: z.string().optional(),
          filePath: z.string().optional(),
        })
        .parse({
          fileId: getFlagAsString({
            flags,
            keys: ['file-id', 'i'],
            coalesce: undefined,
          }),
          fileUrl: getFlagAsString({
            flags,
            keys: ['file-url', 'u'],
            coalesce: undefined,
          }),
          filePath: getFlagAsString({
            flags,
            keys: ['file-path', 'p'],
            coalesce: undefined,
          }),
        })
      const result = await googleDrive.downloadFile({
        config,
        filePath,
        fileId: fileId as string,
        fileUrl: fileUrl as string,
        force,
        verbose,
      })
      log.green(result)
      break
    }
    case 'download-from-google-drive-by-search':
    case 'dgs': {
      const dirId = getFlagAsString({
        flags,
        keys: ['dir', 'd'],
        coalesce: config.googleDriveDirId,
      })
      if (!dirId) {
        log.red('dirId not provided')
        break
      }
      const ext = getFlagAsString({
        flags,
        keys: ['ext', 'e'],
        coalesce: undefined,
      })
      const marksString = getFlagAsString({
        flags,
        keys: ['marks', 'm'],
        coalesce: undefined,
      })
      const marks = marksString ? marksString.split(',') : undefined
      const files = await googleDrive.searchFiles({ config, search: args[0], dirId, ext, marks })
      if (!files.length) {
        log.red('Files not found')
        break
      }
      const multiple = getFlagAsBoolean({
        flags,
        keys: ['multiple', 'm'],
        coalesce: false,
      })
      if (!multiple && files.length > 1) {
        log.red('Multiple files found', files)
        break
      }
      await Promise.all(
        files.map(async (file) => {
          await googleDrive.downloadFile({ config, fileId: file.id, filePath: file.name })
        })
      )
      break
    }
    case 'upload-to-google-drive':
    case 'ug': {
      const dirId = getFlagAsString({
        flags,
        keys: ['dir', 'd'],
        coalesce: config.googleDriveDirId,
      })
      if (!dirId) {
        log.red('dirId not provided')
        break
      }
      const files = args
      await Promise.all(
        files.map(async (file) => {
          await googleDrive.uploadFile({ config, filePath: file, dirId })
        })
      )
      break
    }
    case 'get-google-drive-public-url':
    case 'ggpu': {
      const fileId = args[0]
      const { googleDrivePublicUrl } = await googleDrive.getPublicUrl({ fileId, config })
      log.green(googleDrivePublicUrl)
      break
    }
    case 'search-google-drive':
    case 'sg': {
      const dirId = getFlagAsString({
        flags,
        keys: ['dir', 'd'],
        coalesce: config.googleDriveDirId,
      })
      if (!dirId) {
        log.red('dirId not provided')
        break
      }
      const ext = getFlagAsString({
        flags,
        keys: ['ext', 'e'],
        coalesce: undefined,
      })
      const marksString = getFlagAsString({
        flags,
        keys: ['marks', 'm'],
        coalesce: undefined,
      })
      const marks = marksString ? marksString.split(',') : undefined
      const files = await googleDrive.searchFiles({ config, search: args[0], dirId, ext, marks })
      if (!files.length) {
        log.red('Files not found')
      } else {
        log.green(files)
      }
      break
    }
    case 'upload-to-kinescope':
    case 'uk': {
      const parentId =
        getFlagAsString({
          flags,
          keys: ['parent', 'p'],
          coalesce: config.kinescopeParentId,
        }) || undefined
      const videoId = getFlagAsString({
        flags,
        keys: ['video', 'v'],
        coalesce: undefined,
      })
      const filePath = args[0]
      await kinescope.uploadFile({ config, filePath, parentId, videoId })
      break
    }
    case 'list-kinescope-projects':
    case 'lkp': {
      const projects = await kinescope.getProjects()
      log.green(projects)
      break
    }
    case 'extract-audio':
    case 'ea': {
      const langRaw = getFlagAsString({
        flags,
        keys: ['lang', 'l'],
        coalesce: undefined,
      })
      // const lang = zLang.parse(langRaw)
      const { lang } = z.object({ lang: zLang }).parse({ lang: langRaw })
      const { audioFilePath } = await extractAudio({ config, filePath: args[0], lang, verbose, force })
      log.green(audioFilePath)
      break
    }
    case 'extract-audio-background':
    case 'eab': {
      const { inputAudioPath, outputAudioPath } = z
        .object({ inputAudioPath: z.string().min(1), outputAudioPath: z.string().min(1) })
        .parse({ inputAudioPath: args[0], outputAudioPath: args[1] })
      const result = await extractAudioBackground({
        verbose,
        inputAudioPath: path.resolve(cwd, inputAudioPath),
        outputAudioPath: path.resolve(cwd, outputAudioPath),
      })
      log.green(result)
      break
    }
    case 'combine-audios':
    case 'ca': {
      const { audioPath1, audioPath2, outputAudioPath } = z
        .object({ audioPath1: z.string().min(1), audioPath2: z.string().min(1), outputAudioPath: z.string().min(1) })
        .parse({ audioPath1: args[0], audioPath2: args[1], outputAudioPath: args[2] })
      const result = await combineTwoAudios({
        audioPath1: path.resolve(cwd, audioPath1),
        audioPath2: path.resolve(cwd, audioPath2),
        outputAudioPath: path.resolve(cwd, outputAudioPath),
      })
      log.green(result)
      break
    }
    case 'convert-wav-to-mp3':
    case 'cwm': {
      const inputWavPath = args[0]
      const outputMp3Path = args[1]
      const result = await converWavToMp3({ inputWavPath, outputMp3Path })
      log.green(result)
      break
    }
    case 'apply-audios':
    case 'aa': {
      const inputVideoPath = args[0]
      const langsString = getFlagAsString({
        flags,
        keys: ['langs', 'l'],
        coalesce: undefined,
      })
      const langsRaw = langsString?.split(',')
      const { langs } = z.object({ langs: z.array(zLang) }).parse({ langs: langsRaw })

      const result = await applyAudiosToVideo({ inputVideoPath, config, langs })
      log.green(result)
      break
    }
    case 'elevenlabs-create-dubbing':
    case 'elcd': {
      const filePathRaw = args[0]
      const srcLangRaw = getFlagAsString({
        flags,
        keys: ['src-lang', 'sl'],
        coalesce: undefined,
      })
      const distLangRaw = getFlagAsString({
        flags,
        keys: ['dist-lang', 'dl'],
        coalesce: undefined,
      })
      const { srcLang, distLang, filePath } = z
        .object({
          srcLang: zLangProcessed,
          distLang: zLangProcessed,
          filePath: z.string(),
        })
        .parse({
          srcLang: srcLangRaw,
          distLang: distLangRaw,
          filePath: filePathRaw,
        })
      const parsed = parseFileName(filePath)
      if (parsed.ext !== 'mp3') {
        log.red('File is not mp3')
        break
      }
      const result = await elevenlabs.createDubbing({
        distLang,
        srcLang,
        filePath,
        config,
      })
      log.green(result)
      break
    }
    case 'elevenlabs-create-dubbing-by-url':
    case 'elcdu': {
      const urlRaw = args[0]
      const filePathRaw = getFlagAsString({
        flags,
        keys: ['file', 'f'],
        coalesce: undefined,
      })
      const srcLangRaw = getFlagAsString({
        flags,
        keys: ['src-lang', 'sl'],
        coalesce: undefined,
      })
      const distLangRaw = getFlagAsString({
        flags,
        keys: ['dist-lang', 'dl'],
        coalesce: undefined,
      })
      const { srcLang, distLang, filePath, url } = z
        .object({
          srcLang: zLangProcessed,
          distLang: zLangProcessed,
          filePath: z.string(),
          url: z.string(),
        })
        .parse({
          srcLang: srcLangRaw,
          distLang: distLangRaw,
          filePath: filePathRaw,
          url: urlRaw,
        })
      const parsed = parseFileName(filePath)
      if (parsed.ext !== 'mp3') {
        log.red('File is not mp3')
        break
      }
      const result = await elevenlabs.createDubbingByUrl({
        distLang,
        srcLang,
        filePath,
        config,
        url,
      })
      log.green(result)
      break
    }
    case 'elevenlabs-get-dubbing':
    case 'elgd': {
      const dubbingId = args[0]
      const result = await elevenlabs.getDubbing({ dubbingId })
      log.green(result)
      break
    }
    case 'elevenlabs-download-dubbing':
    case 'eldd': {
      const filePathRaw = getFlagAsString({
        flags,
        keys: ['file', 'f'],
        coalesce: undefined,
      })
      const dubbingIdRaw = getFlagAsString({
        flags,
        keys: ['dubbing', 'd'],
        coalesce: undefined,
      })
      const langRaw = getFlagAsString({
        flags,
        keys: ['lang', 'l'],
        coalesce: undefined,
      })
      const { dubbingId, filePath, lang } = z
        .object({ dubbingId: z.string(), filePath: z.string(), lang: zLangProcessed })
        .parse({
          dubbingId: dubbingIdRaw,
          filePath: filePathRaw,
          lang: langRaw,
        })
      const result = await elevenlabs.downloadDubbing({ dubbingId, config, filePath, lang })
      log.green(result)
      break
    }
    case 'elevenlabs-create-dubbing-with-browser':
    case 'elcdb': {
      const filePathRaw = args[0]
      const srcLangRaw = getFlagAsString({
        flags,
        keys: ['src-lang', 'sl'],
        coalesce: undefined,
      })
      const distLangRaw = getFlagAsString({
        flags,
        keys: ['dist-lang', 'dl'],
        coalesce: undefined,
      })
      const { srcLang, distLang, filePath } = z
        .object({
          srcLang: zLangProcessed,
          distLang: zLangProcessed,
          filePath: z.string(),
        })
        .parse({
          srcLang: srcLangRaw,
          distLang: distLangRaw,
          filePath: filePathRaw,
        })
      const parsed = parseFileName(filePath)
      if (parsed.ext !== 'mp3') {
        log.red('File is not mp3')
        break
      }
      const result = await elevenlabs.createDubbingWithBrowser({
        distLang,
        srcLang,
        filePath,
        config,
      })
      log.green(result)
      break
    }
    case 'elevenlabs-dub-audio':
    case 'eda': {
      const srcFilePathRaw = args[0]
      const srcLangRaw = getFlagAsString({
        flags,
        keys: ['src-lang', 'sl'],
        coalesce: undefined,
      })
      const distLangRaw = getFlagAsString({
        flags,
        keys: ['dist-lang', 'dl'],
        coalesce: undefined,
      })
      const distFilePathRaw = getFlagAsString({
        flags,
        keys: ['dist-file-path', 'df'],
        coalesce: undefined,
      })
      const { srcLang, distLang, srcFilePath, distFilePath } = z
        .object({
          srcLang: zLangProcessed,
          distLang: zLangProcessed,
          srcFilePath: z.string(),
          distFilePath: z.string().nullable().default(null),
        })
        .parse({
          srcLang: srcLangRaw,
          distLang: distLangRaw,
          srcFilePath: srcFilePathRaw,
          distFilePath: distFilePathRaw,
        })
      const parsed = parseFileName(srcFilePath)
      if (parsed.ext !== 'mp3') {
        log.red('File is not mp3')
        break
      }
      const distFilePathSafe = distFilePath || path.resolve(path.dirname(srcFilePath), `${parsed.name}.${distLang}.mp3`)
      const result = await elevenlabs.createWaitDownloadDubbing({
        srcLang,
        distLang,
        srcFilePath,
        distFilePath: distFilePathSafe,
        config,
      })
      log.green(result)
      break
    }
    case 'rask-create-project':
    case 'rcp': {
      const filePathRaw = args[0]
      const srcLangRaw = getFlagAsString({
        flags,
        keys: ['src-lang', 'sl'],
        coalesce: undefined,
      })
      const distLangRaw = getFlagAsString({
        flags,
        keys: ['dist-lang', 'dl'],
        coalesce: undefined,
      })
      const { srcLang, distLang, filePath } = z
        .object({
          srcLang: zLangProcessed,
          distLang: zLangProcessed,
          filePath: z.string(),
        })
        .parse({
          srcLang: srcLangRaw,
          distLang: distLangRaw,
          filePath: filePathRaw,
        })
      const parsed = parseFileName(filePath)
      if (parsed.ext !== 'mp3') {
        log.red('File is not mp3')
        break
      }
      const result = await rask.createProjectWithBrowserByFilePath({
        distLang,
        srcLang,
        filePath,
        config,
        verbose,
      })
      log.green(result)
      break
    }
    case 'rask-get-project-status':
    case 'rgps': {
      const projectId = args[0]
      const result = await rask.getProjectStatusWithBrowser({ projectId })
      log.green(result)
      break
    }
    case 'rask-start-dubbing':
    case 'rsd': {
      const projectId = args[0]
      const result = await rask.startDubbingWithBrowser({ projectId })
      log.green(result)
      break
    }
    case 'rask-download-dubbing':
    case 'rdd': {
      const filePathRaw = getFlagAsString({
        flags,
        keys: ['file', 'f'],
        coalesce: undefined,
      })
      const projectIdRaw = getFlagAsString({
        flags,
        keys: ['project', 'p'],
        coalesce: undefined,
      })
      const { projectId, filePath } = z.object({ projectId: z.string(), filePath: z.string() }).parse({
        projectId: projectIdRaw,
        filePath: filePathRaw,
      })
      const result = await rask.downloadDubbingWithBrowser({ projectId, config, filePath, verbose })
      log.green(result)
      break
    }
    case 'rask-dub-audio':
    case 'rda': {
      const srcFilePathRaw = args[0]
      const srcLangRaw = getFlagAsString({
        flags,
        keys: ['src-lang', 'sl'],
        coalesce: undefined,
      })
      const distLangRaw = getFlagAsString({
        flags,
        keys: ['dist-lang', 'dl'],
        coalesce: undefined,
      })
      const distFilePathRaw = getFlagAsString({
        flags,
        keys: ['dist-file-path', 'df'],
        coalesce: undefined,
      })
      const { srcLang, distLang, srcFilePath, distFilePath } = z
        .object({
          srcLang: zLangProcessed,
          distLang: zLangProcessed,
          srcFilePath: z.string(),
          distFilePath: z.string().nullable().default(null),
        })
        .parse({
          srcLang: srcLangRaw,
          distLang: distLangRaw,
          srcFilePath: srcFilePathRaw,
          distFilePath: distFilePathRaw,
        })
      const parsed = parseFileName(srcFilePath)
      if (parsed.ext !== 'mp3') {
        log.red('File is not mp3')
        break
      }
      const distFilePathSafe = distFilePath || path.resolve(path.dirname(srcFilePath), `${parsed.name}.${distLang}.wav`)
      const result = await rask.createWaitDownloadConvertDubbing({
        srcLang,
        distLang,
        srcFilePath,
        distFilePath: distFilePathSafe,
        config,
        verbose,
      })
      log.green({
        filePath: result.filePath,
      })
      break
    }
    case 'loom-download':
    case 'ld': {
      const loomPublicUrlRaw = args[0]
      const filePathRaw = getFlagAsString({
        flags,
        keys: ['file', 'f'],
        coalesce: undefined,
      })
      const langRaw = getFlagAsString({
        flags,
        keys: ['lang', 'l'],
        coalesce: undefined,
      })
      const { loomPublicUrl, filePath, lang } = z
        .object({ loomPublicUrl: z.string(), filePath: z.string().optional(), lang: zLang })
        .parse({ loomPublicUrl: loomPublicUrlRaw, filePath: filePathRaw, lang: langRaw })
      await loom.downloadVideoByPublicUrl({ loomPublicUrl, filePath, lang, config, verbose })
      break
    }

    case 'auphonic-create-project':
    case 'acp': {
      const filePathRaw = args[0]
      const presetIdRaw = getFlagAsString({
        flags,
        keys: ['preset', 'p'],
        coalesce: undefined,
      })
      const { presetId, filePath } = z
        .object({
          presetId: z.string().optional(),
          filePath: z.string(),
        })
        .parse({
          presetId: presetIdRaw,
          filePath: filePathRaw,
        })
      const parsed = parseFileName(filePath)
      if (parsed.ext !== 'mp3') {
        log.red('File is not mp3')
        break
      }
      const result = await auphonic.createProject({
        filePath,
        config,
        presetId,
        verbose,
      })
      log.green(result)
      break
    }
    case 'auphonic-get-project':
    case 'agp': {
      const projectId = args[0]
      const result = await auphonic.getProject({ projectId, verbose })
      log.green(result)
      break
    }
    case 'auphonic-download-project':
    case 'adp': {
      const filePathRaw = getFlagAsString({
        flags,
        keys: ['file', 'f'],
        coalesce: undefined,
      })
      const projectIdRaw = getFlagAsString({
        flags,
        keys: ['project', 'p'],
        coalesce: undefined,
      })
      const { projectId, filePath } = z.object({ projectId: z.string(), filePath: z.string() }).parse({
        projectId: projectIdRaw,
        filePath: filePathRaw,
      })
      const result = await auphonic.downloadProject({ projectId, config, filePath, verbose })
      log.green(result)
      break
    }
    case 'auphonic-process-audio':
    case 'apa': {
      const srcFilePathRaw = args[0]
      const distFilePathRaw = getFlagAsString({
        flags,
        keys: ['dist-file-path', 'df'],
        coalesce: undefined,
      })
      const { srcFilePath, distFilePath } = z
        .object({
          srcFilePath: z.string(),
          distFilePath: z.string().nullable().default(null),
        })
        .parse({
          srcFilePath: srcFilePathRaw,
          distFilePath: distFilePathRaw,
        })
      const parsed = parseFileName(srcFilePath)
      if (parsed.ext !== 'mp3') {
        log.red('File is not mp3')
        break
      }
      const distFilePathSafe = (() => {
        if (distFilePath) {
          return distFilePath
        }
        if (!parsed.langSingle) {
          throw new Error('distFilePath is not provided and lang is not detected')
        }
        const langProcessed = fromRawLang(parsed.langSingle)
        return path.resolve(path.dirname(srcFilePath), `${parsed.name}.${langProcessed}.mp3`)
      })()
      const result = await auphonic.createWaitDownload({
        srcFilePath,
        distFilePath: distFilePathSafe,
        config,
        verbose,
      })
      log.green(result)
      break
    }

    case 'upload-to-youtube':
    case 'uy': {
      const { title, filePath, playlistId, privacyStatus } = z
        .object({
          title: z.string().optional(),
          description: z.string().optional(),
          playlistId: z.string().optional(),
          privacyStatus: z.enum(['private', 'public', 'unlisted']),
          filePath: z.string(),
        })
        .parse({
          title: getFlagAsString({
            flags,
            keys: ['title', 't'],
            coalesce: undefined,
          }),
          description: getFlagAsString({
            flags,
            keys: ['description', 'd'],
            coalesce: '',
          }),
          playlistId: getFlagAsString({
            flags,
            keys: ['playlist', 'p'],
            coalesce: undefined,
          }),
          privacyStatus: getFlagAsString({
            flags,
            keys: ['privacy-status', 's'],
            coalesce: 'public',
          }),
          filePath: args[0],
        })
      const result = await youtube.uploadFile({
        config,
        title,
        playlistId,
        privacyStatus,
        filePath,
        verbose,
      })
      log.green(result)
      break
    }

    case 'download-from-youtube':
    case 'dy': {
      const { url, filePath } = z
        .object({
          url: z.string().min(1),
          filePath: z.string().optional(),
        })
        .parse({
          url: getFlagAsString({
            flags,
            keys: ['url', 'u'],
            coalesce: undefined,
          }),
          filePath: getFlagAsString({
            flags,
            keys: ['file', 'f'],
            coalesce: undefined,
          }),
        })
      const result = await youtube.downloadFile({ config, url, filePath, verbose, force })
      log.green(result)
      break
    }

    case 'extract-srt-revai':
    case 'esr': {
      const { lang, filePath, translatedLangs } = z
        .object({ lang: zLang.optional(), filePath: z.string().min(1), translatedLangs: z.array(zLangProcessed) })
        .parse({
          lang: getFlagAsString({
            flags,
            keys: ['lang', 'l'],
            coalesce: undefined,
          }),
          filePath: args[0],
          translatedLangs:
            getFlagAsString({
              flags,
              keys: ['translated-langs', 'tl'],
              coalesce: undefined,
            })?.split(',') || [],
        })
      const { srtFilePath } = await extractSrtByRevai({ config, lang, verbose, filePath, translatedLangs, force })
      log.green(srtFilePath)
      break
    }

    case 'prettify-srt':
    case 'ps': {
      const srtName = args[0]
      const result = await prettifySrt({ config, srtName, verbose, force })
      log.green(result)
      break
    }

    case 'translate-srt':
    case 'ts': {
      const { srcSrtPath, distSrtPath, srcLang, distLang } = z
        .object({
          srcSrtPath: z.string().min(1),
          distSrtPath: z.string().optional(),
          srcLang: zLangProcessed.optional(),
          distLang: zLangProcessed,
        })
        .parse({
          srcSrtPath: args[0],
          distSrtPath: getFlagAsString({
            flags,
            keys: ['dist-srt', 'ds'],
            coalesce: undefined,
          }),
          srcLang: getFlagAsString({
            flags,
            keys: ['src-lang', 'sl'],
            coalesce: undefined,
          }),
          distLang: getFlagAsString({
            flags,
            keys: ['dist-lang', 'dl'],
            coalesce: undefined,
          }),
        })
      const result = await translateSrtByOpenai({
        config,
        srcSrtPath,
        distSrtPath,
        srcLang,
        distLang,
        verbose,
        force,
      })
      log.green(result)
      break
    }

    // case 'extract-srt-azureai':
    // case 'esa': {
    //   const { lang, filePath } = z.object({ lang: zLang.optional(), filePath: z.string().min(1) }).parse({
    //     lang: getFlagAsString({
    //       flags,
    //       keys: ['lang', 'l'],
    //       coalesce: undefined,
    //     }),
    //     filePath: args[0],
    //   })
    //   const { srtFilePath } = await extractSrtByAzureai({ config, lang, verbose, filePath, force })
    //   log.green(srtFilePath)
    //   break
    // }

    case 'tts': {
      const { lang, srtPath, srcAudioPath, provider } = z
        .object({
          lang: zLang.optional(),
          srtPath: z.string().min(1),
          srcAudioPath: z.string().min(1),
          provider: z.enum(['azureai', 'elevenlabs']),
        })
        .parse({
          lang: getFlagAsString({
            flags,
            keys: ['lang', 'l'],
            coalesce: undefined,
          }),
          srtPath: getFlagAsString({
            flags,
            keys: ['srt', 's'],
            coalesce: undefined,
          }),
          srcAudioPath: getFlagAsString({
            flags,
            keys: ['src-audio', 'a'],
            coalesce: undefined,
          }),
          provider: getFlagAsString({
            flags,
            keys: ['provider', 'p'],
            coalesce: 'elevenlabs',
          }),
        })
      if (provider === 'elevenlabs') {
        const { audioFilePath } = await ttsByElevenlabs({
          force,
          config,
          lang,
          verbose,
          srcAudioPath,
          srtPath,
        })
        log.green(audioFilePath)
      } else {
        const { audioFilePath } = await ttsByAzureai({
          force,
          config,
          lang,
          verbose,
          srcAudioPath,
          srtPath,
        })
        log.green(audioFilePath)
      }
      break
    }

    case 'boom': {
      const steps = [
        'loom',
        'extract',
        'auphonic',
        'apply-original',
        'rask-cp',
        'rask-sd',
        'rask-dd',
        'apply-all',
        'upload',
        'youtube',
      ] as const
      type Step = (typeof steps)[number]
      const { pause, loomPublicUrl, filePath, srcLang, distLangs, googleDriveDirId, firstStep, raskInputFormat } = z
        .object({
          pause: z.boolean().optional().nullable(),
          loomPublicUrl: z.string().optional().nullable(),
          filePath: z.string().optional().nullable(),
          srcLang: zLang,
          distLangs: z.array(zLangProcessed),
          googleDriveDirId: z.string(),
          firstStep: z.enum(steps),
          raskInputFormat: z.enum(['mp3', 'mp4']),
        })
        .parse({
          pause: getFlagAsBoolean({
            flags,
            keys: ['pause', 'p'],
            coalesce: false,
          }),
          loomPublicUrl: getFlagAsString({
            flags,
            keys: ['loom', 'l'],
            coalesce: undefined,
          }),
          filePath: getFlagAsString({
            flags,
            keys: ['file', 'f'],
            coalesce: undefined,
          }),
          srcLang:
            getFlagAsString({
              flags,
              keys: ['src-lang', 'sl'],
              coalesce: undefined,
            }) || config.srcLang,
          distLangs:
            getFlagAsString({
              flags,
              keys: ['dist-langs', 'dl'],
              coalesce: undefined,
            })?.split(',') || config.distLangs,
          googleDriveDirId:
            getFlagAsString({
              flags,
              keys: ['dir', 'd'],
              coalesce: config.googleDriveDirId,
            }) || undefined,
          firstStep:
            getFlagAsString({
              flags,
              keys: ['step', 's'],
              coalesce: undefined,
            }) || 'loom',
          raskInputFormat: getFlagAsString({
            flags,
            keys: ['rask-format', 'rf'],
            coalesce: 'mp4',
          }),
        })

      const isStepActual = (step: Step) => steps.indexOf(step) >= steps.indexOf(firstStep)
      if (!loomPublicUrl && !filePath) {
        throw new Error('loomPublicUrl or filePath required')
      }
      const loomResult = loomPublicUrl
        ? await loom.downloadVideoByPublicUrl({
            loomPublicUrl,
            lang: srcLang,
            config,
            verbose,
          })
        : null
      const filePathNormalized = loomResult?.filePath || filePath
      if (!filePathNormalized) {
        throw new Error('filePath not provided')
      }
      const filePathAbs = path.resolve(config.contentDir, filePathNormalized)
      if (!filePathAbs.endsWith('.mp4')) {
        throw new Error('File is not mp4')
      }
      const extractResult = await extractAudio({ config, filePath: filePathAbs, lang: srcLang, verbose, force })
      const originalAudioParsedName = parseFileName(extractResult.audioFilePath)
      const originalLangRaw = originalAudioParsedName.langSingle
      if (!originalLangRaw) {
        throw new Error('Original lang not detected')
      }
      if (!distLangs.length) {
        throw new Error('distLangs not provided')
      }
      const originalLangProcessed = fromRawLang(originalLangRaw) as LangProcessed
      const auphonicDistFilePath = path.resolve(
        path.dirname(extractResult.audioFilePath),
        `${originalAudioParsedName.name}.${originalLangProcessed}.mp3`
      )
      if (auphonicDistFilePath === extractResult.audioFilePath) {
        throw new Error('auphonicDistFilePath === extractResult.audioFilePath')
      }
      const auphonicResult = isStepActual('auphonic')
        ? await auphonic.createWaitDownload({
            srcFilePath: extractResult.audioFilePath,
            config,
            distFilePath: auphonicDistFilePath,
            verbose,
          })
        : {
            filePath: auphonicDistFilePath,
          }

      const applyOriginalAudioToVideoResult = isStepActual('apply-original')
        ? await applyAudiosToVideo({
            inputVideoPath: filePathAbs,
            config,
            langs: [originalLangProcessed],
            verbose,
          })
        : {
            outputVideoPath: path.resolve(
              path.dirname(filePathAbs),
              `${originalAudioParsedName.name}.${originalLangProcessed}.mp4`
            ),
          }

      const raskDistMp3sPaths: string[] = []
      const { meta } = getMetaByFilePath({ filePath: extractResult.audioFilePath, config })
      for (const distLang of distLangs) {
        if (distLang === originalLangProcessed) {
          continue
        }
        // const raskResult = await rask.createWaitDownloadConvertDubbing({
        //   srcLang: originalLangProcessed,
        //   distLang,
        //   srcFilePath: auphonicResult.filePath,
        //   distFilePath: path.resolve(
        //     path.dirname(auphonicResult.filePath),
        //     `${originalAudioParsedName.name}.${distLang}.wav`
        //   ),
        //   config,
        //   verbose,
        // })

        const projectId = await (async () => {
          if (isStepActual('rask-cp')) {
            const raskInputPath = (() => {
              if (raskInputFormat === 'mp4') {
                return applyOriginalAudioToVideoResult.outputVideoPath
              }
              if (raskInputFormat === 'mp3') {
                return auphonicResult.filePath
              }
              throw new Error('raskInputFormat not supported')
            })()
            const { projectId, processed } = await rask.createProjectWithBrowserByFilePath({
              config,
              filePath: raskInputPath,
              srcLang: originalLangProcessed,
              distLang,
              verbose,
            })
            if (processed) {
              await rask.waitWhileProcessingWithBrowser({ projectId, verbose })
            }
            return projectId
          }
          const projectId = meta.rask.projects.find((p) => p.distLang === distLang)?.id
          if (!projectId) {
            throw new Error(`projectId not found for distLang ${distLang}`)
          }
          return projectId
        })()

        if (isStepActual('rask-sd')) {
          await rask.waitWhileProcessingWithBrowser({ projectId, verbose })
          if (pause) {
            readlineSync.question('Check your dubs and press Enter')
          }
          const { processed } = await rask.startDubbingWithBrowser({ projectId, verbose })
          if (processed) {
            await rask.waitWhileProcessingWithBrowser({ projectId, verbose })
          }
        }

        if (isStepActual('rask-dd')) {
          const raskResult = await rask.downloadDubbingWithBrowserAndConvertToMp3({
            config,
            projectId,
            filePath: path.resolve(
              path.dirname(auphonicResult.filePath),
              `${originalAudioParsedName.name}.${distLang}.wav`
            ),
            verbose,
          })
          const distMp3Path = path.resolve(
            path.dirname(raskResult.filePath),
            `${originalAudioParsedName.name}.${distLang}.mp3`
          )
          raskDistMp3sPaths.push(distMp3Path)
        }
      }
      const applyAllAudiosToVideoResult = isStepActual('apply-all')
        ? distLangs.length === 1 && fromRawLang(srcLang) === distLangs[0]
          ? applyOriginalAudioToVideoResult
          : await applyAudiosToVideo({
              inputVideoPath: filePathAbs,
              config,
              langs: distLangs,
              verbose,
            })
        : {
            outputVideoPath: path.resolve(
              path.dirname(filePathAbs),
              `${originalAudioParsedName.name}.${distLangs.join('.')}.mp4`
            ),
          }
      const valuableFilesPaths = [
        filePathAbs,
        extractResult.audioFilePath,
        auphonicResult.filePath,
        ...raskDistMp3sPaths,
      ]
      for (const valuableFilePath of valuableFilesPaths) {
        await googleDrive.uploadFile({
          config,
          filePath: valuableFilePath,
          dirId: googleDriveDirId,
        })
      }
      if (isStepActual('youtube')) {
        const youtubeResult = await youtube.uploadFile({
          config,
          title: meta.title || `Untitled ${new Date().toISOString()}`,
          filePath: applyAllAudiosToVideoResult.outputVideoPath,
          verbose,
        })
      }
      break
    }

    case 'bam': {
      const filePathRaw = args[0]
      const parsedFilePath = parseFileName(filePathRaw)
      if (parsedFilePath.ext !== 'mp4') {
        log.red('File is not mp4')
        break
      }
      const srcLangRaw = parsedFilePath.langSingle
      const srcSrtFilePath = path.resolve(parsedFilePath.dirname, `${parsedFilePath.name}.${srcLangRaw}.srt`)
      const srcAudioFilePath = path.resolve(parsedFilePath.dirname, `${parsedFilePath.name}.${srcLangRaw}.mp3`)
      const { filePath, srcLang, distLangs, skipSrcCommands } = z
        .object({
          skipSrcCommands: z.boolean().default(false),
          filePath: z.string().min(1),
          distLangs: z.array(zLangProcessed).min(1),
          srcLang: zLangProcessed,
        })
        .parse({
          skipSrcCommands: getFlagAsBoolean({
            flags,
            keys: ['skip-src-commands', 's'],
            coalesce: false,
          }),
          filePath: filePathRaw,
          distLangs: args[1]?.split(',') || [],
          srcLang: srcLangRaw,
        })

      let lastCommandIndex = -1
      const commands = skipSrcCommands
        ? []
        : [
            // snt ea zxc.ru.mp4 -l ru
            `snt ea ${parsedFilePath.basename} -l ${srcLang}`,
            // snt esr zxc.ru.mp3 -l ru
            `snt esr ${parsedFilePath.name}.${srcLang}.mp3 -l ${srcLang}`,
          ]
      for (const distLang of distLangs) {
        // snt ts zxc.ru.srt --dl en
        commands.push(`snt ts ${parsedFilePath.name}.${srcLang}.srt --dl ${distLang}`)
        // snt tts -s zxc.en.srt -l en -a zxc.ru.mp3
        commands.push(
          `snt tts -s ${parsedFilePath.name}.${distLang}.srt -l ${distLang} -a ${parsedFilePath.name}.${srcLang}.mp3`
        )
        // snt aa zxc.ru.mp4 -l en
        commands.push(`snt aa ${parsedFilePath.basename} -l ${distLang}`)
      }
      commands.push(`snt aa ${parsedFilePath.basename} -l ${[srcLang, ...distLangs].join(',')}`)
      log.green('Commands:', ...commands)
      try {
        if (!skipSrcCommands) {
          lastCommandIndex++
          const { audioFilePath: srcAudioFilePath } = await extractAudio({
            config,
            filePath: args[0],
            lang: srcLang,
            verbose,
            force,
          })
          lastCommandIndex++
          const { srtFilePath: srcSrtFilePath } = await extractSrtByRevai({
            config,
            lang: srcLang,
            verbose,
            filePath: srcAudioFilePath,
            translatedLangs: [],
            force,
          })
        }
        for (const distLang of distLangs) {
          lastCommandIndex++
          const { distSrtPath } = await translateSrtByOpenai({
            config,
            srcSrtPath: srcSrtFilePath,
            srcLang,
            distLang,
            verbose,
            force,
          })
          lastCommandIndex++
          const { audioFilePath: dubbedAudioFilePath } = await ttsByAzureai({
            force,
            config,
            lang: distLang,
            verbose,
            srcAudioPath: srcAudioFilePath,
            srtPath: distSrtPath,
          })
          lastCommandIndex++
          await applyAudiosToVideo({ inputVideoPath: filePath, config, langs: [distLang] })
        }
        await applyAudiosToVideo({ inputVideoPath: filePath, config, langs: [srcLang, ...distLangs] })
        log.green('Success')
      } catch (error: any) {
        // eslint-disable-next-line no-console
        console.error(error)
        log.red('Error on command:', commands[lastCommandIndex])
        const nextCommads = commands.slice(lastCommandIndex)
        log.red('You should run commands:', ...nextCommads)
      }
      break
    }

    case 'bamb': {
      const filePathRaw = args[0]
      const parsedFilePath = parseFileName(filePathRaw)
      if (parsedFilePath.ext !== 'mp4') {
        log.red('File is not mp4')
        break
      }
      const srcLangRaw = parsedFilePath.langSingle
      const srcSrtFilePath = path.resolve(parsedFilePath.dirname, `${parsedFilePath.name}.${srcLangRaw}.srt`)
      const srcAudioFilePath = path.resolve(parsedFilePath.dirname, `${parsedFilePath.name}.${srcLangRaw}.mp3`)
      const srcBackgroundAudioFilePath = path.resolve(parsedFilePath.dirname, `${parsedFilePath.name}.background.mp3`)
      const { filePath, srcLang, distLangs, skipSrcCommands } = z
        .object({
          skipSrcCommands: z.boolean().default(false),
          filePath: z.string().min(1),
          distLangs: z.array(zLangProcessed).min(1),
          srcLang: zLangProcessed,
        })
        .parse({
          skipSrcCommands: getFlagAsBoolean({
            flags,
            keys: ['skip-src-commands', 's'],
            coalesce: false,
          }),
          filePath: filePathRaw,
          distLangs: args[1]?.split(',') || [],
          srcLang: srcLangRaw,
        })

      let lastCommandIndex = -1
      const commands = skipSrcCommands
        ? []
        : [
            // snt ea zxc.ru.mp4 -l ru
            `snt ea ${parsedFilePath.basename} -l ${srcLang}`,
            // snt esr zxc.ru.mp3 -l ru
            `snt esr ${parsedFilePath.name}.${srcLang}.mp3 -l ${srcLang}`,
            // eab zxc.ru.mp3 zxc.background.mp3
            `eab ${parsedFilePath.name}.${srcLang}.mp3 ${parsedFilePath.name}.background.mp3`,
          ]
      for (const distLang of distLangs) {
        // snt ts zxc.ru.srt --dl en
        commands.push(`snt ts ${parsedFilePath.name}.${srcLang}.srt --dl ${distLang}`)
        // snt tts -s zxc.en.srt -l en -a zxc.ru.mp3
        commands.push(
          `snt tts -s ${parsedFilePath.name}.${distLang}.srt -l ${distLang} -a ${parsedFilePath.name}.${srcLang}.mp3`
        )
        // mv zxc.en.mp3 zxc.en.speach.mp3
        commands.push(`mv ${parsedFilePath.name}.${distLang}.mp3 ${parsedFilePath.name}.${distLang}.speach.mp3`)
        // ca zxc.background.mp3 zxc.en.speach.mp3 zxc.en.mp3
        commands.push(
          `ca ${parsedFilePath.name}.background.mp3 ${parsedFilePath.name}.${distLang}.speach.mp3 ${parsedFilePath.name}.${distLang}.mp3`
        )
        // snt aa zxc.ru.mp4 -l en
        commands.push(`snt aa ${parsedFilePath.basename} -l ${distLang}`)
      }
      commands.push(`snt aa ${parsedFilePath.basename} -l ${[srcLang, ...distLangs].join(',')}`)
      log.green('Commands:', ...commands)
      try {
        if (!skipSrcCommands) {
          lastCommandIndex++
          const { audioFilePath: srcAudioFilePath } = await extractAudio({
            config,
            filePath: args[0],
            lang: srcLang,
            verbose,
            force,
          })
          lastCommandIndex++
          const { srtFilePath: srcSrtFilePath } = await extractSrtByRevai({
            config,
            lang: srcLang,
            verbose,
            filePath: srcAudioFilePath,
            translatedLangs: [],
            force,
          })
          lastCommandIndex++
          await extractAudioBackground({
            inputAudioPath: srcAudioFilePath,
            outputAudioPath: srcBackgroundAudioFilePath,
          })
        }
        for (const distLang of distLangs) {
          lastCommandIndex++
          const { distSrtPath } = await translateSrtByOpenai({
            config,
            srcSrtPath: srcSrtFilePath,
            srcLang,
            distLang,
            verbose,
            force,
          })
          lastCommandIndex++
          const { audioFilePath: dubbedAudioFilePath } = await ttsByAzureai({
            force,
            config,
            lang: distLang,
            verbose,
            srcAudioPath: srcAudioFilePath,
            srtPath: distSrtPath,
          })
          lastCommandIndex++
          await spawn({
            command: `mv "${dubbedAudioFilePath}" "${parsedFilePath.name}.${distLang}.speach.mp3"`,
            cwd: parsedFilePath.dirname,
            verbose,
          })
          lastCommandIndex++
          await combineTwoAudios({
            audioPath1: srcBackgroundAudioFilePath,
            audioPath2: `${parsedFilePath.name}.${distLang}.speach.mp3`,
            outputAudioPath: `${parsedFilePath.name}.${distLang}.mp3`,
          })
          lastCommandIndex++
          await applyAudiosToVideo({ inputVideoPath: filePath, config, langs: [distLang] })
        }
        await applyAudiosToVideo({ inputVideoPath: filePath, config, langs: [srcLang, ...distLangs] })
        log.green('Success')
      } catch (error: any) {
        // eslint-disable-next-line no-console
        console.error(error)
        log.red('Error on command:', commands[lastCommandIndex])
        const nextCommads = commands.slice(lastCommandIndex)
        log.red('You should run commands:', ...nextCommads)
      }
      break
    }

    case 'story-text-pictures':
    case 'stp': {
      const {
        characterFilePath,
        worldFilePath,
        storyTemplateFilePath,
        itemsFilePath,
        pickIndex,
        storyFilePath,
        picturesTextFilePath,
        introFilePath,
        cont,
      } = z
        .object({
          characterFilePath: z.string().optional(),
          worldFilePath: z.string().optional(),
          storyTemplateFilePath: z.string().min(1),
          itemsFilePath: z.string().optional(),
          pickIndex: z.string().optional(),
          storyFilePath: z.string().min(1),
          picturesTextFilePath: z.string().min(1),
          introFilePath: z.string().min(1),
          cont: z.boolean().optional(),
        })
        .parse({
          characterFilePath: getFlagAsString({
            flags,
            keys: ['character', 'c'],
            coalesce: undefined,
          }),
          worldFilePath: getFlagAsString({
            flags,
            keys: ['world', 'w'],
            coalesce: undefined,
          }),
          storyTemplateFilePath: getFlagAsString({
            flags,
            keys: ['story-template', 't'],
            coalesce: undefined,
          }),
          itemsFilePath: getFlagAsString({
            flags,
            keys: ['items', 'i'],
            coalesce: undefined,
          }),
          pickIndex: getFlagAsString({
            flags,
            keys: ['pick-index', 'k'],
            coalesce: undefined,
          }),
          storyFilePath: getFlagAsString({
            flags,
            keys: ['story', 's'],
            coalesce: undefined,
          }),
          picturesTextFilePath: getFlagAsString({
            flags,
            keys: ['pictures', 'p'],
            coalesce: undefined,
          }),
          introFilePath: getFlagAsString({
            flags,
            keys: ['intro', 'r'],
            coalesce: undefined,
          }),
          cont: getFlagAsBoolean({
            flags,
            keys: ['cont'],
            coalesce: false,
          }),
        })
      const result = await generateStoryAndIntroAndPicturesTexts({
        config,
        characterFilePath,
        worldFilePath,
        storyTemplateFilePath,
        itemsFilePath,
        pickIndex: pickIndex ? [parseInt(pickIndex.replaceAll(/\D/g, ''), 10)] : undefined,
        storyFilePath,
        picturesTextFilePath,
        introFilePath,
        cont,
        verbose,
        force,
      })
      log.green(result)
      break
    }

    case 'story-pictures':
    case 'sp': {
      const { picturesTextFilePath, pictureTemplateFilePath, picturesDirPath, introFilePath, cont } = z
        .object({
          picturesTextFilePath: z.string().min(1),
          pictureTemplateFilePath: z.string().min(1),
          picturesDirPath: z.string().min(1),
          introFilePath: z.string().min(1),
          cont: z.boolean().optional(),
        })
        .parse({
          picturesTextFilePath: getFlagAsString({
            flags,
            keys: ['pictures-text', 'p'],
            coalesce: undefined,
          }),
          pictureTemplateFilePath: getFlagAsString({
            flags,
            keys: ['picture-template', 't'],
            coalesce: undefined,
          }),
          picturesDirPath: getFlagAsString({
            flags,
            keys: ['output', 'o'],
            coalesce: undefined,
          }),
          introFilePath: getFlagAsString({
            flags,
            keys: ['intro', 'r'],
            coalesce: undefined,
          }),
          cont: getFlagAsBoolean({
            flags,
            keys: ['cont'],
            coalesce: false,
          }),
        })
      const result = await generateStoryPictures({
        config,
        picturesTextFilePath,
        introFilePath,
        pictureTemplateFilePath,
        picturesDirPath,
        cont,
        verbose,
        force,
      })
      log.green(result)
      break
    }

    case 'story-thumb':
    case 'sth': {
      const { storyFilePath, count, cont } = z
        .object({
          storyFilePath: z.string().min(1),
          count: z.string().transform((v) => parseInt(v, 10)),
          cont: z.boolean().optional(),
        })
        .parse({
          storyFilePath: getFlagAsString({
            flags,
            keys: ['story', 's'],
            coalesce: undefined,
          }),
          count: getFlagAsString({
            flags,
            keys: ['count', 'c'],
            coalesce: '3',
          }),
          cont: getFlagAsBoolean({
            flags,
            keys: ['cont'],
            coalesce: false,
          }),
        })
      const result = await generateManyThumbnails({
        config,
        storyFilePath,
        count,
        cont,
        verbose,
        force,
      })
      log.green(result)
      break
    }

    case 'story-audio-parts':
    case 'sap': {
      const { storyFilePath, audioPartsDirPath, lang, cont } = z
        .object({
          lang: zLangProcessed,
          storyFilePath: z.string().min(1),
          audioPartsDirPath: z.string().min(1),
          cont: z.boolean().optional(),
        })
        .parse({
          lang: getFlagAsString({
            flags,
            keys: ['lang', 'l'],
            coalesce: undefined,
          }),
          storyFilePath: getFlagAsString({
            flags,
            keys: ['story', 's'],
            coalesce: undefined,
          }),
          audioPartsDirPath: getFlagAsString({
            flags,
            keys: ['output', 'o'],
            coalesce: undefined,
          }),
          cont: getFlagAsBoolean({
            flags,
            keys: ['cont'],
            coalesce: false,
          }),
        })
      const result = await generateStoryAudioParts({
        config,
        storyFilePath,
        audioPartsDirPath,
        lang,
        cont,
        verbose,
        force,
      })
      log.green(result)
      break
    }

    case 'story-audio-full':
    case 'saf': {
      const { audioFilePath, audioPartsDirPath } = z
        .object({
          audioFilePath: z.string().min(1),
          audioPartsDirPath: z.string().min(1),
          cont: z.boolean().optional(),
        })
        .parse({
          audioFilePath: getFlagAsString({
            flags,
            keys: ['output', 'o'],
            coalesce: undefined,
          }),
          audioPartsDirPath: getFlagAsString({
            flags,
            keys: ['audios-parts-dir', 'd'],
            coalesce: undefined,
          }),
        })
      const result = await generateStoryAudio({
        config,
        audioFilePath,
        audioPartsDirPath,
        verbose,
        force,
      })
      log.green(result)
      break
    }

    case 'story-pictures-video':
    case 'spv': {
      const { videoFilePath, picturesDirPath, audioPartsDirPath, cont } = z
        .object({
          videoFilePath: z.string().min(1),
          picturesDirPath: z.string().min(1),
          audioPartsDirPath: z.string().min(1),
          cont: z.boolean().optional(),
        })
        .parse({
          videoFilePath: getFlagAsString({
            flags,
            keys: ['output', 'o'],
            coalesce: undefined,
          }),
          picturesDirPath: getFlagAsString({
            flags,
            keys: ['pictures-dir', 'p'],
            coalesce: undefined,
          }),
          audioPartsDirPath: getFlagAsString({
            flags,
            keys: ['audios-parts-dir', 'a'],
            coalesce: undefined,
          }),
          cont: getFlagAsBoolean({
            flags,
            keys: ['cont'],
            coalesce: false,
          }),
        })
      const result = await generateStoryVideoByPictures({
        config,
        videoFilePath,
        picturesDirPath,
        audioPartsDirPath,
        cont,
        verbose,
        force,
      })
      log.green(result)
      break
    }

    case 'story-ass-video':
    case 'sav': {
      const { inputVideoPath, outputVideoPath, audioPartsDirPath } = z
        .object({
          inputVideoPath: z.string().min(1),
          outputVideoPath: z.string().min(1),
          audioPartsDirPath: z.string().min(1),
          cont: z.boolean().optional(),
        })
        .parse({
          inputVideoPath: getFlagAsString({
            flags,
            keys: ['input', 'i'],
            coalesce: undefined,
          }),
          outputVideoPath: getFlagAsString({
            flags,
            keys: ['output', 'o'],
            coalesce: undefined,
          }),
          audioPartsDirPath: getFlagAsString({
            flags,
            keys: ['audios-parts-dir', 'a'],
            coalesce: undefined,
          }),
        })
      const result = await applyAssSubtitlesToStoryVideo({
        config,
        audioPartsDirPath,
        inputVideoPath,
        outputVideoPath,
        verbose,
        force,
      })
      log.green(result)
      break
    }

    case 'story-title':
    case 'st': {
      const { storyFilePath, titleFilePath } = z
        .object({
          storyFilePath: z.string().min(1),
          titleFilePath: z.string().min(1),
        })
        .parse({
          titleFilePath: getFlagAsString({
            flags,
            keys: ['output', 'o'],
            coalesce: undefined,
          }),
          storyFilePath: getFlagAsString({
            flags,
            keys: ['story', 's'],
            coalesce: undefined,
          }),
        })
      const result = await generateStoryTitle({
        config,
        storyFilePath,
        titleFilePath,
        verbose,
        force,
      })
      log.green(result)
      break
    }

    case 'story-description':
    case 'sd': {
      const { storyFilePath, descriptionFilePath } = z
        .object({
          storyFilePath: z.string().min(1),
          descriptionFilePath: z.string().min(1),
        })
        .parse({
          descriptionFilePath: getFlagAsString({
            flags,
            keys: ['output', 'o'],
            coalesce: undefined,
          }),
          storyFilePath: getFlagAsString({
            flags,
            keys: ['story', 's'],
            coalesce: undefined,
          }),
        })
      const result = await generateStoryDescription({
        config,
        storyFilePath,
        descriptionFilePath,
        verbose,
        force,
      })
      log.green(result)
      break
    }

    case 'story-youtube-upload':
    case 'syu': {
      const { storyTitleFilePath, storyDescriptionFilePath, videoFilePath, playlistId, privacyStatus } = z
        .object({
          videoFilePath: z.string().min(1),
          storyTitleFilePath: z.string().min(1),
          storyDescriptionFilePath: z.string().min(1),
          playlistId: z.string().optional(),
          privacyStatus: z.enum(['private', 'public', 'unlisted']),
        })
        .parse({
          videoFilePath: getFlagAsString({
            flags,
            keys: ['video', 'v'],
            coalesce: undefined,
          }),
          storyTitleFilePath: getFlagAsString({
            flags,
            keys: ['title', 't'],
            coalesce: undefined,
          }),
          storyDescriptionFilePath: getFlagAsString({
            flags,
            keys: ['description', 'd'],
            coalesce: undefined,
          }),
          playlistId: getFlagAsString({
            flags,
            keys: ['playlist', 'p'],
            coalesce: undefined,
          }),
          privacyStatus: getFlagAsString({
            flags,
            keys: ['privacy-status'],
            coalesce: 'public',
          }),
        })
      const result = await uploadStoryToYoutube({
        config,
        storyDescriptionFilePath,
        storyTitleFilePath,
        videoFilePath,
        playlistId,
        privacyStatus,
        verbose,
        force,
      })
      log.green(result)
      break
    }

    case 'booh': {
      const { pickIndexAsEpisodeNumber, noItems, privacyStatus } = z
        .object({
          pickIndexAsEpisodeNumber: z.boolean(),
          noItems: z.boolean(),
          privacyStatus: z.enum(['private', 'public', 'unlisted']),
        })
        .parse({
          pickIndexAsEpisodeNumber: getFlagAsBoolean({
            flags,
            keys: ['pick-index-as-episode-number', 'k'],
            coalesce: false,
          }),
          noItems: getFlagAsBoolean({
            flags,
            keys: ['no-items', 'n'],
            coalesce: false,
          }),
          privacyStatus: getFlagAsString({
            flags,
            keys: ['privacy-status'],
            coalesce: 'public',
          }),
        })
      const srcLang = 'en'
      const contentDir = config.contentDir
      const episodesDir = path.resolve(contentDir, 'episodes')
      const { nextEpisodeNumber } = await getNextEpisodeNumber({ config, episodesDir })
      const episodeNumber = nextEpisodeNumber
      const episodeDir = path.resolve(episodesDir, `${episodeNumber}`)
      const generalDir = path.resolve(contentDir, 'general')

      const storyFilePath = path.resolve(episodeDir, 'story.txt')
      const introFilePath = path.resolve(episodeDir, 'intro.txt')
      const picturesTextFilePath = path.resolve(episodeDir, 'pictures.txt')
      const titleFilePath = path.resolve(episodeDir, 'title.txt')
      const descriptionFilePath = path.resolve(episodeDir, 'description.txt')
      const picturesDirPath = path.resolve(episodeDir, 'pictures')
      const audioPartsDirPath = path.resolve(episodeDir, 'audio-parts')
      const audioFilePath = path.resolve(episodeDir, `story.en.mp3`)
      const videoNoassSilentFilePath = path.resolve(episodeDir, `story.noass.mp4`)
      const videoSilentFilePath = path.resolve(episodeDir, `story.mp4`)
      const videoFilePath = path.resolve(episodeDir, `story.en.mp4`)
      const storyTemplateFilePath = path.resolve(generalDir, 'storyTemplate.txt')
      const itemsFilePath = path.resolve(generalDir, 'items.json')
      const pictureTemplateFilePath = path.resolve(generalDir, 'pictureTemplate.txt')

      const shrt = (fullFilePath: string) => fullFilePath.replace(contentDir + '/', '')
      const storyFilePathShrt = shrt(storyFilePath)
      const introFilePathShrt = shrt(introFilePath)
      const picturesTextFilePathShrt = shrt(picturesTextFilePath)
      const titleFilePathShrt = shrt(titleFilePath)
      const descriptionFilePathShrt = shrt(descriptionFilePath)
      const picturesDirPathShrt = shrt(picturesDirPath)
      const audioPartsDirPathShrt = shrt(audioPartsDirPath)
      const audioFilePathShrt = shrt(audioFilePath)
      const videoNoassSilentFilePathShrt = shrt(videoNoassSilentFilePath)
      const videoSilentFilePathShrt = shrt(videoSilentFilePath)
      const videoFilePathShrt = shrt(videoFilePath)
      const storyTemplateFilePathShrt = shrt(storyTemplateFilePath)
      const itemsFilePathShrt = shrt(itemsFilePath)
      const pictureTemplateFilePathShrt = shrt(pictureTemplateFilePath)

      // COMMANDS:
      //    if pickIndexAsEpisodeNumber
      // snt stp -i general/items.json -k episodes/2 -t general/storyTemplate.txt -s episodes/2/story.txt -p episodes/2/pictures.txt && \
      //    else if noItems
      // snt stp -t general/storyTemplate.txt -s episodes/2/story.txt -p episodes/2/pictures.txt && \
      //    else
      // snt stp -i general/items.json -t general/storyTemplate.txt -s episodes/2/story.txt -p episodes/2/pictures.txt && \
      //    fi
      // snt st -s episodes/2/story.txt -o episodes/2/title.txt && \
      // snt sd -s episodes/2/story.txt -o episodes/2/description.txt && \
      // snt sp -p episodes/2/pictures.txt -t general/pictureTemplate.txt -o episodes/2/pictures --cont && \
      // snt sap -l en -s episodes/2/story.txt -o episodes/2/audio-parts --cont && \
      // snt saf -d episodes/2/audio-parts -o episodes/2/story.en.mp3 && \
      // snt spv -p episodes/2/pictures -a episodes/2/audio-parts -o episodes/2/story.noass.mp4 --cont && \
      // snt sav -i episodes/2/story.noass.mp4 -o episodes/0/story.mp4 -a episodes/2/audio-parts && \
      // snt aa episodes/2/story.mp4 -l en && \
      // snt syu -v episodes/2/story.en.mp4 -t episodes/2/title.txt -d episodes/2/description.txt
      let lastCommandIndex = -1
      const commands = [
        pickIndexAsEpisodeNumber
          ? `snt stp -r ${introFilePathShrt} -i ${itemsFilePathShrt} -k episodes/${episodeNumber} -t ${storyTemplateFilePathShrt} -s ${storyFilePathShrt} -p ${picturesTextFilePathShrt} && \\`
          : noItems
            ? `snt stp -r ${introFilePathShrt} -t ${storyTemplateFilePathShrt} -s ${storyFilePathShrt} -p ${picturesTextFilePathShrt} && \\`
            : `snt stp -r ${introFilePathShrt} -i ${itemsFilePathShrt} -t ${storyTemplateFilePathShrt} -s ${storyFilePathShrt} -p ${picturesTextFilePathShrt} && \\`,
        `snt st -s ${storyFilePathShrt} -o ${titleFilePathShrt} && \\`,
        `snt sd -s ${storyFilePathShrt} -o ${descriptionFilePathShrt} && \\`,
        `snt sp -r ${introFilePathShrt} -p ${picturesTextFilePathShrt} -t ${pictureTemplateFilePathShrt} -o ${picturesDirPathShrt} --cont && \\`,
        `snt sap -l ${srcLang} -s ${storyFilePathShrt} -o ${audioPartsDirPathShrt} --cont && \\`,
        `snt saf -d ${audioPartsDirPathShrt} -o ${audioFilePathShrt} && \\`,
        `snt spv -p ${picturesDirPathShrt} -a ${audioPartsDirPathShrt} -o ${videoNoassSilentFilePathShrt} --cont && \\`,
        `snt sav -i ${videoNoassSilentFilePathShrt} -o ${videoSilentFilePathShrt} -a ${audioPartsDirPathShrt} && \\`,
        `snt aa ${videoSilentFilePathShrt} -l ${srcLang} && \\`,
        `snt syu -v ${videoFilePathShrt} -t ${titleFilePathShrt} -d ${descriptionFilePathShrt}`,
      ]

      log.green('Commands:', ...commands)

      try {
        // Step 1
        lastCommandIndex++
        if (pickIndexAsEpisodeNumber) {
          // snt stp -r episodes/2/intro.txt -i general/items.json -k episodes/2 -t general/storyTemplate.txt -s episodes/2/story.txt -p episodes/2/pictures.txt
          await generateStoryAndIntroAndPicturesTexts({
            config,
            itemsFilePath,
            introFilePath,
            pickIndex: [episodeNumber],
            storyTemplateFilePath,
            storyFilePath,
            picturesTextFilePath,
            verbose,
            force,
          })
        } else if (noItems) {
          await generateStoryAndIntroAndPicturesTexts({
            config,
            introFilePath,
            storyTemplateFilePath,
            storyFilePath,
            picturesTextFilePath,
            verbose,
            force,
          })
        } else {
          // snt stp -r episodes/2/intro.txt -i general/items.json -t general/storyTemplate.txt -s episodes/2/story.txt -p episodes/2/pictures.txt && \
          await generateStoryAndIntroAndPicturesTexts({
            config,
            introFilePath,
            itemsFilePath,
            storyTemplateFilePath,
            storyFilePath,
            picturesTextFilePath,
            verbose,
            force,
          })
        }

        // Step 2
        // snt st -s episodes/2/story.txt -o episodes/2/title.txt
        lastCommandIndex++
        await generateStoryTitle({
          config,
          storyFilePath,
          titleFilePath,
          verbose,
          force,
        })

        // Step 3
        // snt sd -s episodes/2/story.txt -o episodes/2/description.txt && \
        lastCommandIndex++
        await generateStoryDescription({
          config,
          storyFilePath,
          descriptionFilePath,
          verbose,
          force,
        })

        // Step 4
        // snt sp -r episodes/2/intro.txt -p episodes/2/pictures.txt -t general/pictureTemplate.txt -o episodes/2/pictures --cont
        lastCommandIndex++
        await generateStoryPictures({
          config,
          introFilePath,
          picturesTextFilePath,
          pictureTemplateFilePath,
          picturesDirPath,
          cont: true,
          verbose,
          force,
        })

        // Step 5
        // snt sap -l en -s episodes/2/story.txt -o episodes/2/audio-parts --cont
        lastCommandIndex++
        await generateStoryAudioParts({
          config,
          storyFilePath,
          audioPartsDirPath,
          lang: srcLang,
          cont: true,
          verbose,
          force,
        })

        // Step 6
        // snt saf -d episodes/2/audio-parts -o episodes/2/story.en.mp3
        lastCommandIndex++
        await generateStoryAudio({
          config,
          audioFilePath,
          audioPartsDirPath,
          verbose,
          force,
        })

        // Step 7
        // snt spv -p episodes/2/pictures -a episodes/2/audio-parts -o episodes/2/story.mp4
        lastCommandIndex++
        await generateStoryVideoByPictures({
          config,
          videoFilePath: videoNoassSilentFilePath,
          picturesDirPath,
          audioPartsDirPath,
          verbose,
          cont: true,
          force,
        })

        // Step 7,5
        // snt sav -i episodes/2/story.noass.mp4 -o episodes/0/story.mp4 -a episodes/2/audio-parts
        lastCommandIndex++
        await applyAssSubtitlesToStoryVideo({
          config,
          inputVideoPath: videoNoassSilentFilePath,
          outputVideoPath: videoSilentFilePath,
          audioPartsDirPath,
          verbose,
          force,
        })

        // Step 8
        // snt aa episodes/2/story.mp4 -l en
        lastCommandIndex++
        await applyAudiosToVideo({
          inputVideoPath: videoSilentFilePath,
          config,
          langs: [srcLang],
          verbose,
        })

        // Step 9
        // snt syu -v episodes/2/story.en.mp4 -t episodes/2/title.txt -d episodes/2/description.txt
        lastCommandIndex++
        await uploadStoryToYoutube({
          config,
          storyTitleFilePath: titleFilePath,
          storyDescriptionFilePath: descriptionFilePath,
          videoFilePath,
          verbose,
          privacyStatus,
          force,
        })

        log.green('Success')
      } catch (error: any) {
        // eslint-disable-next-line no-console
        console.error(error)
        log.red('Error on command:', commands[lastCommandIndex])
        const nextCommads = commands.slice(lastCommandIndex)
        log.red('You should run commands:', ...nextCommads)
      }

      // log.green(result)
      break
    }

    case 'clear': {
      const dirPath = args[0] || config.contentDir
      const result = await removeVideosAndAudios({ dirPath })
      log.green(result)
      break
    }
    case 'h': {
      log.black(dedent`Commands:
        c | config

        cut | cut-video <inputVideoPath> <outputVideoPath> <start> <end>

        ga | google-auth
        dg | download-from-google-drive ?--file-id(-i) <fileId> ?--file-path(-p) <filePath> ?--file-url(-u) <fileUrl>
        dgs | download-from-google-drive-by-search <search> --dir <dirId> 
        ug | upload-to-google-drive --dir <dirId> <files>
        sg | search-google-drive <search> --dir <dirId>

        uk | upload-to-kinescope <filePath> --parent <parentId> --video <videoId>
        lkp | list-kinescope-projects

        ea | extract-audio <filePath> --lang <lang>
        eab | extract-audio-background <inputFilePath> <outputFilePath>
        cwm | convert-wav-to-mp3 <inputWavPath> <outputMp3Path>
        aa | apply-audios <inputVideoPath> --langs <langs>

        elcd | elevenlabs-create-dubbing <filePath> --src-lang <srcLang> --dist-lang <distLang>
        elcdu | elevenlabs-create-dubbing-by-url <url> --src-lang <srcLang> --dist-lang <distLang> --file <filePath>
        elcdb | elevenlabs-create-dubbing-with-browser <filePath> --src-lang <srcLang> --dist-lang <distLang>
        elgd | elevenlabs-get-dubbing <dubbingId>
        eldd | elevenlabs-download-dubbing --dubbing <dubbingId> --file <filePath> --lang <lang>
        eda | elevenlabs-dub-audio <srcFilePath> --src-lang <srcLang> --dist-lang <distLang> --dist-file-path <distFilePath>

        rcd | rask-create-dubbing <filePath> --src-lang <srcLang> --dist-lang <distLang>
        rgds | rask-get-dubbing-status <dubbingId>
        rsd | rask-start-dubbing <dubbingId>
        rdd | rask-download-dubbing --project <projectId> --file <filePath>
        rda | rask-dub-audio <srcFilePath> --src-lang <srcLang> --dist-lang <distLang> --dist-file-path <distFilePath>

        ld | loom-download <loomPublicUrl> <?filePath>

        acp | auphonic-create-project --preset <presetId> <filePath>
        agp | auphonic-get-project <projectId>
        adp | auphonic-download-project --project <projectId> --file <filePath>
        apa | auphonic-process-audio --dist-file-path <distFilePath> <srcFilePath>

        uy | upload-to-youtube --title <title> <filePath>
        dy | download-from-youtube -u <url> -f <filePath>

        boom <loomPublicUrl> --src-lang <srcLang> --dist-langs <distLangs> (overhead)
        bam <filePath> <distLangs> (just dub)

        st | story-text --character(c) --world(w) --story-template(t) --output(o)
        si | story-images --story(s)

        esr | extract-srt-revai <filePath> --lang <lang> --translated-langs <translatedLangs>
        (deprecated) esa | extract-srt-azureai <filePath> --lang <lang>
        tts <srtPath> --lang <lang> --src-audio <srcAudioPath>

        clear <dirPath>
        h — help
        `)
      break
    }
    default: {
      log.red('Unknown command:', command)
      break
    }
  }

  const finishedAt = new Date()
  const executionDurationMs = finishedAt.getTime() - startedAt.getTime()
  const executionDurationSeconds = executionDurationMs / 1_000
  const executionDurationMinutes = executionDurationSeconds / 60
  const fullCommandString = [command, ...argr].join(' ')
  await getVoicesElevenlabs()
  log.normal(
    `Execution duration`,
    fullCommandString,
    `${executionDurationMs}ms`,
    `${executionDurationSeconds}s`,
    `${executionDurationMinutes}m`
  )
})
