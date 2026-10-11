const lintStagedConfig = {
  // Lint and auto-fix TypeScript and JavaScript files with zero warnings tolerance
  '*.{js,jsx,mjs,cjs,ts,tsx}': [
    'eslint --fix --max-warnings=0',
  ],
};

export default lintStagedConfig;
