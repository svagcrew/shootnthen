import path from 'path'
import puppeteer, { Browser, Page } from 'puppeteer'

let openedBrowser: Browser | null = null

export const getBrowser = async () => {
  if (openedBrowser) {
    return openedBrowser
  }
  const browser = await puppeteer.launch(
    Math.random()
      ? {
          headless: false,
          userDataDir: path.resolve(__dirname, './pupdata'),
        }
      : {
          headless: true,
          args: ['--no-sandbox', '--disable-setuid-sandbox'],
        }
  )
  openedBrowser = browser
  return browser
}

export const closeBrowser = async () => {
  const browser = await getBrowser()
  await browser.close()
  openedBrowser = null
}

export const visitPage = async (url: string) => {
  const browser = await getBrowser()
  const page = await browser.newPage()
  page.setDefaultTimeout(30000)
  await page.goto(url)
  await page.setViewport({ width: 1600, height: 600 })
  return page
}

export const replacePage = async (page: Page, url: string) => {
  // close old page tab
  await page.close()
  // open new page tab
  return await visitPage(url)
}
