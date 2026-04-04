CREATE TABLE auth_passkey (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    credential_id TEXT NOT NULL UNIQUE,
    credential JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMPTZ,
    last_used_session_id UUID REFERENCES auth_session(id) ON DELETE SET NULL
);

CREATE INDEX auth_passkey_user_id_created_at_idx
    ON auth_passkey (user_id, created_at DESC);

CREATE TABLE auth_webauthn_registration (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    state JSONB NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX auth_webauthn_registration_user_id_idx
    ON auth_webauthn_registration (user_id, created_at DESC);

CREATE TABLE auth_webauthn_authentication (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
    device_name TEXT,
    state JSONB NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX auth_webauthn_authentication_user_id_idx
    ON auth_webauthn_authentication (user_id, created_at DESC);
