/* eslint-disable @typescript-eslint/no-unused-vars */
import 'source-map-support/register'

import { auphonic } from '@/lib/auphonic'
import { getConfig } from '@/lib/config'
import { applyAudiosToVideo, converWavToMp3, extractAudio } from '@/lib/editor'
import { elevenlabs } from '@/lib/elevenlabs'
import { removeVideosAndAudios } from '@/lib/fs'
import { googleDrive } from '@/lib/googledrive'
import { kinescope } from '@/lib/kinescope'
import { loom } from '@/lib/loom'
import { getMetaByFilePath, parseFileName } from '@/lib/meta'
import { rask } from '@/lib/rask'
import { fromRawLang, LangProcessed, zLang, zLangProcessed } from '@/lib/utils'
import { youtube } from '@/lib/youtube'
import dedent from 'dedent'
import path from 'path'
import { defineCliApp, getFlagAsBoolean, getFlagAsString, log } from 'svag-cli-utils'
import z from 'zod'
import readlineSync from 'readline-sync'

defineCliApp(async ({ cwd, command, args, argr, flags }) => {
  const verbose = getFlagAsBoolean({
    flags,
    keys: ['verbose'],
    coalesce: true,
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
    case 'download-from-google-drive':
    case 'dg': {
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
      const { audioFilePath } = await extractAudio({ config, filePath: args[0], lang })
      log.green(audioFilePath)
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

      const result = applyAudiosToVideo({ inputVideoPath, config, langs })
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
      const filePathRaw = args[0]
      const titleRaw = getFlagAsString({
        flags,
        keys: ['title', 't'],
        coalesce: undefined,
      })
      const { title, filePath } = z
        .object({
          title: z.string().optional(),
          filePath: z.string(),
        })
        .parse({
          title: titleRaw,
          filePath: filePathRaw,
        })
      const result = await youtube.uploadFile({ config, title, filePath, verbose })
      log.green(result)
      break
    }

    case 'boom': {
      const steps = [
        'loom',
        'extract',
        'auphonic',
        'rask-cp',
        'rask-sd',
        'rask-dd',
        'apply',
        'upload',
        'youtube',
      ] as const
      type Step = (typeof steps)[number]
      const { pause, loomPublicUrl, filePath, srcLang, distLangs, googleDriveDirId, firstStep } = z
        .object({
          pause: z.boolean().optional().nullable(),
          loomPublicUrl: z.string().optional().nullable(),
          filePath: z.string().optional().nullable(),
          srcLang: zLang,
          distLangs: z.array(zLangProcessed),
          googleDriveDirId: z.string(),
          firstStep: z.enum(steps),
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
      const extractResult = await extractAudio({ config, filePath: filePathAbs, lang: srcLang })
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
            const { projectId } = await rask.createProjectWithBrowserByFilePath({
              config,
              filePath: auphonicResult.filePath,
              srcLang: originalLangProcessed,
              distLang,
              verbose,
            })
            await rask.waitWhileProcessingWithBrowser({ projectId, verbose })
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
          await rask.startDubbingWithBrowser({ projectId, verbose })
          await rask.waitWhileProcessingWithBrowser({ projectId, verbose })
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
      const applyAudiosToVideoResult = await applyAudiosToVideo({
        inputVideoPath: filePathAbs,
        config,
        langs: distLangs,
        verbose,
      })
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
          filePath: applyAudiosToVideoResult.outputVideoPath,
          verbose,
        })
      }
      break
    }

    case 'clear': {
      const dirPath = args[0] || config.contentDir
      const result = removeVideosAndAudios({ dirPath })
      log.green(result)
      break
    }
    case 'h': {
      log.black(dedent`Commands:
        dg | download-from-google-drive --dir <dirId> <search>
        ug | upload-to-google-drive --dir <dirId> <files>
        sg | search-google-drive --dir <dirId> <search>

        uk | upload-to-kinescope --parent <parentId> --video <videoId> <filePath>
        lkp | list-kinescope-projects

        ea | extract-audio --lang <lang> <filePath>
        cwm | convert-wav-to-mp3 <inputWavPath> <outputMp3Path>
        aa | apply-audios --langs <langs> <inputVideoPath>

        elcd | elevenlabs-create-dubbing --src-lang <srcLang> --dist-lang <distLang> <filePath>
        elcdu | elevenlabs-create-dubbing-by-url --src-lang <srcLang> --dist-lang <distLang> --file <filePath> <url>
        elcdb | elevenlabs-create-dubbing-with-browser --src-lang <srcLang> --dist-lang <distLang> <filePath>
        elgd | elevenlabs-get-dubbing <dubbingId>
        eldd | elevenlabs-download-dubbing --dubbing <dubbingId> --file <filePath> --lang <lang>
        eda | elevenlabs-dub-audio --src-lang <srcLang> --dist-lang <distLang> --dist-file-path <distFilePath> <srcFilePath>

        rcd | rask-create-dubbing --src-lang <srcLang> --dist-lang <distLang> <filePath>
        rgds | rask-get-dubbing-status <dubbingId>
        rsd | rask-start-dubbing <dubbingId>
        rdd | rask-download-dubbing --project <projectId> --file <filePath>
        rda | rask-dub-audio --src-lang <srcLang> --dist-lang <distLang> --dist-file-path <distFilePath> <srcFilePath>

        ld | loom-download <loomPublicUrl> <filePath>?

        acp | auphonic-create-project --preset <presetId> <filePath>
        agp | auphonic-get-project <projectId>
        adp | auphonic-download-project --project <projectId> --file <filePath>
        apa | auphonic-process-audio --dist-file-path <distFilePath> <srcFilePath>

        uy | upload-to-youtube --title <title> <filePath>

        boom <loomPublicUrl> --src-lang <srcLang> --dist-langs <distLangs>

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
})
