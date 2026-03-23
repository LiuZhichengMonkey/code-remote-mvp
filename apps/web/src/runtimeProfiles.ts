import { Provider } from './types';

export interface RuntimeProfileSummary {
  name: string;
  provider: Provider;
  model: string;
  valueCount: number;
  baseUrl?: string;
  authTokenConfigured: boolean;
  isSaved: boolean;
}

export interface RuntimeProfileForm {
  baseUrl: string;
  authToken: string;
  model: string;
}

export interface RuntimeProfileProviderState {
  settingsList: RuntimeProfileSummary[];
  activeProfile: RuntimeProfileSummary | null;
  selectedProfileName: string;
  loading: boolean;
  loaded: boolean;
  isEditing: boolean;
  editForm: RuntimeProfileForm;
  errorMessage: string | null;
}

export type RuntimeProfilesState = Record<Provider, RuntimeProfileProviderState>;

export interface RuntimeProfileMessagePayload {
  provider?: Provider;
  settings?: unknown;
  activeProfile?: unknown;
  selectedProfileName?: unknown;
  settingsName?: unknown;
  message?: string;
  error?: string;
}

export const createEmptyRuntimeProfileForm = (): RuntimeProfileForm => ({
  baseUrl: '',
  authToken: '',
  model: ''
});

export const createRuntimeProfileFormFromProfile = (
  profile?: RuntimeProfileSummary | null
): RuntimeProfileForm => ({
  baseUrl: profile?.baseUrl || '',
  authToken: '',
  model: profile?.model || ''
});

export const normalizeRuntimeProfileSummary = (
  value: unknown,
  fallbackProvider: Provider
): RuntimeProfileSummary | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const profile = value as Record<string, unknown>;
  const provider = profile.provider === 'codex' ? 'codex' : fallbackProvider;

  return {
    name: typeof profile.name === 'string' ? profile.name : '',
    provider,
    model: typeof profile.model === 'string' ? profile.model : '',
    valueCount: typeof profile.valueCount === 'number' ? profile.valueCount : 0,
    baseUrl: typeof profile.baseUrl === 'string' && profile.baseUrl ? profile.baseUrl : undefined,
    authTokenConfigured: Boolean(profile.authTokenConfigured),
    isSaved: Boolean(profile.isSaved)
  };
};

export const normalizeRuntimeProfileList = (
  value: unknown,
  fallbackProvider: Provider
): RuntimeProfileSummary[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(item => normalizeRuntimeProfileSummary(item, fallbackProvider))
    .filter((item): item is RuntimeProfileSummary => item !== null);
};

export const createEmptyRuntimeProfileProviderState = (): RuntimeProfileProviderState => ({
  settingsList: [],
  activeProfile: null,
  selectedProfileName: '',
  loading: false,
  loaded: false,
  isEditing: false,
  editForm: createEmptyRuntimeProfileForm(),
  errorMessage: null
});

export const createRuntimeProfilesState = (): RuntimeProfilesState => ({
  claude: createEmptyRuntimeProfileProviderState(),
  codex: createEmptyRuntimeProfileProviderState()
});

export const applyRuntimeProfileList = (
  currentState: RuntimeProfileProviderState,
  payload: RuntimeProfileMessagePayload,
  provider: Provider
): RuntimeProfileProviderState => {
  const settingsList = normalizeRuntimeProfileList(payload.settings, provider);
  const activeProfile = normalizeRuntimeProfileSummary(payload.activeProfile, provider);
  const selectedProfileName = typeof payload.selectedProfileName === 'string'
    ? payload.selectedProfileName
    : '';

  return {
    ...currentState,
    settingsList,
    activeProfile,
    selectedProfileName,
    loading: false,
    loaded: true,
    editForm: currentState.isEditing
      ? currentState.editForm
      : createRuntimeProfileFormFromProfile(activeProfile),
    errorMessage: null
  };
};

export const applyRuntimeProfileMutation = (
  currentState: RuntimeProfileProviderState,
  payload: RuntimeProfileMessagePayload,
  provider: Provider
): RuntimeProfileProviderState => {
  const activeProfile = normalizeRuntimeProfileSummary(payload.activeProfile, provider);
  const selectedProfileName = typeof payload.selectedProfileName === 'string'
    ? payload.selectedProfileName
    : (typeof payload.settingsName === 'string' ? payload.settingsName : '');

  return {
    ...currentState,
    activeProfile,
    selectedProfileName,
    loading: false,
    loaded: true,
    isEditing: false,
    editForm: createRuntimeProfileFormFromProfile(activeProfile),
    errorMessage: null
  };
};

export const applyRuntimeProfileError = (
  currentState: RuntimeProfileProviderState,
  errorMessage: string | undefined
): RuntimeProfileProviderState => ({
  ...currentState,
  loading: false,
  errorMessage: errorMessage || 'Unknown error'
});
