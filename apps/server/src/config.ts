import os from 'node:os'
import path from 'node:path'

export interface ServerConfig {
  novelsDir: string
  appConfigPath: string
  logsDir: string
  port: number
  host: string
}

export function loadConfig(): ServerConfig {
  const home = process.env.NOVEL_HOME ?? path.join(os.homedir(), '.novel')
  return {
    novelsDir: process.env.NOVEL_NOVELS_DIR ?? path.join(home, 'Novels'),
    appConfigPath: path.join(home, 'config.json'),
    logsDir: path.join(home, 'logs'),
    port: Number(process.env.PORT ?? 4317),
    host: process.env.HOST ?? '127.0.0.1',
  }
}
