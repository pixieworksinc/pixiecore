import jsdoc from 'eslint-plugin-jsdoc';
import tseslint from 'typescript-eslint';

const productionFiles = [
  'src/core/**/*.ts',
  'src/plugins/**/*.ts',
];

export default [
  {
    ignores: [
      'dist/**',
      'build/**',
      'coverage/**',
      'src/**/generated/**',
      'src/**/tests/**',
    ],
  },
  {
    files: productionFiles,
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      jsdoc,
    },
    settings: {
      jsdoc: {
        mode: 'typescript',
      },
    },
    rules: {
      'jsdoc/check-alignment': 'error',
      'jsdoc/check-indentation': 'error',
      'jsdoc/check-param-names': 'error',
      'jsdoc/check-tag-names': 'error',
      'jsdoc/check-types': 'error',
      'jsdoc/empty-tags': 'error',
      'jsdoc/no-bad-blocks': 'error',
      'jsdoc/no-types': 'error',
      'jsdoc/require-description': 'error',
      'jsdoc/require-jsdoc': ['error', {
        checkConstructors: true,
        contexts: [
          'ExportNamedDeclaration > FunctionDeclaration',
          'ExportNamedDeclaration > TSInterfaceDeclaration',
          'ExportNamedDeclaration > TSTypeAliasDeclaration',
          'ExportNamedDeclaration > TSEnumDeclaration',
          'TSInterfaceDeclaration > TSMethodSignature',
          'TSInterfaceDeclaration > TSCallSignatureDeclaration',
        ],
        exemptEmptyConstructors: false,
        exemptEmptyFunctions: false,
        require: {
          ArrowFunctionExpression: false,
          ClassDeclaration: true,
          ClassExpression: false,
          FunctionDeclaration: false,
          FunctionExpression: false,
          MethodDefinition: true,
        },
      }],
      'jsdoc/require-param-description': 'error',
      'jsdoc/require-param-name': 'error',
      'jsdoc/require-returns-description': 'error',
      'jsdoc/tag-lines': ['error', 'any', {
        startLines: 1,
      }],
    },
  },
];
