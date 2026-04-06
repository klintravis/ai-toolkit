import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

function getUserHome(userHome?: string): string {
  return path.resolve(userHome ?? os.homedir());
}

function normalizeSlashes(inputPath: string): string {
  return inputPath.replace(/\\/g, '/');
}

function trimTrailingSlash(inputPath: string): string {
  if (inputPath === '/' || /^[A-Za-z]:\/$/.test(inputPath)) {
    return inputPath;
  }

  return inputPath.replace(/\/+$/, '');
}

function pathHasPrefix(targetPath: string, rootPath: string): boolean {
  if (targetPath === rootPath) {
    return true;
  }

  if (rootPath.endsWith('/')) {
    return targetPath.startsWith(rootPath);
  }

  return targetPath.startsWith(`${rootPath}/`);
}

/**
 * Expands a leading "~/" prefix to the user's home directory.
 */
export function expandHomePath(inputPath: string, userHome?: string): string {
  if (inputPath === '~') {
    return normalizeSlashes(getUserHome(userHome));
  }

  if (inputPath.startsWith('~/') || inputPath.startsWith('~\\')) {
    const suffix = inputPath.slice(2);
    return normalizeSlashes(path.join(getUserHome(userHome), suffix));
  }

  return normalizeSlashes(inputPath);
}

/**
 * Converts a path into a stable normalized form for equality/prefix checks.
 */
export function normalizeForComparison(inputPath: string, userHome?: string): string {
  const expandedPath = expandHomePath(inputPath, userHome);
  const resolvedPath = path.resolve(expandedPath);
  const normalizedPath = trimTrailingSlash(normalizeSlashes(path.normalize(resolvedPath)));

  return process.platform === 'win32'
    ? normalizedPath.toLowerCase()
    : normalizedPath;
}

/**
 * Converts an input path to ~/relative form if it is inside the user home.
 */
export function toHomeRelativePath(inputPath: string, userHome?: string): string | undefined {
  const resolvedHome = path.resolve(getUserHome(userHome));
  const expandedInput = expandHomePath(inputPath, userHome);
  const resolvedInput = path.resolve(expandedInput);

  const relativeToHome = path.relative(resolvedHome, resolvedInput);
  if (relativeToHome === '') {
    return '~';
  }

  if (relativeToHome.startsWith('..') || path.isAbsolute(relativeToHome)) {
    return undefined;
  }

  return `~/${normalizeSlashes(relativeToHome)}`;
}

/**
 * Returns true if inputPath resolves to any root path or a descendant path.
 */
export function isPathUnderAnyRoot(inputPath: string, roots: string[], userHome?: string): boolean {
  if (roots.length === 0) {
    return false;
  }

  const normalizedInput = normalizeForComparison(inputPath, userHome);
  for (const root of roots) {
    const normalizedRoot = normalizeForComparison(root, userHome);
    if (pathHasPrefix(normalizedInput, normalizedRoot)) {
      return true;
    }
  }

  return false;
}

/**
 * Convert an absolute directory path to a portable toolkit ID.
 * Uses ~/relative form when under the user's home, otherwise forward-slash absolute.
 */
export function toToolkitId(dirPath: string): string {
  return toHomeRelativePath(dirPath) ?? path.resolve(dirPath).replace(/\\/g, '/');
}

/**
 * Returns true if the path exists on disk (file, directory, or symlink target).
 */
export async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.promises.access(targetPath);
    return true;
  } catch {
    return false;
  }
}
