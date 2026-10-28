import tseslint from 'typescript-eslint';
import nx from '@nx/eslint-plugin';
import prettier from 'eslint-config-prettier';
import oracleBoundary from './tools/oracle-boundary.mjs';

export default tseslint.config(
  {
    // Saved AWS publication snapshots are private deployment artifacts, not source.
    ignores: [
      '**/dist/**',
      'node_modules/**',
      '.nx/**',
      '**/.next/**',
      '**/.deployment/**',
    ],
  },
  ...tseslint.configs.recommended,
  {
    // A nested publication clone contains another ESLint config; pin our root.
    languageOptions: {
      parserOptions: { tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    files: ['libs/**/*.ts', 'apps/**/*.ts', 'apps/**/*.tsx'],
    plugins: { '@nx': nx },
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: [],
          depConstraints: [
            {
              sourceTag: 'layer:stripe-integration',
              onlyDependOnLibsWithTags: [
                'layer:money',
                'layer:ingestion-domain',
              ],
            },
            {
              sourceTag: 'layer:stripe-postgres',
              onlyDependOnLibsWithTags: [
                'layer:stripe-integration',
                'layer:ingestion-domain',
                'layer:worker-postgres',
              ],
            },
            {
              sourceTag: 'layer:integrations',
              onlyDependOnLibsWithTags: [
                'layer:stripe-integration',
                'layer:stripe-postgres',
              ],
            },
            {
              sourceTag: 'layer:operations-read',
              onlyDependOnLibsWithTags: ['layer:integrity-postgres'],
            },
            {
              sourceTag: 'layer:ops',
              onlyDependOnLibsWithTags: [
                'layer:operations-read',
                'layer:money',
              ],
            },
            {
              sourceTag: 'layer:integrity-postgres',
              onlyDependOnLibsWithTags: [],
            },
            {
              sourceTag: 'layer:worker-postgres',
              onlyDependOnLibsWithTags: ['layer:ingestion-domain'],
            },
            {
              sourceTag: 'layer:control-domain',
              onlyDependOnLibsWithTags: ['layer:money'],
            },
            {
              sourceTag: 'layer:control-postgres',
              onlyDependOnLibsWithTags: ['layer:control-domain'],
            },
            {
              sourceTag: 'layer:exception-domain',
              onlyDependOnLibsWithTags: ['layer:money'],
            },
            {
              sourceTag: 'layer:exception-postgres',
              onlyDependOnLibsWithTags: ['layer:exception-domain'],
            },
            {
              sourceTag: 'layer:reconciliation-domain',
              onlyDependOnLibsWithTags: [
                'layer:money',
                'layer:ingestion-domain',
              ],
            },
            {
              sourceTag: 'layer:reconciliation-postgres',
              onlyDependOnLibsWithTags: ['layer:reconciliation-domain'],
            },
            {
              sourceTag: 'layer:bank-domain',
              onlyDependOnLibsWithTags: [
                'layer:money',
                'layer:ingestion-domain',
              ],
            },
            {
              sourceTag: 'layer:bank-postgres',
              onlyDependOnLibsWithTags: ['layer:bank-domain'],
            },
            {
              sourceTag: 'layer:processor-domain',
              onlyDependOnLibsWithTags: [
                'layer:money',
                'layer:ingestion-domain',
              ],
            },
            {
              sourceTag: 'layer:processor-postgres',
              onlyDependOnLibsWithTags: ['layer:processor-domain'],
            },
            {
              sourceTag: 'layer:ingestion-domain',
              onlyDependOnLibsWithTags: ['layer:money'],
            },
            {
              sourceTag: 'layer:ingestion-postgres',
              onlyDependOnLibsWithTags: ['layer:ingestion-domain'],
            },
            {
              sourceTag: 'trust:runtime',
              notDependOnLibsWithTags: ['trust:oracle'],
            },
            {
              sourceTag: 'layer:simulator',
              onlyDependOnLibsWithTags: ['layer:money', 'layer:ledger-domain'],
            },
            {
              sourceTag: 'layer:simulator-oracle',
              onlyDependOnLibsWithTags: ['layer:money', 'layer:simulator'],
            },
            {
              sourceTag: 'layer:money',
              onlyDependOnLibsWithTags: ['layer:money'],
            },
            {
              sourceTag: 'layer:ledger-domain',
              onlyDependOnLibsWithTags: ['layer:money'],
            },
            {
              sourceTag: 'layer:ledger-data',
              onlyDependOnLibsWithTags: ['layer:money', 'layer:ledger-domain'],
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.{ts,tsx,js,mjs}'],
    plugins: { 'vigil-boundaries': oracleBoundary },
    rules: {
      'vigil-boundaries/no-oracle-import': 'error',
      'vigil-boundaries/operations-browser': 'error',
    },
  },
  {
    files: ['libs/**/src/**/*.ts'],
    ignores: ['libs/stripe-integration/**', 'libs/stripe-postgres/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: ['stripe', 'stripe/*', '@vigil/stripe-*'] },
      ],
    },
  },
  prettier,
);
