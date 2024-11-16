import type { Config } from '@/lib/config.js'
import { getEnv } from '@/lib/env.js'
import { parseFileName } from '@/lib/meta.js'
import { downloadFile } from '@/lib/network.js'
import { wait } from '@/lib/utils.js'
import { promises as fs } from 'fs'
import _ from 'lodash'
import OpenAI from 'openai'
import { zodResponseFormat } from 'openai/helpers/zod'
import type { ChatCompletionMessageParam } from 'openai/resources/index.mjs'
import path from 'path'
import SrtParser from 'srt-parser-2'
import { isFileExistsSync, log } from 'svag-cli-utils'
import type { z } from 'zod'

const getOpenaiClient = () => {
  const openaiApiKey = getEnv('OPENAI_API_KEY')
  if (!openaiApiKey) {
    throw new Error('OpenAI API key not provided')
  }
  const openai = new OpenAI({
    apiKey: openaiApiKey,
  })
  return { openai }
}

export const completionByOpenai = async <T>({
  systemPrompt,
  userPrompt,
  jsonSchema,
  zodSchema,
  model = 'gpt-4o',
}: {
  systemPrompt?: string
  userPrompt: string
  jsonSchema?: any
  zodSchema?: z.ZodType<any, any>
  model?: 'gpt-4o' | 'o1-preview'
}): Promise<T> => {
  const { openai } = getOpenaiClient()
  const chatMessages: ChatCompletionMessageParam[] = (() => {
    if (model === 'o1-preview' && !!systemPrompt) {
      return [
        {
          role: 'user' as const,
          content: `_____USER_PROMPT_____
${userPrompt}



_____SYSTEM_PROMPT_____
${systemPrompt}`,
        },
      ]
    } else {
      return [
        ...(systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []),
        { role: 'user' as const, content: userPrompt },
      ]
    }
  })()
  const res = await openai.chat.completions.create({
    messages: chatMessages,
    model,
    ...(!jsonSchema
      ? {}
      : {
          function_call: {
            name: 'structuredResponse',
          },
          functions: [
            {
              name: 'structuredResponse',
              parameters: jsonSchema,
              description: 'Generate structured response',
            },
          ],
        }),
    ...(!zodSchema
      ? {}
      : {
          response_format: zodResponseFormat(zodSchema, 'structuredResponse'),
        }),
  })
  if (jsonSchema) {
    const responseStructuredRaw = res.choices[0].message.function_call?.arguments
    if (!responseStructuredRaw) {
      throw new Error('OpenAI structured response not found')
    }
    const responseStructured = (() => {
      try {
        return JSON.parse(responseStructuredRaw)
      } catch {
        throw new Error('OpenAI structured response not parsed as JSON')
      }
    })()
    if (!responseStructured) {
      throw new Error('OpenAI parsed structured response not found')
    }
    return responseStructured as T
  } else if (zodSchema) {
    return (res.choices[0].message as any).parsed
  } else {
    const responseText = res.choices[0].message.content
    if (!responseText) {
      throw new Error('OpenAI response not found')
    }
    return responseText as T
  }
}

export const imageByOpenai = async ({
  config,
  prompt,
  attemptIndex = 0,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  retryReason = null,
  imageFilePath,
  verbose,
}: {
  config: Config
  prompt: string
  imageFilePath: string
  attemptIndex?: number
  retryReason?: string | null
  verbose?: boolean
}): Promise<{
  imageFilePath: string
}> => {
  imageFilePath = path.resolve(config.contentDir, imageFilePath)
  try {
    const { openai } = getOpenaiClient()
    const res = await openai.images.generate({
      model: 'dall-e-3',
      quality: 'hd',
      prompt,
      size: '1792x1024',
      n: 1,
      response_format: 'url',
    })
    const imagesUrlsOpenAi = res.data.map((item) => item.url).filter(Boolean) as string[]
    if (!imagesUrlsOpenAi?.length) {
      throw new Error('No images')
    }
    await downloadFile({ fileUrl: imagesUrlsOpenAi[0], filePath: imageFilePath })

    return {
      imageFilePath,
    }
  } catch (error: any) {
    verbose && log.red('imageByOpenai Error', error.message)
    // eslint-disable-next-line no-useless-catch
    try {
      const errorMessage = error?.response?.data?.error?.message || error.message || 'Unknown error'
      const responseData = error?.response?.data
      const responseStatus: number = error?.response?.status || error?.status || 0
      const responseCode: number = responseData?.error?.code || error?.code || 0
      const errorReasonByStatus = {
        401: 'weAreUnauthorized' as const,
        429: 'weAreOutOfRequests' as const,
        503: 'openaiOverloaded' as const,
      }[responseStatus]
      const errorReasonByCode = {
        model_not_found: 'modelNotFound' as const,
        content_policy_violation: 'contentPolicyViolation' as const,
      }[responseCode]
      const errorReasonByMessage = errorMessage.includes('Your request was rejected as a result of our safety system')
        ? ('contentPolicyViolation' as const)
        : null
      const errorReason = errorReasonByMessage || errorReasonByCode || errorReasonByStatus || 'unknown'
      // const originalErrorMessage = responseData.error?.message || 'Unknown axios error'
      const normalizedError = new Error('Unknown axios error')

      if (errorReason === 'contentPolicyViolation') {
        if (attemptIndex >= 6) {
          // so we tried 7 times
          throw normalizedError
        }
        const newPrompt = await completionByOpenai<string>({
          systemPrompt:
            'Act as a opani dall-e prompt generator. User will provide you with a prompt, which was rejected by OpenAI DALL-E due to content policy violation. You should generate a new prompt, which will be accepted by OpenAI DALL-E. Reply with the new prompt only.',
          userPrompt: `${prompt}`,
        })
        verbose && log.normal('New prompt', newPrompt)
        return await imageByOpenai({
          config,
          prompt: newPrompt,
          imageFilePath,
          attemptIndex: attemptIndex + 1,
          retryReason: errorReason,
          verbose,
        })
      }

      if (errorReason === 'weAreUnauthorized') {
        throw normalizedError
      }

      if (errorReason === 'weAreOutOfRequests') {
        if (attemptIndex >= 6) {
          // so we tried 7 times
          throw normalizedError
        }
        await new Promise((resolve) => setTimeout(resolve, 5_000))
        return await imageByOpenai({
          config,
          prompt,
          imageFilePath,
          attemptIndex: attemptIndex + 1,
          retryReason: errorReason,
          verbose,
        })
      }

      if (errorReason === 'modelNotFound') {
        throw normalizedError
      }

      if (errorReason === 'openaiOverloaded') {
        if (attemptIndex >= 2) {
          // so we tried 3 times
          throw normalizedError
        }
        await new Promise((resolve) => setTimeout(resolve, 5_000))

        return await imageByOpenai({
          config,
          prompt,
          imageFilePath,
          attemptIndex: attemptIndex + 1,
          retryReason: errorReason,
          verbose,
        })
      }

      throw normalizedError
    } catch (error: any) {
      throw error
    }
  }
}

const translateFewStringByOpenai = async ({
  verbose,
  srcLang,
  distLang,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  translatedStrings = [],
  notTranslatedStrings,
}: {
  verbose?: boolean
  srcLang: string
  distLang: string
  translatedStrings?: Array<{ src: string; dist: string }>
  notTranslatedStrings: string[]
}): Promise<
  Array<{
    src: string
    dist: string
  }>
> => {
  if (notTranslatedStrings.length === 0) {
    throw new Error('No strings to translate')
  }
  const langsNames = {
    en: 'English',
    ru: 'Russian',
    es: 'Spanish',
    pt: 'Portuguese',
    it: 'Italian',
    de: 'German',
    tr: 'Turkish',
  }
  const srcLangName = (langsNames as any)[srcLang] as string
  const distLangName = (langsNames as any)[distLang] as string
  if (!srcLangName || !distLangName) {
    throw new Error('Language name not found')
  }
  let tryIndex = 0
  while (true) {
    try {
      verbose && log.normal('Translating few strings by OpenAI', { srcLang, distLang, tryIndex })
      const systemPromptStart = `Act as subtitles translator.
Translate subtitles provided by user from ${srcLangName} to ${distLangName}.
Short strings should be translated to short strings, long strings to long strings,
because the length of the translated strings should be similar to the original ones.
STRONGLY Keep the original count of strings: ${notTranslatedStrings.length}.
REPLY with only the translated subtitles, WITHOUT additional information, comments, etc.
User will provide you with array of original strings and you should reply with array of translated strings.`
      //       const systemPromptEnd = !translatedStrings ? null : `Take a notice that previously was translated some previous strings and you should continue from there:
      // ${translatedStrings.map(({ src, dist }) => `${src} -> ${dist}`).join('\n')}`
      const systemPromptEnd = null
      const systemPrompt = [systemPromptStart, systemPromptEnd].filter(Boolean).join('\n\n')
      const resRaw = await completionByOpenai<{ translatedArray: string[] }>({
        systemPrompt,
        userPrompt: JSON.stringify(notTranslatedStrings, null, 2),
        jsonSchema: {
          type: 'object',
          properties: {
            translatedArray: {
              type: 'array',
              items: {
                type: 'string',
              },
              minItems: notTranslatedStrings.length,
              maxItems: notTranslatedStrings.length,
            },
          },
          required: ['translatedArray'],
          additionalProperties: false,
        },
        // zodSchema: z.array(z.string()).length(subtitles.length),
      })
      const res = resRaw.translatedArray
      if (!res) {
        throw new Error('Translated array not found')
      }
      if (res.length !== notTranslatedStrings.length) {
        throw new Error(
          `Translated array length mismatch. Expected: ${notTranslatedStrings.length}, got: ${res.length}`
        )
      }
      return res.map((dist, i) => ({ src: notTranslatedStrings[i], dist }))
    } catch (error) {
      verbose && log.red('translateFewStringByOpenai Error', error)
      tryIndex++
      if (tryIndex >= 5) {
        throw error
      } else {
        verbose && log.normal('Retrying translateFewStringByOpenai after 5 sec...', { srcLang, distLang, tryIndex })
        await wait(5)
      }
    }
  }
}

export const translateSrtByOpenai = async ({
  config,
  srcSrtPath,
  distSrtPath,
  srcLang,
  distLang,
  verbose,
  force,
}: {
  config: Config
  srcSrtPath: string
  distSrtPath?: string
  srcLang?: string
  distLang: string
  verbose?: boolean
  force?: boolean
}) => {
  verbose && log.normal('Translating srt', { srcSrtPath, distLang })
  srcSrtPath = path.resolve(config.contentDir, srcSrtPath)
  const parsed = parseFileName(srcSrtPath)
  if (parsed.ext !== 'srt') {
    throw new Error('Only srt files are allowed')
  }
  if (!srcLang) {
    if (parsed.langSingle) {
      srcLang = parsed.langSingle
    } else {
      throw new Error('srcLang not found')
    }
  }
  distSrtPath = distSrtPath || path.resolve(parsed.dirname, `${parsed.name}.${distLang}.srt`)
  const { fileExists } = isFileExistsSync({ filePath: distSrtPath })
  if (fileExists && !force) {
    verbose && log.normal('Srt file already exists', { distSrtPath })
    return { distSrtPath }
  }

  const srcSrtContent = await fs.readFile(srcSrtPath, 'utf8')
  const parser = new SrtParser()
  const srcSubtitles = parser.fromSrt(srcSrtContent) // Parse SRT
  const srcSubtitlesTexts = srcSubtitles.map((subtitle) => subtitle.text.replaceAll('\n', ' '))
  const distSubtitlesTexts: string[] = []

  const chunkSize = 7
  const srcSubtitlesChunks = _.chunk(srcSubtitlesTexts, chunkSize)
  for (const [i, chunk] of srcSubtitlesChunks.entries()) {
    verbose &&
      log.normal('Translating chunk', { chunkSize, chunkNumber: i + 1, totalChunksCount: srcSubtitlesChunks.length })
    const translatedChunk = await translateFewStringByOpenai({
      verbose,
      srcLang,
      distLang,
      notTranslatedStrings: chunk,
    })
    for (const [j, { dist }] of translatedChunk.entries()) {
      distSubtitlesTexts[i * chunkSize + j] = dist
    }
  }

  for (const [i, srcSubtitle] of srcSubtitles.entries()) {
    srcSubtitle.text = distSubtitlesTexts[i]
  }
  const distSrtContent = parser.toSrt(srcSubtitles) // Convert to SRT
  await fs.writeFile(distSrtPath, distSrtContent)

  return {
    distSrtPath,
  }
}

// export const translateSrtByOpenai = async ({
//   // eslint-disable-next-line @typescript-eslint/no-unused-vars
//   config,
//   srcSrtPath,
//   distSrtPath,
//   srcLang,
//   distLang,
//   verbose,
//   force,
// }: {
//   config: Config
//   srcSrtPath: string
//   distSrtPath?: string
//   srcLang?: string
//   distLang: string
//   verbose?: boolean
//   force?: boolean
// }) => {
//   verbose && log.normal('Translating srt', { srcSrtPath, distLang })
//   const parsed = parseFileName(srcSrtPath)
//   if (parsed.ext !== 'srt') {
//     throw new Error('Only srt files are allowed')
//   }
//   if (!srcLang) {
//     if (parsed.langSingle) {
//       srcLang = parsed.langSingle
//     } else {
//       throw new Error('srcLang not found')
//     }
//   }
//   distSrtPath = distSrtPath || path.resolve(parsed.dirname, `${parsed.name}.${distLang}.srt`)
//   const { fileExists } = isFileExistsSync({ filePath: distSrtPath })
//   if (fileExists && !force) {
//     verbose && log.normal('Audio file already exists', { distSrtPath })
//     return { distSrtPath }
//   }

//   const langsNames = {
//     en: 'English',
//     ru: 'Russian',
//   }
//   const srcLangName = (langsNames as any)[srcLang] as string
//   const distLangName = (langsNames as any)[distLang] as string
//   if (!srcLangName || !distLangName) {
//     throw new Error('Language name not found')
//   }

//   // Too bad
//   // const srcSrtContent = await fs.readFile(srcSrtPath, 'utf8')
//   // const resRaw = await completionByOpenai<string>({
//   //   systemPrompt: `Act as SRT files translator.
//   // Translate subtitles provided by user from ${srcLangName} to ${distLangName}.
//   // The subtitles are in the SRT format.
//   // Keep the original formatting.
//   // Keep the original timestamps.
//   // Reply ONLY with the translated subtitles.
//   // Your response should be in the SRT format.`,
//   //   userPrompt: srcSrtContent,
//   // })
//   // const res = resRaw.replace(/^```srt\n/, '').replace(/\n```$/, '')
//   // await fs.writeFile(distSrtPath, res)

//   // Some experiments
//   //   const parser = new SrtParser()
//   //   const subtitles = parser.fromSrt(srcSrtContent) // Parse SRT
//   //   const subtitlesTexts = subtitles.map((subtitle) => subtitle.text.replaceAll('\n', ' '))
//   //   const resRaw = await completionByOpenai<string>({
//   //     systemPrompt: `Act as subtitles translator.
//   // Translate subtitles provided by user from ${srcLangName} to ${distLangName}.
//   // STRONGLY Keep the original count of strings: ${subtitles.length}.
//   // REPLY with only the translated subtitles, WITHOUT additional information, comments, etc.
//   // `,
//   //     // userPrompt: JSON.stringify(subtitlesTexts, null, 2),
//   //     // userPrompt: subtitlesTexts.join('\n----------------\n'),
//   //     userPrompt: subtitlesTexts.join('\n'),
//   //     // jsonSchema: {
//   //     //   type: 'array',
//   //     //   items: {
//   //     //     type: 'string',
//   //     //   },
//   //     //   minItems: subtitles.length,
//   //     //   maxItems: subtitles.length,
//   //     // },
//   //     // zodSchema: z.array(z.string()).length(subtitles.length),
//   //     zodSchema: z.object({ structuredResponse: z.array(z.string()).length(subtitles.length) }),
//   //   })
//   //   // const res = resRaw.trim().split('\n')
//   //   // if (!res || res.length !== subtitles.length) {
//   //   //   throw new Error('Subtitles count mismatch')
//   //   // }
//   //   console.log(555, resRaw)
//   //   const res = resRaw
//   //   for (const [i, subtitle] of subtitles.entries()) {
//   //     subtitle.text = res[i]
//   //   }
//   //   const distSrtContent = parser.toSrt(subtitles) // Convert to SRT
//   //   await fs.writeFile(distSrtPath, distSrtContent)

//   const srcSrtContent = await fs.readFile(srcSrtPath, 'utf8')
//   const parser = new SrtParser()
//   const subtitles = parser.fromSrt(srcSrtContent) // Parse SRT
//   const subtitlesTexts = subtitles.map((subtitle) => subtitle.text.replaceAll('\n', ' '))
//   const resRaw = await completionByOpenai<string>({
//     systemPrompt: `Act as subtitles translator.
//   Translate subtitles provided by user from ${srcLangName} to ${distLangName}.
//   `,
//     // userPrompt: JSON.stringify(subtitlesTexts, null, 2),
//     // userPrompt: subtitlesTexts.join('\n----------------\n'),
//     userPrompt: subtitlesTexts.join('\n'),
//     jsonSchema: {
//       type: 'object',
//       properties: {
//         ...subtitlesTexts.map((text, i) => ({})),
//       },
//       required: ['structuredResponse'],
//       additionalProperties: false,
//     },
//     // zodSchema: z.array(z.string()).length(subtitles.length),
//     zodSchema: z.object({ structuredResponse: z.array(z.string()).length(subtitles.length) }),
//   })
//   // const res = resRaw.trim().split('\n')
//   // if (!res || res.length !== subtitles.length) {
//   //   throw new Error('Subtitles count mismatch')
//   // }
//   console.log(555, resRaw)
//   const res = resRaw
//   for (const [i, subtitle] of subtitles.entries()) {
//     subtitle.text = res[i]
//   }
//   const distSrtContent = parser.toSrt(subtitles) // Convert to SRT
//   await fs.writeFile(distSrtPath, distSrtContent)

//   return {
//     distSrtPath,
//   }
// }
