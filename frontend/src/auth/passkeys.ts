function decodeBase64Url(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = window.atob(padded);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function encodeBase64Url(buffer: ArrayBuffer | Uint8Array) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';

  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return window
    .btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function mapCredentialDescriptor(
  descriptor: Record<string, unknown>,
): PublicKeyCredentialDescriptor {
  return {
    ...(descriptor as Omit<PublicKeyCredentialDescriptor, 'id'>),
    type: (descriptor.type as PublicKeyCredentialType | undefined) ?? 'public-key',
    id: decodeBase64Url(String(descriptor.id)),
  };
}

export function passkeysSupported() {
  return (
    typeof window !== 'undefined' &&
    typeof window.PublicKeyCredential !== 'undefined' &&
    typeof navigator.credentials !== 'undefined'
  );
}

export async function passkeyConditionalUiSupported() {
  return (
    passkeysSupported() &&
    typeof window.PublicKeyCredential.isConditionalMediationAvailable === 'function' &&
    (await window.PublicKeyCredential.isConditionalMediationAvailable())
  );
}

export function passkeyFriendlyName() {
  return `${navigator.platform || 'Device'} · ${navigator.userAgent.includes('Mobile') ? 'mobile' : 'browser'}`;
}

export async function createPasskey(options: Record<string, unknown>) {
  const publicKey = options.publicKey as Record<string, unknown>;
  if (!publicKey) {
    throw new Error('Missing publicKey in registration options');
  }

  const user = publicKey.user as Record<string, unknown>;
  if (!user) {
    throw new Error('Missing user in registration options');
  }

  const authenticatorSelection = {
    ...((publicKey.authenticatorSelection as Record<string, unknown> | undefined) ?? {}),
    residentKey: 'required' as ResidentKeyRequirement,
    requireResidentKey: true,
  };
  const creationOptions: PublicKeyCredentialCreationOptions = {
    ...(publicKey as Omit<
      PublicKeyCredentialCreationOptions,
      'challenge' | 'user' | 'excludeCredentials'
    >),
    challenge: decodeBase64Url(String(publicKey.challenge)),
    user: {
      name: String(user.name ?? ''),
      displayName: String(user.displayName ?? user.name ?? ''),
      id: decodeBase64Url(String(user.id)),
    },
    excludeCredentials: Array.isArray(publicKey.excludeCredentials)
      ? publicKey.excludeCredentials.map((descriptor) =>
          mapCredentialDescriptor(descriptor as Record<string, unknown>),
        )
      : undefined,
    authenticatorSelection,
  };

  const credential = (await navigator.credentials.create({
    publicKey: creationOptions,
  })) as PublicKeyCredential | null;

  if (!credential) {
    throw new Error('Passkey registration was cancelled.');
  }

  const response = credential.response as AuthenticatorAttestationResponse;
  const transports =
    typeof response.getTransports === 'function' ? response.getTransports() : undefined;

  return {
    id: credential.id,
    rawId: encodeBase64Url(credential.rawId),
    type: credential.type,
    response: {
      attestationObject: encodeBase64Url(response.attestationObject),
      clientDataJSON: encodeBase64Url(response.clientDataJSON),
      transports,
    },
    clientExtensionResults: credential.getClientExtensionResults(),
  };
}

export async function authenticateWithPasskey(options: Record<string, unknown>) {
  const publicKey = options.publicKey as Record<string, unknown>;
  if (!publicKey) {
    throw new Error('Missing publicKey in authentication options');
  }

  const requestOptions: PublicKeyCredentialRequestOptions = {
    ...(publicKey as Omit<PublicKeyCredentialRequestOptions, 'challenge' | 'allowCredentials'>),
    challenge: decodeBase64Url(String(publicKey.challenge)),
    allowCredentials: Array.isArray(publicKey.allowCredentials)
      ? publicKey.allowCredentials.map((descriptor) =>
          mapCredentialDescriptor(descriptor as Record<string, unknown>),
        )
      : undefined,
    userVerification:
      (publicKey.userVerification as UserVerificationRequirement | undefined) ?? 'required',
  };

  const credential = (await navigator.credentials.get({
    mediation: (options.mediation as CredentialMediationRequirement | undefined) ?? 'optional',
    publicKey: requestOptions,
  })) as PublicKeyCredential | null;

  if (!credential) {
    throw new Error('Passkey sign-in was cancelled.');
  }

  const response = credential.response as AuthenticatorAssertionResponse;
  return {
    id: credential.id,
    rawId: encodeBase64Url(credential.rawId),
    type: credential.type,
    response: {
      authenticatorData: encodeBase64Url(response.authenticatorData),
      clientDataJSON: encodeBase64Url(response.clientDataJSON),
      signature: encodeBase64Url(response.signature),
      userHandle: response.userHandle ? encodeBase64Url(response.userHandle) : null,
    },
    clientExtensionResults: credential.getClientExtensionResults(),
  };
}

export function fallbackPasskeyLabel() {
  const label = passkeyFriendlyName().trim();
  return label.length > 1 ? label : 'This device';
}
