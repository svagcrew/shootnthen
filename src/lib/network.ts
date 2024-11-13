import { createWriteStream, promises as fs } from 'fs'
import https from 'https'

export const downloadFile = async ({
  fileUrl,
  filePath,
}: {
  fileUrl: string
  filePath: string
}): Promise<{ filePath: string }> => {
  return await new Promise((resolve, reject) => {
    const url = new URL(fileUrl)
    const fileStream = createWriteStream(filePath)

    const request = https.get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to get '${fileUrl}' (${response.statusCode})`))
        return
      }

      response.pipe(fileStream)
    })

    fileStream.on('finish', () => {
      fileStream.close()
      resolve({ filePath })
    })

    request.on('error', (error: any) => {
      // fs.unlink(filePath, () => reject(error))
      fs.unlink(filePath)
        .then(() => reject(error))
        .catch(() => reject(error))
    })

    fileStream.on('error', (error: any) => {
      // fs.unlink(filePath, () => reject(error))
      fs.unlink(filePath)
        .then(() => reject(error))
        .catch(() => reject(error))
    })
  })
}
