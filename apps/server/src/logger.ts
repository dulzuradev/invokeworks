export interface Logger {
  info(data: Record<string, unknown>, message: string): void;
  error(data: Record<string, unknown>, message: string): void;
}

function write(level: string, data: Record<string, unknown>, message: string): void {
  process.stdout.write(
    `${JSON.stringify({ level, time: new Date().toISOString(), message, ...data })}\n`,
  );
}

export const logger: Logger = {
  info: (data, message) => write('info', data, message),
  error: (data, message) => write('error', data, message),
};
