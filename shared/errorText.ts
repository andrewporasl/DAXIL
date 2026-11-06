// Electron rethrows main-process errors in the renderer as
// "Error invoking remote method 'channel': Error: <message>". Show people only <message>.
export function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^Error invoking remote method '[^']*': (?:\w*Error: )?/, '')
}
