import 'source-map-support/register'

import { getConfig } from '@/lib/config'
import { validateEnv } from '@/lib/env'
import { googleDrive } from '@/lib/googledrive'
import dedent from 'dedent'
import { defineCliApp, getFlagAsBoolean, getFlagAsString, log } from 'svag-cli-utils'
import { applyAudiosToVideo, extractAudio } from '@/lib/editor'
import { zLang, zLangProcessed } from '@/lib/utils'
import { parseFileName } from '@/lib/meta'
import { elevenlabs } from '@/lib/elevenlabs'
import z from 'zod'
import { kinescope } from '@/lib/kinescope'

// TODO: delete all files locally except jsons
// TODO: playground code implementation for sgrd course

// TODO: get file names of all course

// TODO: translate first 3 videos

// TODO: dub audio by elevenlabs
// TODO: translate again and again

// TODO: download video from loom
// TODO: extract first audio from video by ffmpeg
// TODO: auphonic audio
// TODO: replace audio in video by ffmpeg
// TODO: meta auphonic, loom, youtube
// TODO: upload file to youtube
// TODO: add one audio to video by ffmpeg

// eslint-disable-next-line @typescript-eslint/no-unused-vars
defineCliApp(async ({ cwd, command, args, argr, flags }) => {
  validateEnv()
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
    case 'dub-audio':
    case 'da': {
      const srcFilePath = args[0]
      const parsed = parseFileName(srcFilePath)
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
      if (parsed.ext !== 'mp3') {
        log.red('File is not mp3')
        break
      }
      const { srcLang, distLang } = z
        .object({
          srcLang: zLangProcessed,
          distLang: zLangProcessed,
        })
        .parse({
          srcLang: srcLangRaw || parsed.langSingle,
          distLang: distLangRaw,
        })
      await elevenlabs.createDubbing({
        distLang,
        srcLang,
        filePath: srcFilePath,
        config,
      })
      // TODO:ASAP
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

      applyAudiosToVideo({ inputVideoPath, config, langs })
      break
    }
    case 'x': {
      const dirId = args[1] || config.googleDriveDirId
      if (!dirId) {
        log.red('dirId not provided')
        break
      }
      await googleDrive.getAllFilesInDir({ config, dirId })
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
        elcd | elevenlabs-create-dubbing --src-lang <srcLang> --dist-lang <distLang> <filePath>
        elcdu | elevenlabs-create-dubbing-by-url --src-lang <srcLang> --dist-lang <distLang> --file <filePath> <url>
        elcdb | elevenlabs-create-dubbing-with-browser --src-lang <srcLang> --dist-lang <distLang> <filePath>
        elgd | elevenlabs-get-dubbing <dubbingId>
        eldd | elevenlabs-download-dubbing --dubbing <dubbingId> --file <filePath> --lang <lang>
        da | dub-audio --src-lang <srcLang> --dist-lang <distLang> <filePath>
        aa | apply-audios --langs <langs> <inputVideoPath>
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
