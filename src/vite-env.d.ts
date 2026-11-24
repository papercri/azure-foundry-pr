/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AZURE_FOUNDRY_AGENT_ENDPOINT?: string
  readonly VITE_AZURE_FOUNDRY_API_KEY?: string
  readonly VITE_AZURE_DEPLOYMENT_NAME?: string
  readonly VITE_AZURE_API_VERSION?: string
}
