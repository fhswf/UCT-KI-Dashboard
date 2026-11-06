import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default [
    js.configs.recommended,
    prettier,
    {
        languageOptions: {
            globals: globals.node   // process, console, __dirname, Buffer, etc.
        },
        rules: {
            'no-unused-vars': 'warn',
            'no-console': 'off',
        }
    }
];