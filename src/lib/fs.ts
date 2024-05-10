import fg from 'fast-glob'
import fs from 'fs'

export const removeVideosAndAudios = async ({ dirPath }: { dirPath: string }) => {
  const filesPaths = await fg([`${dirPath}/**/*.{mp4,mp3}`])
  for (const filePath of filesPaths) {
    fs.unlinkSync(filePath)
  }
  return { filesPaths }
}

export const replaceIllegalSymbolsFromFileName = (fileName: string) => {
  return fileName.replace(/[/\\?%*:|"<>]/g, '_')
}
