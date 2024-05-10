/* eslint-disable no-useless-catch */
import { googleDrive } from '@/exports'
import { closeBrowser, visitPage } from '@/lib/browser'
import { Config } from '@/lib/config'
import { converWavToMp3 } from '@/lib/editor'
import { getEnv } from '@/lib/env'
import { getMetaByFilePath, parseFileName, updateMeta } from '@/lib/meta'
import { LangProcessed, wait } from '@/lib/utils'
import axios, { isAxiosError } from 'axios'
import fs from 'fs'
import path from 'path'
import { ElementHandle } from 'puppeteer'
import { pipeline } from 'stream'
import { isFileExists, log } from 'svag-cli-utils'
import util from 'util'
const streamPipeline = util.promisify(pipeline)

const authorize = async ({ verbose }: { verbose?: boolean } = {}) => {
  const email = getEnv('RASK_EMAIL')
  const password = getEnv('RASK_PASSWORD')
  const page = await visitPage('https://app.rask.ai/')

  verbose && log.normal('Checking if already authorized')

  const authorizedHeaderSelector = 'text/Translate video and audio'
  const signInButtonSelector = 'text/Sign in'
  const { signInButton, authorizedHeader } = await new Promise<{
    signInButton: ElementHandle | null
    authorizedHeader: ElementHandle | null
  }>((resolve) => {
    const timeout = setTimeout(() => {
      clearInterval(interval)
      resolve({
        signInButton: null,
        authorizedHeader: null,
      })
    }, 20000)
    const interval = setInterval(() => {
      void (async () => {
        const signInButton = await page.$(signInButtonSelector)
        const authorizedHeader = await page.$(authorizedHeaderSelector)
        if (signInButton || authorizedHeader) {
          clearTimeout(timeout)
          clearInterval(interval)
          resolve({
            signInButton,
            authorizedHeader,
          })
        }
      })()
    }, 1000)
  })
  if (!signInButton && !authorizedHeader) {
    throw new Error('No account button and no sign in button')
  }
  if (authorizedHeader) {
    verbose && log.normal('Already authorized')
    return { page }
  }
  if (!signInButton) {
    throw new Error('No sign in button')
  }
  verbose && log.normal('Start signing in')
  await signInButton.click()
  await wait(3)

  const emailInputSelector = '[name="email"]'
  const passwordInputSelector = '[type="password"]'
  await page.waitForSelector(emailInputSelector)
  await page.waitForSelector(passwordInputSelector)

  await page.type(emailInputSelector, email)
  await page.type(passwordInputSelector, password)
  await page.keyboard.press('Enter')

  await wait(5)

  await page.goto('https://app.rask.ai/')

  try {
    await page.waitForSelector(authorizedHeaderSelector)
    verbose && log.normal('Signed in')
    return { page }
  } catch (err) {
    throw new Error('No authorized header after sign in')
  }
}

const getNonNullable = <T>(value: T): NonNullable<T> => {
  if (!value) {
    throw new Error('Falsy value')
  }
  return value as NonNullable<T>
}

const createProjectWithBrowserByFilePath = async ({
  config,
  filePath,
  srcLang,
  distLang,
  verbose,
  googleDriveDirId,
}: {
  config: Config
  filePath: string
  srcLang: LangProcessed
  distLang: LangProcessed
  verbose?: boolean
  googleDriveDirId?: string
}) => {
  const filePathAbs = path.resolve(config.contentDir, filePath)
  const { meta } = getMetaByFilePath({ filePath, config })
  const parsedName = parseFileName(filePath)
  const googleDriveFileMeta = meta.googleDrive.files.find((file) => file.name === parsedName.basename)
  if (!parsedName.ext || !['mp4', 'mp3'].includes(parsedName.ext)) {
    throw new Error('Only mp4 and mp3 files are allowed')
  }
  if (googleDriveFileMeta) {
    const { googleDrivePublicUrl } = await googleDrive.getPublicUrl({
      config,
      fileId: googleDriveFileMeta.id,
    })
    return await createProjectWithBrowserByUrlAndFilePath({
      config,
      googleDrivePublicUrl,
      filePath,
      srcLang,
      distLang,
      verbose,
    })
  } else {
    const { fileExists } = await isFileExists({ filePath: filePathAbs })
    if (!fileExists) {
      throw new Error('File not found')
    }
    googleDriveDirId = googleDriveDirId || config.googleDriveDirId || undefined
    if (!googleDriveDirId) {
      throw new Error('No google drive dir id')
    }
    const { googleDriveData } = await googleDrive.uploadFile({
      config,
      filePath,
      dirId: googleDriveDirId,
      verbose,
    })
    if (!googleDriveData.id) {
      throw new Error('No google drive file id after upload')
    }
    const { googleDrivePublicUrl } = await googleDrive.getPublicUrl({
      config,
      fileId: googleDriveData.id,
    })
    return await createProjectWithBrowserByUrlAndFilePath({
      config,
      googleDrivePublicUrl,
      filePath,
      srcLang,
      distLang,
      verbose,
    })
  }
}

const createProjectWithBrowserByUrlAndFilePath = async ({
  config,
  googleDrivePublicUrl,
  filePath,
  srcLang,
  distLang,
  verbose,
}: {
  config: Config
  googleDrivePublicUrl: string
  filePath: string
  srcLang: LangProcessed
  distLang: LangProcessed
  verbose?: boolean
}) => {
  try {
    verbose && log.normal('Creating dubbing with browser', googleDrivePublicUrl, srcLang, distLang)
    const filePathAbs = path.resolve(config.contentDir, filePath)
    const { meta, metaFilePath } = getMetaByFilePath({ filePath, config })
    const parsedName = parseFileName(filePath)
    const projectName = `${parsedName.name}.${distLang}.${parsedName.ext}`
    if (!parsedName.ext || !['mp4', 'mp3'].includes(parsedName.ext)) {
      throw new Error('Only mp4 and mp3 files are allowed')
    }

    const { page } = await authorize({ verbose })

    await page.goto('https://app.rask.ai/')
    verbose && log.normal('Openning form')
    const newProjectButtonSelector = 'text/Get video or audio in a new language'
    await page.waitForSelector(newProjectButtonSelector)
    const newProjectButton = getNonNullable(await page.$(newProjectButtonSelector))
    await wait(3)
    await newProjectButton.click()

    verbose && log.normal('Filling form')
    await wait(3)

    const googleDriveUrlInputSelector = '[name="source_url"]'
    await page.waitForSelector(googleDriveUrlInputSelector)
    await page.type(googleDriveUrlInputSelector, googleDrivePublicUrl)
    await wait(10)

    const projectNameInputSelector = '[name="name"]'
    await page.waitForSelector(projectNameInputSelector)
    const projectNameInput = getNonNullable(await page.$(projectNameInputSelector))
    await projectNameInput.click()
    await wait(1)
    await projectNameInput.evaluate((el) => (el.value = ''))
    await page.type(projectNameInputSelector, projectName)
    await wait(1)

    const speakerNumberInputSelector = 'text/Choose'
    await page.waitForSelector(speakerNumberInputSelector)
    const speakerSunmerInput = getNonNullable(await page.$(speakerNumberInputSelector))
    await speakerSunmerInput.click()
    await wait(1)

    const speakerNumberOneOptionSelector = '[data-value="1"]'
    await page.waitForSelector(speakerNumberOneOptionSelector)
    const speakerNumberOneOption = getNonNullable(await page.$(speakerNumberOneOptionSelector))
    await speakerNumberOneOption.click()

    const allLangsSelects = await page.$$('[placeholder="Select language"]')
    const srcLangSelect = getNonNullable(allLangsSelects[0])
    const distLangSelect = getNonNullable(allLangsSelects[1])

    await srcLangSelect.click()
    await wait(1)
    const srcLangFull = getNonNullable(srcLang === 'en' ? 'English' : srcLang === 'ru' ? 'Russian' : null)
    await srcLangSelect.type(srcLangFull)
    await wait(1)
    const maybeSrcLangOptions = await page.$$(`text/${srcLangFull}`)
    const srcLangOption = getNonNullable(maybeSrcLangOptions[1])
    await wait(1)
    await srcLangOption.click()

    await distLangSelect.click()
    await wait(1)
    const distLangFull = getNonNullable(distLang === 'en' ? 'English (US)' : distLang === 'ru' ? 'Russian' : null)
    await distLangSelect.type(distLangFull)
    await wait(1)
    const maybeDistLangOptions = await page.$$(`text/${distLangFull}`)
    const distLangOption = getNonNullable(maybeDistLangOptions[1])
    await wait(1)
    await distLangOption.click()

    const buttons = await page.$$('button[type="button"]')
    const button = await (async () => {
      for (const button of buttons) {
        const text = await button.evaluate((el) => el.textContent)
        if (text === 'Translate') {
          return button
        }
      }
      throw new Error('No button with text')
    })()
    await button.click()
    await wait(10)

    const uploadPopupTitleSelector = 'text/Upload video or audio to translate'
    const uploadPopupTitle = await page.$(uploadPopupTitleSelector)
    if (uploadPopupTitle) {
      throw new Error('Upload popup title found, but should not')
    }

    const ptojectCardSelector = `text/${projectName}`
    await page.waitForSelector(ptojectCardSelector)
    const projectCard = getNonNullable(await page.$(ptojectCardSelector))
    await projectCard.click()
    await wait(10)

    const currentUrl = page.url()
    if (!currentUrl.startsWith('https://app.rask.ai/project/')) {
      throw new Error('No project url after form submit')
    }
    const projectId = currentUrl.split('/').pop()
    if (!projectId) {
      throw new Error('No projectId after upload')
    }
    meta.rask.dubbings.push({
      id: projectId,
      srcLang,
      distLang,
      distFilePath: null,
      srcFilePath: filePathAbs,
      srcUrl: googleDrivePublicUrl,
    })
    updateMeta({ meta, metaFilePath })
    await closeBrowser()
    verbose && log.normal('Dubbing created')
    return { projectId, srcLang, distLang }
  } catch (err) {
    // await closeBrowser()
    throw err
  }
}

const getProjectStatusWithBrowser = async ({ projectId, verbose }: { projectId: string; verbose?: boolean }) => {
  try {
    verbose && log.normal('Getting dubbing status', projectId)
    const { page } = await authorize({ verbose })
    await page.goto(`https://app.rask.ai/project/${projectId}`)
    await wait(10)

    const buttons = await page.$$('button[type="button"]')
    const buttonTranslated = await (async () => {
      for (const button of buttons) {
        const text = await button.evaluate((el) => el.textContent)
        if (text === 'Translated') {
          return button
        }
      }
      return null
    })()
    if (!buttonTranslated) {
      throw new Error('No button with text translated')
    }
    const buttonDub = await (async () => {
      for (const button of buttons) {
        const text = await button.evaluate((el) => el.textContent)
        if (text.includes('Dub Video')) {
          return button
        }
      }
      return null
    })()
    const isButtonTranslatedDisabled = await buttonTranslated.evaluate((el) => el.disabled)
    const status = (() => {
      if (!isButtonTranslatedDisabled) {
        return 'dubbed'
      }
      if (buttonDub) {
        return 'awaitingForDubbing'
      }
      return 'processing'
    })()
    await closeBrowser()
    verbose && log.normal('Dubbing status got', projectId, status)
    return { status }
  } catch (err) {
    // await closeBrowser()
    throw err
  }
}

const startDubbingWithBrowser = async ({ projectId, verbose }: { projectId: string; verbose?: boolean }) => {
  try {
    verbose && log.normal('Starting dubbing', projectId)
    const { page } = await authorize({ verbose })
    await page.goto(`https://app.rask.ai/project/${projectId}`)
    await wait(10)

    const buttons = await page.$$('button[type="button"]')
    const buttonDub = await (async () => {
      for (const button of buttons) {
        const text = await button.evaluate((el) => el.textContent)
        if (text.includes('Dub Video')) {
          return button
        }
      }
      return null
    })()
    if (!buttonDub) {
      throw new Error('No button with text translated')
    }
    await buttonDub.press('Enter')
    await wait(10)
    await closeBrowser()
    verbose && log.normal('Dubbing started', projectId)
  } catch (err) {
    // await closeBrowser()
    throw err
  }
}

const waitWhileProcessingWithBrowser = async ({
  projectId,
  verbose,
}: {
  projectId: string
  verbose?: boolean
}): Promise<{
  status: string
}> => {
  const result = await getProjectStatusWithBrowser({ projectId, verbose })
  if (result.status !== 'processing') {
    verbose && log.normal('Processing finished', result)
    return result
  }
  verbose && log.normal('Waiting while processing', result)
  await wait(30)
  const awaitedResult = await waitWhileProcessingWithBrowser({ projectId })
  verbose && log.normal('Processing finished', result)
  return awaitedResult
}

const downloadDubbingWithBrowser = async ({
  config,
  projectId,
  filePath,
  verbose,
}: {
  config: Config
  projectId: string
  filePath: string
  verbose?: boolean
}) => {
  try {
    verbose && log.normal('Searching download link', projectId)
    const { meta, metaFilePath } = getMetaByFilePath({ filePath, config })
    const { page } = await authorize({ verbose })
    await page.goto(`https://app.rask.ai/project/${projectId}`)
    await wait(10)
    const parsedFileName = parseFileName(filePath)
    if (parsedFileName.ext !== 'wav') {
      throw new Error('Only wav files are allowed')
    }
    const filePathAbs = path.resolve(config.contentDir, filePath)

    const buttons = await page.$$('button[type="button"]')
    const buttonDownload = await (async () => {
      for (const button of buttons) {
        const text = await button.evaluate((el) => el.textContent)
        if (text.includes('Download')) {
          return button
        }
      }
      return null
    })()
    if (!buttonDownload) {
      throw new Error('No button with text download')
    }
    await buttonDownload.click()
    await wait(1)

    const audioButton = getNonNullable(await page.$('text/Audio'))
    await audioButton.click()
    await wait(1)

    const thatAudioButton = getNonNullable(await page.$('text/Audio with voice only'))
    // this button inside a with hred. Find parent "a" and get this href
    const url = await thatAudioButton.evaluate((el) => {
      const a = el.closest('a')
      return a?.href
    })
    if (!url) {
      throw new Error('No href for audio with voice only')
    }
    await closeBrowser()

    verbose && log.normal('Downloading dubbing file', projectId)
    await (async () => {
      try {
        const response = await axios({
          method: 'get',
          url,
          responseType: 'stream',
        })
        await streamPipeline(response.data, fs.createWriteStream(filePathAbs))
        return response
      } catch (err) {
        if (isAxiosError(err)) {
          throw new Error(JSON.stringify(err.response?.data, null, 2))
        }
        throw err
      }
    })()

    const exRecord = meta.rask.dubbings.find((dubbing) => dubbing.id === projectId)
    if (exRecord) {
      exRecord.distFilePath = filePathAbs
      updateMeta({ meta, metaFilePath })
    }
    verbose && log.normal('Downloaded dubbing', projectId)
    return { filePath: filePathAbs }
  } catch (err) {
    // await closeBrowser()
    throw err
  }
}

const downloadDubbingWithBrowserAndConvertToMp3 = async ({
  config,
  projectId,
  filePath,
  verbose,
}: {
  config: Config
  projectId: string
  filePath: string
  verbose?: boolean
}) => {
  const { filePath: wavFilePath } = await downloadDubbingWithBrowser({ config, projectId, filePath, verbose })
  const outputMp3Path = wavFilePath.replace(/\.wav$/, '.mp3')
  await converWavToMp3({ inputWavPath: wavFilePath, outputMp3Path })
  return { filePath: outputMp3Path }
}

const createWaitDownloadConvertDubbing = async ({
  config,
  srcFilePath,
  distFilePath,
  srcLang,
  distLang,
  verbose,
}: {
  config: Config
  srcFilePath: string
  distFilePath: string
  srcLang: LangProcessed
  distLang: LangProcessed
  verbose?: boolean
}) => {
  const { projectId } = await createProjectWithBrowserByFilePath({
    config,
    filePath: srcFilePath,
    srcLang,
    distLang,
    verbose,
  })
  await waitWhileProcessingWithBrowser({ projectId, verbose })
  await startDubbingWithBrowser({ projectId, verbose })
  await waitWhileProcessingWithBrowser({ projectId, verbose })
  const result = await downloadDubbingWithBrowserAndConvertToMp3({ config, projectId, filePath: distFilePath, verbose })
  return { projectId, filePath: result.filePath }
}

export const rask = {
  createProjectWithBrowserByFilePath,
  createProjectWithBrowserByUrlAndFilePath,
  getProjectStatusWithBrowser,
  downloadDubbingWithBrowser,
  downloadDubbingWithBrowserAndConvertToMp3,
  startDubbingWithBrowser,
  waitWhileProcessingWithBrowser,
  createWaitDownloadConvertDubbing,
}