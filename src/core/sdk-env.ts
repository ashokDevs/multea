// Doesn't modify process.env - just creates a filtered copy for the SDK
export function buildSdkEnv(authMethod: 'api' | 'auth'): Record<string, string> {
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;

    // If using Claude Code auth, exclude ANTHROPIC_API_KEY from SDK env
    if (authMethod === 'auth' && key === 'ANTHROPIC_API_KEY') {
      continue;
    }

    env[key] = value;
  }

  return env;
}
