import { googleDrive } from '@/exports'
import { closeBrowser, visitPage } from '@/lib/browser'
import type { Config } from '@/lib/config'
import { converWavToMp3 } from '@/lib/editor'
import { getEnv } from '@/lib/env'
import { getMetaByFilePath, parseFileName, updateMeta } from '@/lib/meta'
import type { LangProcessed } from '@/lib/utils'
import { wait } from '@/lib/utils'
import axios, { isAxiosError } from 'axios'
import fs from 'fs'
import path from 'path'
import type { ElementHandle, Page } from 'puppeteer'
import { pipeline } from 'stream'
import { isFileExists, log } from 'svag-cli-utils'
import util from 'util'
const streamPipeline = util.promisify(pipeline)

const maxRetryNumber = 3

const authorize = async ({ verbose, retryNumber = 0 }: { verbose?: boolean; retryNumber?: number } = {}): Promise<{
  page: Page
}> => {
  try {
    const email = getEnv('RASK_EMAIL')
    const password = getEnv('RASK_PASSWORD')
    const page = await visitPage('https://app.rask.ai/')

    verbose && log.normal('Checking if already authorized', { retryNumber })

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
      }, 20_000)
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
      }, 1_000)
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
    } catch {
      throw new Error('No authorized header after sign in')
    }
  } catch (error) {
    await closeBrowser()
    if (retryNumber < maxRetryNumber) {
      return await authorize({ verbose, retryNumber: retryNumber + 1 })
    }
    throw error
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
  force,
  retryNumber = 0,
}: {
  config: Config
  filePath: string
  srcLang: LangProcessed
  distLang: LangProcessed
  verbose?: boolean
  googleDriveDirId?: string
  force?: boolean
  retryNumber?: number
}): Promise<{
  projectId: string
  srcLang: LangProcessed
  distLang: LangProcessed
  processed: boolean
}> => {
  try {
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
        force,
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
        force,
        verbose,
      })
    }
  } catch (error) {
    await closeBrowser()
    if (retryNumber < maxRetryNumber) {
      return await createProjectWithBrowserByFilePath({
        config,
        filePath,
        srcLang,
        distLang,
        verbose,
        googleDriveDirId,
        retryNumber: retryNumber + 1,
      })
    }
    throw error
  }
}

const createProjectWithBrowserByUrlAndFilePath = async ({
  config,
  googleDrivePublicUrl,
  filePath,
  srcLang,
  distLang,
  verbose,
  force,
  retryNumber = 0,
}: {
  config: Config
  googleDrivePublicUrl: string
  filePath: string
  srcLang: LangProcessed
  distLang: LangProcessed
  verbose?: boolean
  force?: boolean
  retryNumber?: number
}): Promise<{
  projectId: string
  srcLang: LangProcessed
  distLang: LangProcessed
  processed: boolean
}> => {
  try {
    verbose && log.normal('Creating project with browser', { googleDrivePublicUrl, srcLang, distLang, retryNumber })
    const filePathAbs = path.resolve(config.contentDir, filePath)
    const { meta, metaFilePath } = getMetaByFilePath({ filePath, config })
    const exRecord = meta.rask.projects.find((p) => p.srcUrl === googleDrivePublicUrl || p.srcFilePath === filePathAbs)
    if (exRecord && !force) {
      verbose && log.normal('Project already created', exRecord.id)
      return { projectId: exRecord.id, srcLang, distLang, processed: false }
    }
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
    await projectNameInput.evaluate((el) => ((el as any).value = ''))
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
    meta.rask.projects.push({
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
    return { projectId, srcLang, distLang, processed: true }
  } catch (error) {
    await closeBrowser()
    if (retryNumber < maxRetryNumber) {
      return await createProjectWithBrowserByUrlAndFilePath({
        config,
        googleDrivePublicUrl,
        filePath,
        srcLang,
        distLang,
        force,
        verbose,
        retryNumber: retryNumber + 1,
      })
    }
    throw error
  }
}

const getProjectStatusWithBrowser = async ({
  projectId,
  verbose,
  retryNumber = 0,
}: {
  projectId: string
  verbose?: boolean
  retryNumber?: number
}): Promise<{
  status: string
}> => {
  try {
    verbose && log.normal('Getting dubbing status', { projectId, retryNumber })
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
        if (text?.includes('Dub Video')) {
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
  } catch (error) {
    await closeBrowser()
    if (retryNumber < maxRetryNumber) {
      return await getProjectStatusWithBrowser({ projectId, verbose, retryNumber: retryNumber + 1 })
    }
    throw error
  }
}

const startDubbingWithBrowser = async ({
  projectId,
  verbose,
  retryNumber = 0,
}: {
  projectId: string
  verbose?: boolean
  retryNumber?: number
}): Promise<{
  processed: boolean
}> => {
  try {
    verbose && log.normal('Starting dubbing', { projectId, retryNumber })

    const { status } = await getProjectStatusWithBrowser({ projectId, verbose })
    if (status === 'dubbed') {
      verbose && log.normal('Already dubbed', projectId)
      return { processed: false }
    }

    const { page } = await authorize({ verbose })
    await page.goto(`https://app.rask.ai/project/${projectId}`)
    await wait(10)

    const buttons = await page.$$('button[type="button"]')
    const buttonsDub = await (async () => {
      const result: ElementHandle[] = []
      for (const button of buttons) {
        const text = await button.evaluate((el) => el.textContent)
        if (text?.includes('Dub Video')) {
          result.push(button)
        }
      }
      return result
    })()
    if (!buttonsDub.length) {
      throw new Error('No button with text Dub Video')
    }
    if (buttonsDub.length > 1) {
      throw new Error('Multiple buttons with text Dub Video')
    }
    await buttonsDub[0].press('Enter')
    await wait(2)

    const buttons1 = await page.$$('button[type="button"]')
    const buttonsDub1 = await (async () => {
      const result: ElementHandle[] = []
      for (const button of buttons1) {
        const text = await button.evaluate((el) => el.textContent)
        if (text?.includes('Dub Video')) {
          result.push(button)
        }
      }
      return result
    })()
    if (!buttonsDub1.length) {
      await closeBrowser()
      verbose && log.normal('Dubbing started', projectId)
      return { processed: true }
    }
    if (buttonsDub1.length === 2) {
      await buttonsDub1[1].press('Enter')
      await wait(2)
      const buttons11 = await page.$$('button[type="button"]')
      const buttonsDub11 = await (async () => {
        const result: ElementHandle[] = []
        for (const button of buttons11) {
          const text = await button.evaluate((el) => el.textContent)
          if (text?.includes('Dub Video')) {
            result.push(button)
          }
        }
        return result
      })()
      if (!buttonsDub11.length) {
        await closeBrowser()
        verbose && log.normal('Dubbing started', projectId)
        return { processed: true }
      }
      throw new Error('Dubbing not started after second click')
    }
    throw new Error('Dubbing not started after first click, and no second button found')
  } catch (error) {
    await closeBrowser()
    if (retryNumber < maxRetryNumber) {
      return await startDubbingWithBrowser({ projectId, verbose, retryNumber: retryNumber + 1 })
    }
    throw error
  }
}

const waitWhileProcessingWithBrowser = async ({
  projectId,
  verbose,
  retryNumber = 0,
}: {
  projectId: string
  verbose?: boolean
  retryNumber?: number
}): Promise<{
  status: string
}> => {
  try {
    log.normal('Waiting while processing', { projectId, retryNumber })
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
  } catch (error) {
    await closeBrowser()
    if (retryNumber < maxRetryNumber) {
      return await waitWhileProcessingWithBrowser({ projectId, verbose, retryNumber: retryNumber + 1 })
    }
    throw error
  }
}

const downloadDubbingWithBrowser = async ({
  config,
  projectId,
  filePath,
  force,
  verbose,
  retryNumber = 0,
}: {
  config: Config
  projectId: string
  filePath: string
  force?: boolean
  verbose?: boolean
  retryNumber?: number
}): Promise<{
  filePath: string
}> => {
  try {
    verbose && log.normal('Searching download link', { projectId, retryNumber })
    const { meta, metaFilePath } = getMetaByFilePath({ filePath, config })
    const filePathAbs = path.resolve(config.contentDir, filePath)
    const exRecordBefore = meta.rask.projects.find((p) => p.distFilePath === filePathAbs)
    if (exRecordBefore && !force) {
      verbose && log.normal('Already downloaded', projectId)
      return { filePath: filePathAbs }
    }
    const { page } = await authorize({ verbose })
    await page.goto(`https://app.rask.ai/project/${projectId}`)
    await wait(10)
    const parsedFileName = parseFileName(filePath)
    if (parsedFileName.ext !== 'wav') {
      throw new Error('Only wav files are allowed')
    }

    const buttons = await page.$$('button[type="button"]')
    const buttonDownload = await (async () => {
      for (const button of buttons) {
        const text = await button.evaluate((el) => el.textContent)
        if (text?.includes('Download')) {
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

    const thatAudioButton = getNonNullable(await page.$('text/Audio with voice and background'))
    // this button inside a with hred. Find parent "a" and get this href
    const url = await thatAudioButton.evaluate((el) => {
      const a = el.closest('a')
      return a?.href
    })
    if (!url) {
      throw new Error('No href for audio with voice only')
    }
    await closeBrowser()

    verbose && log.normal('Downloading dubbing file', { projectId })
    await (async () => {
      try {
        const response = await axios({
          method: 'get',
          url,
          responseType: 'stream',
        })
        await streamPipeline(response.data, fs.createWriteStream(filePathAbs))
        return response
      } catch (error) {
        if (isAxiosError(error)) {
          throw new Error(JSON.stringify(error.response?.data, null, 2))
        }
        throw error
      }
    })()

    const exRecord = meta.rask.projects.find((p) => p.id === projectId)
    if (exRecord) {
      exRecord.distFilePath = filePathAbs
      updateMeta({ meta, metaFilePath })
    }
    verbose && log.normal('Downloaded dubbing', projectId)
    return { filePath: filePathAbs }
  } catch (error) {
    await closeBrowser()
    if (retryNumber < maxRetryNumber) {
      return await downloadDubbingWithBrowser({
        config,
        projectId,
        filePath,
        verbose,
        force,
        retryNumber: retryNumber + 1,
      })
    }
    throw error
  }
}

const downloadDubbingWithBrowserAndConvertToMp3 = async ({
  config,
  projectId,
  filePath,
  force,
  verbose,
}: {
  config: Config
  projectId: string
  filePath: string
  force?: boolean
  verbose?: boolean
}) => {
  const { filePath: wavFilePath } = await downloadDubbingWithBrowser({ config, projectId, filePath, force, verbose })
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
