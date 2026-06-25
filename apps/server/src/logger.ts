import { pino } from 'pino'

export function createLogger(logFile: string) {
  return pino({
    level: process.env.LOG_LEVEL ?? 'info',
    transport: {
      targets: [
        { target: 'pino/file', options: { destination: logFile, mkdir: true }, level: 'info' },
        { target: 'pino-pretty', options: { colorize: true }, level: 'info' },
      ],
    },
  })
}
