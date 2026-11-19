import firebaseRulesPlugin from '@firebase/eslint-plugin-security-rules';

export default [
  {
    ignores: ['.next/**/*', 'dist/**/*', 'node_modules/**/*', 'src/**/*', 'tests/**/*'],
  },
  firebaseRulesPlugin.configs['flat/recommended'],
];
