import { Config } from '@/lib/config'
import { authenticate } from '@google-cloud/local-auth'
import fs from 'fs/promises'
import { google } from 'googleapis'

// https://developers.google.com/drive/api/quickstart/nodejs?hl=ru

export const getGoogleAuthClient = async ({
  config,
}: {
  config: Config
}): Promise<{
  authClient: any
}> => {
  const SCOPES = ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/youtube']

  async function loadSavedCredentialsIfExist() {
    try {
      const content = await fs.readFile(config.googleTokenJsonPath, 'utf8')
      const credentials = JSON.parse(content)
      return google.auth.fromJSON(credentials)
    } catch (err) {
      return null
    }
  }

  async function saveCredentials(client: any) {
    const content = await fs.readFile(config.googleCredentialsJsonPath, 'utf8')
    const keys = JSON.parse(content)
    const key = keys.installed || keys.web
    const payload = JSON.stringify({
      type: 'authorized_user',
      client_id: key.client_id,
      client_secret: key.client_secret,
      refresh_token: client.credentials.refresh_token,
    })
    await fs.writeFile(config.googleTokenJsonPath, payload)
  }

  const clientJson = await loadSavedCredentialsIfExist()
  if (clientJson) {
    return { authClient: clientJson }
  }
  const clientOauth = await authenticate({
    scopes: SCOPES,
    keyfilePath: config.googleCredentialsJsonPath,
  })
  await saveCredentials(clientOauth)
  return { authClient: clientOauth }
}
