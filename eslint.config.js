const eslint = require('@eslint/js')
const tseslint = require('typescript-eslint')
const figmaPlugin = require('@figma/eslint-plugin-figma-plugins')

// The Figma plugin's type-aware rules read `context.parserServices`, which
// ESLint 9 removed (it's now `context.sourceCode.parserServices`). Hand each
// rule a context that still has it, until the plugin supports ESLint 9.
const figmaPluginCompat = {
  ...figmaPlugin,
  rules: Object.fromEntries(
    Object.entries(figmaPlugin.rules).map(([name, rule]) => [
      name,
      {
        ...rule,
        create: (context) =>
          rule.create(
            new Proxy(context, {
              get: (target, prop) =>
                prop === 'parserServices' ? target.sourceCode.parserServices : Reflect.get(target, prop),
            }),
          ),
      },
    ]),
  ),
}

module.exports = tseslint.config(
  eslint.configs.recommended,
  // @typescript-eslint/recommended-type-checked is too aggressive for
  // widget code...it doesn't seem to like JSX element return values or
  // unbundling the `widget` object for use* hooks. So we'll use
  // tseslint.configs.recommended instead.
  tseslint.configs.recommended,
  {
    plugins: {
      '@figma/figma-plugins': figmaPluginCompat,
    },
    rules: {
      ...figmaPlugin.configs.recommended.rules,
      // allow underscore-prefixing of unused variables
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    // The Figma rules need type information.
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: { project: './tsconfig.json', tsconfigRootDir: __dirname },
    },
  },
  {
    ignores: ['code.js', 'dist', 'eslint.config.js'],
  },
)
