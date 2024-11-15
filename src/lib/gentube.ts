/* eslint-disable @typescript-eslint/no-loop-func */
/* eslint-disable radix */
import type { Config } from '@/exports.js'
import { ttsMegasimpleByAzureai } from '@/lib/azureai.js'
import {
  applyAssSubtitlesToVideo,
  concatAudios,
  concatImagesToVideo,
  concatImagesToVideoWithTransitions,
  getAudioDuration,
} from '@/lib/editor.js'
import { ttsMegasimpleWithTimestampsByElevenlabs } from '@/lib/elevenlabs.general.js'
import { completionByOpenai, imageByOpenai } from '@/lib/openai.js'
import { youtube } from '@/lib/youtube.js'
import { promises as fs } from 'fs'
import Handlebars from 'handlebars'
import _ from 'lodash'
import path from 'path'
import { isDirExists, isFileExists, log } from 'svag-cli-utils'
import z from 'zod'

Handlebars.registerHelper('coalesce', (a, b) => {
  return a ? a : b
})

export const parseCharacterFile = async ({ characterFilePath }: { characterFilePath: string }) => {
  const characterFileContent = await fs.readFile(characterFilePath, 'utf-8')
  return { characterFileContent }
}

export const parseStoryTemplateFile = async ({
  storyTemplateFilePath,
  itemsFilePath,
  pickIndex,
}: {
  storyTemplateFilePath: string
  itemsFilePath?: string
  pickIndex?: number[]
}) => {
  const storyTemplateFileContentRaw = await fs.readFile(storyTemplateFilePath, 'utf-8')
  if (!itemsFilePath) {
    return { storyTemplateFileContent: storyTemplateFileContentRaw }
  } else {
    const itemsData: {
      pickIndex?: number[]
      pickCount?: number
      pickMatch?: Array<Record<string, any>>
      items: Array<Record<string, any>>
    } = JSON.parse(await fs.readFile(itemsFilePath, 'utf-8'))
    const items = (() => {
      const pickIndexHere = pickIndex || itemsData.pickIndex
      if (pickIndexHere) {
        const itemsHere: typeof itemsData.items = pickIndexHere
          .map((index) => {
            return itemsData.items[index]
          })
          .filter(Boolean)
        if (itemsHere.length !== pickIndexHere.length) {
          throw new Error(`Invalid items data: pickIndex not found ${itemsData.pickIndex}`)
        }
        return itemsHere
      } else if (itemsData.pickMatch) {
        const itemsHere: typeof itemsData.items = []
        for (const pickMatchItem of itemsData.pickMatch) {
          const item = itemsData.items.find((item) => {
            return _.matches(pickMatchItem)(item)
          })
          if (!item) {
            throw new Error(`Item not found: ${JSON.stringify(pickMatchItem)}`)
          }
          itemsHere.push(item)
        }
        return itemsHere
      } else if (itemsData.pickCount) {
        return _.sampleSize(itemsData.items, itemsData.pickCount)
      } else {
        throw new Error('Invalid items data: pickCount not found and pickMatch not found')
      }
    })()
    const template = Handlebars.compile(storyTemplateFileContentRaw)
    const storyTemplateFileContent = template({ items })
    if (storyTemplateFileContent.includes('__UNDEFINED__')) {
      throw new Error('Template contains __UNDEFINED__, missing items')
    }
    return { storyTemplateFileContent }
  }
}

export const parseWorldFile = async ({ worldFilePath }: { worldFilePath: string }) => {
  const worldFileContent = await fs.readFile(worldFilePath, 'utf-8')
  return { worldFileContent }
}

export const parsePictureTemplateFile = async ({ pictureTemplateFilePath }: { pictureTemplateFilePath: string }) => {
  const pictureTemplateFileContent = await fs.readFile(pictureTemplateFilePath, 'utf-8')
  return { pictureTemplateFileContent }
}

export const parseStoryFile = async ({ storyFilePath }: { storyFilePath: string }) => {
  const storyFileContent = await fs.readFile(storyFilePath, 'utf-8')
  const storyParagraphs = storyFileContent.split(/\n+/)
  const storyParagraphsCount = storyParagraphs.length
  return { storyFileContent, storyParagraphs, storyParagraphsCount }
}

export const parsePicturesTextFilePath = async ({ picturesTextFilePath }: { picturesTextFilePath: string }) => {
  const picturesTextFileContent = await fs.readFile(picturesTextFilePath, 'utf-8')
  const picturesParagraphs = picturesTextFileContent.split(/\n+/)
  const picturesParagraphsCount = picturesParagraphs.length
  return { picturesTextFileContent, picturesParagraphs, picturesParagraphsCount }
}

export const generateStoryTitle = async ({
  config,
  storyFilePath,
  titleFilePath,
  verbose,
  force,
}: {
  config: Config
  storyFilePath: string
  titleFilePath: string
  verbose?: boolean
  force?: boolean
}) => {
  titleFilePath = path.resolve(config.contentDir, titleFilePath)
  storyFilePath = path.resolve(config.contentDir, storyFilePath)
  const { fileExists: storyFileExists } = await isFileExists({ filePath: storyFilePath })
  if (!storyFileExists) {
    throw new Error(`Story file does not exist: ${storyFilePath}`)
  }
  const { fileExists: titleFileExists } = await isFileExists({ filePath: titleFilePath })
  if (titleFileExists && !force) {
    throw new Error(`Title file already exists: ${titleFilePath}`)
  }
  const { storyFileContent } = await parseStoryFile({ storyFilePath })
  const systemPrompt = `Act as youtube video title generator and generate a title for the story. Reply with a single sentence that would make a compelling title for a video based on the story. User will provide the story text. Title should be short, just from 3 to 8 words`
  const userPrompt = storyFileContent
  verbose && log.normal('Generating story title')
  const resultRaw: string = await completionByOpenai({
    userPrompt,
    systemPrompt,
  })
  const result = (() => {
    if (resultRaw.startsWith('"') && resultRaw.endsWith('"')) {
      return resultRaw.slice(1, -1)
    } else {
      return resultRaw
    }
  })()
  await fs.writeFile(titleFilePath, result)
  return { titleFilePath }
}

export const generateStoryDescription = async ({
  config,
  storyFilePath,
  descriptionFilePath,
  verbose,
  force,
}: {
  config: Config
  storyFilePath: string
  descriptionFilePath: string
  verbose?: boolean
  force?: boolean
}) => {
  descriptionFilePath = path.resolve(config.contentDir, descriptionFilePath)
  storyFilePath = path.resolve(config.contentDir, storyFilePath)
  const { fileExists: storyFileExists } = await isFileExists({ filePath: storyFilePath })
  if (!storyFileExists) {
    throw new Error(`Story file does not exist: ${storyFilePath}`)
  }
  const { fileExists: descriptionFileExists } = await isFileExists({ filePath: descriptionFilePath })
  if (descriptionFileExists && !force) {
    throw new Error(`Title file already exists: ${descriptionFilePath}`)
  }
  const { storyFileContent } = await parseStoryFile({ storyFilePath })
  const systemPrompt = `Act as youtube video description generator and generate a description for the story. Reply with text that would make a compelling description for a video based on the story, using hash tags and other stuff. User will provide the story text.`
  const userPrompt = storyFileContent
  verbose && log.normal('Generating story description')
  const result: string = await completionByOpenai({
    userPrompt,
    systemPrompt,
  })
  await fs.writeFile(descriptionFilePath, result)
  return { descriptionFilePath }
}

export const generateStoryAndPicturesTexts = async ({
  config,
  characterFilePath,
  worldFilePath,
  storyTemplateFilePath,
  separate = true,
  itemsFilePath,
  pickIndex,
  storyFilePath,
  picturesTextFilePath,
  verbose,
  force,
}: {
  config: Config
  characterFilePath?: string
  worldFilePath?: string
  storyTemplateFilePath: string
  separate?: boolean
  itemsFilePath?: string
  pickIndex?: number[]
  storyFilePath: string
  picturesTextFilePath: string
  verbose?: boolean
  force?: boolean
}) => {
  characterFilePath = characterFilePath && path.resolve(config.contentDir, characterFilePath)
  worldFilePath = worldFilePath && path.resolve(config.contentDir, worldFilePath)
  storyTemplateFilePath = path.resolve(config.contentDir, storyTemplateFilePath)
  storyFilePath = path.resolve(config.contentDir, storyFilePath)
  picturesTextFilePath = path.resolve(config.contentDir, picturesTextFilePath)
  const storyFileDir = path.dirname(storyFilePath)
  await fs.mkdir(storyFileDir, { recursive: true })
  const { fileExists: storyFileExists } = await isFileExists({ filePath: storyFilePath })
  const { fileExists: picturesFileExists } = await isFileExists({ filePath: picturesTextFilePath })
  if (storyFileExists && !force) {
    throw new Error(`Story file already exists: ${storyFilePath}`)
  }
  if (picturesFileExists && !force) {
    throw new Error(`Pictures file already exists: ${picturesTextFilePath}`)
  }
  const userPromptParts: string[] = []
  const { characterFileContent } = characterFilePath
    ? await parseCharacterFile({ characterFilePath })
    : { characterFileContent: null }
  const { worldFileContent } = worldFilePath ? await parseWorldFile({ worldFilePath }) : { worldFileContent: null }
  const { storyTemplateFileContent } = await parseStoryTemplateFile({ storyTemplateFilePath, itemsFilePath, pickIndex })
  characterFileContent &&
    userPromptParts.push(`===============
Character
===============
${characterFileContent}`)
  worldFileContent &&
    userPromptParts.push(`===============
World
===============
${worldFileContent}`)
  userPromptParts.push(`===============
Story Template
===============
${storyTemplateFileContent}`)
  const { storyParagraphs, picturesParagraphs } = await (async () => {
    if (!separate) {
      const userPrompt = userPromptParts.join('\n\n\n')
      const systemPrompt = `Act as a professional storyteller and craft a dynamic story based on the provided information. Expand each section of the story template into multiple short paragraphs. Do not include any titles, scene headings, or extra metadata—only the story text. Each paragraph should represent a single moment or idea, be concise (around 30–50 words), and be separated by an empty line. This will allow for frequent image changes in the video. Use vivid and engaging language to captivate the audience, ensuring smooth transitions between paragraphs while maintaining a brisk narrative pace.
  After each paragraph provide additional paragraph started with text "Illustrate: ..." and describe what should be on the picture, this will be used to generate images for the story with openai dall-e. So illustration should not violate any rules of openai dall-e.
  When you counting requested words count or requested paragraphs count, do not count "Illustrate: ..." paragraphs.`
      verbose && log.normal('Generating story and pictures text', { storyFilePath }, systemPrompt, userPrompt)
      const result: string = await completionByOpenai({
        userPrompt,
        systemPrompt,
        model: 'o1-preview',
      })
      const resultParagraphs = result.split(/\n+/)
      const storyParagraphs: string[] = resultParagraphs.filter((paragraph) => !paragraph.startsWith('Illustrate:'))
      const picturesParagraphs: string[] = resultParagraphs.filter((paragraph) => paragraph.startsWith('Illustrate:'))
      return { storyParagraphs, picturesParagraphs }
    } else {
      const userPromptStory = userPromptParts.join('\n\n\n')
      const systemPromptStory = `Act as a professional storyteller and craft a dynamic story based on the provided information.
    Expand each section of the story template into multiple short paragraphs.
    Do not include any titles, scene headings, or extra metadata—only the story text.
    Each paragraph should represent a single moment or idea, be concise (around 30–50 words), and be separated by an empty line.
    This will allow for frequent image changes in the video.
    Use vivid and engaging language to captivate the audience, ensuring smooth transitions between paragraphs while maintaining a brisk narrative pace.`
      verbose && log.normal('Generating story', { storyFilePath }, systemPromptStory, userPromptStory)
      const resultStory: string = await completionByOpenai({
        userPrompt: userPromptStory,
        systemPrompt: systemPromptStory,
        model: 'o1-preview',
      })
      const storyParagraphs = resultStory.split(/\n+/)

      const userPromptPictures = storyParagraphs.map((paragraph, i) => `Paragraph ${i + 1}: ${paragraph}`).join('\n\n')
      const systemPromptPictures = `Act as picture generation prompter and generate pictures for each paragraph of the story provided by user.
    Each prompt should be separate paragraph started with text "Illustrate N: ..." and describe what should be on the picture, this will be used to generate images for the story with openai dall-e.
    Count of illustration prompt paragraphs should be equal to count of story paragraphs.`
      verbose && log.normal('Generating pictures prompts', { storyFilePath }, systemPromptPictures, userPromptPictures)
      const resultPictures: string = await completionByOpenai({
        userPrompt: userPromptPictures,
        systemPrompt: systemPromptPictures,
        model: 'o1-preview',
      })
      const picturesParagraphs = resultPictures
        .split(/\n+/)
        .map((paragraph) => paragraph.replace(/^Illustrate \d+: /, ''))
      return { storyParagraphs, picturesParagraphs }
    }
  })()

  const storyFileContent = storyParagraphs.join('\n\n')
  const picturesFileContent = picturesParagraphs.join('\n\n')
  await fs.writeFile(storyFilePath, storyFileContent)
  await fs.writeFile(picturesTextFilePath, picturesFileContent)
  if (storyParagraphs.length !== picturesParagraphs.length) {
    await fs.writeFile(storyFilePath + '.error', storyFileContent + '\n\n ======== \n\n' + picturesFileContent)
    throw new Error('Number of story paragraphs and pictures paragraphs should be equal')
  }
  if (!storyParagraphs.length) {
    throw new Error('No story paragraphs generated')
  }
  const minLengthStoryParagraph = storyParagraphs.reduce((min, paragraph) => {
    return Math.min(min, paragraph.length)
  }, Infinity)
  if (minLengthStoryParagraph < 20) {
    throw new Error('Minimum length of story paragraph is less than 20 characters')
  }
  return { storyFilePath, picturesTextFilePath }
}

export const generateStoryPictures = async ({
  config,
  pictureTemplateFilePath,
  picturesTextFilePath,
  picturesDirPath,
  verbose,
  force,
  cont,
}: {
  config: Config
  pictureTemplateFilePath: string
  picturesTextFilePath: string
  picturesDirPath: string
  verbose?: boolean
  force?: boolean
  cont?: boolean
}) => {
  picturesTextFilePath = path.resolve(config.contentDir, picturesTextFilePath)
  picturesDirPath = path.resolve(config.contentDir, picturesDirPath)
  pictureTemplateFilePath = path.resolve(config.contentDir, pictureTemplateFilePath)
  const { dirExists: picturesDirExists } = await isDirExists({ cwd: picturesDirPath })
  if (picturesDirExists && !force && !cont) {
    throw new Error(`Pcitures directory already exists: ${picturesDirPath}`)
  }
  await fs.mkdir(picturesDirPath, { recursive: true })
  const { pictureTemplateFileContent } = await parsePictureTemplateFile({ pictureTemplateFilePath })
  const { picturesParagraphs } = await parsePicturesTextFilePath({ picturesTextFilePath })
  const picturesFilePaths: string[] = []
  const promises: Array<Promise<any>> = []
  for (const [index, pictureParagraph] of picturesParagraphs.entries()) {
    verbose && log.normal('Generating story image', { index, pictureParagraph })
    const pictureFileName = `${index}.png`
    const pictureFilePath = path.resolve(picturesDirPath, pictureFileName)
    const { fileExists: pictureFileExists } = await isFileExists({ filePath: pictureFilePath })
    if (cont && pictureFileExists) {
      log.normal('Image already exists', { pictureFilePath })
      picturesFilePaths.push(pictureFilePath)
      continue
    }
    picturesFilePaths.push(pictureFilePath)

    const prompt = `${pictureParagraph}.
    
Additional instructions: ${pictureTemplateFileContent}.`
    promises.push(
      imageByOpenai({
        config,
        imageFilePath: pictureFilePath,
        prompt,
        verbose,
      })
    )
  }
  await Promise.all(promises)
  return {
    picturesDirPath,
    picturesFilePaths,
  }
}

export const generateStoryAudioParts = async ({
  config,
  storyFilePath,
  audioPartsDirPath,
  ttsProvider = 'elevenlabs',
  lang,
  verbose,
  force,
  cont,
}: {
  config: Config
  storyFilePath: string
  audioPartsDirPath: string
  ttsProvider?: 'azureai' | 'elevenlabs'
  lang: string
  verbose?: boolean
  force?: boolean
  cont?: boolean
}) => {
  storyFilePath = path.resolve(config.contentDir, storyFilePath)
  audioPartsDirPath = path.resolve(config.contentDir, audioPartsDirPath)
  const { dirExists: audioPartsDirExists } = await isDirExists({ cwd: audioPartsDirPath })
  if (audioPartsDirExists && !force && !cont) {
    throw new Error(`Audio parts directory already exists: ${audioPartsDirExists}`)
  }
  await fs.mkdir(audioPartsDirPath, { recursive: true })
  const { storyParagraphs } = await parseStoryFile({ storyFilePath })
  const audioPartFilePaths: string[] = []
  for (const [index, storyParagraph] of storyParagraphs.entries()) {
    verbose && log.normal('Generating story audio part', { index, storyParagraph })
    const audioDataFileName = `${index}.json`
    const audioPartFileName = `${index}.mp3`
    const audioDataFilePath = path.resolve(audioPartsDirPath, audioDataFileName)
    const audioPartFilePath = path.resolve(audioPartsDirPath, audioPartFileName)
    const { fileExists: audioPartFileExists } = await isFileExists({ filePath: audioPartFilePath })
    if (cont && audioPartFileExists) {
      log.normal('Audio part already exists', { pictureFilePath: audioPartFilePath })
      audioPartFilePaths.push(audioPartFilePath)
      continue
    }
    audioPartFilePaths.push(audioPartFilePath)
    if (ttsProvider === 'elevenlabs') {
      await ttsMegasimpleWithTimestampsByElevenlabs({
        text: storyParagraph,
        lang,
        verbose,
        distAudioPath: audioPartFilePath,
        distDataPath: audioDataFilePath,
      })
    } else if (ttsProvider === 'azureai') {
      await ttsMegasimpleByAzureai({
        text: storyParagraph,
        lang,
        verbose,
        distAudioPath: audioPartFilePath,
      })
    }
  }
  return {
    audioPartsDirPath,
    audioPartFilePaths,
  }
}

export const generateStoryAudio = async ({
  config,
  audioFilePath,
  audioPartsDirPath,
  verbose,
  force,
}: {
  config: Config
  audioFilePath: string
  audioPartsDirPath: string
  verbose?: boolean
  force?: boolean
}) => {
  audioFilePath = path.resolve(config.contentDir, audioFilePath)
  audioPartsDirPath = path.resolve(config.contentDir, audioPartsDirPath)
  const { dirExists: audioPartsDirExists } = await isDirExists({ cwd: audioPartsDirPath })
  if (!audioPartsDirExists) {
    throw new Error(`Audio parts directory does not exist: ${audioPartsDirPath}`)
  }
  const { fileExists: audioFileExists } = await isFileExists({ filePath: audioFilePath })
  if (audioFileExists && !force) {
    throw new Error(`Audio file already exists: ${audioFilePath}`)
  }
  verbose && log.normal('Generating story audio', { audioFilePath, audioPartsDirPath })
  const audioPartFilePathsRaw = await fs.readdir(audioPartsDirPath)
  const audioPartFilePaths = audioPartFilePathsRaw
    .filter((audioPartFilePath) => audioPartFilePath.endsWith('.mp3'))
    .map((audioPartFilePath) => {
      const index = parseInt(path.basename(audioPartFilePath).split('.')[0])
      return { index, audioPartFilePath }
    })
    .sort((a, b) => a.index - b.index)
    .map(({ audioPartFilePath }) => path.resolve(audioPartsDirPath, audioPartFilePath))
  await concatAudios({
    audioPaths: audioPartFilePaths,
    outputAudioPath: audioFilePath,
    verbose,
  })
  return {
    audioPartFilePaths,
  }
}

export const generateStoryVideoByPictures = async ({
  config,
  videoFilePath,
  picturesDirPath,
  audioPartsDirPath,
  withTransition = true,
  cont,
  verbose,
  force,
}: {
  config: Config
  videoFilePath: string
  picturesDirPath: string
  audioPartsDirPath: string
  withTransition?: boolean
  cont?: boolean
  verbose?: boolean
  force?: boolean
}) => {
  videoFilePath = path.resolve(config.contentDir, videoFilePath)
  picturesDirPath = path.resolve(config.contentDir, picturesDirPath)
  const { dirExists: picturesDirExists } = await isDirExists({ cwd: picturesDirPath })
  if (!picturesDirExists) {
    throw new Error(`Pictures directory does not exist: ${picturesDirPath}`)
  }
  const { fileExists: videoFileExists } = await isFileExists({ filePath: videoFilePath })
  if (videoFileExists && !force) {
    throw new Error(`Video file already exists: ${videoFilePath}`)
  }
  verbose && log.normal('Generating story video by pictures', { videoFilePath, picturesDirPath })
  const picturesPathsRaw = await fs.readdir(picturesDirPath)
  const picturesPaths = picturesPathsRaw
    .map((picturePath) => {
      const index = parseInt(path.basename(picturePath).split('.')[0])
      return { index, picturePath }
    })
    .sort((a, b) => a.index - b.index)
    .map(({ picturePath }) => path.resolve(picturesDirPath, picturePath))

  const audioPartFilePathsRaw = await fs.readdir(audioPartsDirPath)
  const audioPartFilePaths = audioPartFilePathsRaw
    .filter((audioPartFilePath) => audioPartFilePath.endsWith('.mp3'))
    .map((audioPartFilePath) => {
      const index = parseInt(path.basename(audioPartFilePath).split('.')[0])
      return { index, audioPartFilePath }
    })
    .sort((a, b) => a.index - b.index)
    .map(({ audioPartFilePath }) => path.resolve(audioPartsDirPath, audioPartFilePath))
  const durationsMs: number[] = []
  for (const audioPartFilePath of audioPartFilePaths) {
    const audioPartDuration = await getAudioDuration({ audioPath: audioPartFilePath })
    durationsMs.push(audioPartDuration)
  }
  if (withTransition) {
    await concatImagesToVideoWithTransitions({
      imagesPaths: picturesPaths,
      durationsMs,
      cont,
      outputVideoPath: videoFilePath,
      verbose,
    })
  } else {
    await concatImagesToVideo({
      imagesPaths: picturesPaths,
      durationsMs,
      outputVideoPath: videoFilePath,
      verbose,
    })
  }
  return {
    audioPartFilePaths: picturesPaths,
  }
}

export const uploadStoryToYoutube = async ({
  storyTitleFilePath,
  storyDescriptionFilePath,
  videoFilePath,
  playlistId,
  config,
  verbose,
  force,
}: {
  storyTitleFilePath: string
  storyDescriptionFilePath: string
  videoFilePath: string
  playlistId?: string
  config: Config
  verbose?: boolean
  force?: boolean
}) => {
  storyTitleFilePath = path.resolve(config.contentDir, storyTitleFilePath)
  storyDescriptionFilePath = path.resolve(config.contentDir, storyDescriptionFilePath)
  videoFilePath = path.resolve(config.contentDir, videoFilePath)
  const { fileExists: storyTitleFileExists } = await isFileExists({ filePath: storyTitleFilePath })
  if (!storyTitleFileExists) {
    throw new Error(`Story title file does not exist: ${storyTitleFilePath}`)
  }
  const { fileExists: storyDescriptionFileExists } = await isFileExists({ filePath: storyDescriptionFilePath })
  if (!storyDescriptionFileExists) {
    throw new Error(`Story description file does not exist: ${storyDescriptionFilePath}`)
  }
  const { fileExists: videoFileExists } = await isFileExists({ filePath: videoFilePath })
  if (!videoFileExists) {
    throw new Error(`Video file does not exist: ${videoFilePath}`)
  }
  const title = await fs.readFile(storyTitleFilePath, 'utf-8')
  const description = await fs.readFile(storyDescriptionFilePath, 'utf-8')
  playlistId = playlistId || config.youtubePlaylistId || undefined
  verbose && log.normal('Uploading story to youtube', { videoFilePath, title, description, playlistId })
  const result = await youtube.uploadFile({
    config,
    title,
    description,
    playlistId,
    filePath: videoFilePath,
    verbose,
    force,
    privacyStatus: 'public',
  })
  return result
}

export const getNextEpisodeNumber = async ({ episodesDir, config }: { episodesDir: string; config: Config }) => {
  episodesDir = path.resolve(config.contentDir, episodesDir)
  const { dirExists: episodesDirExists } = await isDirExists({ cwd: episodesDir })
  if (!episodesDirExists) {
    throw new Error(`Episodes directory does not exist: ${episodesDir}`)
  }
  const episodesPathsRaw = await fs.readdir(episodesDir)
  const episodesPaths = episodesPathsRaw
    // find all directoreies with numbers inside
    .filter((episodePath) => /^\d+$/.test(episodePath))
    .map((episodePath) => parseInt(episodePath))
    .sort((a, b) => a - b)
  if (episodesPaths.length === 0) {
    throw new Error(`No episodes found in directory: ${episodesDir}`)
  }
  const lastEpisodeNumber = episodesPaths[episodesPaths.length - 1]
  const nextEpisodeNumber = lastEpisodeNumber + 1
  return { lastEpisodeNumber, nextEpisodeNumber }
}

export const getStoryWordsTimestamps = async ({
  audioPartsDirPath,
  config,
}: {
  audioPartsDirPath: string
  config: Config
}) => {
  audioPartsDirPath = path.resolve(config.contentDir, audioPartsDirPath)
  const audioPartFilePathsRaw = await fs.readdir(audioPartsDirPath)
  const audioPartFilePaths = audioPartFilePathsRaw
    .filter((audioPartFilePath) => audioPartFilePath.endsWith('.json'))
    .map((audioPartFilePath) => {
      const index = parseInt(path.basename(audioPartFilePath).split('.')[0])
      return { index, audioPartFilePath }
    })
    .sort((a, b) => a.index - b.index)
    .map(({ audioPartFilePath }) => path.resolve(audioPartsDirPath, audioPartFilePath))
  const audioPartFileDataRaws = await Promise.all(
    audioPartFilePaths.map(async (audioPartFilePath) => {
      const audioPartFileData = await fs.readFile(audioPartFilePath, 'utf-8')
      return { info: JSON.parse(audioPartFileData), filePath: audioPartFilePath }
    })
  )
  const partCharactersInfo: Array<{
    characters: string[]
    character_start_times_seconds: number[]
    character_end_times_seconds: number[]
  }> = []
  if (audioPartFileDataRaws.length === 0) {
    throw new Error('No audio part files found')
  }
  for (const [, audioPartFileDataRaw] of audioPartFileDataRaws.entries()) {
    const audioPartInfoParseResult = z
      .object({
        characters: z.array(z.string()),
        character_start_times_seconds: z.array(z.number()),
        character_end_times_seconds: z.array(z.number()),
      })
      .safeParse(audioPartFileDataRaw.info)
    if (!audioPartInfoParseResult.success) {
      throw new Error(
        `Invalid audio part file data: ${audioPartFileDataRaw.filePath}, because ${audioPartInfoParseResult.error}`
      )
    }
    if (
      audioPartInfoParseResult.data.characters.length !==
      audioPartInfoParseResult.data.character_start_times_seconds.length
    ) {
      throw new Error(
        `Invalid audio part file data: ${audioPartFileDataRaw.filePath}, because character_start_times_seconds length is not equal to characters length`
      )
    }
    if (
      audioPartInfoParseResult.data.characters.length !==
      audioPartInfoParseResult.data.character_end_times_seconds.length
    ) {
      throw new Error(
        `Invalid audio part file data: ${audioPartFileDataRaw.filePath}, because character_end_times_seconds length is not equal to characters length`
      )
    }
    partCharactersInfo.push(audioPartInfoParseResult.data)
  }
  const fullCharactersInfo: {
    characters: string[]
    character_start_times_seconds: number[]
    character_end_times_seconds: number[]
  } = {
    characters: [],
    character_start_times_seconds: [],
    character_end_times_seconds: [],
  }
  let lastCharacterEndTime = 0
  for (const partCharactersInfoItem of partCharactersInfo) {
    const partCharactersInfoItemWithOffsets = {
      ...partCharactersInfoItem,
      character_start_times_seconds: partCharactersInfoItem.character_start_times_seconds.map(
        (time) => time + lastCharacterEndTime
      ),
      character_end_times_seconds: partCharactersInfoItem.character_end_times_seconds.map(
        (time) => time + lastCharacterEndTime
      ),
    }
    lastCharacterEndTime =
      partCharactersInfoItemWithOffsets.character_end_times_seconds[
        partCharactersInfoItemWithOffsets.character_end_times_seconds.length - 1
      ]
    fullCharactersInfo.characters.push(...partCharactersInfoItemWithOffsets.characters)
    fullCharactersInfo.character_start_times_seconds.push(
      ...partCharactersInfoItemWithOffsets.character_start_times_seconds
    )
    fullCharactersInfo.character_end_times_seconds.push(
      ...partCharactersInfoItemWithOffsets.character_end_times_seconds
    )
  }
  const wordsTimestamps: Array<{
    word: string
    startMs: number
    endMs: number
  }> = []

  let currentWord = ''
  let wordStartSeconds: number | null = null
  let wordEndSeconds: number | null = null

  for (let i = 0; i < fullCharactersInfo.characters.length; i++) {
    const character = fullCharactersInfo.characters[i]
    const startSeconds = fullCharactersInfo.character_start_times_seconds[i]
    const endSeconds = fullCharactersInfo.character_end_times_seconds[i]

    if (character.trim() === '') {
      // Character is whitespace
      if (currentWord !== '') {
        // End of a word
        wordsTimestamps.push({
          word: currentWord,
          startMs: Math.floor((wordStartSeconds as number) * 1_000),
          endMs: Math.floor((wordEndSeconds as number) * 1_000),
        })
        currentWord = ''
        wordStartSeconds = null
        wordEndSeconds = null
      }
    } else {
      // Character is not whitespace
      if (currentWord === '') {
        // Start of a new word
        wordStartSeconds = startSeconds
      }
      currentWord += character
      wordEndSeconds = endSeconds
    }
  }

  // After loop, check if any word remains
  if (currentWord !== '') {
    wordsTimestamps.push({
      word: currentWord,
      startMs: Math.floor((wordStartSeconds as number) * 1_000),
      endMs: Math.floor((wordEndSeconds as number) * 1_000),
    })
  }
  return { wordsTimestamps }
}

export const applyAssSubtitlesToStoryVideo = async ({
  config,
  inputVideoPath,
  outputVideoPath,
  audioPartsDirPath,
  verbose,
  force,
}: {
  config: Config
  inputVideoPath: string
  outputVideoPath: string
  audioPartsDirPath: string
  verbose?: boolean
  force?: boolean
}) => {
  inputVideoPath = path.resolve(config.contentDir, inputVideoPath)
  outputVideoPath = path.resolve(config.contentDir, outputVideoPath)
  audioPartsDirPath = path.resolve(config.contentDir, audioPartsDirPath)
  const { fileExists: inputVideoFileExists } = await isFileExists({ filePath: inputVideoPath })
  if (!inputVideoFileExists) {
    throw new Error(`Input video file does not exist: ${inputVideoPath}`)
  }
  const { fileExists: outputVideoFileExists } = await isFileExists({ filePath: outputVideoPath })
  if (outputVideoFileExists && !force) {
    throw new Error(`Output video file already exists: ${outputVideoPath}`)
  }
  const { wordsTimestamps } = await getStoryWordsTimestamps({ audioPartsDirPath, config })
  verbose &&
    log.normal('Applying ass subtitles to story video', {
      inputVideoFilePath: inputVideoPath,
      outputVideoFilePath: outputVideoPath,
    })
  return await applyAssSubtitlesToVideo({
    inputVideoPath,
    outputVideoPath,
    wordsTimestamps,
    verbose,
  })
}
