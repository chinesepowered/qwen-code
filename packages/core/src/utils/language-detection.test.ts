/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { getLanguageFromFilePath } from './language-detection.js';

describe('getLanguageFromFilePath', () => {
  it('maps common extensions to languages', () => {
    expect(getLanguageFromFilePath('src/index.ts')).toBe('TypeScript');
    expect(getLanguageFromFilePath('app.py')).toBe('Python');
    expect(getLanguageFromFilePath('main.go')).toBe('Go');
  });

  it('is case-insensitive on the extension', () => {
    expect(getLanguageFromFilePath('README.MD')).toBe('Markdown');
    expect(getLanguageFromFilePath('Component.TSX')).toBe('TypeScript');
  });

  it('maps extensionless well-known filenames', () => {
    expect(getLanguageFromFilePath('Dockerfile')).toBe('Dockerfile');
    expect(getLanguageFromFilePath('path/to/Dockerfile')).toBe('Dockerfile');
  });

  it('maps dotfiles whose basename already starts with a dot', () => {
    // Regression: a leading dot is not an extension, so these fall to the
    // filename branch. Prepending another dot would look up `..gitignore`.
    expect(getLanguageFromFilePath('.gitignore')).toBe('Git');
    expect(getLanguageFromFilePath('.dockerignore')).toBe('Docker');
    expect(getLanguageFromFilePath('.npmignore')).toBe('npm');
    expect(getLanguageFromFilePath('.editorconfig')).toBe('EditorConfig');
    expect(getLanguageFromFilePath('.prettierrc')).toBe('Prettier');
    expect(getLanguageFromFilePath('.eslintrc')).toBe('ESLint');
    expect(getLanguageFromFilePath('.babelrc')).toBe('Babel');
  });

  it('resolves dotfiles nested in a directory', () => {
    expect(getLanguageFromFilePath('project/.gitignore')).toBe('Git');
  });

  it('returns undefined for unknown extensions and names', () => {
    expect(getLanguageFromFilePath('archive.unknownext')).toBeUndefined();
    expect(getLanguageFromFilePath('LICENSE')).toBeUndefined();
    expect(getLanguageFromFilePath('noextension')).toBeUndefined();
  });
});
