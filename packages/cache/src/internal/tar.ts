import {exec} from '@actions/exec'
import * as io from '@actions/io'
import {existsSync, writeFileSync} from 'fs'
import * as path from 'path'
import * as utils from './cacheUtils'
import {CompressionMethod} from './constants'

async function getTarPath(args: string[]): Promise<string> {
  // Explicitly use BSD Tar on Windows
  const IS_WINDOWS = process.platform === 'win32'
  if (IS_WINDOWS) {
    const systemTar = `${process.env['windir']}\\System32\\tar.exe`
    if (existsSync(systemTar)) {
      return systemTar
    } else if (await utils.useGnuTar()) {
      args.push('--force-local')
    }
  }
  return await io.which('tar', true)
}

async function execTar(args: string[], cwd?: string): Promise<void> {
  try {
    await exec(`"${await getTarPath(args)}"`, args, {cwd})
  } catch (error) {
    throw new Error(`Tar failed with error: ${error?.message}`)
  }
}

function getWorkingDirectory(): string {
  return process.env['GITHUB_WORKSPACE'] ?? process.cwd()
}

export async function extractTar(
  archivePath: string,
  compressionMethod: CompressionMethod
): Promise<void> {
  // Create directory to extract tar into
  const workingDirectory = getWorkingDirectory()
  await io.mkdirP(workingDirectory)
  // --d: Decompress.
  // --long=#: Enables long distance matching with # bits. Maximum is 30 (1GB) on 32-bit OS and 31 (2GB) on 64-bit.
  // Using 30 here because we also support 32-bit self-hosted runners.
  const args = [
    ...(compressionMethod === CompressionMethod.Zstd
      ? ['--use-compress-program', 'zstd -d --long=30']
      : ['-z']),
    '-xf',
    archivePath.replace(new RegExp(`\\${path.sep}`, 'g'), '/'),
    '-P',
    '-C',
    workingDirectory.replace(new RegExp(`\\${path.sep}`, 'g'), '/')
  ]
  await execTar(args)
}

export async function createTar(
  archiveFolder: string,
  sourceDirectories: string[],
  compressionMethod: CompressionMethod
): Promise<void> {
  // Write source directories to manifest.txt to avoid command length limits
  const manifestFilename = 'manifest.txt'
  const cacheFileName = utils.getCacheFileName(compressionMethod)
  writeFileSync(
    path.join(archiveFolder, manifestFilename),
    sourceDirectories.join('\n')
  )
  // -T#: Compress using # working thread. If # is 0, attempt to detect and use the number of physical CPU cores.
  // --long=#: Enables long distance matching with # bits. Maximum is 30 (1GB) on 32-bit OS and 31 (2GB) on 64-bit.
  // Using 30 here because we also support 32-bit self-hosted runners.
  const workingDirectory = getWorkingDirectory()
  const args = [
    ...(compressionMethod === CompressionMethod.Zstd
      ? ['--use-compress-program', 'zstd -T0 --long=30']
      : ['-z']),
    '-cf',
    cacheFileName.replace(new RegExp(`\\${path.sep}`, 'g'), '/'),
    '-P',
    '-C',
    workingDirectory.replace(new RegExp(`\\${path.sep}`, 'g'), '/'),
    '--files-from',
    manifestFilename
  ]
  await execTar(args, archiveFolder)
}
