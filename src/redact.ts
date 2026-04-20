/**
 * Strip user:password from https:// and ssh:// URLs in a string so that
 * credentials never leak into log output, error toasts, or the output channel.
 * Applied at every UI surface that displays error messages.
 */
export function redactCredentials(text: string): string {
  return text.replace(
    /(https?:\/\/|ssh:\/\/)([^@/\s]+):([^@/\s]+)@/g,
    '$1***:***@',
  );
}
